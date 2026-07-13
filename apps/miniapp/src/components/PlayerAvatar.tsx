import type { CSSProperties } from 'react';

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const source = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return (source.toUpperCase() || 'FR').slice(0, 2);
}

export function PlayerAvatar({
  name,
  avatarUrl,
  className = 'player-avatar',
  style,
}: {
  name: string;
  avatarUrl?: string;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span className={`${className}${avatarUrl ? ' has-image' : ''}`} style={style} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : playerInitials(name)}
    </span>
  );
}
