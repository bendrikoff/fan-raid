import cors from '@fastify/cors';
import Fastify from 'fastify';
import { MATCH_ID, TEAM_NAMES, type MatchInfo, type MatchSummary } from '@fan-raid/shared';
import { config } from './config.js';
import { createFeed } from './feed/createFeed.js';
import { SimFeed } from './feed/SimFeed.js';
import { resolveMatchForFeed, type ResolvedMatch } from './feed/TxLineDiscovery.js';
import { MatchRoom } from './engine/MatchRoom.js';
import { Db } from './persist/db.js';
import { Recorder } from './recorder/Recorder.js';
import { registerRoutes } from './api/routes.js';
import { WsGateway } from './ws/gateway.js';
import { createCommitter } from './solana/index.js';

function gameSecondsPerRealSecond(): number {
  switch (config.feedSource) {
    case 'sim':
      return config.simSpeed;
    case 'replay':
      return config.replaySpeed;
    case 'txodds':
      return 1;
    default:
      return 1;
  }
}

function createTestMatchInfo(seq: number): MatchInfo {
  return {
    id: `test-${Date.now()}-${seq}`,
    externalId: 'local-sim',
    source: 'sim',
    isReal: false,
    teams: { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
    competition: 'Test simulation',
    startsAt: new Date().toISOString(),
    status: 'live',
  };
}

function createFallbackLiveMatch(): ResolvedMatch {
  return {
    externalFixtureId: MATCH_ID,
    info: {
      id: MATCH_ID,
      externalId: 'local-fallback',
      source: 'sim',
      isReal: false,
      teams: { home: TEAM_NAMES.home, away: TEAM_NAMES.away },
      competition: 'Local fallback',
      startsAt: new Date().toISOString(),
      status: 'live',
    },
  };
}

async function main(): Promise<void> {
  const db = new Db(config.dbPath);
  const committer = await createCommitter(config);

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  let liveRoom: MatchRoom | null = null;
  let testRoom: MatchRoom | null = null;
  let activeMatch: ResolvedMatch | null = null;

  registerRoutes(app, {
    config,
    db,
    getPhase: () => liveRoom?.currentPhase ?? 'lobby',
    getMinute: () => (liveRoom ? liveRoom.snapshotFor().minute : 0),
    getMatchInfo: () => activeMatch?.info ?? null,
    getLiveSnapshot: (playerId) => liveRoom?.snapshotFor(playerId) ?? null,
  });

  await app.listen({ port: config.serverPort, host: '0.0.0.0' });

  const gateway = new WsGateway(app.server, config);

  const onLiveMatchEnd = async (summary: MatchSummary): Promise<MatchSummary> => {
    db.saveMatchResults(summary, 'live');
    const res = await committer.commitMatchResult(summary);
    return res ? { ...summary, chainSignature: res.signature } : summary;
  };

  let recorder: Recorder | null = null;

  const startLiveMatch = async (): Promise<void> => {
    try {
      activeMatch = await resolveMatchForFeed(config);
    } catch (err) {
      if (config.feedSource !== 'txodds') throw err;
      console.warn(
        `[server] TxODDS discovery failed, starting local simulation fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      activeMatch = createFallbackLiveMatch();
    }
    const matchId = activeMatch.info.id;
    const speed = activeMatch.info.source === 'sim' ? config.simSpeed : gameSecondsPerRealSecond();
    liveRoom = new MatchRoom(gateway.broadcaster('live'), speed, {
      onMatchEnd: onLiveMatchEnd,
      persistAnswer: (row) => db.insertAnswer(matchId, row),
      onFinished: () => {
        if (config.matchAutorestart) {
          console.log(`[server] next live match in ${config.matchRestartDelayMs} ms`);
          setTimeout(() => void startLiveMatch(), config.matchRestartDelayMs);
        }
      },
    }, config.simSeed, activeMatch.info);
    gateway.setRoom('live', liveRoom);

    const feed = activeMatch.info.source === 'sim'
      ? new SimFeed(config.simSpeed, config.simSeed)
      : createFeed(config, activeMatch);
    recorder?.close();
    recorder = new Recorder(config.recordingsDir);
    recorder.attach(feed, matchId);

    liveRoom.start(feed);
    console.log(
      `[server] live match ${matchId} started (feed: ${activeMatch.info.source}, teams: ${activeMatch.info.teams.home} vs ${activeMatch.info.teams.away})`,
    );
  };

  let testSeq = 0;
  const startTestMatch = (): void => {
    const seq = ++testSeq;
    const seed = config.simSeed === undefined ? Date.now() + seq : config.simSeed + seq;
    const matchInfo = createTestMatchInfo(seq);
    testRoom = new MatchRoom(gateway.broadcaster('test'), config.simSpeed, {
      onMatchEnd: (summary) => {
        db.saveMatchResults(summary, 'test');
        return summary;
      },
      onFinished: () => {
        if (config.matchAutorestart) {
          setTimeout(() => startTestMatch(), config.matchRestartDelayMs);
        }
      },
    }, seed, matchInfo);
    gateway.setRoom('test', testRoom);
    testRoom.start(new SimFeed(config.simSpeed, seed));
    console.log(`[server] test match ${matchInfo.id} started (SimFeed)`);
  };

  await startLiveMatch();
  startTestMatch();

  console.log(`[server] Fan Raid started on :${config.serverPort}`);
  console.log(`[server] DEV_MODE=${config.devMode}, SOLANA_ENABLED=${config.solanaEnabled}`);
  console.log(`[server] WS rooms: /ws?room=live and /ws?room=test`);

  const shutdown = (): void => {
    console.log('[server] stopping...');
    liveRoom?.stop();
    testRoom?.stop();
    recorder?.close();
    gateway.close();
    db.close();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
