// Airway. Ports ACM_airway: handleAirway (timeline on going unconscious), handleAirwayCollapse,
// handleAirwayObstruction_Vomit/_Blood, resetVariables (on waking), checkAirway, performHeadTurn, handleSuctionLocal,
// getSuctionTime, setRecoveryPosition, insertAirwayItem/removeAirwayItem.
// Not yet: CBRN inflammation, surgical airway, nausea medication effects (taken as 0).
import { lin } from "./util.js";
import { isBodyPartBleeding } from "./wounds.js";
import { nauseaEffect } from "./pharmacology.js";

/** Strings shown in game (ACM stringtable keys STR_ACM_Airway_*). */
export const AIRWAY_TEXT = {
    clear: "Airway is clear", clearShort: "Clear",
    recovery: "In Recovery Position", recoveryShort: "In Recovery",
    headTilt: "Head Tilted-Chin Lifted", headTiltShort: "Head Tilted",
    collapse: ["", "Airway mildly collapsed", "Airway moderately collapsed", "Airway severely collapsed"],
    collapseShort: ["", "Mild collapse", "Moderate collapse", "Severe collapse"],
    obstructionLight: "Airway lightly obstructed", obstructionLightShort: "Light obstruction",
    obstruction: "Airway obstructed", obstructionShort: "Obstruction",
};

const headBleeding = (p) => p.openWounds.head.reduce((a, w) => a + (w.count > 0 ? w.count * w.bleeding : 0), 0);

/** airway/resetVariables (called on waking and at creation). */
export function resetAirway(sim) {
    const { p, rng } = sim;
    p.airwayReflex = true;
    p.airwayCollapse = 0;
    p.obstructionVomit = 0;
    p.vomitGrace = -1;
    p.vomitCount = Math.round(2 + rng.random(2));
    p.obstructionBlood = 0;
    p.recoveryPosition = false;
    p.headTilt = false;
    p.airwayOral = "";
    p.airwayNasal = "";
    p.airwayCheckedTime = null;
    p.airwayEpoch = (p.airwayEpoch || 0) + 1; // invalidates pending timeline timers from an earlier episode
}

/** airway/handleAirway: schedules reflex loss, collapse and vomiting after going unconscious. */
export function onUnconsciousAirway(sim) {
    const { p, rng } = sim;
    if (!sim.setting("ACM_airway_enable") || !p.unconscious) return;
    const epoch = p.airwayEpoch;
    const reflexDelay = 20 + rng.random(25);
    sim.schedule(reflexDelay, "airwayReflexLoss", { epoch });
    sim.schedule(reflexDelay + 240 + rng.random(60), "airwayCollapseStart", { epoch });
    if (sim.setting("ACM_airway_airwayObstructionVomitChance") > 0) {
        const nausea = nauseaEffect(p);
        if ((p.bodyPartDamage[0] > 1 && rng.random(1) < 0.8 + nausea) || rng.random(1) < 0.3 + nausea) {
            sim.schedule(reflexDelay + 60 + rng.random(60), "airwayVomitStart", { epoch });
        }
    }
}

export const airwayTimers = {
    airwayReflexLoss(sim, { epoch }) {
        const { p } = sim;
        if (epoch !== p.airwayEpoch || !p.unconscious) return;
        p.airwayReflex = false;
        if (isBodyPartBleeding(p, "head") && sim.setting("ACM_airway_airwayObstructionBloodChance") > 0) startBlood(sim);
    },
    airwayCollapseStart(sim, { epoch }) {
        if (epoch !== sim.p.airwayEpoch || sim.p.collapseLoop) return;
        sim.p.collapseLoop = true;
        // A CBA per-frame handler keeps one random interval for its whole life
        const every = 30 + sim.rng.random(15);
        sim.schedule(every, "airwayCollapseTick", { epoch, every });
    },
    airwayCollapseTick(sim, { epoch, every }) {
        const { p, rng } = sim;
        if (epoch !== p.airwayEpoch) { p.collapseLoop = false; return; }
        if (!p.unconscious || p.airwayCollapse > 2) { p.airwayCollapse = 3; p.collapseLoop = false; return; }
        p.airwayReflex = false;
        if (rng.random(1) < 0.3 * sim.setting("ACM_airway_airwayCollapseChance")) p.airwayCollapse++;
        sim.schedule(every, "airwayCollapseTick", { epoch, every });
    },
    airwayVomitStart(sim, { epoch }) {
        if (epoch !== sim.p.airwayEpoch || sim.p.vomitLoop) return;
        sim.p.vomitLoop = true;
        const every = 10 + sim.rng.random(10);
        sim.schedule(every, "airwayVomitTick", { epoch, every });
    },
    airwayVomitTick(sim, { epoch, every }) {
        const { p, rng } = sim;
        if (epoch !== p.airwayEpoch || !p.unconscious || p.vomitCount < 1) { p.vomitLoop = false; return; }
        sim.schedule(every, "airwayVomitTick", { epoch, every });
        const grace = p.vomitGrace + 20 > p.t;
        if (p.airwayOral === "SGA" || grace) return;
        if (rng.random(1) < 0.4 * sim.setting("ACM_airway_airwayObstructionVomitChance") + nauseaEffect(p)) {
            p.vomitGrace = p.t;
            p.vomitCount = Math.max(0, p.vomitCount - 1);
            sim.emit("vomit", { obstructs: !p.recoveryPosition });
            if (!p.recoveryPosition) p.obstructionVomit++;
        }
    },
    airwayBloodTick(sim, { every }) {
        const { p, rng } = sim;
        if (!p.unconscious || !isBodyPartBleeding(p, "head")) { p.bloodLoop = false; return; }
        sim.schedule(every, "airwayBloodTick", { every });
        if (p.recoveryPosition || p.airwayOral === "SGA") return;
        const arrest = p.hr < 20;
        const chance = lin(0.05, 0.5, headBleeding(p), 0, 0.5) * sim.setting("ACM_airway_airwayObstructionBloodChance");
        if ((!arrest && rng.random(1) < chance) || (arrest && rng.random(1) < chance / 2)) p.obstructionBlood++;
    },
};

function startBlood(sim) {
    if (sim.p.bloodLoop) return;
    sim.p.bloodLoop = true;
    const every = Math.max(5, sim.rng.random(10));
    sim.schedule(every, "airwayBloodTick", { every });
}

/** airway/checkAirway: returns { hint: [lines], log } and records the check time (shortens suction). */
export function checkAirway(sim) {
    const { p } = sim;
    const lines = [], log = [];
    let collapseManaged = false, secure = false;
    if (p.recoveryPosition) { lines.push(AIRWAY_TEXT.recovery); log.push(AIRWAY_TEXT.recoveryShort); collapseManaged = true; }
    else if (p.headTilt) { lines.push(AIRWAY_TEXT.headTilt); log.push(AIRWAY_TEXT.headTiltShort); collapseManaged = true; }
    const oral = p.airwayOral === "OPA" ? "OPA" : p.airwayOral ? (secure = true, "i-gel") : "";
    const nasal = p.airwayNasal === "NPA" ? "NPA" : "";
    if (oral || nasal) {
        const s = oral && nasal ? `${oral} & ${nasal} inserted` : `${oral || nasal} inserted`;
        lines.push(s); log.push(s);
    }
    if (p.obstructionVomit > 0 || p.obstructionBlood > 0) {
        const heavy = p.obstructionVomit > 1 || p.obstructionBlood > 1;
        lines.push(heavy ? AIRWAY_TEXT.obstruction : AIRWAY_TEXT.obstructionLight);
        log.push(heavy ? AIRWAY_TEXT.obstructionShort : AIRWAY_TEXT.obstructionLightShort);
    }
    collapseManaged = collapseManaged || secure;
    if (!collapseManaged && p.airwayCollapse > 0) {
        lines.push(AIRWAY_TEXT.collapse[p.airwayCollapse]);
        log.push(AIRWAY_TEXT.collapseShort[p.airwayCollapse]);
    }
    if (!lines.length) { lines.push(AIRWAY_TEXT.clear); log.push(AIRWAY_TEXT.clearShort); }
    p.airwayCheckedTime = p.t;
    return { hint: lines, log: log.join(", ") };
}

/** airway/performHeadTurn */
export function headTurn(sim) {
    const { p } = sim;
    if (p.obstructionVomit === 0 && p.obstructionBlood === 0) return { hint: ["Head turning performed", "Airway is clear"] };
    let tooSevere = false;
    if (p.obstructionVomit < 2) { p.obstructionVomit = 0; p.vomitGrace = p.t; } else tooSevere = true;
    if (p.obstructionBlood < 2) p.obstructionBlood = 0; else tooSevere = true;
    return { hint: ["Head turning performed", tooSevere ? "Medical suction required" : "Airway has been cleared"] };
}

/** airway/getSuctionTime (type 1 = ACCUVAC) */
export function suctionTime(p, type = 0) {
    if (p.airwayCheckedTime === null || p.airwayCheckedTime + 45 < p.t) return 12;
    const r = Math.round(Math.min(8, Math.max(3, (p.obstructionVomit + p.obstructionBlood) * 1.25)));
    return type === 1 ? Math.min(6, r) : r;
}

/** airway/handleSuctionLocal */
export function suction(sim) {
    const { p } = sim;
    const was = p.obstructionVomit + p.obstructionBlood;
    p.obstructionVomit = 0;
    p.obstructionBlood = 0;
    p.vomitGrace = p.t;
    p.airwayCheckedTime = null;
    return { hint: ["Suction finished", was > 0 ? "Airway has been cleared" : "Airway is clear"] };
}

/** airway/setRecoveryPosition */
export function setRecoveryPosition(sim, state) {
    const { p } = sim;
    if (state && p.recoveryPosition) return { hint: ["Patient already in recovery position"], ok: false };
    if ((!state && !p.recoveryPosition) || !p.unconscious) return { ok: false };
    p.recoveryPosition = state;
    p.headTilt = state;
    if (p.obstructionVomit === 1) p.obstructionVomit = 0;
    if (p.obstructionBlood === 1) p.obstructionBlood = 0;
    return { hint: [state ? "Established recovery position" : "Cancelled recovery position"], ok: true };
}

/** airway/insertAirwayItem. type: "OPA" | "NPA" | "SGA". Returns ok=false (item returned) on failure. */
export function insertAirwayItem(sim, type) {
    const { p } = sim;
    const name = type === "NPA" ? "NPA" : type === "SGA" ? "i-gel" : "OPA";
    const current = type === "NPA" ? p.airwayNasal : p.airwayOral;
    if (!p.unconscious && p.alive) return { ok: false, hint: [`Failed to insert ${name}`, "Patient is awake"] };
    if (current !== "") return { ok: false, hint: ["Airway item already inserted"] };
    if (p.obstructionVomit + p.obstructionBlood > 0) return { ok: false, hint: [`Failed to insert ${name}`] };
    if (type === "NPA") p.airwayNasal = type; else p.airwayOral = type;
    return { ok: true, hint: [`${name} inserted`] };
}

export function removeAirwayItem(sim, type) {
    const { p } = sim;
    if (type === "NPA") { if (p.airwayNasal !== "NPA") return { ok: false }; p.airwayNasal = ""; }
    else { if (p.airwayOral !== type) return { ok: false }; p.airwayOral = ""; }
    return { ok: true };
}
