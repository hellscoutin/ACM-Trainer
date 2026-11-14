// Airway state, breathing state, respiration rate and SpO2.
// Ports: airway/getAirwayState, breathing/getBreathingState, breathing/updateRespirationRate, core/ov/updateOxygen.
// Altitude and ACE fatigue are not simulated (sea level, rested casualty), so air saturation = 1.
import { lin } from "./util.js";
import { effectiveBloodVolume, map } from "./patient.js";
import { inflammation, lungDamage, spasmUnmitigated } from "./cbrn.js";

const BASE_OXYGEN_USE = -0.25;
const MIN_DECREASE = 0.1; // ACM_BREATHING_MINDECREASE
const MAX_DECREASE = 0.12; // ACM_BREATHING_MAXDECREASE

export function airwayState(p) {
    if (p.surgicalAirway) return p.surgicalAirwayUnsecure ? 0.75 : 1;
    if (!p.unconscious) return 1;
    let state;
    if (p.obstructionVomit + p.obstructionBlood > 0) {
        state = 0;
    } else {
        const collapse = 1 - p.airwayCollapse / 3;
        const base = p.airwayReflex ? 0.88 : 0.78;
        if (p.recoveryPosition) state = Math.max(collapse, 0.97);
        else if (p.headTilt) state = Math.max(collapse, 0.98);
        else if (p.airwayOral === "SGA") state = Math.max(collapse, 0.99);
        else if (p.airwayNasal === "NPA" || p.airwayOral === "OPA") state = Math.min(collapse, Math.max(base, 0.95));
        else state = Math.min(base, collapse);
    }
    // CBRN airway inflammation (only reached when unconscious, as in getAirwayState)
    const infl = inflammation(p);
    if (infl > 10) state = infl >= 100 ? 0 : state * lin(10, 100, infl, 1, 0.2);
    return state;
}

export function breathingState(p) {
    let state = 1;
    if (p.htxFluid > 0.3) state = 1 - 0.9 * (p.htxFluid / 1.5);
    if (p.tensionPtx) state = 0.1;
    else state -= p.ptx / 10;
    if (p.hardcorePtx) state = Math.min(state, p.cardiacArrest ? 0.95 : 0.8);
    const exposure = p.cbrn?.breathingAbility ?? 1; // CBRN heavy exposure halves breathing
    if (exposure < 1) state *= exposure;
    return state;
}

export const bvmActive = (p) => p.bvm;
export const cprActive = (p) => p.cpr;

/** breathing/updateRespirationRate */
export function updateRespirationRate(sim, spo2, oxygenDemand, rrAdjust, coAdjust, dt) {
    const { p, rng } = sim;
    let rr = p.rr;
    const breathing = airwayState(p) > 0 && breathingState(p) > 0;
    if (!breathing) rr = 0;
    else if (p.cbrn && spasmUnmitigated(sim) && !p.surgicalAirway) rr = 0; // sarin airway spasm (before BVM)
    else if (bvmActive(p)) rr = 10;
    else if (cprActive(p)) rr = rng.tri(20, 25, 30);
    else if (!p.alive || p.hr < 20) rr = 0;
    else {
        const desired = p.targets.rr;
        const coEffect = coAdjust !== 0 ? 1 + coAdjust : 1;
        const missing = p.targets.spo2 * coEffect - spo2;
        // as SQF: (desired + missing * lin) max (demand * -500)
        let target = Math.max(desired + missing * lin(0, 20, missing, 1, 0.6), oxygenDemand * -500);
        if (p.unconscious) target = Math.min(desired + 16, target);
        target = Math.max(0, Math.min(60, target + rrAdjust));
        const change = (target - rr) / 2;
        rr = change < 0 ? Math.max(rr + dt * change, target) : Math.min(rr + dt * change, target);
    }
    p.rr = rr;
    return rr;
}

/** core/ov/updateOxygen. Returns the new SpO2. */
export function updateOxygen(sim, rrAdjust, coAdjust, breathingAdjust, dt, hasPulse) {
    const { p } = sim;
    const desired = p.targets.spo2;
    const current = p.spo2;
    const negativeChange = BASE_OXYGEN_USE;
    const rr = updateRespirationRate(sim, current, negativeChange - BASE_OXYGEN_USE, rrAdjust, coAdjust, dt);

    let target = desired;
    const capture = 1; // po2 = ideal
    const eff = effectiveBloodVolume(p);
    const bvFactor = eff < 5 ? lin(5, 4, eff, 0.92, 0.84, false) : lin(6, 5, eff, 1, 0.92);
    const airway = airwayState(p);
    let breathingSt = breathingState(p);

    let spo2 = current;
    const activeBVM = bvmActive(p);
    let bvmOxygen = p.bvmOxygen;
    const sinceBreath = p.t - p.lastBreath;
    let lasting = 0;
    if (sinceBreath < 35) {
        bvmOxygen = p.t - p.lastBreathOxygen < 30;
        lasting = Math.min(1, 25 / Math.max(sinceBreath, 0.001));
    }

    let maxDecrease = p.hr > 0 ? lin(90, 75, spo2, -MAX_DECREASE, -MIN_DECREASE) : -MIN_DECREASE;
    let maxGain = 0.5;
    const exposed = !!p.cbrn?.exposedAny;
    if (!activeBVM) {
        if (exposed) maxGain *= p.cbrn.breathingIncrease; // CBRN
        if (p.unconscious) maxGain *= 0.25;
        maxDecrease *= 1 - 0.7 * lasting;
    } else if (bvmOxygen) {
        maxGain *= 0.8;
        maxDecrease *= p.cardiacArrest ? 0.3 : 0.1;
    } else {
        if (exposed) maxGain *= p.cbrn.breathingIncrease; // CBRN
        maxGain *= 0.75;
        maxDecrease *= p.cardiacArrest ? 0.9 : 0.7;
    }
    if (p.cbrn && rr > 0) {
        const infl = inflammation(p);
        if (!p.surgicalAirway && infl > 30) maxGain *= lin(30, 100, infl, 1, 0);
        const lung = lungDamage(p);
        breathingSt = lung >= 100 ? 0 : breathingSt * lin(20, 95, lung, 1, 0.1);
    }

    let effectiveness = Math.min(bvFactor, airway * breathingSt);

    if (rr > 0 && hasPulse) {
        const m = map(p.bp);
        let cardiac = 1;
        if (m > 90) cardiac *= m > 120 ? lin(120, 150, m, 1.15, 0.85) : lin(95, 120, m, 1, 1.15);
        else cardiac *= lin(80, 60, m, 1, 0.8);
        if (activeBVM) {
            effectiveness *= p.cardiacArrest ? 1.2 : 1.3;
            if (bvmOxygen) effectiveness *= 1.6;
        }
        if (p.freshBloodEffect > 0.83) effectiveness *= Math.max(1, 1.2 * p.freshBloodEffect);
        if (breathingAdjust !== 0) effectiveness = Math.min(effectiveness * (1 + breathingAdjust), Math.min(effectiveness + 0.01, 1));
        const fatigue = Math.min(1, Math.max(0.99, -0.25 / negativeChange));
        // As SQF: when RR is above target the computed value is never assigned, so the effect stays 1.
        const respEffect = rr > p.targets.rr ? 1 : Math.min(1, Math.max(0.8, rr / 12));
        target = Math.min(desired, target * effectiveness * cardiac * capture * respEffect * fatigue);
        const change = (target - current) / 5;
        spo2 = change < 0 ? current + Math.max(change, maxDecrease) * dt : current + Math.min(maxGain, Math.max(maxGain / 2, change)) * dt;
    } else if (p.cardiacArrest && cprActive(p)) {
        maxGain *= 0.5 + 0.5 * lasting;
        effectiveness *= 0.75 * (1 + 0.3 * lasting);
        if (bvmOxygen) effectiveness *= 1.5;
        if (breathingAdjust !== 0) effectiveness = Math.min(effectiveness * (1 + breathingAdjust), Math.min(effectiveness + 0.01, 1));
        target = Math.min(desired, target * effectiveness);
        const change = (target - current) / 5;
        spo2 = change < 0 ? current + Math.max(change, maxDecrease) * dt : current + Math.min(maxGain, Math.max(maxGain / 10, change)) * dt;
    } else {
        spo2 = current + maxDecrease * dt;
    }
    p.spo2 = Math.max(0, Math.min(100, spo2));
    p.oxygenDemand = 0;
    return p.spo2;
}
