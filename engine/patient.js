// Patient state. Field names follow ACM/ACE variables where practical (comments give the original).
import { BODY_PARTS } from "./util.js";

/**
 * Creates a healthy patient.
 * @param {object} data   acm-1.4.8.json
 * @param {object} rng    from makeRng
 * @param {object} opts   { weight, bloodType, player: true, targets: {hr, maxHr, spo2, rr} }
 */
export function createPatient(data, rng, opts = {}) {
    const T = data.thresholds;
    // core/generateTargetVitals: AI/singleplayer get random values; players get values from their Steam ID.
    const targets = {
        hr: opts.targets?.hr ?? rng.tri(75, 78, 82),
        maxHr: opts.targets?.maxHr ?? rng.tri(195, 200, 202),
        spo2: opts.targets?.spo2 ?? rng.tri(98, 98.9, 99),
        rr: opts.targets?.rr ?? rng.tri(16, 18, 20),
    };
    const parts = () => Object.fromEntries(BODY_PARTS.map((p) => [p, []]));
    return {
        t: 0,
        alive: true,
        causeOfDeath: null,
        weight: opts.weight ?? rng.tri(75, T.bodyWeight.ideal, 105),
        bloodType: opts.bloodType ?? "O+",
        targets,
        // ACM_circulation_Blood_Volume / Plasma_Volume / Saline_Volume / Overload_Volume / Platelet_Count
        blood: T.bloodVolume.default, plasma: 0, saline: 0, overload: 0, platelets: T.platelets.default,
        transfused: 0, calcium: 0, reactionVolume: 0, reactionSeverity: 0,
        bloodVolume: T.bloodVolume.default, // ace_medical_bloodVolume (sum, capped at 6)
        hemorrhage: 0,
        hr: targets.hr, bp: [80, 120], rr: targets.rr, spo2: targets.spo2,
        resistance: 100, vasoconstriction: 0, oxygenDemand: 0,
        pain: 0, painSuppress: 0,
        woundBleeding: 0, internalBleeding: 0,
        // Wounds per body part: {type, size (0-2), count, bleeding, damage}
        openWounds: parts(), bandagedWounds: parts(), clottedWounds: parts(), wrappedWounds: parts(), stitchedWounds: parts(),
        internalWounds: parts(),
        bodyPartDamage: [0, 0, 0, 0, 0, 0],
        tourniquets: [0, 0, 0, 0, 0, 0], tourniquetTime: [-1, -1, -1, -1, -1, -1],
        // States (ACE/ACM: IS_UNCONSCIOUS, KnockOut_State, IN_CRDC_ARRST, Cardiac_RhythmState, CardiacArrest_TargetRhythm)
        unconscious: false, knockOut: false, cardiacArrest: false, rhythm: "Sinus", targetRhythm: "Sinus",
        // CriticalVitals_State/_Time/_Passed, CirculationState
        criticalUntil: -1, criticalActive: false, criticalPassed: false, circulationOk: true,
        // ROSC_Time, AED_LastShock, CardiacArrest_Time, ReversibleCardiacArrest_State/_Time, ..._HypoxiaTime
        roscTime: -45, lastShock: -120, shockTotal: 0, shockResistant: false, resistChecked: false,
        arrestTime: -1, arrestLoop: false, reversibleActive: false, reversibleTime: -1, hypoxiaNextCheck: 0,
        hardcorePostArrest: false, lastWakeUpCheck: null,
        // CPR (CPR_provider, CPR_StoppedTotal, CPR_StoppedTime); cprSkill 0 anyone, 1 medic, 2 doctor
        cpr: false, cprSession: 0, cprSkill: 0, cprStartTime: 0, cprStoppedTotal: 0, cprStoppedTime: 0, lastCprChance: 0,
        // Airway (ACM_airway): reflex, collapse 0-3, obstruction levels, positioning and adjuncts
        airwayReflex: true, airwayCollapse: 0, obstructionVomit: 0, obstructionBlood: 0,
        recoveryPosition: false, headTilt: false, airwayOral: "", airwayNasal: "",
        surgicalAirway: false, surgicalAirwayUnsecure: false, incisionBleedRate: 0, incisionStitched: false,
        // Breathing (ACM_breathing): pneumothorax 0-4, tension, hemothorax level 0-10 and chest fluid (L)
        ptx: 0, tensionPtx: false, hardcorePtx: false, htxState: 0, htxFluid: 0,
        bvm: false, bvmOxygen: false, lastBreath: -35, lastBreathOxygen: -35,
        // Medications: [{name, route, added, onset, plateau, total, conc, hr, pain, flow, rr, co2, breathing, type, part, dose}]
        meds: [], occludedMeds: [],
        // Vascular access per body part: IV has 3 sites (upper/middle/lower), IO one per part.
        ivAccess: BODY_PARTS.map(() => [null, null, null]), ioAccess: BODY_PARTS.map(() => null),
        ivFlow: BODY_PARTS.map(() => [true, true, true]), ioFlow: BODY_PARTS.map(() => true),
        ivComplicationFlow: BODY_PARTS.map(() => [0, 0, 0]), ivComplicationPain: BODY_PARTS.map(() => [0, 0, 0]),
        ivBags: [], // [{type, remaining, original, part, site, iv, bloodType, donorAlive, collectedAt}]
        freshBloodEffect: 0,
        // Scheduled future events (re-opening wounds etc.): [{at, kind, args}]
        timers: [],
        coagulationNext: -1, coagulationLastClot: -1, ibCoagulationNext: -1,
        log: [],
    };
}

export function painPerceived(p) {
    // GET_PAIN_PERCEIVED
    return Math.max(0, Math.min(1, p.pain - p.painSuppress));
}

export function addPain(p, level, data) {
    // ace_medical_status_fnc_adjustPainLevel: pain = max(pain, desired), coefficient 1
    p.pain = Math.max(0, Math.min(1, Math.max(p.pain, level)));
}

export function cardiacOutput(p) {
    // ace_medical_status_fnc_getCardiacOutput
    const ratio = p.bloodVolume / 6;
    const entering = Math.max(0, Math.min(1, (ratio - 0.5) / 0.5));
    return Math.max(0, entering * 0.095 * p.hr / 60);
}

export function effectiveBloodVolume(p) {
    // GET_EFF_BLOOD_VOLUME
    return Math.max(0, Math.min(6, p.blood + p.plasma * 0.3 - p.overload));
}

export function map(bp) {
    return bp[0] + (bp[1] - bp[0]) / 3;
}
