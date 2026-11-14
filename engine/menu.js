// Medical menu action catalogue. Names, categories, body parts, items, training levels and times come from
// data/acm-1.4.8.json (ACM/ACE treatment config); conditions follow each action's ACM/ACE condition function.
// In game an action whose condition fails is simply not listed; `available()` returns the reason so practice mode
// can optionally show it.
import { PART_INDEX } from "./util.js";
import { isBodyPartBleeding, bandageTime } from "./wounds.js";
import { checkAirway, headTurn, suctionTime, suction, setRecoveryPosition, insertAirwayItem, removeAirwayItem } from "./airway.js";
import { checkBreathing, inspectChest, applyChestSeal, performNCD } from "./breathing.js";
import { capillaryRefill, checkResponse, checkDogTag } from "./exams.js";
import { addMedication } from "./pharmacology.js";

export const CATEGORIES = [
    { id: "examine", label: "Examine Patient" },
    { id: "bandage", label: "Bandage / Fractures" },
    { id: "medication", label: "Medication" },
    { id: "airway", label: "Airway Management" },
    { id: "advanced", label: "Advanced Treatments" },
];

export const ACE_ITEM_NAMES = {
    ACE_tourniquet: "Tourniquet (CAT)", ACE_fieldDressing: "Bandage (Basic)", ACE_packingBandage: "Bandage (Packing)",
    ACE_elasticBandage: "Bandage (Elastic)", ACE_quikclot: "Basic Field Dressing (QuikClot)", ACE_morphine: "Morphine Autoinjector",
    ACE_epinephrine: "Epinephrine Autoinjector", ACE_adenosine: "Adenosine Autoinjector", ACE_splint: "Splint",
    ACE_surgicalKit: "Surgical Kit", ACE_bodyBag: "Bodybag",
};
export function itemName(data, cls) {
    if (ACE_ITEM_NAMES[cls]) return ACE_ITEM_NAMES[cls];
    const it = data.items.find((i) => i.class === cls.toLowerCase());
    return it?.name || cls;
}

const LEVEL = { anyone: 0, medic: 1, doctor: 2 };
const LEVEL_NAME = ["Anyone", "Medics", "Doctors"];
const LIMBS = ["leftarm", "rightarm", "leftleg", "rightleg"];

/** Resolves a treatment field that may be a number, {setting}, {aceSetting} or {computed}. */
function resolve(sim, v, fallback) {
    if (typeof v === "number") return v;
    if (typeof v === "string") return LEVEL[v] ?? fallback;
    if (v && v.setting) { const s = sim.setting(v.setting); return typeof s === "string" ? LEVEL[s] ?? fallback : s; }
    if (v && v.aceSetting) return sim.aceSetting(v.aceSetting.replace(/^ace_medical_treatment_/, ""), fallback);
    return fallback;
}

const awake = (p) => p.alive && !p.unconscious;
const notAwake = (p) => !awake(p);

/**
 * Action definitions keyed by the ACM/ACE treatment class.
 *   show(ctx, part): condition as in game (false = not listed)
 *   run(ctx, part): effect at the end of the progress bar; returns { hint: [lines], log, quick } (log = activity log)
 *   continuous: the action holds the medic until stopped (Feel Pulse, head tilt, CPR, BVM)
 */
const DEFS = {
    // ------------------------------------------------------------------ examine
    checkpulse: { continuous: "pulse", show: () => true, run: (c, part) => ({ window: { type: "pulse", part }, log: `${c.name} felt for a ${part === "head" ? "carotid" : part.includes("arm") ? "radial" : "femoral"} pulse` }) },
    checkbloodpressure: { show: () => true, run: (c, part) => { const r = capillaryRefill(c.sim, part); return { hint: r.hint, quick: `${c.name} ${r.log}` }; } },
    checkresponse: { show: () => true, run: (c) => { const r = checkResponse(c.sim, c.patientName); return { hint: r.hint, quick: r.log }; } },
    checkdogtags: { show: () => true, run: (c) => { const r = checkDogTag(c.sim, c.patientName); return { hint: r.hint, quick: r.log }; } },
    placepulseoximeter: { show: (c, part) => !c.sim.p.pulseOx[PART_INDEX[part] - 2], run: (c, part) => { c.sim.p.pulseOx[PART_INDEX[part] - 2] = true; return { log: `${c.name} placed Pulse Oximeter` }; } },
    removepulseoximeter: { show: (c, part) => c.sim.p.pulseOx[PART_INDEX[part] - 2], returnsItem: "ACM_PulseOximeter", run: (c, part) => { c.sim.p.pulseOx[PART_INDEX[part] - 2] = false; return { log: `${c.name} removed Pulse Oximeter` }; } },

    // ------------------------------------------------------------------ bandage
    ...Object.fromEntries(["fielddressing", "packingbandage", "elasticbandage", "quikclot", "pressurebandage", "emergencytraumadressing"].map((cls) => [cls, {
        show: (c, part) => isBodyPartBleeding(c.sim.p, part),
        time: (c, part) => bandageTime(c.sim, part, cls, c.level, false),
        run: (c, part) => {
            c.sim.act("bandage", { part, bandage: cls });
            return { log: `${c.name} used ${c.label}` };
        },
    }])),
    applytourniquet: {
        show: (c, part) => !c.sim.p.tourniquets[PART_INDEX[part]],
        run: (c, part) => { c.sim.act("tourniquet", { part }); return { log: `${c.name} applied a tourniquet` }; },
    },
    removetourniquet: {
        show: (c, part) => !!c.sim.p.tourniquets[PART_INDEX[part]], returnsItem: "ACE_tourniquet",
        run: (c, part) => { c.sim.act("removeTourniquet", { part }); return { log: `${c.name} removed a tourniquet` }; },
    },

    // ------------------------------------------------------------------ medication (autoinjectors and simple drugs)
    morphine: { show: () => true, run: (c, part) => med(c, part, "Morphine", 5, "Morphine Autoinjector") },
    epinephrine: { show: () => true, run: (c, part) => med(c, part, "Epinephrine", 0.3, "Epinephrine Autoinjector") },
    paracetamol: { show: (c) => awake(c.sim.p) && !c.sim.p.bvm, run: (c) => med(c, "head", "Paracetamol", 1, "Paracetamol") },
    penthrox: { show: (c) => awake(c.sim.p) && !c.sim.p.bvm, run: (c) => med(c, "head", "Penthrox", 1, "Penthrox Inhaler") },

    // ------------------------------------------------------------------ airway
    checkairway: { show: (c) => airwayOn(c) && notAwake(c.sim.p) && !c.sim.p.bvm, run: (c) => { const r = checkAirway(c.sim); return { hint: r.hint, quick: `${c.name} checked airway: ${r.log}` }; } },
    headturn: { show: (c) => airwayOn(c) && notAwake(c.sim.p) && c.sim.p.airwayOral === "" && !c.sim.p.bvm, run: (c) => ({ ...headTurn(c.sim), log: `${c.name} performed head turning` }) },
    recoveryposition: {
        show: (c) => airwayOn(c) && !c.sim.p.cpr && notAwake(c.sim.p) && c.sim.p.airwayOral === "" && !c.sim.p.recoveryPosition && !c.sim.p.bvm,
        run: (c) => { const r = setRecoveryPosition(c.sim, true); return { hint: r.hint, log: r.ok ? `${c.name} established recovery position` : undefined }; },
    },
    cancelrecoveryposition: { show: (c) => airwayOn(c) && notAwake(c.sim.p) && c.sim.p.recoveryPosition, run: (c) => { const r = setRecoveryPosition(c.sim, false); return { hint: r.hint, log: `${c.name} cancelled recovery position` }; } },
    beginheadtiltchinlift: {
        continuous: "headTilt",
        show: (c) => airwayOn(c) && notAwake(c.sim.p) && !c.sim.p.headTilt && c.sim.p.airwayOral !== "SGA" && !c.sim.p.recoveryPosition,
        run: (c) => { c.sim.p.headTilt = true; return { log: `${c.name} performed head tilt-chin lift` }; },
    },
    usesuctionbag: {
        show: (c) => airwayOn(c) && notAwake(c.sim.p) && !c.sim.p.bvm,
        time: (c) => suctionTime(c.sim.p, 0),
        run: (c) => ({ ...suction(c.sim), log: `${c.name} used Suction Bag` }),
    },
    insertopa: adjunct("OPA", "OPA"), insertnpa: adjunct("NPA", "NPA"), insertigel: adjunct("SGA", "i-gel"),
    removeopa: removeAdj("OPA"), removenpa: removeAdj("NPA"), removeigel: removeAdj("SGA"),
    checkbreathing: { show: (c) => !c.sim.p.bvm, run: (c) => { const r = checkBreathing(c.sim); return { hint: r.hint, quick: `${c.name} checked breathing: ${r.log}` }; } },
    inspectchest: { show: (c) => breathingOn(c) && notAwake(c.sim.p) && !c.sim.p.cpr, run: (c) => { const r = inspectChest(c.sim); return { hint: r.hint, quick: `${c.name} inspected chest: ${r.log}` }; } },
    applychestseal: {
        show: (c) => breathingOn(c) && !c.sim.p.cpr && !c.sim.p.chestSeal && c.sim.p.chestInjury,
        run: (c) => { applyChestSeal(c.sim); return { log: `${c.name} applied Chest Seal` }; },
    },
    performncd: {
        show: (c) => breathingOn(c) && !c.sim.p.cpr && !c.sim.p.bvm && c.sim.p.chestInjury,
        run: (c) => { performNCD(c.sim); return { log: `${c.name} performed needle-chest-decompression` }; },
    },
    usebvm: {
        continuous: "bvm",
        show: (c) => (notAwake(c.sim.p) || c.sim.p.lying) && !c.sim.p.bvm,
        run: (c) => { c.sim.act("bvmStart", {}); return { log: `${c.name} started using BVM` }; },
    },

    // ------------------------------------------------------------------ advanced
    cpr: {
        continuous: "cpr",
        // ace canCPR: patient unconscious/in arrest and not already receiving CPR; ACM: no BVM in progress unless i-gel
        show: (c) => notAwake(c.sim.p) && c.sim.p.alive && !c.sim.p.cpr && (c.sim.p.airwayOral === "SGA" || !c.sim.p.bvm),
        run: (c) => { c.sim.act("cprStart", { skill: c.level }); return { log: `${c.name} started CPR` }; },
    },
};

function med(c, part, name, dose, label) {
    const r = addMedication(c.sim, part, name, dose, false);
    return { log: `${c.name} used ${label}`, hint: r?.occluded ? ["No effect until tourniquet removed"] : undefined };
}
function adjunct(type, name) {
    return {
        show: (c) => airwayOn(c) && notAwake(c.sim.p) && (type === "NPA" ? c.sim.p.airwayNasal === "" : c.sim.p.airwayOral === "") && !c.sim.p.bvm,
        run: (c) => {
            const r = insertAirwayItem(c.sim, type);
            return { hint: r.hint, log: r.ok ? `${c.name} inserted ${name}` : undefined, refund: !r.ok };
        },
    };
}
function removeAdj(type) {
    return {
        show: (c) => airwayOn(c) && (type === "NPA" ? c.sim.p.airwayNasal === "NPA" : c.sim.p.airwayOral === type) && !c.sim.p.bvm,
        // ACM adjunct reusable setting defaults to off: a removed adjunct is discarded
        run: (c) => { removeAirwayItem(c.sim, type); return { log: `${c.name} removed ${type === "SGA" ? "i-gel" : type}` }; },
    };
}
const airwayOn = (c) => c.sim.setting("ACM_airway_enable");
const breathingOn = (c) => c.sim.setting("ACM_breathing_pneumothoraxEnabled");

/** Builds the catalogue: every supported treatment with its config data. */
export function buildCatalogue(data) {
    const out = [];
    for (const [cls, def] of Object.entries(DEFS)) {
        const t = data.treatments.find((x) => x.class === cls);
        if (!t) throw new Error("No treatment config for " + cls);
        out.push({
            id: cls, label: t.name, category: t.category,
            parts: t.bodyParts.includes("all") ? ["head", "body", ...LIMBS] : t.bodyParts,
            items: t.items || [], consumes: !!t.consumesItem && (t.items || []).length > 0,
            levelSpec: t.trainingLevel, timeSpec: t.time, ...def,
        });
    }
    return out;
}

/**
 * Whether an action can be used now on a part. Returns null when available, otherwise the reason.
 * ctx: { sim, level (0 anyone, 1 medic, 2 doctor), inventory {class: count}, name, patientName, busy }
 */
export function available(ctx, a, part) {
    if (!a.parts.includes(part)) return "Not on this body part";
    if (!ctx.sim.p.alive && a.id !== "checkresponse" && a.id !== "checkpulse" && a.id !== "checkdogtags") return "Patient is dead";
    const need = resolve(ctx.sim, a.levelSpec, 0);
    if (ctx.level < need) return `Requires: ${LEVEL_NAME[need]}`;
    if (a.items.length && !a.items.some((i) => (ctx.inventory[i] || 0) > 0)) return `Requires: ${a.items.map((i) => itemName(ctx.sim.data, i)).join(" or ")}`;
    if (ctx.busy && ctx.busy !== a.continuous) return "Busy with a continuous action";
    if (!a.show(ctx, part)) return "Condition not met";
    return null;
}

/** Treatment time in seconds. */
export function actionTime(ctx, a, part) {
    if (a.time) return a.time(ctx, part);
    const v = a.timeSpec;
    if (typeof v === "number") return v;
    if (v && v.setting) return ctx.sim.setting(v.setting);
    if (v && v.aceSetting) return ctx.sim.aceSetting(v.aceSetting.replace(/^ace_medical_treatment_/, ""), { treatmentTimeTourniquet: 7, treatmentTimeAutoinjector: 5 }[v.aceSetting.replace(/^ace_medical_treatment_/, "")] ?? 5);
    return 1;
}

/** Item used by an action: the first one in the inventory, in config order (ACE picks the first available). */
export function pickItem(ctx, a) {
    return a.items.find((i) => (ctx.inventory[i] || 0) > 0) || null;
}
