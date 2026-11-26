import { useMemo, type CSSProperties } from "react";

type Tone = "brand" | "soft" | "warn" | "grow" | "ink";
type Shape = "strip" | "chip" | "dot" | "spark";

type Bit = { shape: Shape; tone: Tone; dx: number; dy: number; fy: number; rot: number; delay: number; dur: number };

const PIECES = 32;
const SPARKS = 8;
// Weighted so the blue leads and the accents stay accents.
const TONES: Tone[] = ["brand", "brand", "brand", "soft", "soft", "warn", "warn", "grow", "grow", "ink"];
const SHAPES: Shape[] = ["strip", "strip", "chip", "dot"];

/** FNV-1a, so the same gift always throws the same confetti. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded generator (mulberry32). Pure: same seed, same numbers, nothing read from outside. */
function generator(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The confetti for one gift: angles in an upward cone, 40 to 140px out. The rise is capped at about
 * 84px because the box opening sits roughly 96px under the top edge of the scrolling stage, so the
 * long throws go sideways instead of being clipped under the header. Each piece then falls 50 to
 * 100px and fades. Sparks travel less and mostly twinkle.
 */
export function burstBits(seed: string): Bit[] {
  const rnd = generator(hash(seed));
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const bits: Bit[] = [];
  for (let i = 0; i < PIECES + SPARKS; i++) {
    const spark = i >= PIECES;
    // Spread the cone evenly, then jitter, so no side ends up empty.
    const slot = spark ? (i - PIECES + rnd()) / SPARKS : (i + rnd()) / PIECES;
    const angle = (slot * 2 - 1) * (spark ? 0.9 : 1.15);
    const dist = spark ? 34 + rnd() * 40 : 40 + rnd() * 100;
    const dx = Math.sin(angle) * dist;
    const dy = -(Math.cos(angle) * dist * 0.5 + 14);
    bits.push({
      shape: spark ? "spark" : pick(SHAPES),
      tone: spark ? (rnd() < 0.5 ? "warn" : "soft") : pick(TONES),
      dx: Math.round(dx),
      dy: Math.round(dy),
      fy: Math.round(dy + 50 + rnd() * 50),
      rot: Math.round((rnd() * 2 - 1) * 360),
      delay: Math.round(rnd() * 60),
      dur: Math.round(spark ? 720 + rnd() * 140 : 760 + rnd() * 140),
    });
  }
  return bits;
}

/**
 * The burst that leaves the box when it opens. Always mounted (at opacity 0) inside the big box so
 * CSS alone plays it from data-phase="opened" on the surrounding .gift-stage.
 */
export function GiftBurst({ seed }: { seed: string }) {
  const bits = useMemo(() => burstBits(seed), [seed]);
  return (
    <div className="gift-burst">
      {bits.map((b, i) => (
        <span
          key={i}
          className="gift-particle"
          data-shape={b.shape}
          data-tone={b.tone}
          style={
            {
              "--dx": `${b.dx}px`,
              "--dy": `${b.dy}px`,
              "--fy": `${b.fy}px`,
              "--rot": `${b.rot}deg`,
              "--delay": `${b.delay}ms`,
              "--dur": `${b.dur}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
