// Medical menu action catalogue. Names, categories, body parts, items, training levels and times come from
// data/acm-1.4.8.json (ACM/ACE treatment config); conditions follow each action's ACM/ACE condition function.
// In game an action whose condition fails is simply not listed; `available()` returns the reason so practice mode
// can optionally show it.
import { PART_INDEX } from "./util.js";
import { isBodyPartBleeding, bandageTime } from "./wounds.js";
const SITES = ["upper", "middle", "lower"];
import { checkAirway, headTurn, suctionTime, suction, setRecoveryPosition, insertAirwayItem, removeAirwayItem } from "./airway.js";
import { checkBreathing, inspectChest, applyChestSeal, performNCD } from "./breathing.js";
import { capillaryRefill, checkResponse, checkDogTag } from "./exams.js";
import { addMedication } from "./pharmacology.js";
import { insertIV, removeIV, insertIO, removeIO, inspectIV, attachCuff, removeCuff, canInsertIV, bagInfo, bagName } from "./circulation.js";
import { thoracostomy, insertChestTube, drainChest, closeIncision } from "./breathing.js";
import { wrap, stitch } from "./wounds.js";
import { SYRINGE_SIZES, SYRINGE_DRUGS, vialItem, drugName, injectSyringe } from "./syringes.js";
import { canEstablish, canSecure, canStitchIncision, secureStrap, stitchIncision, stitchIncisionTime, startProcedure } from "./surgicalAirway.js";
import { aedState, hasAED, connect, disconnect, analyze, manualCharge, shock, cancelCharge, measureBP, canAnalyze, canManualCharge, canShock, canCancelCharge, canMeasureBP } from "./aed.js";

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
    if (bagInfo(cls)) return bagName(cls);
    const syr = /^ACM_Syringe_(\d+)$/.exec(cls);
    if (syr) return `Syringe (${syr[1]}ml)`;
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

    // ------------------------------------------------------------------ step 3: circulation, chest procedures, stitching
    ...Object.fromEntries(SITES.map((site, k) => [`inspectiv_${site}`, {
        show: (c, part) => !!c.sim.p.ivAccess[PART_INDEX[part]][k],
        run: (c, part) => { const r = inspectIV(c.sim, part, k); return { hint: r.hint, quick: `${c.name} ${r.quick}` }; },
    }])),
    pressurecuff_attach: {
        show: (c, part) => !c.sim.p.pressureCuff[PART_INDEX[part] - 2] && !c.sim.p.ivAccess[PART_INDEX[part]][0],
        run: (c, part) => outcome(c, attachCuff(c.sim, part)),
    },
    pressurecuff_remove: {
        show: (c, part) => c.sim.p.pressureCuff[PART_INDEX[part] - 2], returnsItem: "ACM_PressureCuff",
        run: (c, part) => outcome(c, removeCuff(c.sim, part)),
    },
    measurebloodpressure: { continuous: "bp", show: (c, part) => c.sim.p.pressureCuff[PART_INDEX[part] - 2], run: (c, part) => ({ window: { type: "bp", part, stethoscope: false } }) },
    measurebloodpressurestethoscope: { continuous: "bp", show: (c, part) => c.sim.p.pressureCuff[PART_INDEX[part] - 2], run: (c, part) => ({ window: { type: "bp", part, stethoscope: true } }) },
    usestethoscope: { continuous: "stethoscope", show: (c) => !c.sim.p.cpr, run: (c) => ({ window: { type: "stethoscope", part: "body" }, log: `${c.name} used Stethoscope` }) },
    ...Object.fromEntries(["16", "14"].flatMap((g) => SITES.map((site, k) => [`insertiv_${g}_${site}`, {
        show: (c, part) => canInsertIV(c.sim.p, part, k),
        run: (c, part) => outcome(c, insertIV(c.sim, part, k, `IV_${g}g`, c.level)),
    }]))),
    ...Object.fromEntries(["16", "14"].flatMap((g) => SITES.map((site, k) => [`removeiv_${g}_${site}`, {
        show: (c, part) => c.sim.p.ivAccess[PART_INDEX[part]][k] === `IV_${g}g`,
        run: (c, part) => outcome(c, removeIV(c.sim, part, k)),
    }]))),
    insertio_fast1: { show: (c, part) => !c.sim.p.ioAccess[PART_INDEX[part]], run: (c, part) => outcome(c, insertIO(c.sim, part, "IO_FAST1")) },
    insertio_ez: { show: (c, part) => !c.sim.p.ioAccess[PART_INDEX[part]], run: (c, part) => outcome(c, insertIO(c.sim, part, "IO_EZ")) },
    removeio_fast1: { show: (c, part) => c.sim.p.ioAccess[PART_INDEX[part]] === "IO_FAST1", run: (c, part) => outcome(c, removeIO(c.sim, part)) },
    removeio_ez: { show: (c, part) => c.sim.p.ioAccess[PART_INDEX[part]] === "IO_EZ", run: (c, part) => outcome(c, removeIO(c.sim, part)) },
    opentransfusionmenu: {
        continuous: "transfusion",
        show: (c, part) => c.sim.p.ivAccess[PART_INDEX[part]].some(Boolean) || !!c.sim.p.ioAccess[PART_INDEX[part]],
        run: (c, part) => ({ window: { type: "transfusion", part } }),
    },
    performthoracostomy: chestProc((p) => p.chestInjury && p.thoracostomy < 1, (c) => thoracostomy(c.sim, false), "performed thoracostomy"),
    performthoracostomy_kit: chestProc((p) => p.chestInjury && p.thoracostomy < 1, (c) => thoracostomy(c.sim, true), "performed thoracostomy (Thoracostomy Kit)"),
    insertchesttube: chestProc((p) => p.thoracostomy === 1, (c) => insertChestTube(c.sim), "inserted Chest Tube"),
    resealchesttube: chestProc((p) => p.thoracostomy === 3, (c) => insertChestTube(c.sim, true), "re-sealed Chest Tube"),
    drainfluid_accuvac: chestProc((p) => p.thoracostomy === 2 || p.thoracostomy === 3, (c) => drainChest(c.sim, 1), "drained pleural space"),
    drainfluid_suctionbag: chestProc((p) => p.thoracostomy === 2 || p.thoracostomy === 3, (c) => drainChest(c.sim, 0), "drained pleural space"),
    closeincision: {
        // needs a surgical kit unless the thoracostomy kit was used
        show: (c) => breathingOn(c) && !c.sim.p.cpr && !c.sim.p.bvm && c.sim.p.thoracostomy > 0 && ((c.inventory.ACE_surgicalKit || 0) > 0 || c.sim.p.thoracostomyUsedKit),
        run: (c) => ({ ...closeIncision(c.sim), log: `${c.name} closed up thoracostomy incision` }),
    },
    useaccuvac: {
        show: (c) => airwayOn(c) && notAwake(c.sim.p) && !c.sim.p.bvm,
        time: (c) => suctionTime(c.sim.p, 1),
        run: (c) => ({ ...suction(c.sim), log: `${c.name} used ACCUVAC` }),
    },
    // ------------------------------------------------------------------ AED (canConnectAED: carrying an AED or already connected)
    aed_applypads: aedDef((c) => !aedState(c.sim.p).pads && canConnect(c), (c) => connect(c.sim, "pads"), "applied AED pads", (c) => (c.sim.p.cpr ? 10 : 5)),
    aed_removepads: aedDef((c) => aedState(c.sim.p).pads, (c) => disconnect(c.sim, "pads"), "removed AED pads"),
    aed_connectpulseoximeter: aedDef((c) => aedState(c.sim.p).po === -1 && canConnect(c), (c, part) => connect(c.sim, "po", part), "connected AED pulse oximeter"),
    aed_disconnectpulseoximeter: aedDef((c, part) => aedState(c.sim.p).po === PART_INDEX[part], (c) => disconnect(c.sim, "po"), "disconnected AED pulse oximeter"),
    aed_connectpressurecuff: aedDef((c, part) => aedState(c.sim.p).cuff === -1 && !c.sim.p.pressureCuff[PART_INDEX[part] - 2] && canConnect(c) && !c.sim.p.ivAccess[PART_INDEX[part]][0], (c, part) => connect(c.sim, "cuff", part), "connected AED pressure cuff"),
    aed_disconnectpressurecuff: aedDef((c, part) => aedState(c.sim.p).cuff === PART_INDEX[part], (c) => disconnect(c.sim, "cuff"), "disconnected AED pressure cuff"),
    aed_connectcapnograph: aedDef((c) => !aedState(c.sim.p).capno && canConnect(c), (c) => connect(c.sim, "capno"), "connected AED capnograph"),
    aed_disconnectcapnograph: aedDef((c) => aedState(c.sim.p).capno, (c) => disconnect(c.sim, "capno"), "disconnected AED capnograph"),
    aed_viewmonitor: { continuous: "aed", show: (c) => hasAED(c.sim.p), run: () => ({ window: { type: "aed" } }) },
    aed_analyzerhythm: aedDef((c) => canAnalyze(c.sim.p), (c) => analyze(c.sim), "analyzed rhythm"),
    aed_manualcharge: aedDef((c) => canManualCharge(c.sim.p), (c) => manualCharge(c.sim), "charged the AED"),
    aed_shock: aedDef((c) => canShock(c.sim.p), (c) => shock(c.sim), "administered a shock"),
    aed_cancelcharge: aedDef((c) => canCancelCharge(c.sim.p), (c) => cancelCharge(c.sim), "cancelled the charge"),
    aed_measurebp: aedDef((c, part) => canMeasureBP(c.sim.p) && (aedState(c.sim.p).cuff === PART_INDEX[part] || part === "body"), (c) => measureBP(c.sim), "measured blood pressure (AED)"),
    // ------------------------------------------------------------------ surgical airway
    establishsurgicalairway: { continuous: "cric", show: (c) => airwayOn(c) && canEstablish(c.sim.p), run: (c) => { startProcedure(c.sim); return { window: { type: "cric" } }; } },
    surgicalairway_securestrap: { show: (c) => canSecure(c.sim.p), run: (c) => ({ hint: [secureStrap(c.sim)], log: `${c.name} secured surgical airway neck strap` }) },
    stitchairwayincision: { show: (c) => canStitchIncision(c.sim.p), time: (c) => stitchIncisionTime(c.sim.p, false), run: (c) => ({ hint: [stitchIncision(c.sim)], log: `${c.name} stitched surgical airway incision` }) },
    elasticwrapbandages: wrapDef(false), elasticwrapclots: wrapDef(true),
    surgicalkit: stitchDef("bandaged", 5), stitchclottedwounds: stitchDef("clotted", 5), stitchwrappedwounds: stitchDef("wrapped", 2),
};

const canConnect = (c) => (c.inventory.ACM_AED || 0) > 0 || hasAED(c.sim.p);
function aedDef(cond, fn, logText, time) {
    return { show: cond, time, run: (c, part) => { fn(c, part); return { log: `${c.name} ${logText}` }; } };
}

function outcome(c, r) {
    const out = { hint: r.hint, refund: r.refund || !r.ok, give: r.returned };
    if (r.ok && r.log) out.log = `${c.name} ${r.log}`;
    return out;
}
function chestProc(cond, fn, logText) {
    return {
        show: (c) => breathingOn(c) && !c.sim.p.cpr && !c.sim.p.bvm && cond(c.sim.p),
        run: (c) => { const r = fn(c); return { hint: r.hint, quick: r.quick, log: `${c.name} ${logText}` }; },
    };
}
const entries = (p, key, part) => p[key][part].filter((w) => w.count > 0).length;
function wrapDef(clotted) {
    const key = clotted ? "clottedWounds" : "bandagedWounds";
    return {
        show: (c, part) => !isBodyPartBleeding(c.sim.p, part) && entries(c.sim.p, key, part) > 0,
        // damage/getWrapTime: min(12, 5 per wound entry), medic -2, min 1
        time: (c, part) => Math.max(1, Math.min(12, 5 * entries(c.sim.p, key, part)) + (c.level >= 1 ? -2 : 0)),
        run: (c, part) => { wrap(c.sim, part, clotted); return { log: `${c.name} wrapped ${clotted ? "clotted" : "bandaged"} wounds` }; },
    };
}
function stitchDef(state, perWound) {
    const key = state + "Wounds";
    return {
        show: (c, part) => !isBodyPartBleeding(c.sim.p, part) && entries(c.sim.p, key, part) > 0,
        // ACE woundStitchTime 5 s per wound entry; ACM wrapped stitch 2 s per entry
        time: (c, part) => perWound * entries(c.sim.p, key, part),
        run: (c, part) => { stitch(c.sim, part, state); return { log: `${c.name} stitched ${state} wounds` }; },
    };
}

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

// Syringe actions: not in the data file's treatment list, defined from ACM's config (ACE_Medical_Treatment_Actions):
// "Use Syringe" per size opens the draw window; push (IV) and inject (IM) per drug and size take 2 s.
const LIMBS_AND_BODY = ["body", "leftarm", "rightarm", "leftleg", "rightleg"];
const SYRINGE_LEVEL = { setting: "ACM_circulation_allowSyringe" };
function syringeDefs() {
    const out = [];
    for (const size of SYRINGE_SIZES) {
        out.push({
            id: `usesyringe_${size}`, label: `Use Syringe (${size}ml)`, category: "medication", parts: LIMBS_AND_BODY,
            items: [`ACM_Syringe_${size}`], consumes: false, levelSpec: SYRINGE_LEVEL, timeSpec: 0.01, continuous: "syringe",
            show: (c) => SYRINGE_DRUGS.some((d) => (c.inventory[vialItem(d)] || 0) > 0),
            run: (c, part) => ({ window: { type: "syringe", part, size } }),
        });
    }
    for (const drug of SYRINGE_DRUGS) for (const size of SYRINGE_SIZES) for (const iv of [true, false]) {
        const find = (c) => (c.syringes || []).find((s) => s.drug === drug && s.size === size);
        out.push({
            id: `${drug.toLowerCase()}_${size}_${iv ? "iv" : "im"}`, label: `${iv ? "Push" : "Inject"} ${drugName(drug)} ${iv ? "IV" : "IM"} (${size}ml syringe)`,
            category: "medication", parts: LIMBS_AND_BODY, items: [], consumes: false, levelSpec: SYRINGE_LEVEL, timeSpec: 2,
            show: (c) => !!find(c),
            run: (c, part) => {
                const s = find(c);
                const r = injectSyringe(c.sim, c, part, s, iv);
                return { hint: r.hint, refund: !r.ok, log: r.ok ? `${c.name} ${r.log}` : undefined };
            },
        });
    }
    return out;
}

// Actions whose config sets ACM_rollToBack (inherited by their variants): done on an unconscious patient they set
// WasTreated, so the patient stays lying after waking (ACM_core XEH_postInit "ace_treatmentSucceded").
const ROLL_TO_BACK = /^(checkairway|checkbreathing|cpr|cancelrecoveryposition|aed_applypads|insertiv_.*|pressurecuff_attach|fracturerealignment|stitchairwayincision|washeyes|fentanyllozenge|naloxone)$/;
export function markTreated(sim, a) {
    if (sim.p.unconscious && !sim.p.wasTreated && ROLL_TO_BACK.test(a.id)) sim.p.wasTreated = true;
}

/** Builds the catalogue: every supported treatment with its config data. */
export function buildCatalogue(data) {
    const out = [...syringeDefs()];
    for (const [cls, def] of Object.entries(DEFS)) {
        const t = data.treatments.find((x) => x.class === cls);
        if (!t) throw new Error("No treatment config for " + cls);
        out.push({
            id: cls, label: t.name, category: t.category,
            parts: t.bodyParts.includes("all") ? ["head", "body", ...LIMBS] : t.bodyParts,
            // consumesItem may be an ACE setting (consumeSurgicalKit, default 0 = nothing consumed)
            items: t.items || [], consumes: t.consumesItem === true && (t.items || []).length > 0,
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
    // The AED monitor is operated while its window is open
    if (ctx.busy && ctx.busy !== a.continuous && !(ctx.busy === "aed" && a.id.startsWith("aed_"))) return "Busy with a continuous action";
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
