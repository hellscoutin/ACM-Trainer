// Damage types -> wounds. Ports ACE medical_damage (ACE_Medical_Injuries >> damageTypes, interpolatePoints) as used by
// ACM's woundsHandlerBase override, plus ACM's training computer patient generator (ACM_mission generatePatient).
// applyDamage(sim, part, type, damage) is what ACE's addDamageToUnit does for one body part.
import { lin, BODY_PARTS } from "./util.js";
import { addWound } from "./wounds.js";

// thresholds: [[damage, wounds]] (descending); wounds: { type: { w: weighting [[dmgPerWound, weight]], size, pain, bleeding, fracture } }
export const DAMAGE_TYPES = {
    bullet: { thresholds: [[20, 10], [4.5, 2], [3, 1], [0, 1]], wounds: {
        Avulsion: { w: [[1, 1], [0.35, 0]] }, Contusion: { w: [[0.35, 0], [0.35, 1]], size: 3.2, pain: 2.2 },
        VelocityWound: { w: [[1.5, 0], [1.5, 1], [0.35, 1], [0.35, 0]], size: 0.9 } } },
    grenade: { thresholds: [[20, 10], [10, 5], [4, 3], [1.5, 2], [0.8, 2], [0.3, 1], [0, 0]], wounds: {
        Avulsion: { w: [[1.5, 1], [1.1, 0]] }, VelocityWound: { w: [[1.5, 0], [1.1, 1], [0.7, 0]] }, PunctureWound: { w: [[0.9, 0], [0.7, 1], [0.35, 0]] },
        Cut: { w: [[0.7, 0], [0.35, 1], [0.35, 0]] }, Contusion: { w: [[0.5, 0], [0.35, 1]], size: 2, pain: 0.9 } } },
    explosive: { thresholds: [[20, 15], [8, 7], [2, 3], [1.2, 2], [0.4, 1], [0, 0]], wounds: {
        Avulsion: { w: [[1, 1], [0.8, 0]] }, Cut: { w: [[1.5, 0], [0.35, 1], [0, 0]] }, Contusion: { w: [[0.5, 0], [0.35, 1]], size: 2, pain: 0.9 } } },
    shell: { thresholds: [[20, 10], [10, 5], [4.5, 2], [2, 2], [0.8, 1], [0.2, 1], [0, 0]], wounds: null }, // same wounds as grenade
    vehiclecrash: { thresholds: [[1.5, 3], [1.5, 2], [1, 2], [1, 1], [0.05, 1]], randomPart: true, wounds: {
        Abrasion: { w: [[0.3, 0], [0.3, 1]] }, Avulsion: { w: [[0.01, 1], [0.01, 0]] }, Contusion: { w: [[0.35, 0], [0.35, 1]] },
        Crush: { w: [[0.1, 1], [0.1, 0]] }, Cut: { w: [[0.1, 1], [0.1, 0]] }, Laceration: { w: [[0, 1]] } } },
    collision: { thresholds: [[8, 4], [1, 1], [0.3, 1], [0.15, 0.5], [0, 0.3]], wounds: {
        Avulsion: { w: [[1, 2], [0.5, 0.5], [0.5, 0]] }, Abrasion: { w: [[0.4, 0], [0.2, 1], [0, 0]] }, Contusion: { w: [[0.4, 0], [0.2, 1]] },
        Crush: { w: [[0.4, 1], [0.2, 0]] }, Cut: { w: [[0.1, 1], [0.1, 0]] }, Laceration: { w: [[0, 1]] } } },
    falling: { thresholds: [[8, 4], [1, 1], [0.2, 1], [0.1, 0.7], [0, 0.5]], wounds: {
        Abrasion: { w: [[0.4, 0], [0.2, 1], [0, 0]], size: 3 }, Contusion: { w: [[0.4, 0], [0.2, 1]], size: 3 }, Crush: { w: [[0.4, 1], [0.2, 0]], size: 1.5 } } },
    backblast: { thresholds: [[1, 6], [1, 5], [0.55, 5], [0.55, 2], [0, 2]], wounds: {
        Avulsion: { w: [[0.3, 0], [0.3, 1]] }, Contusion: { w: [[0.35, 0], [0.35, 1]] }, Cut: { w: [[0.1, 1], [0.1, 0]] } } },
    stab: { thresholds: [[0.1, 1], [0.1, 0]], wounds: { Cut: { w: [[0.1, 1], [0.1, 0]] }, PunctureWound: { w: [[0.02, 1], [0.02, 0]] } } },
    punch: { thresholds: [[0.1, 1], [0.1, 0]], wounds: { Contusion: { w: [[0.35, 0], [0.35, 1]] }, Crush: { w: [[0.1, 1], [0.1, 0]] }, Laceration: { w: [[0, 1]] } } },
};
DAMAGE_TYPES.shell.wounds = DAMAGE_TYPES.grenade.wounds;

/** ace_medical_damage_fnc_interpolatePoints (points sorted by descending input). */
export function interpolate(input, points, rng = null) {
    if (!points.length) return 0;
    if (points.length === 1) return points[0][1];
    const lowerIdx = points.findIndex((pt) => pt[0] < input);
    if (lowerIdx === 0) return points[0][1];
    if (lowerIdx === -1) return points[points.length - 1][1];
    const upper = points[lowerIdx - 1], lower = points[lowerIdx];
    const out = lin(lower[0], upper[0], input, lower[1], upper[1]);
    return rng ? Math.ceil(out - rng.random(1)) : out; // random rounding: chance to round up = the decimal part
}

/** woundsHandlerBase for one body part hit. Returns the wounds created [{part, type}]. */
export function applyDamage(sim, part, type, damage) {
    const { rng } = sim;
    const dt = DAMAGE_TYPES[type];
    if (!dt) throw new Error("Unknown damage type " + type);
    if (dt.randomPart) part = rng.pick(BODY_PARTS); // woundsHandlerVehiclecrash randomises the hit selection
    const n = interpolate(damage, dt.thresholds, rng);
    if (n < 1) return [];
    const perWound = damage / n;
    const options = Object.entries(dt.wounds).map(([t, d]) => ({ t, d, weight: interpolate(perWound, d.w) }));
    const total = options.reduce((a, o) => a + o.weight, 0);
    const made = [];
    for (let k = 0; k < n; k++) {
        if (total <= 0) break;
        // selectRandomWeighted
        let r = rng.random(total), pick = options[options.length - 1];
        for (const o of options) { if (r < o.weight) { pick = o; break; } r -= o.weight; }
        addWound(sim, part, pick.t, perWound, 1, { size: pick.d.size ?? 1, pain: pick.d.pain ?? 1, bleeding: pick.d.bleeding ?? 1, fracture: pick.d.fracture ?? 1 });
        made.push({ part, type: pick.t });
    }
    return made;
}

/**
 * ACM training computer (generatePatient). severity: 1 Routine, 2 Priority, 3 Immediate, 4 Expectant (0 random);
 * cause: 1 gunshot, 2 shrapnel, 3 explosion, 4 collision, 5 falling, 6 backblast (0 random for the severity).
 */
export const CAUSES = { 1: "Gunshot", 2: "Shrapnel", 3: "Explosion", 4: "Collision", 5: "Falling", 6: "Backblast" };
export const SEVERITIES = { 1: "Routine", 2: "Priority", 3: "Immediate", 4: "Expectant" };
export const CAUSES_FOR = { 1: [1, 2, 5, 6], 2: [1, 2, 3, 4], 3: [1, 3], 4: [1, 2, 3] };
export function generatePatient(sim, severity = 0, cause = 0) {
    const { rng } = sim;
    if (severity === 0) severity = 1 + Math.round(rng.random(3));
    const [mult, count] = {
        1: [rng.tri(1, 1.25, 1.5), Math.round(rng.tri(2, 2, 3))], 2: [rng.tri(2.5, 3, 4), Math.round(rng.tri(3, 4, 5))],
        3: [rng.tri(3.5, 4, 5), Math.round(rng.tri(5, 6, 7))], 4: [rng.tri(7, 8, 9), Math.round(rng.tri(7, 8, 10))],
    }[severity];
    const hits = [];
    for (let i = 0; i < count; i++) {
        let c = cause;
        if (c === 0) { const opts = CAUSES_FOR[severity]; c = opts[Math.round(rng.random(opts.length - 1))]; }
        let part = BODY_PARTS[Math.round(rng.random(5))];
        const mech = { 1: "bullet", 2: "grenade", 3: "explosive", 4: "collision", 5: "falling", 6: "backblast" }[c];
        if (c === 4) part = "body";
        if (c === 5) part = BODY_PARTS[4 + Math.round(rng.random(1))];
        hits.push([part, mech, mult]);
    }
    // the training computer spawns an AI casualty, immune to instant death, unconscious, then applies the damage
    sim.p.ai = true;
    sim.p.instantDeathImmune = true;
    sim.criticalVitals();
    for (const [part, mech, dmg] of hits) applyDamage(sim, part, mech, dmg);
    return { severity, hits };
}
