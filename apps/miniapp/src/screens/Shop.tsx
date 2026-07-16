import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CoinTopupOption } from '@fan-raid/shared';

type RewardRarity = 'common' | 'rare' | 'epic';

type LootboxReward =
  | {
      kind: 'coins';
      title: string;
      detail: string;
      rarity: RewardRarity;
      weight: number;
      amount: number;
    }
  | {
      kind: 'boost' | 'cosmetic' | 'item';
      title: string;
      detail: string;
      rarity: RewardRarity;
      weight: number;
    };

type Lootbox = {
  id: string;
  title: string;
  tag: string;
  price: number;
  accent: string;
  tone: 'green' | 'blue' | 'purple';
  description: string;
  highlights: Array<{ icon: string; title: string; detail: string }>;
  rewards: LootboxReward[];
};

type OpenResult = {
  box: Lootbox;
  reward: LootboxReward;
  stage: 'opening' | 'revealed';
  sequence: number;
};

const LOOTBOXES: Lootbox[] = [
  {
    id: 'match',
    title: 'Basic lootbox',
    tag: 'BASIC',
    price: 150,
    accent: '#82c95a',
    tone: 'green',
    description: 'A quick pack for match fan activity.',
    highlights: [
      { icon: 'coin', title: '100-300', detail: 'Coins' },
      { icon: 'card', title: 'Common', detail: 'cards' },
      { icon: 'emoji', title: 'Emoji', detail: 'profile' },
    ],
    rewards: [
      { kind: 'item', title: 'Test item', detail: 'Demo box drop', rarity: 'epic', weight: 1 },
      { kind: 'boost', title: 'Fan Boost x1', detail: 'Boost for live activity', rarity: 'common', weight: 34 },
      { kind: 'coins', title: '40 coins', detail: 'Returned to balance', rarity: 'common', weight: 42, amount: 40 },
      { kind: 'coins', title: '120 coins', detail: 'Large return', rarity: 'rare', weight: 18, amount: 120 },
      { kind: 'cosmetic', title: 'Green Chant', detail: 'Profile banner', rarity: 'epic', weight: 6 },
    ],
  },
  {
    id: 'ultra',
    title: 'Rare lootbox',
    tag: 'RARE',
    price: 350,
    accent: '#f3c14e',
    tone: 'blue',
    description: 'Premium box with rare prizes and a bigger coin drop.',
    highlights: [
      { icon: 'coin', title: '300-800', detail: 'Coins' },
      { icon: 'card', title: 'Rare', detail: 'cards' },
      { icon: 'frame', title: 'Frames', detail: 'profile' },
    ],
    rewards: [
      { kind: 'item', title: 'Test item', detail: 'Demo box drop', rarity: 'epic', weight: 1 },
      { kind: 'boost', title: 'Power Play x2', detail: 'Double match boost', rarity: 'rare', weight: 32 },
      { kind: 'coins', title: '180 coins', detail: 'Returned to balance', rarity: 'common', weight: 36, amount: 180 },
      { kind: 'coins', title: '420 coins', detail: 'Large coin drop', rarity: 'rare', weight: 22, amount: 420 },
      { kind: 'cosmetic', title: 'Gold Ultras', detail: 'Rare profile frame', rarity: 'epic', weight: 10 },
    ],
  },
  {
    id: 'epic',
    title: 'Epic lootbox',
    tag: 'EPIC',
    price: 750,
    accent: '#bd5cff',
    tone: 'purple',
    description: 'Epic box with a test item and a high coin drop.',
    highlights: [
      { icon: 'coin', title: '800-2000', detail: 'Coins' },
      { icon: 'card', title: 'Epic', detail: 'cards' },
      { icon: 'frame', title: 'Special', detail: 'items' },
    ],
    rewards: [
      { kind: 'item', title: 'Test item', detail: 'Demo box drop', rarity: 'epic', weight: 1 },
      { kind: 'coins', title: '800 coins', detail: 'Large coin drop', rarity: 'rare', weight: 20, amount: 800 },
    ],
  },
];

export function Shop({
  coins,
  walletAddress,
  topupOptions,
  topupBusyId,
  onSpendCoins,
  onConnectWallet,
  onTopupCoins,
}: {
  coins: number;
  walletAddress?: string;
  topupOptions: CoinTopupOption[];
  topupBusyId: string | null;
  onSpendCoins: (amount: number) => boolean | Promise<boolean>;
  onConnectWallet: () => void | Promise<void>;
  onTopupCoins: (packageId: string) => void | Promise<void>;
}): JSX.Element {
  const [lastOpen, setLastOpen] = useState<OpenResult | null>(null);
  const openTimer = useRef<number | null>(null);
  const openSequence = useRef(0);
  const isOpening = lastOpen?.stage === 'opening';

  useEffect(() => {
    return () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    };
  }, []);

  async function buyLootbox(box: Lootbox): Promise<void> {
    if (isOpening) return;
    if (!(await onSpendCoins(box.price))) return;
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);

    const sequence = openSequence.current + 1;
    openSequence.current = sequence;
    const reward = createTestReward(box);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setLastOpen({ box, reward, stage: 'revealed', sequence });
      return;
    }

    setLastOpen({ box, reward, stage: 'opening', sequence });
    openTimer.current = window.setTimeout(() => {
      setLastOpen((current) => (
        current?.sequence === sequence ? { ...current, stage: 'revealed' } : current
      ));
      openTimer.current = null;
    }, 720);
  }

  function buyCoins(): void {
    const firstTopup = topupOptions[0];
    if (firstTopup) {
      void onTopupCoins(firstTopup.id);
      return;
    }
    void onConnectWallet();
  }

  return (
    <div className="app-shell shop-page shop-redesign">
      <main className="shop-main">
        <section className="shop-hero-panel">
          <div className="shop-heading">
            <h1>Shop</h1>
            <p>Open lootboxes and collect rewards</p>
          </div>

          <div className="shop-lootbox-row" aria-label="Lootboxes">
            {LOOTBOXES.map((box) => {
              const canBuy = coins >= box.price;
              const isActiveOpening = isOpening && lastOpen?.box.id === box.id;
              return (
                <article
                  key={box.id}
                  className={`shop-box-card ${box.tone}`}
                  style={{ '--box-accent': box.accent } as CSSProperties}
                >
                  <h2>{box.title}</h2>
                  <div className="shop-box-art" aria-hidden="true">
                    <span className="shop-box-lid" />
                    <span className="shop-box-body" />
                    <span className="shop-box-ball">⚽</span>
                  </div>
                  <div className="shop-box-highlights">
                    <span>Possible rewards</span>
                    <div>
                      {box.highlights.map((item) => (
                        <small key={`${box.id}-${item.title}`}>
                          <i className={`shop-highlight-icon ${item.icon}`} aria-hidden="true" />
                          <b>{item.title}</b>
                          {item.detail}
                        </small>
                      ))}
                    </div>
                  </div>
                  <div className="shop-box-price">
                    <span className="coin-icon" aria-hidden="true" />
                    <b>{box.price.toLocaleString('en-US')}</b>
                  </div>
                  <button className="lootbox-buy" disabled={!canBuy || isOpening} onClick={() => void buyLootbox(box)}>
                    {isActiveOpening ? 'Opening' : canBuy ? 'Open' : `Need ${box.price}`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <aside className="shop-rail">
        <section className="shop-balance-card">
          <h2>Your coins</h2>
          <div className="shop-coins-row">
            <div className="shop-coin-stack" aria-hidden="true"><span className="coin-icon" /><span className="coin-icon" /><span className="coin-icon" /></div>
            <b>{coins.toLocaleString('en-US')}</b>
          </div>
          <button disabled={Boolean(topupBusyId) || isOpening} onClick={buyCoins}>
            {walletAddress || topupOptions.length > 0 ? 'Buy coins' : 'Connect wallet'}
          </button>
        </section>

        <section className="shop-rewards-card">
          <h2>Recent rewards</h2>
          <div className="shop-reward-list">
            <span><i className="reward-card-icon epic">85</i><b>Epic card</b><small>2 min ago</small></span>
            <span><i className="coin-icon" /><b>500 coins</b><small>15 min ago</small></span>
            <span><i className="reward-frame-icon" /><b>Profile frame</b><small>1h ago</small></span>
            <span><i className="reward-card-icon rare">78</i><b>Rare card</b><small>3h ago</small></span>
          </div>
        </section>
      </aside>

      {lastOpen && (
        <section
          className={`lootbox-open-overlay ${lastOpen.stage}`}
          aria-label="Lootbox opening"
          aria-live="polite"
          aria-modal="true"
          aria-busy={isOpening}
          role="dialog"
          style={{ '--box-accent': lastOpen.box.accent } as CSSProperties}
        >
          <div className="lootbox-open-card">
            {lastOpen.stage === 'revealed' && (
              <button className="lootbox-open-close" aria-label="Close" onClick={() => setLastOpen(null)}>X</button>
            )}
            <div className="lootbox-stage" aria-hidden="true">
              <div className="opening-box">
                <span className="opening-light" />
                <span className="opening-lid" />
                <span className="opening-body">BOX</span>
                <span className="opening-spark spark-1" />
                <span className="opening-spark spark-2" />
                <span className="opening-spark spark-3" />
              </div>
              <div className="opening-item-card">
                <span>{rarityLabel(lastOpen.reward.rarity)}</span>
                <b>{lastOpen.reward.title}</b>
              </div>
            </div>
            <div className="lootbox-open-copy">
              <span className="lootbox-kicker">{lastOpen.stage === 'opening' ? 'Opening' : lastOpen.box.title}</span>
              <h2>{lastOpen.stage === 'opening' ? 'Box opening' : lastOpen.reward.title}</h2>
              <p className="muted">{lastOpen.stage === 'opening' ? 'Revealing the drop.' : lastOpen.reward.detail}</p>
            </div>
            {lastOpen.stage === 'revealed' && (
              <button className="lootbox-claim" onClick={() => setLastOpen(null)}>Claim</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function createTestReward(box: Lootbox): LootboxReward {
  return {
    kind: 'item',
    title: 'Test item',
    detail: `Demo item from ${box.title}. Real inventory items can be connected here later.`,
    rarity: 'epic',
    weight: 1,
  };
}

function rarityLabel(rarity: RewardRarity): string {
  if (rarity === 'epic') return 'EPIC';
  if (rarity === 'rare') return 'RARE';
  return 'DROP';
}
