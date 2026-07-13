// Arena visual effects (section 9). Everything is ≤ 2 s and does not block the UI.
// Animations use CSS + requestAnimationFrame.

// Full-screen confetti in the scoring team's color.
export function confetti(color: string): void {
  const layer = document.createElement('div');
  layer.className = 'fx-confetti';
  document.body.appendChild(layer);

  const N = 90;
  const parts: Array<{ el: HTMLDivElement; x: number; y: number; vx: number; vy: number; rot: number; vr: number }> = [];
  const palette = [color, '#ffffff', '#ffd54a'];
  for (let i = 0; i < N; i++) {
    const el = document.createElement('div');
    el.className = 'fx-confetti-piece';
    el.style.background = palette[i % palette.length]!;
    layer.appendChild(el);
    parts.push({
      el,
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 3,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 12,
    });
  }

  const start = performance.now();
  function frame(now: number): void {
    const t = now - start;
    for (const p of parts) {
      p.vy += 0.08; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`;
    }
    if (t < 2000) requestAnimationFrame(frame);
    else layer.remove();
  }
  requestAnimationFrame(frame);
}

// Full-screen flash.
export function flash(color: string): void {
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = color;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('fx-flash-on'));
  window.setTimeout(() => el.remove(), 600);
}

// Element shake.
export function shake(el: HTMLElement | null, ms = 500, strong = false): void {
  if (!el) return;
  const cls = strong ? 'fx-shake-strong' : 'fx-shake';
  el.classList.remove(cls);
  // Reflow to restart the animation.
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

// Short element pulse (Fan Power / probability bars).
export function pulse(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('fx-pulse');
  void el.offsetWidth;
  el.classList.add('fx-pulse');
  window.setTimeout(() => el.classList.remove('fx-pulse'), 500);
}
