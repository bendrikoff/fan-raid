// Deterministic PRNG (mulberry32) — makes SimFeed reproducible with SIM_SEED.
export class Rng {
  private state: number;

  constructor(seed?: number) {
    // If no seed is provided, use time (not reproducible, but valid).
    this.state = (seed ?? Date.now()) >>> 0;
  }

  // Next value in [0, 1).
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Event with probability p.
  chance(p: number): boolean {
    return this.next() < p;
  }

  // Number in range [min, max).
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Random array element.
  pick<T>(arr: readonly T[]): T {
    const i = Math.floor(this.next() * arr.length);
    return arr[Math.min(i, arr.length - 1)] as T;
  }
}
