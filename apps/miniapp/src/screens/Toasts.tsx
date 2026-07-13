import { useGame } from '../game/store.js';

export function Toasts(): JSX.Element {
  const { toasts } = useGame();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        t.kind === 'achievement' ? (
          <div key={t.id} className="toast achievement-toast">
            {t.image && <img src={t.image} alt="" loading="lazy" />}
            <span>
              <small>Achievement unlocked</small>
              <b>{t.title ?? t.text}</b>
              {t.detail && <em>{t.detail}</em>}
            </span>
          </div>
        ) : (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        )
      ))}
    </div>
  );
}
