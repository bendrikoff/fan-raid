import { useCallback, useEffect, useRef, useState } from 'react';
import {
  authDev,
  authTelegram,
  authWallet,
  claimDailyQuest,
  claimMatchCard,
  clearSession,
  isTelegram,
  loadLiveDashboard,
  loadCoinTopupConfig,
  loadAccount,
  loadPlayerProfile,
  payAndVerifyCoinTopup,
  savedSession,
  spendAccountCoins,
  submitLivePrediction,
  updateStoredSessionCoins,
  uploadAccountAvatar,
  type Session,
} from './game/auth.js';
import { PlayerAvatar } from './components/PlayerAvatar.js';
import { store, useGame, type RoomChannel } from './game/store.js';
import { Pick } from './screens/Pick.js';
import { LiveHome } from './screens/Live.js';
import { Arena } from './screens/Arena.js';
import { FinalSummary, HalftimeSummary } from './screens/Summary.js';
import { Leaderboard } from './screens/Leaderboard.js';
import { MiniGames } from './screens/MiniGames.js';
import { Profile } from './screens/Profile.js';
import { Shop } from './screens/Shop.js';
import { Toasts } from './screens/Toasts.js';
import type { AccountProfile, CoinTopupConfig, LiveDashboard, PlayerAchievement, PredictionOptionId, RoomStatePublic } from '@fan-raid/shared';

type BootPhase = 'loading' | 'need-name' | 'ready';
type Surface = 'live' | 'test' | 'top' | 'play' | 'shop' | 'profile';

export function App(): JSX.Element {
  const [phase, setPhase] = useState<BootPhase>('loading');

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(): Promise<void> {
    const saved = savedSession();
    if (saved) {
      try {
        const fresh = await loadAccount(saved.token);
        store.connect(fresh.token);
        setPhase('ready');
        return;
      } catch {
        clearSession();
      }
    }

    if (isTelegram()) {
      try {
        const session = await authTelegram();
        store.connect(session.token);
        setPhase('ready');
        return;
      } catch {
        /* fall through to wallet/dev gate */
      }
    }

    store.connect(null);
    setPhase('ready');
  }

  if (phase === 'loading') {
    return <div className="app-shell center"><p className="muted">Loading...</p></div>;
  }

  if (phase === 'need-name') {
    return <NameGate onDone={(session) => { store.connect(session.token); setPhase('ready'); }} />;
  }

  return <Game />;
}

function NameGate({
  onDone,
  onCancel,
  embedded = false,
}: {
  onDone: (session: Session) => void;
  onCancel?: () => void;
  embedded?: boolean;
}): JSX.Element {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitWallet(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      onDone(await authWallet());
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitDev(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      onDone(await authDev(name.trim() || 'Guest'));
    } catch {
      setError('Could not sign in with dev mode');
    } finally {
      setBusy(false);
    }
  }

  const card = (
    <div className="panel login-card">
        {onCancel && (
          <button className="auth-close-button" type="button" aria-label="Close" onClick={onCancel}>
            X
          </button>
        )}
        <div className="brand login-brand">Fan Raid</div>
        <p className="muted login-copy">Connect your wallet to sign in. One wallet equals one player profile.</p>
        <button className="wallet-login-button" disabled={busy} onClick={() => void submitWallet()}>
          Sign in with wallet
        </button>
        <div className="login-divider"><span>or dev sign-in</span></div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Player name"
          onKeyDown={(e) => e.key === 'Enter' && void submitDev()}
        />
        <button className="dev-login-button" disabled={busy} onClick={() => void submitDev()}>
          Sign in without wallet
        </button>
        {error && <p className="login-error">{error}</p>}
    </div>
  );

  if (embedded) return card;

  return (
    <div className="app-shell center login-shell">
      {card}
    </div>
  );
}

function Game(): JSX.Element {
  const game = useGame();
  const [surface, setSurface] = useState<Surface>('live');
  const [roomChannel, setRoomChannel] = useState<RoomChannel>('live');
  const [session, setSession] = useState<Session | null>(() => savedSession());
  const [coins, setCoins] = useState(() => savedSession()?.coins ?? 0);
  const [topupConfig, setTopupConfig] = useState<CoinTopupConfig | null>(null);
  const [topupBusyId, setTopupBusyId] = useState<string | null>(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [liveDashboard, setLiveDashboard] = useState<LiveDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionOptionId | null>(null);
  const [predictionBusy, setPredictionBusy] = useState(false);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [halftimeClosed, setHalftimeClosed] = useState(false);
  const prevPhase = useRef<string | null>(null);
  const room = game.room;
  const picked = Boolean(room?.you);
  const sessionName = session?.name;
  const isAuthenticated = Boolean(session?.token);

  const notifyAchievements = useCallback((achievements: PlayerAchievement[]): void => {
    for (const achievement of achievements) store.achievementToast(achievement);
  }, []);

  function completeLogin(nextSession: Session): void {
    setSession(nextSession);
    setCoins(nextSession.coins);
    store.connect(nextSession.token, roomChannel);
    setShowLogin(false);
  }

  function requireAuth(): Session | null {
    const current = savedSession() ?? session;
    if (current) return current;
    setShowLogin(true);
    store.toast('Sign in to continue');
    return null;
  }

  useEffect(() => {
    const phase = game.room?.phase ?? null;
    if (prevPhase.current === 'halftime' && phase !== 'halftime') setHalftimeClosed(false);
    prevPhase.current = phase;
  }, [game.room?.phase]);

  useEffect(() => {
    if (!session) return;
    updateStoredSessionCoins(coins);
  }, [coins, session]);

  useEffect(() => {
    const token = session?.token;
    if (!token) return;
    let cancelled = false;
    void loadCoinTopupConfig(token)
      .then((config) => {
        if (!cancelled) setTopupConfig(config);
      })
      .catch(() => {
        if (!cancelled) setTopupConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token]);

  useEffect(() => {
    if (!room || surface !== 'live') return;

    let cancelled = false;

    async function refresh(showLoading: boolean): Promise<void> {
      if (showLoading) setDashboardLoading(true);
      try {
        const dashboard = await loadLiveDashboard(session?.token);
        if (cancelled) return;
        setLiveDashboard(dashboard);
      } catch {
        if (!cancelled && showLoading) store.toast('Could not load LIVE data');
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    void refresh(true);
    const id = window.setInterval(() => void refresh(false), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [room?.matchId, session?.token, surface]);

  useEffect(() => {
    setSelectedPrediction(liveDashboard?.prediction.selectedOptionId ?? null);
  }, [liveDashboard?.prediction.questionId, liveDashboard?.prediction.selectedOptionId]);

  useEffect(() => {
    const token = session?.token;
    const matchId = game.summary?.matchId;
    if (!token || !matchId) return;

    let cancelled = false;
    void loadPlayerProfile(token)
      .then((profile) => {
        if (cancelled) return;
        notifyAchievements(profile.newAchievements ?? []);
        setProfileRefreshKey((value) => value + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [game.summary?.matchId, notifyAchievements, session?.token]);

  function switchRoom(nextRoomChannel: RoomChannel, nextSurface: Surface): void {
    setRoomChannel(nextRoomChannel);
    setSurface(nextSurface);
    const token = savedSession()?.token ?? session?.token;
    store.connect(token ?? null, nextRoomChannel);
  }

  async function connectWallet(): Promise<Session | null> {
    try {
      const nextSession = await authWallet();
      completeLogin(nextSession);
      store.toast('Wallet connected');
      return nextSession;
    } catch (err) {
      store.toast(walletErrorText(err));
      return null;
    }
  }

  async function spendCoins(amount: number): Promise<boolean> {
    const current = requireAuth();
    if (!current) return false;

    if (coins < amount) {
      store.toast('Not enough coins');
      return false;
    }

    try {
      const updated = await spendAccountCoins(current.token, amount);
      const nextSession = { ...current, ...updated };
      setSession(nextSession);
      setCoins(updated.coins);
      return true;
    } catch {
      store.toast('Could not spend coins');
      return false;
    }
  }

  function syncAccount(updated: AccountProfile): void {
    const current = savedSession() ?? session;
    const nextSession = current ? { ...current, ...updated } : null;
    if (nextSession) setSession(nextSession);
    setCoins(updated.coins);
  }

  async function submitPrediction(): Promise<void> {
    if (predictionBusy) return;
    const current = requireAuth();
    if (!current) return;
    if (!selectedPrediction) {
      store.toast('Choose a prediction option');
      return;
    }

    setPredictionBusy(true);
    try {
      const result = await submitLivePrediction(current.token, selectedPrediction);
      syncAccount(result.account);
      setLiveDashboard(result.dashboard);
      setSelectedPrediction(result.dashboard.prediction.selectedOptionId ?? selectedPrediction);
      store.toast(result.created ? `Prediction submitted: +${result.dashboard.prediction.rewardCoins} coins` : 'Prediction already submitted');
    } catch {
      store.toast('Could not submit prediction');
    } finally {
      setPredictionBusy(false);
    }
  }

  async function claimDaily(): Promise<void> {
    if (dailyBusy) return;
    const current = requireAuth();
    if (!current) return;

    setDailyBusy(true);
    try {
      const result = await claimDailyQuest(current.token);
      syncAccount(result.account);
      setLiveDashboard(result.dashboard);
      store.toast(result.claimed ? `Daily quest claimed: +${result.dashboard.daily.rewardCoins} coins` : 'Daily quest already claimed');
    } catch {
      store.toast('Daily quest is not complete yet');
    } finally {
      setDailyBusy(false);
    }
  }

  async function topupCoins(packageId: string): Promise<void> {
    let current = requireAuth();
    if (!current) return;
    if (!current?.walletAddress) {
      current = await connectWallet();
      if (!current?.walletAddress) return;
    }

    setTopupBusyId(packageId);
    try {
      const receipt = await payAndVerifyCoinTopup(current.token, packageId);
      const nextSession = { ...current, ...receipt };
      setSession(nextSession);
      setCoins(receipt.coins);
      store.toast(`Balance topped up by ${receipt.creditedCoins} coins`);
    } catch (err) {
      store.toast(topupErrorText(err));
    } finally {
      setTopupBusyId(null);
    }
  }

  async function claimCard(): Promise<void> {
    if (claimBusy) return;
    const current = requireAuth();
    if (!current) return;

    setClaimBusy(true);
    try {
      const result = await claimMatchCard(current.token);
      notifyAchievements(result.profile.newAchievements ?? []);
      setProfileRefreshKey((value) => value + 1);
      setSurface('profile');
      store.toast(`Card claimed: ${result.card.title}`);
    } catch {
      store.toast('No match card is available');
    } finally {
      setClaimBusy(false);
    }
  }

  async function uploadAvatar(dataUrl: string): Promise<void> {
    const current = requireAuth();
    if (!current) return;

    try {
      const nextSession = await uploadAccountAvatar(current.token, dataUrl);
      setSession(nextSession);
      setCoins(nextSession.coins);
      store.connect(nextSession.token, roomChannel);
      setProfileRefreshKey((value) => value + 1);
      store.toast('Avatar updated');
    } catch {
      store.toast('Could not upload avatar');
    }
  }

  return (
    <div className={room ? 'game-frame with-player-header' : undefined}>
      {room && (
        <div className="topbar-shell">
          <PlayerHeader
            room={room}
            fallbackName={sessionName}
            coins={coins}
            avatarUrl={session?.avatarUrl}
            walletAddress={session?.walletAddress}
            isAuthenticated={isAuthenticated}
            onConnectWallet={() => void connectWallet()}
            onLogin={() => setShowLogin(true)}
            onProfile={() => setSurface('profile')}
            onLogout={() => {
              clearSession();
              setSession(null);
              setCoins(0);
              setSurface('live');
              store.connect(null, 'live');
              store.toast('You have signed out');
            }}
          />
          <BottomNav
            activeSurface={surface}
            onLive={() => switchRoom('live', 'live')}
            onLeaderboard={() => setSurface('top')}
            onMiniGames={() => setSurface('play')}
            onShop={() => setSurface('shop')}
            onProfile={() => { if (requireAuth()) setSurface('profile'); }}
          />
        </div>
      )}

      {!room ? (
        <div className="app-shell center"><p className="muted">Connecting to match...</p></div>
      ) : surface === 'live' ? (
        <LiveHome
          room={room}
          dashboard={liveDashboard}
          dashboardLoading={dashboardLoading}
          selectedPrediction={selectedPrediction}
          predictionBusy={predictionBusy}
          dailyBusy={dailyBusy}
          isAuthenticated={isAuthenticated}
          onSelectPrediction={setSelectedPrediction}
          onSubmitPrediction={() => void submitPrediction()}
          onClaimDaily={() => void claimDaily()}
          onJoinLive={() => { if (requireAuth()) setSurface('test'); }}
          onTestMatch={() => { if (requireAuth()) switchRoom('test', 'test'); }}
        />
      ) : surface === 'top' ? (
        <Leaderboard
          currentPlayerId={session?.playerId}
          daily={liveDashboard?.daily}
          dailyBusy={dailyBusy}
          isAuthenticated={isAuthenticated}
          onClaimDaily={() => void claimDaily()}
        />
      ) : surface === 'play' ? (
        <MiniGames
          room={room}
          daily={liveDashboard?.daily}
          dailyBusy={dailyBusy}
          isAuthenticated={isAuthenticated}
          onClaimDaily={() => void claimDaily()}
          onJoinLive={() => { if (requireAuth()) setSurface('test'); }}
        />
      ) : surface === 'shop' ? (
        <Shop
          coins={coins}
          walletAddress={session?.walletAddress}
          topupOptions={topupConfig?.options ?? []}
          topupBusyId={topupBusyId}
          onSpendCoins={spendCoins}
          onConnectWallet={() => void connectWallet()}
          onTopupCoins={(packageId) => void topupCoins(packageId)}
        />
      ) : surface === 'profile' ? (
        <Profile
          token={session?.token}
          refreshKey={profileRefreshKey}
          claimBusy={claimBusy}
          onClaimCard={claimCard}
          onUploadAvatar={uploadAvatar}
          onNewAchievements={notifyAchievements}
        />
      ) : !picked ? (
        <Pick />
      ) : (
        <Arena />
      )}

      {surface === 'test' && picked && room && room.phase === 'halftime' && !halftimeClosed && !game.summary && (
        <HalftimeSummary
          room={room}
          top={game.leaderboard?.top ?? []}
          onClose={() => setHalftimeClosed(true)}
        />
      )}

      {surface === 'test' && game.summary && (
        <FinalSummary
          summary={game.summary}
          meId={room?.you?.id}
          claimBusy={claimBusy}
          onClaimCard={claimCard}
        />
      )}

      <Toasts />
      {showLogin && (
        <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Login">
          <NameGate onDone={completeLogin} onCancel={() => setShowLogin(false)} embedded />
        </div>
      )}
    </div>
  );
}

function PlayerHeader({
  room,
  fallbackName,
  coins,
  avatarUrl,
  walletAddress,
  isAuthenticated,
  onConnectWallet,
  onLogin,
  onProfile,
  onLogout,
}: {
  room: RoomStatePublic;
  fallbackName?: string;
  coins: number;
  avatarUrl?: string;
  walletAddress?: string;
  isAuthenticated: boolean;
  onConnectWallet: () => void;
  onLogin: () => void;
  onProfile: () => void;
  onLogout: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  if (!isAuthenticated) {
    return (
      <header className="player-header guest-header" aria-label="Fan Raid">
        <div className="player-brand" aria-label="Fan Raid">
          <span>⚽</span>
          <b>Fan <em>Raid</em></b>
        </div>
        <button className="header-login-button" type="button" onClick={onLogin}>
          Sign in
        </button>
      </header>
    );
  }

  const walletShort = walletAddress ? shortWallet(walletAddress) : undefined;
  const baseName = room.you?.name ?? fallbackName ?? 'Guest';
  const name = walletShort ? `Wallet ${walletShort}` : baseName;
  const effectiveAvatarUrl = room.you?.avatarUrl ?? avatarUrl;
  const status = walletShort ?? (room.you ? 'In match' : 'No side selected');

  return (
    <header className="player-header" aria-label="Player profile">
      <div className="player-brand" aria-label="Fan Raid">
        <span>⚽</span>
        <b>Fan <em>Raid</em></b>
      </div>
      <div className="player-account">
        <div className="player-balance" aria-label={`Balance ${coins} coins`}>
          <span className="coin-icon" aria-hidden="true" />
          <b>{coins.toLocaleString('en-US')}</b>
        </div>
        <span className="player-account-divider" aria-hidden="true" />
        <button
          className="player-id player-menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <PlayerAvatar name={walletShort ? name : baseName} avatarUrl={effectiveAvatarUrl} />
          <div className="player-copy">
            <b>{name}</b>
            <span>{status}</span>
          </div>
          <span className="player-chevron" aria-hidden="true">⌄</span>
        </button>
        {menuOpen && (
          <div className="player-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onProfile();
              }}
            >
              Profile
            </button>
            {!walletAddress && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void onConnectWallet();
                }}
              >
                Connect wallet
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function shortWallet(walletAddress: string): string {
  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

function walletErrorText(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message === 'wallet_requires_https') return 'Wallet login requires HTTPS. Open the site through your HTTPS domain.';
  if (message === 'wallet_not_found') return 'Wallet not found. Install Phantom/Solflare or use dev sign-in.';
  if (message === 'wallet_sign_not_supported') return 'Wallet does not support message signing.';
  if (message.includes('/api/auth/wallet/verify')) return 'Wallet signature verification failed.';
  return 'Could not connect wallet.';
}

function topupErrorText(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message === 'wallet_requires_https') return 'Wallet payments require HTTPS. Open the site through your HTTPS domain.';
  if (message === 'wallet_not_found') return 'Wallet not found.';
  if (message === 'wallet_devnet_balance_insufficient') return 'Not enough SOL in the devnet wallet.';
  if (message === 'wallet_transaction_not_supported') return 'Wallet cannot send transactions.';
  if (message.includes('/api/account/coins/topup/verify')) return 'Transaction verification failed.';
  if (message.includes('User rejected')) return 'Transaction was rejected in the wallet.';
  return 'Could not top up balance.';
}

function BottomNav({
  activeSurface,
  onLive,
  onLeaderboard,
  onMiniGames,
  onShop,
  onProfile,
}: {
  activeSurface: Surface;
  onLive: () => void;
  onLeaderboard: () => void;
  onMiniGames: () => void;
  onShop: () => void;
  onProfile: () => void;
}): JSX.Element {
  return (
    <nav className="bottom-nav">
      <button className={`nav-item${activeSurface === 'live' ? ' active' : ''}`} onClick={onLive} aria-label="Live">
        <span className="nav-ic"><NavIcon name="live" /></span>
        <span>Live</span>
      </button>
      <button className={`nav-item${activeSurface === 'top' ? ' active' : ''}`} onClick={onLeaderboard} aria-label="Leaderboard">
        <span className="nav-ic"><NavIcon name="rating" /></span>
        <span>Leaderboard</span>
      </button>
      <button className={`nav-item${activeSurface === 'play' ? ' active' : ''}`} onClick={onMiniGames} aria-label="Games">
        <span className="nav-ic"><NavIcon name="games" /></span>
        <span>Games</span>
      </button>
      <button className={`nav-item${activeSurface === 'shop' ? ' active' : ''}`} onClick={onShop} aria-label="Shop">
        <span className="nav-ic"><NavIcon name="shop" /></span>
        <span>Shop</span>
      </button>
      <button className={`nav-item nav-profile${activeSurface === 'profile' ? ' active' : ''}`} onClick={onProfile} aria-label="Profile">
        <span className="nav-ic"><NavIcon name="profile" /></span>
        <span>Profile</span>
      </button>
    </nav>
  );
}

function NavIcon({ name }: { name: 'live' | 'rating' | 'games' | 'shop' | 'profile' }): JSX.Element {
  const common = {
    className: 'nav-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'live') {
    return (
      <svg {...common}>
        <path d="M4.5 10.8 12 4.6l7.5 6.2" />
        <path d="M6.8 10.2v8.3h10.4v-8.3" />
        <path d="M10 18.5v-4h4v4" />
      </svg>
    );
  }

  if (name === 'rating') {
    return (
      <svg {...common}>
        <path d="M8 5.2h8v3.1a4 4 0 0 1-8 0z" />
        <path d="M6.2 6.2H4.5v1.5a3.2 3.2 0 0 0 3.3 3.2" />
        <path d="M17.8 6.2h1.7v1.5a3.2 3.2 0 0 1-3.3 3.2" />
        <path d="M12 12.7v3.5" />
        <path d="M8.8 19h6.4" />
      </svg>
    );
  }

  if (name === 'games') {
    return (
      <svg {...common}>
        <path d="M7.3 9.2h9.4a4.6 4.6 0 0 1 4.4 4l.35 2.5a2.1 2.1 0 0 1-3.64 1.72l-1.9-2.02H8.08l-1.9 2.02a2.1 2.1 0 0 1-3.64-1.72l.35-2.5a4.6 4.6 0 0 1 4.4-4Z" />
        <path d="M8 12.2v3" />
        <path d="M6.5 13.7h3" />
        <path d="M16.2 13h.01" />
        <path d="M18.2 15h.01" />
      </svg>
    );
  }

  if (name === 'shop') {
    return (
      <svg {...common}>
        <path d="M7.2 9.2h9.6l-.8 10H8z" />
        <path d="M9 9.2a3 3 0 0 1 6 0" />
        <path d="M7.8 9.2H6.2l.7-3.2h10.2l.7 3.2h-1.6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 12.4a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z" />
      <path d="M5.2 20a6.8 6.8 0 0 1 13.6 0" />
    </svg>
  );
}
