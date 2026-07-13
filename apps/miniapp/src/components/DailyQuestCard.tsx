import type { DailyQuestState } from '@fan-raid/shared';

interface DailyQuestCardProps {
  daily?: DailyQuestState;
  busy?: boolean;
  isAuthenticated: boolean;
  onClaimDaily: () => void;
  className?: string;
  title?: string;
}

export function DailyQuestCard({
  daily,
  busy = false,
  isAuthenticated,
  onClaimDaily,
  className = '',
  title = 'Daily quest',
}: DailyQuestCardProps): JSX.Element {
  const progress = daily ? Math.min(100, Math.round((daily.progress / daily.target) * 100)) : 0;
  const buttonText = !isAuthenticated
    ? 'Sign in'
    : daily?.claimed
      ? 'Claimed'
      : daily?.claimable
        ? (busy ? 'Claiming...' : 'Claim')
        : 'In progress';
  const disabled = busy || (isAuthenticated && (!daily?.claimable || daily.claimed));

  return (
    <article className={`live-side-card live-task-card daily-quest-card ${className}`.trim()}>
      <div className="daily-task-icon" aria-hidden="true" />
      <div className="live-task-main">
        <span>{title}</span>
        <h2>{daily?.title ?? 'Make 3 predictions'}</h2>
        <div className="task-progress"><span style={{ width: `${progress}%` }} /></div>
        <p className="task-status">{daily ? `${daily.progress} / ${daily.target}` : '0 / 3'}</p>
      </div>
      <div className="task-reward">
        <small>Reward</small>
        <div className="task-reward-value">
          <span className="coin-icon" aria-hidden="true" />
          <b>{daily?.rewardCoins ?? 200}</b>
        </div>
      </div>
      <button
        className="daily-claim-button"
        disabled={disabled}
        onClick={onClaimDaily}
      >
        {buttonText}
      </button>
    </article>
  );
}
