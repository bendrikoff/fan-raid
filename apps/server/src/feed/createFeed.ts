import type { AppConfig } from '../config.js';
import type { ResolvedMatch } from './TxLineDiscovery.js';
import { defaultTxLineOddsStreamUrl, defaultTxLineScoresStreamUrl } from './TxLineDiscovery.js';
import type { FeedSource } from './FeedSource.js';
import { ReplayFeed } from './ReplayFeed.js';
import { SimFeed } from './SimFeed.js';
import { TxOddsFeed } from './TxOddsFeed.js';

// Feed source factory based on config (sections 3, 5).
export function createFeed(config: AppConfig, match?: ResolvedMatch): FeedSource {
  switch (config.feedSource) {
    case 'sim':
      return new SimFeed(config.simSpeed, config.simSeed);
    case 'replay':
      return new ReplayFeed(config.replayFile, config.replaySpeed);
    case 'txodds':
      const bearerToken = match?.bearerToken ?? config.txoddsBearerToken;
      return new TxOddsFeed({
        apiUrl: config.txoddsApiUrl || defaultTxLineOddsStreamUrl(config),
        scoresApiUrl: config.txoddsScoresApiUrl || defaultTxLineScoresStreamUrl(config),
        apiKey: config.txoddsApiKey,
        bearerToken,
        mode: config.txoddsMode === 'auto' ? 'sse' : config.txoddsMode,
        pollMs: config.txoddsPollMs,
        matchId: match?.externalFixtureId ?? config.txoddsMatchId,
        apiKeyHeader: bearerToken ? 'X-Api-Token' : config.txoddsApiKeyHeader,
        apiKeyPrefix: bearerToken ? '' : config.txoddsApiKeyPrefix,
        subscribeMessage: config.txoddsSubscribeMessage,
        payloadPath: config.txoddsPayloadPath,
        minutePath: config.txoddsMinutePath,
        tsPath: config.txoddsTsPath,
        oddsHomePath: config.txoddsOddsHomePath,
        oddsDrawPath: config.txoddsOddsDrawPath,
        oddsAwayPath: config.txoddsOddsAwayPath,
        eventTypePath: config.txoddsEventTypePath,
        eventTeamPath: config.txoddsEventTeamPath,
        homeTeamName: config.txoddsHomeTeamName || match?.info.teams.home || '',
        awayTeamName: config.txoddsAwayTeamName || match?.info.teams.away || '',
      });
    default:
      throw new Error(`Неизвестный FEED_SOURCE: ${String(config.feedSource)}`);
  }
}
