// Wounds, bleeding, bandaging, re-opening, clotting, wrapping and stitching.
// Ports: core/ov/woundsHandlerBase, core/ov/updateWoundBloodLoss, core/ov/handleBandageOpening,
// damage/handleCoagulationPFH, clotWoundsOnBodyPart, handleIBCoagulationPFH, inflictInternalBleeding,
// wrapBodyPartLocal, stitchWound, getBandageTime.
import { lin, BODY_PARTS, PART_INDEX, SIZES } from "./util.js";
import { addPain, effectiveBloodVolume } from "./patient.js";

const LARGE_WOUND_THRESHOLD = 0.5;
const INTERNAL_TYPES = ["Avulsion", "Contusion", "Crush", "VelocityWound", "PunctureWound"];

/**
 * Adds one or more wounds of a type to a body part, as ACE's wound handler would for a hit of `damage` per wound.
 * Bleeding and pain follow woundsHandlerBase: woundSize = lin(0.1..2 over damage*sizeMultiplier -> 0.125..1).
 * The size category (minor/medium/large) comes from woundSize, as in ACE.
 */
export function addWound(sim, part, type, damage, count = 1) {
    const { p, data, rng } = sim;
    const def = data.wounds.types[type];
    if (!def) throw new Error("Unknown wound type " + type);
    const pi = PART_INDEX[part];
    for (let i = 0; i < count; i++) {
        const dmg = damage * rng.tri(0.9, 1, 1.1);
        p.bodyPartDamage[pi] += dmg;
        const woundSize = lin(0.1, 2, dmg, LARGE_WOUND_THRESHOLD ** 3, 1);
        const pain = woundSize * def.pain;
        const bleeding = woundSize * def.bleeding;
        const category = Math.max(0, Math.min(2, 2 - Math.floor(Math.log(woundSize) / Math.log(LARGE_WOUND_THRESHOLD))));
        addPain(p, pain, data);
        mergeWound(p.openWounds[part], { type, size: category, count: 1, bleeding, damage: dmg });
        inflictInternalBleeding(sim, part, type, category, bleeding);
        // Critical hit to the head or a penetrating torso hit
        if (type !== "ThermalBurn" && type !== "ChemicalBurn" && (part === "head" || (part === "body" && dmg > data.thresholds.aceConstants.penetrationThreshold))) {
            sim.emit("criticalHit", { part, type, size: category, damage: dmg });
        }
    }
    updateWoundBleeding(sim);
}

function mergeWound(list, w) {
    const ex = list.find((x) => x.type === w.type && x.size === w.size);
    if (ex) {
        const n = ex.count + w.count;
        ex.bleeding = (ex.count * ex.bleeding + w.count * w.bleeding) / n;
        ex.damage = (ex.count * ex.damage + w.count * w.damage) / n;
        ex.count = n;
    } else {
        list.push({ ...w });
    }
}

function inflictInternalBleeding(sim, part, type, size, bleeding) {
    // damage/inflictInternalBleeding
    if (size < 1 || !INTERNAL_TYPES.includes(type)) return;
    const { p, data, rng } = sim;
    const def = data.wounds.types[type];
    let chance = (def.internal ? def.internal[size - 1] : 0) * sim.setting("ACM_damage_internalBleedingChanceMultiplier");
    let inflict = chance >= 1;
    if (!inflict) {
        chance += Math.min(0.8, lin(2, 4, p.bodyPartDamage[PART_INDEX[part]], 0, 0.5, false));
        inflict = rng.chance(chance);
    }
    if (!inflict) return;
    const share = data.wounds.internalBleedShareByPart[part === "body" ? "torso" : part];
    mergeWound(p.internalWounds[part], { type, size, count: 1, bleeding: bleeding * share, damage: 0 });
    sim.startIBCoagulation();
}

/** core/ov/updateWoundBloodLoss: totals capped per region, limbs scaled by what the torso/head leave. */
export function updateWoundBleeding(sim) {
    const { p } = sim;
    const sums = (src) => BODY_PARTS.map((part, i) => (p.tourniquets[i] ? 0 : src[part].reduce((a, w) => a + w.count * w.bleeding, 0)));
    const ib = sums(p.internalWounds);
    const combine = (b) => {
        const body = Math.min(1, Math.min(0.9, b[0]) + Math.min(1, b[1]));
        let limb = Math.min(1, Math.min(0.3, b[2]) + Math.min(0.3, b[3]) + Math.min(0.5, b[4]) + Math.min(0.5, b[5]));
        return body + limb * (1 - body);
    };
    p.internalBleeding = ib.some((x) => x > 0) ? combine(ib) : 0;
    let ext = sums(p.openWounds);
    if (ext.some((x) => x > 0)) {
        if (p.internalBleeding > 0.3) ext = ext.map((x, i) => x - ib[i]); // severe internal bleeding slows external bleeding
        p.woundBleeding = combine(ext);
        if (sim.setting("ACM_circulation_coagulationClotting")) sim.startCoagulation();
    } else {
        p.woundBleeding = 0;
    }
}

// ------------------------------------------------------------------ bandaging

/** Effectiveness table entry for a bandage class and wound. */
function bandageEntry(data, bandage, type, size) {
    const t = data.bandages[bandage.toLowerCase()];
    return t && t[type] ? t[type][SIZES[size]] : null;
}

/**
 * Applies a bandage to a body part. ACE closes the most effective wounds first and, with advanced bandages,
 * spreads one bandage's effectiveness over several wounds; this follows that behaviour.
 * Returns the number of wounds closed (fractional counts allowed).
 */
export function bandage(sim, part, bandageClass) {
    const { p, data, rng } = sim;
    const open = p.openWounds[part];
    let budget = 1; // one bandage = 1.0 of its effectiveness, spent across wounds
    let closed = 0;
    const order = open.filter((w) => w.count > 0 && bandageEntry(data, bandageClass, w.type, w.size)?.effectiveness > 0)
        .sort((a, b) => b.bleeding * b.count - a.bleeding * a.count);
    for (const w of order) {
        if (budget <= 0) break;
        const e = bandageEntry(data, bandageClass, w.type, w.size);
        const impact = Math.min(w.count, budget * e.effectiveness);
        budget -= impact / e.effectiveness;
        w.count -= impact;
        closed += impact;
        mergeWound(p.bandagedWounds[part], { type: w.type, size: w.size, count: impact, bleeding: w.bleeding, damage: w.damage });
        scheduleBandageOpening(sim, part, w, impact, e);
    }
    p.openWounds[part] = open.filter((w) => w.count > 1e-6);
    updateWoundBleeding(sim);
    return closed;
}

function scheduleBandageOpening(sim, part, wound, impact, e) {
    // core/ov/handleBandageOpening
    const { p, rng } = sim;
    const plateletEffect = lin(2.5, 1, p.platelets, 0.5, 1);
    if (!rng.chance(e.reopenChance * plateletEffect * sim.aceSetting("woundReopenChance", 1))) return;
    const willClot = rng.chance(lin(2, 1, p.platelets, 1, 0));
    const delay = e.reopenDelay[0] + rng.random(Math.max(0, e.reopenDelay[1] - e.reopenDelay[0]));
    sim.schedule(delay, willClot ? "bandageClots" : "bandageReopens", { part, type: wound.type, size: wound.size, impact });
}

/** Timer handlers for bandage outcomes. */
export const woundTimers = {
    bandageClots(sim, { part, type, size, impact }) {
        const { p, rng } = sim;
        if (!moveWound(p.bandagedWounds[part], p.clottedWounds[part], type, size, impact)) return;
        if (rng.chance(lin(2.5, 1, p.platelets, 1, 0.1))) return; // clot holds
        const mid = lin(2.5, 1, p.platelets, 360, 150);
        sim.schedule(rng.tri(mid - 60, mid, mid + 60), "clotReopens", { part, type, size, impact });
    },
    bandageReopens(sim, { part, type, size, impact }) {
        const { p } = sim;
        if (moveWound(p.bandagedWounds[part], p.openWounds[part], type, size, impact)) updateWoundBleeding(sim);
    },
    clotReopens(sim, { part, type, size, impact }) {
        const { p } = sim;
        if (moveWound(p.clottedWounds[part], p.openWounds[part], type, size, impact)) updateWoundBleeding(sim);
    },
    wrapLoosens(sim, { part, type, size, toClotted }) {
        const { p, rng } = sim;
        const target = toClotted ? p.clottedWounds[part] : p.bandagedWounds[part];
        if (!moveWound(p.wrappedWounds[part], target, type, size, 1)) return;
        if (rng.chance(lin(2.5, 1, p.platelets, 1, 0.1) * sim.setting("ACM_core_wrappedWoundReopenChance"))) return;
        sim.schedule(lin(2.5, 1, p.platelets, 600, 180), toClotted ? "clotReopens" : "bandageReopens", { part, type, size, impact: 1 });
    },
};

function moveWound(from, to, type, size, amount) {
    const w = from.find((x) => x.type === type && x.size === size && x.count > 0);
    if (!w) return false;
    const n = Math.min(w.count, amount);
    w.count -= n;
    mergeWound(to, { type, size, count: n, bleeding: w.bleeding, damage: w.damage });
    return true;
}

export function isBodyPartBleeding(p, part) {
    return p.openWounds[part].some((w) => w.count > 0 && w.bleeding > 0);
}

/** damage/wrapBodyPartLocal: wraps all bandaged (fromClotted=false) or clotted wounds on a part. */
export function wrap(sim, part, fromClotted) {
    const { p, rng } = sim;
    if (isBodyPartBleeding(p, part)) return false;
    const src = fromClotted ? p.clottedWounds : p.bandagedWounds;
    if (!src[part].length) return false;
    const plateletEffect = lin(2.5, 1, p.platelets, 0.5, 1);
    for (const w of src[part]) {
        mergeWound(p.wrappedWounds[part], { ...w });
        for (let i = 0; i < Math.round(w.count); i++) {
            if (rng.chance((fromClotted ? 0.7 : 0.5) * plateletEffect)) {
                sim.schedule(rng.tri(300, 450, 900), "wrapLoosens", { part, type: w.type, size: w.size, toClotted: fromClotted });
            }
        }
    }
    src[part] = [];
    return true;
}

/** damage/stitchWound for all wounds of one state on a part (woundState: "bandaged" | "wrapped" | "clotted"). */
export function stitch(sim, part, woundState) {
    const { p } = sim;
    if (isBodyPartBleeding(p, part)) return false;
    const key = woundState + "Wounds";
    for (const w of p[key][part]) mergeWound(p.stitchedWounds[part], { ...w });
    p[key][part] = [];
    return true;
}

/** damage/getBandageTime. */
export function bandageTime(sim, part, bandageClass, medicLevel, self) {
    const { p, data } = sim;
    const bt = data.wounds.bandageTime;
    const targets = p.openWounds[part].filter((w) => w.count > 0 && bandageEntry(data, bandageClass, w.type, w.size)?.effectiveness > 0);
    if (!targets.length) return 0;
    let t = targets.reduce((a, w) => a + bt.perWound[w.size], 0);
    t = bandageClass.toLowerCase() === "emergencytraumadressing" ? Math.max(t, bt.cap) + 2 : Math.min(t, bt.cap);
    if (medicLevel >= 1) t += bt.medic;
    if (self) t += bt.self;
    if (targets.length > 1) t += bt.perExtraWound * targets.length;
    return Math.max(bt.min, t);
}

// ------------------------------------------------------------------ clotting

/**
 * One external clotting attempt (damage/handleCoagulationPFH body).
 * Returns "blocked" (no attempt: HR/platelets/volume too low), true (a wound was attempted; the loop's
 * last-clot time is refreshed by any attempt, as in ACM) or false (nothing clottable: the loop ends).
 */
export function coagulationStep(sim) {
    const { p, rng } = sim;
    const txa = Math.min(2, sim.medCount("TXA_IV"));
    if (p.hr < 20 || (p.platelets < 1 && txa < 0.5) || effectiveBloodVolume(p) < 3.8) return "blocked";
    const maxSeverity = Math.max(Math.ceil(p.platelets / 2), Math.ceil(txa));
    for (const part of ["body", "head", "leftarm", "rightarm", "leftleg", "rightleg"]) {
        if (p.tourniquets[PART_INDEX[part]]) continue;
        const list = p.openWounds[part];
        const w = list.filter((x) => x.count > 0 && x.bleeding > 0 && x.size + 1 <= maxSeverity).sort((a, b) => a.size - b.size)[0];
        if (!w) continue;
        p.coagulationLastClot = p.t;
        // damage/clotWoundsOnBodyPart with 2 wounds' worth of clotting
        const severity = w.size + 1;
        const amount = Math.min(w.count, 2 / severity);
        const txaEffect = Math.min(1.5, 1 + sim.medCount("TXA_IV"));
        const bvEffect = Math.min(1, effectiveBloodVolume(p) / 5.2);
        const success = severity === 1 || rng.chance((1 - 0.9 * (severity / 3)) * txaEffect * bvEffect);
        if (success) {
            moveWound(list, p.clottedWounds[part], w.type, w.size, amount);
            p.openWounds[part] = list.filter((x) => x.count > 1e-6);
            const reopen = p.platelets < 2.5 ? 0.5 / p.platelets : 0;
            if (rng.chance(txaEffect > 1.15 ? reopen * 0.5 : reopen)) {
                sim.schedule(rng.tri(lin(2.5, 1, p.platelets, 480, 180) - 30, lin(2.5, 1, p.platelets, 480, 180), lin(2.5, 1, p.platelets, 480, 180) + 30),
                    "clotReopens", { part, type: w.type, size: w.size, impact: 1 });
            }
            updateWoundBleeding(sim);
        }
        return true;
    }
    return false;
}

/** One internal-bleeding clotting attempt (damage/handleIBCoagulationPFH body). */
export function ibCoagulationStep(sim) {
    const { p, rng } = sim;
    const txa = Math.min(2.2, sim.medCount("TXA_IV"));
    if (p.hr < 20 || (p.platelets < 0.1 && txa < 0.1) || effectiveBloodVolume(p) < 3.6) return "blocked";
    const eff = p.platelets > 4 || txa > 0.35 ? 2 : 1;
    let any = false;
    for (const part of ["body", "head", "leftarm", "rightarm", "leftleg", "rightleg"]) {
        const list = p.internalWounds[part];
        if (!list.length) continue;
        any = true;
        if (p.tourniquets[PART_INDEX[part]]) continue;
        const w = list.find((x) => x.count > 0);
        if (!w) continue;
        if (w.size === 1 || (w.size === 2 && rng.chance(0.3 * (1 + Math.min(2, txa)) * Math.min(1, effectiveBloodVolume(p) / 4.5)))) {
            const n = w.count - eff;
            if (n < 1) list.splice(list.indexOf(w), 1);
            else { w.bleeding = (w.bleeding / w.count) * n; w.count = n; }
            updateWoundBleeding(sim);
        }
        return true;
    }
    return any;
}
