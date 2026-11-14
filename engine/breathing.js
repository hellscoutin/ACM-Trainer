// Chest injuries. Ports ACM_breathing: handleChestInjury (with generatePTXMap chances), handlePneumothorax,
// handleHemothorax, applyChestSealLocal, performNCDLocal, updateLungState, checkBreathingLocal, inspectChestLocal.
// Not yet: thoracostomy, chest tube, drainage, stethoscope dialog, CBRN lung damage.
import { lin } from "./util.js";
import { airwayState, breathingState } from "./oxygen.js";

/** generatePTXMap: wound ID (10 x class + size) -> [minDamage, minChance, maxDamage, maxChance] */
const CHEST_CHANCES = {
    61: [0.25, 0, 0.5, 0.3], 62: [0.5, 0.5, 1, 0.9], // VelocityWound medium / large
    71: [0.25, 0, 0.5, 0.25], 72: [0.5, 0.3, 1, 0.8], // PunctureWound
    11: [0.25, 0, 0.5, 0.2], 12: [0.5, 0.2, 2, 0.5], // Avulsion
};
const CLASS_ID = { Avulsion: 1, VelocityWound: 6, PunctureWound: 7 };

const pain = (p, level) => { p.pain = Math.max(0, Math.min(1, Math.max(p.pain, level))); };

/** Called from the wound handler for a torso critical hit of avulsion, velocity or puncture (woundsHandlerBase). */
export function handleChestInjury(sim, type, size, damage) {
    const { p, rng } = sim;
    if (!sim.setting("ACM_breathing_pneumothoraxEnabled") || !(type in CLASS_ID)) return;
    p.chestInjury = true;
    const c = CHEST_CHANCES[CLASS_ID[type] * 10 + size];
    if (c) {
        const chance = lin(c[0], c[2], damage, c[1], c[3]);
        if (rng.random(1) < chance * sim.setting("ACM_breathing_chestInjuryChance")) {
            if (rng.random(1) < sim.setting("ACM_breathing_hemothoraxChance")) handleHemothorax(sim);
            else handlePneumothorax(sim);
            updateLungState(sim);
        }
    }
    if (p.chestSeal) p.chestSeal = false; // any new chest hit removes the seal
}

export function handlePneumothorax(sim) {
    const { p, rng } = sim;
    if (p.tensionPtx) return;
    if (p.ptx > 3) { p.tensionPtx = true; p.tensionTime = p.t; }
    else p.ptx++;
    sim.emit("pneumothorax", { level: p.ptx, tension: p.tensionPtx });
    if (p.ptxLoop) return;
    p.ptxLoop = true;
    const every = 40 + rng.random(40);
    sim.schedule(every, "ptxTick", { every });
}

export function handleHemothorax(sim) {
    const { p, rng } = sim;
    if (p.htxState >= 10) return;
    p.htxState = p.htxState === 0 ? 5 + Math.round(rng.random(5)) : p.htxState + 1;
    pain(p, lin(1, 6, p.htxState, 0.3, 1));
    sim.emit("hemothorax", { level: p.htxState });
    if (p.htxLoop) return;
    p.htxLoop = true;
    const hardcore = sim.setting("ACM_breathing_Hardcore_HemothoraxBleeding");
    const every = hardcore ? 15 + rng.random(15) : 10 + rng.random(10);
    sim.schedule(every, "htxTick", { every });
}

export const breathingTimers = {
    ptxTick(sim, { every }) {
        const { p, rng } = sim;
        if (!p.alive || !p.chestInjury || (p.ptx < 1 && p.chestSeal) || p.tensionPtx || p.thoracostomy > 0) { p.ptxLoop = false; return; }
        sim.schedule(every, "ptxTick", { every });
        const bs = breathingState(p);
        if (!(airwayState(p) > 0 && bs > 0)) return;
        if (rng.random(100) < (40 + bs * 15) * sim.setting("ACM_breathing_pneumothoraxDeteriorateChance")) {
            const level = p.ptx + 1;
            pain(p, level / 4);
            if (level > 4) {
                p.ptx = 4;
                p.tensionPtx = true;
                p.tensionTime = p.t;
                if (sim.setting("ACM_breathing_Hardcore_ChestInjury")) p.hardcorePtx = true;
                updateLungState(sim);
                sim.emit("tensionPneumothorax", {});
            } else p.ptx = level;
        }
    },
    htxTick(sim, { every }) {
        const { p, rng } = sim;
        const hardcore = sim.setting("ACM_breathing_Hardcore_HemothoraxBleeding");
        if (hardcore && p.htxState <= 2) { sim.schedule(every, "htxTick", { every }); return; }
        const txa = Math.min(2, sim.medCount("TXA_IV"));
        if (!p.alive || p.htxState === 0) { p.htxLoop = false; return; }
        sim.schedule(every, "htxTick", { every });
        if (p.hr < 20 || (p.platelets < 1 && txa < 0.1) || p.blood + p.plasma * 0.3 - p.overload < 3.6) return;
        if (rng.random(1) < Math.max((0.25 * p.platelets) / 4, 0.5 * Math.min(txa, 1.2))) {
            let clear = 1;
            if (txa >= 1) clear = rng.random(1) < 0.25 * txa ? 3 : 2;
            p.htxState = Math.max(hardcore ? 2 : 0, p.htxState - clear);
        }
    },
};

/** updateLungState: stethoscope lung sounds [left, right], 0 normal, 1 shallow, 2 dull. */
export function updateLungState(sim) {
    const { p, rng } = sim;
    let idx = p.lungState.findIndex((x) => x > 0);
    if (idx === -1) idx = Math.round(rng.random(1));
    const state = p.tensionPtx || p.htxFluid > 1.1 ? 2 : p.ptx > 0 || p.htxFluid > 0.3 ? 1 : 0;
    if (state === 0) { p.lungState = [0, 0]; return; }
    p.lungState[idx] = state;
}

export function applyChestSeal(sim) {
    const { p } = sim;
    if (p.ptx > 0) p.ptx = 0;
    p.chestSeal = true;
    updateLungState(sim);
    return { ok: true };
}

export function performNCD(sim) {
    const { p } = sim;
    pain(p, 0.5);
    if (p.tensionPtx) {
        p.tensionPtx = false;
        p.tensionTime = null;
        if (p.ptx > 0) {
            p.ptx = 0;
            if (!p.chestSeal) handlePneumothorax(sim);
        }
    } else if (!p.chestSeal) {
        p.ptx = 3; // decompressing a chest without tension makes it worse
    }
    updateLungState(sim);
    return { ok: true };
}

/** checkBreathingLocal */
export function checkBreathing(sim) {
    const { p } = sim;
    const rr = p.rr;
    const arrest = rr < 1 || p.hr < 20 || !p.alive || p.tensionPtx || p.htxFluid > 1.4;
    const blocked = airwayState(p) === 0;
    const maneuver = p.recoveryPosition || p.headTilt;
    const adjunct = p.airwayOral === "OPA" || p.airwayNasal === "NPA" || maneuver;
    const secure = p.airwayOral === "SGA" || maneuver;
    let hint = "Patient is breathing normally", log = "Normal";
    if (arrest || blocked) { hint = "Patient is not breathing"; log = "None"; }
    else if (p.ptx > 0 || (p.airwayCollapse > 0 && !secure) || (!secure && !p.airwayReflex && !adjunct)) {
        if (rr < 15.9) { hint = "Patient breathing is slow and shallow"; log = "Slow and shallow"; }
        else if (rr > 22) { hint = "Patient breathing is rapid and shallow"; log = "Rapid and shallow"; }
        else { hint = "Patient breathing is shallow"; log = "Shallow"; }
    } else if (rr < 15.9) { hint = "Patient breathing is slow"; log = "Slow"; }
    else if (rr > 22) { hint = "Patient breathing is rapid"; log = "Rapid"; }
    return { hint: [hint], log };
}

/** inspectChestLocal */
export function inspectChest(sim) {
    const { p } = sim;
    const ptx = p.ptx > 0 || p.tensionPtx;
    const htx = p.htxFluid > 0.5;
    const deviation = p.tensionTime !== null && p.tensionTime !== undefined ? p.t - p.tensionTime : 0;
    const arrest = p.rr < 1 || p.hr < 20 || !p.alive || p.tensionPtx || p.htxFluid > 1.4;
    const lines = [], log = [];
    if (arrest || airwayState(p) === 0) {
        lines.push("No chest movement observed"); log.push("No chest movement");
        if (ptx) {
            lines.push("Chest sides are uneven"); log.push("chest sides uneven");
            if (deviation > 300) { lines.push("Severe Tracheal Deviation"); log.push("Severe tracheal deviation"); }
            else if (deviation > 200) { lines.push("Slight Tracheal Deviation"); log.push("Slight tracheal deviation"); }
        }
        if (htx) { lines.push("Noticable extensive bruising"); log.push("Extensive Bruising"); }
    } else if (ptx) {
        lines.push("Uneven chest rise and fall observed"); log.push("Uneven chest rise and fall");
    } else if (htx) {
        lines.push("Uneven chest rise and fall observed", "Noticable extensive bruising");
        log.push("Uneven chest rise and fall", "Extensive Bruising");
    } else {
        lines.push("Chest rise and fall observed"); log.push("Chest rise and fall observed");
    }
    return { hint: lines, log: log.join(", ") };
}

// ------------------------------------------------------------------ thoracostomy (Thoracostomy_*Local)
const ANAESTHETIC = (sim) => sim.medCount("Lidocaine", 1); // local lidocaine in the torso

/** Thoracostomy_startLocal: finger sweep report, opens the chest (PTX 3, tension relieved). */
export function thoracostomy(sim, usedKit) {
    const { p } = sim;
    const lines = ["Finger Thoracostomy Performed"], log = [];
    if (p.htxFluid > 0.8) { lines.push("Large amount of blood in pleural space", "Lung is severely collapsed"); log.push("Lung is collapsed", "large amount of blood"); }
    else if (p.tensionPtx) {
        lines.push("Lung is severely collapsed"); log.push("Lung is collapsed");
        if (p.htxState > 0) { lines.push("Noticable bleeding inside pleural space"); log.push("Bleeding in pleural space"); }
    } else if (p.htxState > 0) { lines.push("Noticable bleeding inside pleural space"); log.push("Bleeding in pleural space"); }
    else if (p.htxFluid > 0) {
        lines.push("Found blood in pleural space"); log.push("Blood in pleural space");
        if (p.rr < 1) { lines.push("Lung is not inflating"); log.push("Lung is not inflating"); }
        else { lines.push("Lung is inflating normally"); log.push("lung inflating normally"); }
    } else if (p.rr < 1 || !p.alive) { lines.push("Lung is not inflating"); log.push("Lung is not inflating"); }
    else { lines.push("Lung is inflating normally"); log.push("Lung is inflating normally"); }
    p.thoracostomy = 1;
    const a = ANAESTHETIC(sim);
    if (a < 0.7) {
        pain(p, 1 - a);
        if (a < 0.5) sim.criticalVitals(); // the sweep knocks an unanaesthetised patient out
    }
    p.ptx = 3;
    p.tensionPtx = false;
    p.tensionTime = null;
    p.thoracostomyUsedKit = usedKit;
    updateLungState(sim);
    return { hint: lines, quick: `Thoracostomy Sweep: ${log.join(", ")}` };
}

/** Thoracostomy_insertChestTubeLocal / resealChestTubeLocal: PTX 0; the tube unseals 60-120 s after the patient is up. */
export function insertChestTube(sim, reseal = false) {
    const { p } = sim;
    p.ptx = 0;
    p.thoracostomy = 2;
    p.chestTubeEpoch = (p.chestTubeEpoch || 0) + 1;
    sim.schedule(1, "chestTubeWatch", { epoch: p.chestTubeEpoch });
    updateLungState(sim);
    return { hint: [reseal ? "Chest Tube re-sealed" : "Chest Tube inserted"] };
}

/** Thoracostomy_drainLocal. type 0 = suction bag (rough amount), 1 = ACCUVAC (exact ml). */
export function drainChest(sim, type) {
    const { p } = sim;
    const f = p.htxFluid;
    let amount;
    if (type === 0) amount = f <= 0 ? "No blood drained" : f < 0.3 ? "Small amount of blood drained" : f < 0.8 ? "Significant amount of blood drained" : "Large amount of blood drained";
    else amount = f <= 0 ? "No blood drained" : `~${Math.ceil(f * 1000)} ml of blood drained`;
    p.htxFluid = 0;
    updateLungState(sim);
    return { hint: ["Fluid draining complete", amount], quick: `Thoracostomy Drain: ${amount}` };
}

/** Thoracostomy_closeLocal */
export function closeIncision(sim) {
    const { p } = sim;
    p.thoracostomy = 0;
    p.ptx = 0;
    p.thoracostomyUsedKit = false;
    updateLungState(sim);
    return { hint: ["Thoracostomy incision sealed and one-way valve placed"] };
}

breathingTimers.chestTubeWatch = (sim, { epoch }) => {
    // waitUntil: patient awake and not lying, or the tube state changed -> 60-120 s later the tube unseals
    const { p, rng } = sim;
    if (epoch !== p.chestTubeEpoch || p.thoracostomy !== 2 || !p.alive) return;
    if (!p.unconscious && !p.lying) sim.schedule(60 + rng.random(60), "chestTubeFail", { epoch });
    else sim.schedule(1, "chestTubeWatch", { epoch });
};
breathingTimers.chestTubeFail = (sim, { epoch }) => {
    const { p } = sim;
    if (epoch !== p.chestTubeEpoch || p.thoracostomy !== 2 || !p.alive) return;
    p.ptx = 3;
    p.thoracostomy = 3;
    updateLungState(sim);
    pain(p, 0.5);
    sim.emit("chestTubeUnsealed", {});
};
