// Vitals loop, heart rate, blood pressure, critical grace period, cardiac arrest, CPR, AED shock and wake-up.
// Ports: core/ov/handleUnitVitals, updateHeartRate, getBloodPressure, hasStableVitals, handleStateUnconscious;
// core/handleFatalVitals, handleCriticalVitals, onCardiacArrest, setCardiacArrestState, handleKnockOut;
// circulation/hasPulse, updateCirculationState, handleCardiacArrest, handleReversibleCardiacArrest, attemptROSC,
// handleCPR, beginCPR (timing variables), AED_AdministerShock, recentAEDShock; ACE pain/resistance updates.
import { lin } from "./util.js";
import { cbrnHeartRateAdjust } from "./cbrn.js";
import { cardiacOutput, painPerceived, map } from "./patient.js";
import { bloodVolumeStep, bloodLossRate } from "./blood.js";
import { updateOxygen } from "./oxygen.js";
import { medicationAdjustments, medicationCount, cardiacMedicationEffects } from "./pharmacology.js";

const BP_HIGH = 9.4736842; // ACE MODIFIER_BP_HIGH
const BP_LOW = 6.3157894; // ACE MODIFIER_BP_LOW
const PAIN_FADE = 900;

export const recentAEDShock = (p) => p.lastShock + 60 > p.t;

/** circulation/hasPulse */
export function hasPulse(p, palpable = false) {
    if (!p.alive || recentAEDShock(p) || !p.circulationOk || p.cardiacArrest) return false;
    if (palpable) return !p.criticalActive;
    return true;
}

/** circulation/updateCirculationState */
export function updateCirculationState(p) {
    p.circulationOk = !(p.spo2 < 67 || p.tensionPtx || p.htxFluid > 1.2 || p.bloodVolume < 3.6);
}

/** core/ov/getBloodPressure -> [diastolic, systolic] */
export function bloodPressure(p) {
    let bp = cardiacOutput(p) * p.resistance;
    if (p.hr > 140) bp *= lin(140, 200, p.hr, 1, 0.75);
    else if (p.hr < 70) bp *= lin(70, 50, p.hr, 1, 0.75);
    if (p.bloodVolume < 4.8) bp *= lin(4.8, 3.6, p.bloodVolume, 1, 0.5);
    const bleedEffect = 1 - 0.2 * p.woundBleeding;
    const htxBleeding = 0.5 * (p.htxState / 10);
    const ibEffect = Math.max(0.5, Math.min(1, 1 - 0.8 * (p.internalBleeding + htxBleeding)));
    const overloadEffect = lin(0, 1, p.overload, 1, 1.5, false);
    const diastolicMod = p.bloodVolume < 6 ? lin(5.1, 4.2, p.bloodVolume, 1, 1.2) : 1;
    let tension = 0;
    if (p.ptx > 0 || p.htxFluid > 0.1) tension = Math.max(p.ptx * 8, p.htxFluid / 46);
    if (p.tensionPtx || p.hardcorePtx) tension = 35;
    const poisonEffect = p.cbrn ? lin(0, 100, p.cbrn.capillary, 1, 0.7, false) : 1; // lewisite capillary damage
    const f = bleedEffect * ibEffect * overloadEffect * poisonEffect;
    return [Math.max(0, Math.round((bp * BP_LOW * diastolicMod - tension) * f)), Math.max(0, Math.round((bp * BP_HIGH - tension) * f))];
}

/** SQF round: halves round away from zero. */
const sqfRound = (x) => Math.sign(x) * Math.round(Math.abs(x));

/** core/ov/updateHeartRate */
export function updateHeartRate(sim, adjust, dt) {
    const { p, rng } = sim;
    const desired = p.targets.hr;
    let hr = p.hr;
    if (!hasPulse(p) || p.cpr) {
        hr = p.cpr ? rng.tri(100, 110, 120) : 0;
    } else {
        let change, target = 0;
        if (p.bloodVolume > 3.6) {
            const sinceROSC = p.t - p.roscTime;
            const meanBP = map(p.bp);
            const pain = painPerceived(p);
            target = desired;
            if (p.bloodVolume <= 5.1) {
                let targetBP = lin(5.1, 4.2, p.bloodVolume, 90, 80);
                if (p.bloodVolume <= 4.2) targetBP = lin(4.2, 3.6, p.bloodVolume, 80, 40);
                target = Math.max(desired, hr * (targetBP / Math.max(45, meanBP)));
            }
            if (pain > 0.2) target = Math.max(target, desired + (p.unconscious ? 40 : 50) * pain);
            const missing = p.targets.spo2 - p.spo2;
            let oxyHR = target + Math.max(missing * lin(5, 20, missing, 0, 2), p.oxygenDemand * -2000);
            oxyHR = Math.min(oxyHR, p.targets.maxHr);
            target = Math.max(target, oxyHR);
            target = Math.max(0, target + adjust);
            if (sinceROSC < 45) {
                target = Math.max(target, desired + 40 * Math.min(1, 30 / sinceROSC));
                target = Math.min(target, p.targets.maxHr);
            } else if (p.hardcorePostArrest) {
                target = Math.min(target, (target / desired) * (desired * 0.7));
            }
            change = sqfRound(target - hr) / 2;
        } else {
            change = -sqfRound(hr / 10);
        }
        hr = change < 0 ? Math.max(hr + dt * change, target) : Math.min(hr + dt * change, target);
    }
    p.hr = hr;
    return hr;
}

/** core/ov/hasStableVitals */
export function hasStableVitals(sim) {
    const { p } = sim;
    if (p.bloodVolume < 5.1 || p.cardiacArrest || recentAEDShock(p)) return false;
    if (bloodLossRate(sim) > (0.5 * cardiacOutput(p)) / 2) return false;
    if (p.bp[0] < 50 || p.bp[1] < 60) return false;
    if (p.hr < 40 || p.spo2 < 80 || p.rr < 6) return false;
    return true;
}

/** core/ov/handleUnitVitals: one vitals update of dt seconds (dt >= 1, capped at 10). */
export function handleUnitVitals(sim, dt) {
    const { p, rng } = sim;
    dt = Math.min(10, dt);
    const bv = Math.max(0, Math.min(6, bloodVolumeStep(sim, dt)));
    p.bloodVolume = bv;
    p.hemorrhage = bv < 3.6 ? 4 : bv < 4.2 ? 3 : bv < 5.1 ? 2 : bv < 5.95 ? 1 : 0;
    const woundBleeding = p.woundBleeding;
    const inPain = painPerceived(p) > 0;

    let tqPain = 0;
    for (const at of p.tourniquetTime) if (at !== -1 && p.t - at > 120) tqPain = Math.max(tqPain, (p.t - at - 120) * 0.001);
    if (tqPain > 0) p.pain = Math.max(0, Math.min(1, Math.max(p.pain, tqPain)));

    const adj = medicationAdjustments(sim);
    if (p.reactionSeverity > 0) {
        adj.hr += p.reactionSeverity * 15;
        adj.rr -= p.reactionSeverity * 5;
        adj.resistance -= p.reactionSeverity * 15;
        adj.breathing -= p.reactionSeverity * 0.05;
    }

    const spo2 = updateOxygen(sim, adj.rr, adj.co2, adj.breathing, dt, hasPulse(p));
    if (spo2 < 67) adj.hr -= 10 * Math.abs(67 - spo2);
    if (p.tensionPtx || p.hardcorePtx) adj.hr -= p.tensionPtx ? 35 : 25;
    else if (p.ptx > 0) adj.hr -= 5 * p.ptx;
    if (p.transfused > 0.05) adj.hr -= p.transfused / 0.05;
    adj.hr += cbrnHeartRateAdjust(p);

    const hr = updateHeartRate(sim, adj.hr, dt);
    // ACE updatePainSuppress (advanced medication) and pain fade
    p.pain = Math.max(0, p.pain - dt / PAIN_FADE);
    p.painSuppress = Math.max(0, adj.pain);

    // Vasoconstriction
    let targetVaso = bv < 5.9 ? lin(5.9, 4.5, bv, 0, 50) : 0;
    if (bv > 4) {
        const m = map(p.bp);
        const mapAdj = m > 94 ? lin(94, 120, m, 0, -60) : m < 88 ? lin(88, 60, m, 0, 40) : 0;
        targetVaso = Math.min(50, targetVaso + mapAdj);
        if (woundBleeding > 0 && targetVaso < 0) targetVaso *= 0.75;
    }
    const vChange = (targetVaso - p.vasoconstriction) / 4;
    p.vasoconstriction = targetVaso > p.vasoconstriction
        ? Math.min(targetVaso, p.vasoconstriction + vChange * Math.min(dt, 1.2))
        : Math.max(targetVaso, p.vasoconstriction + vChange * Math.min(dt, 1.2));
    p.resistance = Math.max(1, 100 + adj.resistance + p.vasoconstriction);

    p.bp = bloodPressure(p);
    const m = map(p.bp);

    // Ordered most lethal first
    if (sim.aceSetting("cardiacArrestBleedoutEnabled", true) && bv < 3) { sim.die("Bleedout"); return; }
    if (spo2 < 55) { if (55 - rng.random(5) > spo2) sim.die("Oxygen Deprivation"); return; }
    if (p.cardiacArrest) return;
    if (recentAEDShock(p)) return;
    if (p.hemorrhage === 4) { sim.fatalVitals(); updateCirculationState(p); return; }
    if (p.roscTime + 10 > p.t) return;
    if (spo2 < 67) {
        let enter = false;
        if (p.t >= p.hypoxiaNextCheck) {
            enter = 67 - rng.random(10) > spo2;
            p.hypoxiaNextCheck = p.t + 5;
            updateCirculationState(p);
        }
        if (enter) sim.fatalVitals(); else sim.criticalVitals();
        return;
    }
    if (!p.criticalActive && (hr < 40 || hr > 220)) {
        if (hr > 220) { p.rhythm = "VT"; p.targetRhythm = "PVT"; }
        else if (medicationCount(p, "Adenosine_IV") > 0.5) { p.rhythm = "Asystole"; p.targetRhythm = "Asystole"; }
        else { p.rhythm = "VF"; p.targetRhythm = "VF"; }
        handleFatalVitals(sim);
        return;
    }
    if (m < 55 || m > 200) { handleFatalVitals(sim); return; }
    if (p.unconscious) return;
    if (woundBleeding > 0.5) { sim.criticalVitals(); return; }
    if (spo2 < 80) { if (80 - rng.random(10) > spo2) sim.criticalVitals(); return; }
    if (p.rr < 6) { sim.criticalVitals(); return; }
}

/** core/handleFatalVitals */
export function handleFatalVitals(sim) {
    const { p } = sim;
    if (p.criticalActive || p.cardiacArrest || !p.alive) return;
    if (p.bloodVolume > 3.6 && !p.criticalPassed) { startCriticalVitals(sim); return; }
    sim.fatalVitals();
}

/** core/handleCriticalVitals: 15-30 s grace period, checked every second by criticalTick. */
function startCriticalVitals(sim) {
    const { p, rng } = sim;
    if (p.targetRhythm === "Asystole") return;
    p.criticalUntil = p.t + 15 + rng.random(15);
    p.criticalActive = true;
    sim.emit("criticalGrace", { until: p.criticalUntil });
    sim.schedule(1, "criticalTick", {});
}

export const vitalsTimers = {
    criticalTick(sim) {
        const { p, rng } = sim;
        if (!p.criticalActive) return;
        const hr = p.hr;
        const m = map(bloodPressure(p));
        const hrLimits = hr > 240 || hr < 30;
        const mapLimits = m > 200 || m < 55;
        if (hr > 245 || hr < 10 || m > 220 || m < 30 || ((hrLimits || mapLimits) && p.t > p.criticalUntil + 15) || !p.alive || p.cardiacArrest || !["Sinus", "VT"].includes(p.rhythm)) {
            if (p.alive) {
                p.targetRhythm = !p.circulationOk ? "PEA" : hr > 200 ? "PVT" : "VF";
                if (!p.cardiacArrest) sim.fatalVitals();
                p.criticalPassed = true;
                sim.schedule(15 + rng.random(15), "criticalPassedReset", {});
            }
            p.criticalActive = false;
            return;
        }
        if (!p.cardiacArrest && hr > 45 && hr < 200 && m > 60 && m < 180) {
            if (p.rhythm === "VT") p.rhythm = "Sinus";
            p.criticalActive = false;
            sim.emit("criticalRecovered", {});
            return;
        }
        if (!p.unconscious && (hrLimits || mapLimits || p.t > p.criticalUntil)) sim.criticalVitals();
        sim.schedule(1, "criticalTick", {});
    },
    criticalPassedReset(sim) {
        // waitUntil: not critical and not in arrest
        const { p } = sim;
        if (p.criticalActive || p.cardiacArrest) { sim.schedule(1, "criticalPassedReset", {}); return; }
        p.criticalPassed = false;
    },
    knockOutEnds(sim) {
        // core/handleKnockOut callback
        const { p } = sim;
        if (!p.alive || !p.unconscious) return;
        p.knockOut = false;
        if (!p.airwayReflex) p.airwayReflex = true;
    },
    reversibleTick(sim) {
        const { p } = sim;
        if (!p.reversibleActive) return;
        const cause = p.tensionPtx || p.htxFluid > 1.2 || p.bloodVolume <= 4.2 || p.spo2 < 67;
        const expired = p.reversibleTime + 360 < p.t;
        if (p.rhythm !== "PEA" || !cause || !p.cardiacArrest || !p.alive || expired) {
            p.reversibleActive = false;
            if (p.cardiacArrest && p.alive && !expired && p.rhythm === "PEA") attemptROSC(sim);
            else if (p.cardiacArrest && p.alive) handleCardiacArrest(sim);
            updateCirculationState(p);
            return;
        }
        sim.schedule(5, "reversibleTick", {});
    },
    asystoleWatch(sim) {
        const { p } = sim;
        if (!p.alive || !p.cardiacArrest) return;
        if (p.bloodVolume < 3.1) { p.rhythm = "Asystole"; return; }
        sim.schedule(1, "asystoleWatch", {});
    },
    cprRoll(sim, { session }) {
        // circulation/handleCPR: one roll every 5 s while the same CPR session is running
        const { p, rng } = sim;
        if (!p.cpr || p.cprSession !== session) return; // pausing or stopping ends the loop
        sim.schedule(5, "cprRoll", { session });
        if (!p.cardiacArrest || p.rhythm === "PEA" || !p.alive) return;
        if (p.bloodVolume < 3.6) return;
        const skill = [0.2, 0.4, 0.55][p.cprSkill] ?? 0.2;
        const noFlow = p.t - p.cprStoppedTime;
        const last = Math.max(0.5, Math.min(1.5, lin(65, 120, p.cprStoppedTotal, 0.1, 1, false) * (30 / Math.max(noFlow, 0.1))));
        const cprTime = p.t - p.cprStartTime;
        const consistency = Math.min(1.2, last * lin(65, 120, cprTime, 0.1, 1, false));
        const bloodloss = lin(3.6, 5.1, p.bloodVolume, 0, 1);
        const shock = Math.max(0.8, Math.min(1.7, 120 / (p.t - p.lastShock)));
        const med = cardiacMedicationEffects(p);
        let rhythmEffect = 1, medEffect = 1;
        if (p.rhythm === "PVT" || p.rhythm === "VF") {
            rhythmEffect = (p.rhythm === "PVT" ? 0.9 : 0.85) * shock;
            medEffect = Math.max(1, Math.min(2.2, med.epinephrine + med.amiodarone + med.lidocaine)) - med.morphine - med.fentanyl;
        } else if (p.rhythm === "Asystole") {
            rhythmEffect = 1.2;
            medEffect = Math.max(1, med.epinephrine) - med.morphine - med.fentanyl;
        }
        const chance = Math.max(0, skill * sim.setting("ACM_circulation_CPREffectiveness") * bloodloss * consistency * rhythmEffect * medEffect);
        p.lastCprChance = chance;
        if (chance > 0.1 && rng.random(1) < chance) {
            if (p.rhythm === "Asystole") { p.rhythm = rng.random(1) < 0.5 ? "PVT" : "VF"; sim.emit("rhythmChange", { rhythm: p.rhythm }); }
            else attemptROSC(sim);
        }
    },
};

/** core/onCardiacArrest (called when the ACE state machine enters cardiac arrest). */
export function onCardiacArrest(sim) {
    const { p, rng } = sim;
    if (p.rhythm === "Asystole") return;
    updateCirculationState(p);
    if (!p.circulationOk || p.bloodVolume < 4.2) {
        handleReversibleCardiacArrest(sim);
        p.arrestTime = p.t;
    } else if (sim.isOverdosed() || rng.random(1) < sim.setting("ACM_circulation_cardiacArrestChance") || p.targetRhythm !== "Sinus") {
        handleCardiacArrest(sim);
        p.arrestTime = p.t;
    } else {
        handleKnockOut(sim);
        attemptROSC(sim);
    }
}

export function handleKnockOut(sim) {
    const { p, rng } = sim;
    if (!p.alive) return;
    p.knockOut = true;
    if (!p.ai || rng.random(1) > sim.setting("ACM_damage_AIStayDownChance")) sim.schedule(15 + rng.random(20), "knockOutEnds", {}); // players always get the timer
}

/** circulation/handleCardiacArrest. Rhythm deterioration is omitted: its time check is inverted in ACM 1.4.8 and never fires. */
export function handleCardiacArrest(sim) {
    const { p, rng } = sim;
    if (p.rhythm === "Asystole" || p.arrestLoop) return;
    if (p.bloodVolume < 3.1) { p.rhythm = "Asystole"; sim.emit("rhythmChange", { rhythm: p.rhythm }); return; }
    let target = p.targetRhythm;
    if (["Sinus", "VT", "PVT"].includes(target)) target = rng.random(100) * (p.bloodVolume / 5.1) > 50 ? "PVT" : "VF";
    p.rhythm = target;
    p.targetRhythm = "Sinus";
    if (!p.cpr) p.cprStoppedTime = p.t;
    p.arrestLoop = true;
    sim.emit("rhythmChange", { rhythm: p.rhythm });
    sim.schedule(1, "asystoleWatch", {});
}

export function handleReversibleCardiacArrest(sim) {
    const { p } = sim;
    if (p.rhythm === "PEA" || p.reversibleActive) return;
    p.reversibleActive = true;
    p.reversibleTime = p.t;
    p.rhythm = "PEA";
    updateCirculationState(p);
    sim.emit("rhythmChange", { rhythm: "PEA" });
    sim.schedule(5, "reversibleTick", {});
}

/** circulation/attemptROSC */
export function attemptROSC(sim) {
    const { p } = sim;
    updateCirculationState(p);
    if (!p.cardiacArrest || !p.alive) return false;
    if (p.circulationOk && p.bloodVolume > 4.2) {
        sim.cprSucceeded();
        if (sim.setting("ACM_circulation_Hardcore_PostCardiacArrest")) p.hardcorePostArrest = true;
        p.arrestTime = -1;
        return true;
    }
    handleReversibleCardiacArrest(sim);
    return false;
}

/** circulation/AED_AdministerShock (effects only). */
export function administerShock(sim) {
    const { p, rng } = sim;
    const since = p.t - p.lastShock;
    p.lastShock = p.t;
    p.shockTotal++;
    sim.emit("shock", { rhythm: p.rhythm });
    if (!p.alive) return;
    const rhythm = p.rhythm;
    if (["Sinus", "Asystole", "PEA", "VT"].includes(rhythm) || since < 60) {
        p.rhythm = "Asystole";
        if (rhythm === "Sinus" || rhythm === "VT") handleFatalVitals(sim);
        return;
    }
    const amio = cardiacMedicationEffects(p).amiodarone;
    let go = false;
    if (p.shockResistant) go = amio > 1.9;
    else if (!p.resistChecked && rng.random(1) < 0.3) { p.shockResistant = true; p.resistChecked = true; }
    if (!go) return;
    const cprEff = p.cprStoppedTotal > 60 ? lin(60, 120, p.cprStoppedTotal, 0, 10, false) : 0;
    if (rng.random(1) < cprEff + 0.2 + 0.2 * amio) attemptROSC(sim);
}

/** ACM handleStateUnconscious wake-up part (spontaneous wake-up every 15 s). */
export function wakeUpCheck(sim) {
    const { p, rng } = sim;
    const chance = sim.aceSetting("spontaneousWakeUpChance", 0.1);
    if (chance <= 0) return;
    if (hasStableVitals(sim) && !p.knockOut && !p.surgicalAirway) {
        if (p.lastWakeUpCheck === null) { p.lastWakeUpCheck = p.t; return; }
        if (p.t - p.lastWakeUpCheck > 15) {
            p.lastWakeUpCheck = p.t;
            if (rng.random(1) <= chance) sim.wakeUp();
        }
    } else {
        p.lastWakeUpCheck = Math.max(p.lastWakeUpCheck ?? 0, p.t);
    }
}
