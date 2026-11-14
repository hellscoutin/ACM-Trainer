// Shared helpers that mirror SQF behaviour.

/** SQF linearConversion [a, b, v, c, d, clamp]. */
export function lin(a, b, v, c, d, clamp = true) {
    if (a === b) return c;
    let t = (v - a) / (b - a);
    if (clamp) t = Math.max(0, Math.min(1, t));
    return c + (d - c) * t;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Seeded PRNG (mulberry32) so a scenario replays exactly from its seed and action log. */
export function makeRng(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        /** SQF `random x`: uniform in [0, x). */
        random: (x = 1) => next() * x,
        /** SQF `random [min, mid, max]`: Arma uses a bell-shaped curve; a triangular distribution is a close stand-in. */
        tri: (min, mid, max) => {
            const u = next();
            const f = (mid - min) / (max - min || 1);
            return u < f ? min + Math.sqrt(u * (max - min) * (mid - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mid));
        },
        chance: (p) => next() < p,
        pick: (arr) => arr[Math.floor(next() * arr.length)],
        state: () => s,
    };
}

export const BODY_PARTS = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"];
export const PART_INDEX = Object.fromEntries(BODY_PARTS.map((p, i) => [p, i]));
export const SIZES = ["minor", "medium", "large"];
