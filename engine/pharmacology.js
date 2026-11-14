// Medications. Ports: core/ov/medicationLocal (dose scaling and the adjustment entry),
// circulation/getMedicationEffect (effect curves), core/ov/getMedicationCount, the medication part of
// core/ov/handleUnitVitals (per-type caps), core/generateMedicationTypeMap and circulation/getCardiacMedicationEffects.
// Overdose (onMedicationUsage/handleOverdose) and the per-drug handlers (adenosine, amiodarone, calcium, naloxone)
// are not in this module yet.
import { lin, PART_INDEX } from "./util.js";
import { startAtropineLoop, startDimercaprolLoop } from "./cbrn.js";

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
    // A class with no config (e.g. IM TXA) falls back to the root defaults, which have no time in system: no effect.
    if (!c) { sim.emit("medication", { name, dose, part, noEffect: true }); return { noEffect: true }; }
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
    onMedicationUsage(sim, name, c.maxDose || 0, c.maxDoseDeviation || 0, ratio, maxEff);
    handleMedicationEffects(sim, part, name, dose);
    return entry;
}

// ------------------------------------------------------------------ overdose (onMedicationUsage, handleOverdose, isOverdosed)
// [class, timeTillMaxEffect, timeInSystem, hr [a,b,c], route, maxEffectTime, rr, co2, breathing]
const OVERDOSE = {
    Amiodarone_IV: ["Overdose_Amiodarone", 60, 360, [-100, -110, -120], ROUTE.IV, 300, null, null, null],
    Ketamine: ["Overdose_Ketamine", 60, 360, [-20, -35, -40], ROUTE.IM, 240, null, [-0.9, -0.95, -1], [-0.01, -0.05, -0.1]],
    Lidocaine: ["Overdose_Lidocaine", 60, 360, [-40, -45, -50], ROUTE.IM, 240, null, [-0.9, -0.95, -1], null],
    Morphine: ["Overdose_Opioid", 60, 360, [-10, -15, -20], ROUTE.IM, 240, [-40, -45, -50], [-0.9, -0.95, -1], [-0.01, -0.05, -0.1]],
    Penthrox: ["Overdose_Penthrox", 30, 300, [-10, -15, -20], ROUTE.IM, 120, [-40, -45, -50], [-0.9, -0.95, -1], [-0.01, -0.05, -0.1]],
};
OVERDOSE.Ketamine_IV = OVERDOSE.Ketamine;
for (const k of ["Fentanyl", "Fentanyl_IV", "Fentanyl_BUC", "Morphine_IV"]) OVERDOSE[k] = OVERDOSE.Morphine;

function onMedicationUsage(sim, name, maxDose, deviation, ratio, maxEffectDose) {
    const { p, rng } = sim;
    if (maxDose < 1) return;
    const count = medicationCount(p, name);
    const dev = deviation > 0 ? rng.random(lin(75, 100, p.weight, deviation / 20, deviation)) : 0;
    if (count * maxEffectDose > maxDose + dev || ratio * maxEffectDose > maxDose + dev) {
        // handleOverdose: waits (up to an hour) until the amount in the body passes the fatal threshold
        sim.schedule(1, "overdoseWatch", { name, maxEffectDose, fatal: maxDose + dev, until: p.t + 3600 });
    }
}

export const pharmacologyTimers = {
    overdoseWatch(sim, a) {
        const { p, rng } = sim;
        if (medicationCount(p, a.name) * a.maxEffectDose > a.fatal) {
            const o = OVERDOSE[a.name];
            if (!o) return;
            const [cls, onset, total, hr, route, plateau, rr, co2, br] = o;
            p.meds.push({
                name: cls, route, added: p.t, onset, total, plateau, hr: rng.tri(...hr), pain: 0, flow: 0,
                rr: rr ? rng.tri(...rr) : 0, co2: co2 ? rng.tri(...co2) : 0, breathing: br ? rng.tri(...br) : 0,
                conc: 1, type: cls, part: -1, dose: 0,
            });
            sim.emit("overdose", { name: a.name });
            return;
        }
        if (p.t < a.until) sim.schedule(1, "overdoseWatch", a);
    },
    /** handleMed_AdenosineLocal, first wait: asystole once the effect passes 0.9 (60 s limit) */
    adenosineWatch(sim, { target, until }) {
        const { p } = sim;
        if (!p.alive || p.rhythm === "Asystole") return;
        if (medicationCount(p, "Adenosine_IV") > 0.9) {
            if (!p.cardiacArrest) { p.targetRhythm = "Asystole"; sim.fatalVitals(); }
            sim.schedule(1, "adenosineRestart", { target, until: p.t + 180 });
            return;
        }
        if (p.t < until) sim.schedule(1, "adenosineWatch", { target, until });
    },
    /** second wait: when the effect falls below 0.5, restart in the earlier rhythm (VT becomes sinus) */
    adenosineRestart(sim, { target, until }) {
        const { p } = sim;
        if (!p.alive) return;
        if (medicationCount(p, "Adenosine_IV") < 0.5) {
            if (p.rhythm !== "Asystole") return;
            if (target === "Sinus") { sim.attemptROSC(); return; }
            p.rhythm = target;
            return;
        }
        if (p.t < until) sim.schedule(1, "adenosineRestart", { target, until });
    },
};

const OVERDOSE_NAMES = ["Overdose_Amiodarone", "Overdose_Ketamine", "Overdose_Lidocaine", "Overdose_Opioid", "Overdose_Penthrox"];
const LOW_HR = ["Amiodarone_IV", "Morphine", "Morphine_IV", "Fentanyl", "Fentanyl_IV", "Fentanyl_BUC", "Midazolam", "Lidocaine_IV", "Ondansetron", "Ondansetron_IV", "Adenosine_IV", "Esmolol_IV"];
const HIGH_HR = ["Epinephrine", "Epinephrine_IV", "Atropine", "Atropine_IV", "Dimercaprol"];

/** circulation/isOverdosed: an overdose effect is active, or a drug is above its unstable dose for the last heart rate. */
export function isOverdosed(sim) {
    const { p, meds } = sim;
    if (OVERDOSE_NAMES.some((n) => medicationCount(p, n) > 0.1)) return true;
    const last = p.hrLast ?? 0;
    const list = last < 50 ? LOW_HR : last > p.targets.maxHr ? HIGH_HR : [];
    for (const n of list) {
        let conc = medicationCount(p, n);
        if (conc === 0) continue;
        const c = meds.medications[n];
        if (!c || !c.unstableDose) continue;
        conc *= c.weightEffect > 0 ? (c.maxEffectDose / 83) * p.weight : c.maxEffectDose;
        if (conc > c.unstableDose) return true;
    }
    return false;
}

// ------------------------------------------------------------------ special medication effects (handleMedicationEffects)
// ACM dispatches only these classes. Amiodarone_IV is NOT in its list, so the amiodarone restart routine never runs.
function handleMedicationEffects(sim, part, name, dose) {
    const { p } = sim;
    switch (name) {
        case "TXA_IV": sim.startCoagulation(); sim.startIBCoagulation(); break;
        case "CalciumChloride_IV": {
            if (dose < 900) break;
            let given = 2 * (dose / 1000);
            if (!p.calciumFirstDose) { p.calciumFirstDose = true; given += 0.5 * (dose / 1000); }
            p.calcium += given;
            break;
        }
        case "Adenosine_IV": {
            const target = p.rhythm === "VT" ? "Sinus" : p.rhythm;
            if (!p.alive || target === "Asystole") break;
            sim.schedule(1, "adenosineWatch", { target, until: p.t + 60 });
            break;
        }
        case "Naloxone":
            // Removes the opioid overdose effect. Its call to remove the "Opioid" family matches class names only, so doses stay.
            p.meds = p.meds.filter((m) => m.name !== "Overdose_Opioid");
            break;
        case "AmmoniaInhalant": {
            const since = p.t - (p.ammoniaLastUse ?? -1e9);
            p.ammoniaLastUse = p.t;
            p.knockOut = false;
            if (since < 10) break;
            if (!sim.hasStableVitals() || p.surgicalAirway) break;
            if (sim.rng.random(1) < lin(80, 99, p.spo2, 0.5, 1) && p.unconscious) sim.wakeUp();
            break;
        }
        case "Atropine": case "Atropine_IV": startAtropineLoop(sim); break; // sarin buildup and airway spasm
        case "Dimercaprol": startDimercaprolLoop(sim); break; // lewisite buildup
        default: break; // Ketamine/Lidocaine: player screen effect only
    }
}

/** circulation/getNauseaMedicationEffects: added to the vomit chance; ondansetron suppresses. */
export function nauseaEffect(p) {
    const e = {};
    for (const m of p.meds) e[m.name] = (e[m.name] || 0) + medicationEffect(m.route, p.t - m.added, m.onset, m.total, m.plateau);
    const g = (k) => e[k] || 0;
    const L = (a, b, v, c, d) => Math.max(0, lin(a, b, v, c, d, false));
    const opioidIV = L(0.3, 1, g("Morphine_IV"), 0, 1), opioid = L(0.3, 1, g("Morphine") * 0.5, 0, 1);
    const fentIV = L(0.5, 1, g("Fentanyl_IV"), 0, 1), fent = L(0.5, 1, g("Fentanyl") * 0.5, 0, 1);
    const ketIV = L(0.3, 1, g("Ketamine_IV"), 0, 1), ket = L(0.3, 1, g("Ketamine") * 0.5, 0, 1);
    const lidoIV = L(0.6, 1, g("Lidocaine_IV"), 0, 1), lido = L(0.4, 1, g("Lidocaine") * 0.5, 0, 1);
    const amioIV = L(0.5, 1, g("Amiodarone_IV"), 0, 1);
    const ondIV = Math.max(0, lin(0.5, 1, g("Ondansetron_IV"), 0, 0.9)), ond = Math.max(0, lin(0.5, 1, g("Ondansetron") * 0.6, 0, 0.5));
    const heavy = medicationCount(p, "Ondansetron_IV") + medicationCount(p, "Ondansetron") * 0.5 > 2;
    const suppression = heavy ? (ondIV + ond) * 0.5 : ondIV + ond;
    const nausea = Math.min(1.2, Math.min(1, opioidIV + opioid) + Math.min(1, fentIV + fent) + Math.min(1, ketIV + ket) + Math.min(1, lidoIV + lido) + amioIV);
    return nausea - suppression;
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
