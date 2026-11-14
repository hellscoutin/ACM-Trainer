// CBRN (chemical agents). Ports ACM_cbrn as it acts on a casualty: initHazardUnit (per-agent buildup loop, PPE),
// effectCS / effectChlorine / effectSarin / effectLewisite, updateExposureEffects, the atropine and dimercaprol
// loops (ACM_circulation handleMed_*Local), canWashEyes / washEyes and putting a gas mask on a casualty.
// World parts are not simulated: hazard zones are a scenario timeline (in the cloud until a time or until dragged out),
// vehicles, detectors, camera shake, coughing sounds and AI skill effects are left out.
//
// Scenario: cbrn: { agent: "Sarin" | "Chlorine" | "Lewisite" | "CS", until: seconds in the cloud (-1 = until dragged out),
//                   ppe: { mask, filter (s), suit, goggles, respirator: "mask" | "makeshift" }, dragTime: s, buildup: {agent: n} }
import { lin, BODY_PARTS } from "./util.js";
import { addPain } from "./patient.js";
import { addWound } from "./wounds.js";

export const AGENTS = ["CS", "Chlorine", "Sarin", "Lewisite"];
export const AGENT_NAMES = { CS: "CS Gas", Chlorine: "Chlorine Gas", Sarin: "Sarin Gas", Lewisite: "Lewisite" };
const DEATH = { Chlorine: "Chlorine Gas Poisoning", Sarin: "Sarin Overexposure", Lewisite: "Lewisite Poisoning" };

export const cbrnOn = (p) => !!p.cbrn;

export function initCBRN(sim, cfg) {
    const z = () => Object.fromEntries(AGENTS.map((a) => [a, 0]));
    const f = () => Object.fromEntries(AGENTS.map((a) => [a, false]));
    sim.p.cbrn = {
        agent: cfg.agent, zoneUntil: cfg.until ?? -1, inCloud: true, dragTime: cfg.dragTime ?? 20,
        buildup: { ...z(), ...(cfg.buildup || {}) }, band: Object.fromEntries(AGENTS.map((a) => [a, -1])),
        exposed: f(), exposedExt: f(), contaminated: f(), wasExposed: f(), active: f(),
        ppe: { mask: false, filter: 600, suit: false, goggles: false, respirator: "", ...(cfg.ppe || {}) },
        exposedAny: false, exposedExtAny: false, contaminatedAny: false, breathingAbility: 1, breathingIncrease: 1,
        inflammation: cfg.inflammation || 0, lungDamage: 0, capillary: 0, spasm: false, skin: [0, 0, 0, 0, 0, 0],
        blind: false, permBlind: { Chlorine: false, Lewisite: false }, eyesWashed: false,
    };
    for (const a of AGENTS) if (sim.p.cbrn.buildup[a] > 0) sim.p.cbrn.wasExposed[a] = true;
}

const inArea = (c, agent) => c.inCloud && agent === c.agent;

/** Called once per second (the CBA per-frame handlers run at a 1 s interval). */
export function cbrnTick(sim) {
    const p = sim.p, c = p.cbrn;
    if (!c || !p.alive) return;
    if (c.inCloud && c.zoneUntil >= 0 && p.t >= c.zoneUntil) c.inCloud = false; // the cloud has passed
    for (const agent of AGENTS) {
        if (!c.active[agent] && !(inArea(c, agent) || c.buildup[agent] > 0)) continue;
        c.active[agent] = true;
        agentTick(sim, agent);
    }
    updateExposureEffects(sim);
}

function agentTick(sim, agent) {
    const p = sim.p, c = p.cbrn, cfg = sim.data.cbrn.agents[agent];
    const area = inArea(c, agent);
    c.contaminated[agent] = area;
    if (!area && c.buildup[agent] <= 0) {
        c.active[agent] = false; c.exposed[agent] = false; c.exposedExt[agent] = false;
        return;
    }
    let inhale = cfg.inhale;
    const canInhale = inhale > 0, canAbsorb = cfg.skin > 0;
    let filtered = !canInhale, protectedEyes = false, protectedBody = !canAbsorb;
    let exposed = false, exposedExt = false;
    if (area) {
        const ppe = c.ppe;
        let blocked = false;
        if (ppe.suit) protectedBody = true;
        if (ppe.mask) {
            protectedEyes = true;
            filtered = ppe.filter > 0;
            blocked = protectedBody && filtered;
            if (filtered) ppe.filter = Math.max(0, ppe.filter - 1); // depletes once per agent loop
        }
        if (!blocked) {
            exposed = !filtered;
            exposedExt = true;
            if (ppe.goggles) protectedEyes = true;
            else if (!filtered) {
                if (ppe.respirator === "mask") inhale *= 0.5;
                else if (ppe.respirator === "makeshift") inhale *= 0.9;
            }
        }
    }
    // threshold bands (above the last threshold the code finds no band and keeps the modifiers at 1)
    let inc = 1, dec = 1;
    const idx = cfg.thresholds.findIndex((x) => x > c.buildup[agent]);
    if (idx > -1) { const b = Math.max(0, idx - 1); inc = cfg.pos[b]; dec = cfg.neg[b]; c.band[agent] = cfg.thresholds[b]; }
    let b = c.buildup[agent];
    if (exposed && !filtered) b = Math.min(100, b + inhale * inc);
    else if (exposedExt && !protectedBody) b = Math.min(100, b + cfg.skin * inc);
    else b = Math.max(0, b + cfg.elim * dec);
    c.buildup[agent] = b;
    if (b > 0) EFFECTS[agent](sim, b, exposed, exposedExt, { filtered, protectedBody, protectedEyes });
    c.exposed[agent] = exposed;
    c.exposedExt[agent] = exposedExt;
    if (exposed || exposedExt) c.wasExposed[agent] = true;
}

const pain = (p) => p.pain; // GET_PAIN (raw pain, not suppressed)
function critical(sim) { if (!sim.p.unconscious) sim.criticalVitals(); }
function setBlind(c, on) { c.blind = on; }

const EFFECTS = {
    CS(sim, b, exposed, ext, { filtered, protectedEyes }) {
        const p = sim.p;
        if (!exposed || b < 0.1) return;
        if (!filtered && pain(p) < 0.9) addPain(p, 1);
        if (b < 50) return;
        if (!protectedEyes) setBlind(p.cbrn, true); // CS/chlorine/lewisite "cause blindness" settings default on
    },
    Chlorine(sim, b, exposed, ext, { filtered, protectedBody, protectedEyes }) {
        const p = sim.p, c = p.cbrn;
        if (b < 0.1) return;
        if (exposed && pain(p) < 0.4) addPain(p, 0.5);
        else if (ext && pain(p) < 0.05) addPain(p, 0.1);
        if (exposed || ext) {
            if (!filtered) c.inflammation += 1;
            const target = Math.round(lin(25, 95, b, 20, 100));
            c.skin = c.skin.map((x, i) => {
                if (x >= target) return x;
                if (i === 0 && filtered && protectedEyes) return x;
                if (i > 0 && protectedBody) return x;
                return Math.min(x + 1, target);
            });
        }
        if (b < 15) return;
        if (exposed && pain(p) < 0.9) addPain(p, 1);
        if (b < 40) return;
        if (exposed) {
            if (!filtered) c.lungDamage += 1;
            if (!protectedEyes) setBlind(c, true);
        }
        if (b < 50) return;
        if (exposed && !protectedEyes && c.blind) c.permBlind.Chlorine = true;
        if (b < 70) return;
        critical(sim);
        if (b >= 100) sim.die(DEATH.Chlorine);
    },
    Sarin(sim, b, exposed) {
        const p = sim.p, c = p.cbrn;
        if (b < 0.1) return;
        if (exposed && pain(p) < 0.3) addPain(p, 0.2);
        // 10+: tremors and seizures are a camera effect on the player (midazolam stops them); nothing on the casualty model
        if (b < 60) return;
        if (atropine(sim) < 4 && !c.spasm) c.spasm = true;
        critical(sim);
        if (b >= 100) sim.die(DEATH.Sarin);
    },
    Lewisite(sim, b, exposed, ext, { filtered, protectedBody, protectedEyes }) {
        const p = sim.p, c = p.cbrn;
        if (b < 0.1) return;
        if (exposed && pain(p) < 0.4) addPain(p, 0.5);
        else if (ext && pain(p) < 0.1) addPain(p, 0.2);
        if (b < 5) return;
        if (exposed || ext) {
            const part = protectedBody ? "head" : weightedPart(sim.rng);
            const sev = lin(10, 60, b, 0.01, 1);
            addWound(sim, part, "ChemicalBurn", sev, 1); // woundReceived "lewisiteburn": one chemical burn
        }
        if (b < 30) return;
        if (exposed) {
            if (!filtered) c.inflammation += 1;
            if (!protectedEyes) setBlind(c, true);
        }
        if (b < 50) return;
        if (exposed && !protectedEyes && c.blind) c.permBlind.Lewisite = true;
        c.capillary = Math.min(c.capillary + 1, lin(70, 90, b, 0, 100)); // runs from 50, but the target is 0 until 70
        if (b < 70) return;
        critical(sim);
        if (b >= 100) sim.die(DEATH.Lewisite);
    },
};

function weightedPart(rng) {
    const w = [0.7, 0.5, 0.75, 0.75, 0.3, 0.3];
    let r = rng.random(w.reduce((a, x) => a + x, 0));
    for (let i = 0; i < 6; i++) { if (r < w[i]) return BODY_PARTS[i]; r -= w[i]; }
    return BODY_PARTS[5];
}

/** updateExposureEffects: overall exposure flags and the breathing penalties. */
function updateExposureEffects(sim) {
    const c = sim.p.cbrn;
    c.exposedAny = AGENTS.some((a) => c.contaminated[a] && c.exposed[a]);
    c.exposedExtAny = AGENTS.some((a) => c.contaminated[a] && c.exposedExt[a]);
    c.contaminatedAny = AGENTS.some((a) => c.contaminated[a]);
    const b = c.buildup;
    c.breathingIncrease = b.CS > 50 || b.Chlorine > 0.5 || b.Sarin > 0.5 || b.Lewisite > 0.5 ? 0.25 : 1;
    c.breathingAbility = b.CS >= 100 || b.Chlorine > 15 || b.Sarin > 30 || b.Lewisite > 20 ? 0.5 : 1;
}

// ------------------------------------------------------------------ effects read by the other modules
export const atropine = (sim) => sim.medCount("Atropine") + sim.medCount("Atropine_IV");
/** HAS_AIRWAY_SPASM_UNMITIGATED: breathing stops unless 3+ atropine is active (a surgical airway is checked by the caller). */
export const spasmUnmitigated = (sim) => !!sim.p.cbrn?.spasm && atropine(sim) < 3;
export const inflammation = (p) => p.cbrn?.inflammation || 0;
export const lungDamage = (p) => p.cbrn?.lungDamage || 0;
export const capillaryDamage = (p) => p.cbrn?.capillary || 0;
/** Heart rate target adjustment from sarin and lewisite (handleUnitVitals). */
export function cbrnHeartRateAdjust(p) {
    if (!p.cbrn) return 0;
    return -lin(15, 100, p.cbrn.buildup.Sarin, 0, 35) - lin(15, 100, p.cbrn.buildup.Lewisite, 0, 35);
}

// ------------------------------------------------------------------ antidote loops (ACM_circulation handleMed_*Local)
export function startAtropineLoop(sim) {
    const p = sim.p;
    if (p.atropineLoop) return;
    p.atropineLoop = true;
    const interval = 20 + sim.rng.random(10); // the PFH interval is fixed when the loop starts
    sim.schedule(interval, "atropineTick", { interval });
}
export function startDimercaprolLoop(sim) {
    const p = sim.p;
    if (p.dimercaprolLoop) return;
    p.dimercaprolLoop = true;
    const interval = 20 + sim.rng.random(10);
    sim.schedule(interval, "dimercaprolTick", { interval });
}
export const cbrnTimers = {
    atropineTick(sim, args) {
        const p = sim.p;
        const { interval } = args;
        const dose = atropine(sim);
        if (!p.alive || dose < 1) { p.atropineLoop = false; return; }
        sim.schedule(interval, "atropineTick", { interval });
        if (dose < 3 || !p.cbrn) return;
        let reduce = 2 * (dose / 3);
        if (p.cardiacArrest) reduce /= 2;
        const before = p.cbrn.buildup.Sarin;
        p.cbrn.buildup.Sarin = Math.max(0, before - reduce);
        if (dose < 4) return;
        if (p.cbrn.spasm && (sim.rng.random(1) < 0.3 || before <= 1)) p.cbrn.spasm = false;
    },
    dimercaprolTick(sim, args) {
        const p = sim.p;
        const { interval } = args;
        const dose = sim.medCount("Dimercaprol");
        if (!p.alive || dose < 0.1) { p.dimercaprolLoop = false; return; }
        sim.schedule(interval, "dimercaprolTick", { interval });
        if (dose < 0.5 || !p.cbrn) return;
        let reduce = 8 * Math.min(dose, 2);
        if (p.cardiacArrest) reduce /= 2;
        p.cbrn.buildup.Lewisite = Math.max(0, p.cbrn.buildup.Lewisite - reduce);
    },
};

// ------------------------------------------------------------------ treatments
/** canWashEyes */
export function canWashEyes(p) {
    const c = p.cbrn;
    if (!c) return false;
    if (c.wasExposed.CS) return true;
    if (c.wasExposed.Chlorine && !c.permBlind.Chlorine) return true;
    if (c.wasExposed.Lewisite && !c.permBlind.Lewisite) return true;
    return false;
}
/** washEyes: cures blindness unless chlorine or lewisite made it permanent. */
export function washEyes(sim) {
    const c = sim.p.cbrn;
    c.eyesWashed = true;
    if (c.permBlind.Chlorine || c.permBlind.Lewisite) return { hint: ["Washed eyes"], cured: false };
    setBlind(c, false);
    return { hint: ["Washed eyes"], cured: true };
}
/** ACE interaction "Put on gas mask" on an unconscious casualty (immediate). */
export function putOnGasMask(sim) {
    const c = sim.p.cbrn;
    c.ppe.mask = true;
    c.ppe.respirator = "";
    return { hint: ["Gas mask put on"] };
}
/** Replace Filter (3 s): a fresh 600 s filter. */
export function replaceFilter(sim) { sim.p.cbrn.ppe.filter = 600; return { hint: ["Filter replaced"] }; }
/** Trainer abstraction of dragging or carrying the casualty out of the cloud (ACE drag/carry). */
export function dragOutOfCloud(sim) { sim.p.cbrn.inCloud = false; return { hint: ["Casualty moved out of the contaminated area"] }; }

/** Injury list: skin irritation per part (updateInjuryList). */
export function skinIrritationEntry(p, i) {
    const s = p.cbrn?.skin[i] || 0;
    if (s <= 5) return null;
    const m = lin(5, 85, s, 1, 0.7);
    const sev = s < 25 ? "Slight" : s < 65 ? "Moderate" : "Severe";
    const rgb = (r, g, b) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    return { text: `${sev} Skin Irritation`, color: rgb(0.8 * m, 0.7 * m, 0.1 * m) };
}
