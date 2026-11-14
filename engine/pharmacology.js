// Medications. Ports: core/ov/medicationLocal (dose scaling and the adjustment entry),
// circulation/getMedicationEffect (effect curves), core/ov/getMedicationCount, the medication part of
// core/ov/handleUnitVitals (per-type caps), core/generateMedicationTypeMap and circulation/getCardiacMedicationEffects.
// Overdose (onMedicationUsage/handleOverdose) and the per-drug handlers (adenosine, amiodarone, calcium, naloxone)
// are not in this module yet.
import { lin, PART_INDEX } from "./util.js";

const ROUTE = { IM: 0, IV: 1, PO: 2, INHALE: 3 };
export { ROUTE };

/** circulation/getMedicationEffect: 0..1 effect at timeInSystem. */
export function medicationEffect(route, t, onset, total, plateau) {
    const elimination = total - plateau - onset;
    const sinceElim = t - plateau - onset;
    let e;
    if (t > onset && t < onset + plateau) e = 1;
    else if (route === ROUTE.IM) e = t > plateau + onset ? 1 - sinceElim ** 2 / elimination ** 2 : 1.1 ** (t - onset);
    else if (route === ROUTE.IV || route === ROUTE.PO || route === ROUTE.INHALE) {
        // SQF sin/cos take degrees; deg() converts the radian argument back, so these are radian sin/cos.
        e = t > plateau + onset ? Math.cos(sinceElim / (elimination / 3.1)) / 2 + 0.5 : Math.sin(t / ((2 * onset * Math.PI) / (3.113 * Math.PI)));
    } else e = Math.min(1, (t / onset) ** 2) * (total - t) / total;
    return Math.max(0, Math.min(1, e));
}

/** core/ov/getMedicationCount. getCount=false (default here) gives effect x concentration, as the vitals code uses. */
export function medicationCount(p, name, partIndex = -1, getCount = false) {
    let sum = 0;
    for (const m of p.meds) {
        if (m.name !== name) continue;
        if (partIndex !== -1 && partIndex !== m.part) continue;
        const t = p.t - m.added;
        sum += (getCount ? lin(m.onset + m.plateau, m.total, t, 1, 0) : medicationEffect(m.route, t, m.onset, m.total, m.plateau)) * m.conc;
    }
    return sum;
}

/** core/generateMedicationTypeMap: {type: max} for one pair of config entries, first qualifying class wins. */
export function medicationTypeMap(meds, maxEntry, valueEntry) {
    const out = {};
    for (const name of meds.order) {
        const c = meds.medications[name];
        const v = c[valueEntry];
        if (v === undefined) { /* not defined: SQF checks fall through */ }
        else if (typeof v === "number") { if (v <= 0) continue; }
        else if (Array.isArray(v) && v[0] === 0 && v[1] === 0) continue;
        if (typeof c[maxEntry] !== "number") continue;
        const key = c.medicationType === "Default" ? name : c.medicationType;
        if (key in out) continue;
        out[key] = c[maxEntry];
    }
    return out;
}

/**
 * core/ov/medicationLocal: gives a medication. `name` is the ACM class (e.g. "Epinephrine_IV", "Morphine").
 * Returns the adjustment entry, or {occluded:true} when a tourniquet holds it.
 */
export function addMedication(sim, part, name, dose = 1, iv = false) {
    const { p, meds } = sim;
    if (!p.alive) return null;
    const pi = PART_INDEX[part];
    if (p.tourniquets[pi] && (!iv || !p.ioAccess[pi] || pi > 3)) {
        p.occludedMeds.push({ part: pi, name, dose, iv });
        return { occluded: true };
    }
    const c = meds.medications[name];
    if (!c) throw new Error("Unknown medication " + name);
    let maxEff = c.maxEffectDose, minEff = c.minEffectDose;
    let pain = c.painReduce || 0;
    const absorption = (c.bloodlossEffect || 0) > 0 ? lin(4.5, 3.6, p.bloodVolume, 1, 0.1) : 1;
    let ratio;
    if (c.weightEffect === 1 || c.weightEffect === 2) {
        maxEff = (maxEff / 83) * p.weight;
        minEff = (minEff / 83) * p.weight;
        ratio = dose / maxEff;
        if (pain !== 0) {
            pain = dose > minEff
                ? lin(minEff, maxEff, dose * absorption, c.minPainReduce, pain, false)
                : lin(minEff, 0, dose * absorption, c.minPainReduce, 0, false);
        }
    } else {
        ratio = dose / maxEff;
        if (pain !== 0) {
            pain = minEff === maxEff ? Math.min(pain, c.maxPainReduce) : Math.min(lin(minEff, maxEff, dose * absorption, c.minPainReduce, pain, false), c.maxPainReduce);
        }
    }
    ratio *= absorption;
    const [hrLo, hrHi] = c.hrIncrease;
    const hr = hrLo + hrHi !== 0 ? lin(0.5, 1, ratio, hrLo, hrHi, false) * 1.2 : 0;
    const scaled = (arr) => (arr[0] + arr[1] !== 0 ? lin(minEff, maxEff, maxEff * ratio, arr[0], arr[1], false) : 0);
    const clampR = (lo) => Math.min(1.1, Math.max(lo, ratio));
    const entry = {
        name, route: c.administrationType, added: p.t,
        onset: c.timeTillMaxEffect / clampR(0.5),
        total: c.timeInSystem * clampR(0.5),
        plateau: c.maxEffectTime * clampR(0.01),
        hr, pain, flow: (c.viscosityChange || 0) * ratio,
        rr: scaled(c.rrAdjust), co2: scaled(c.coSensitivityAdjust), breathing: scaled(c.breathingEffectivenessAdjust),
        conc: ratio, type: c.medicationType === "Default" ? name : c.medicationType, part: pi, dose,
    };
    p.meds.push(entry);
    sim.emit("medication", { name, dose, part });
    if (name === "TXA_IV") { sim.startCoagulation(); sim.startIBCoagulation(); }
    return entry;
}

/** Medication part of handleUnitVitals. Removes expired entries; returns the summed adjustments. */
export function medicationAdjustments(sim) {
    const { p } = sim;
    const caps = sim.medTypeCaps;
    const hrMap = Object.fromEntries(Object.entries(caps.hr).map(([k, v]) => [k, [0, v]]));
    const rrMap = Object.fromEntries(Object.entries(caps.rr).map(([k, v]) => [k, [0, v]]));
    const painMap = Object.fromEntries(Object.entries(caps.pain).map(([k, v]) => [k, [0, v]]));
    const out = { hr: 0, pain: 0, resistance: 0, rr: 0, co2: 0, breathing: 0 };
    const capAdd = (mapObj, key, add) => {
        const [cur, max] = mapObj[key];
        const next = cur + add;
        const positive = max > 0;
        if (positive ? cur < Math.min(next, max) : cur > Math.max(next, max)) mapObj[key] = [positive ? Math.min(next, max) : Math.max(next, max), max];
    };
    for (let i = p.meds.length - 1; i >= 0; i--) {
        const m = p.meds[i];
        const t = p.t - m.added;
        if (t >= m.total) { p.meds.splice(i, 1); continue; }
        const e = medicationEffect(m.route, t, m.onset, m.total, m.plateau);
        if (m.hr !== 0 && p.hr > 0) {
            const hrEffect = m.hr > 0 ? (p.targets.hr + 20) / p.hr : p.hr / (p.targets.hr - 20);
            if (m.type in hrMap) capAdd(hrMap, m.type, m.hr * e * hrEffect);
            else out.hr += m.hr * e * hrEffect;
        }
        if (m.flow !== 0) out.resistance += m.flow * e;
        if (m.rr !== 0) {
            if (m.type in rrMap) capAdd(rrMap, m.type, m.rr * e);
            else out.rr += m.rr * e;
        }
        if (m.co2 !== 0) out.co2 += m.co2 * e;
        if (m.breathing !== 0) out.breathing += m.breathing * e;
        if (m.pain !== 0 && m.type in painMap) {
            const [cur, max] = painMap[m.type];
            const next = cur + m.pain * e;
            if (cur < Math.min(next, max)) painMap[m.type] = [Math.min(next, max), max];
        }
    }
    for (const [v] of Object.values(hrMap)) out.hr += v;
    for (const [v] of Object.values(rrMap)) out.rr += v;
    for (const [v] of Object.values(painMap)) out.pain += v;
    return out;
}

/** circulation/getCardiacMedicationEffects (dose does not scale these: the concentration argument is unused in ACM). */
export function cardiacMedicationEffects(p) {
    const s = { Morphine: 0, Morphine_IV: 0, Fentanyl: 0, Fentanyl_IV: 0, Epinephrine_IV: 0, Amiodarone_IV: 0, Lidocaine_IV: 0 };
    for (const m of p.meds) {
        if (!(m.name in s)) continue;
        s[m.name] += medicationEffect(m.route, p.t - m.added, m.onset, m.total, m.plateau);
    }
    return {
        morphine: Math.max(Math.min(0.5, s.Morphine * 0.3), Math.min(0.8, s.Morphine_IV * 0.6)),
        fentanyl: Math.max(Math.min(0.5, s.Fentanyl * 0.3), Math.min(0.8, s.Fentanyl_IV * 0.6)),
        epinephrine: Math.min(2, s.Epinephrine_IV * 1.8),
        amiodarone: Math.min(2, s.Amiodarone_IV),
        lidocaine: Math.min(1.5, s.Lidocaine_IV),
    };
}
