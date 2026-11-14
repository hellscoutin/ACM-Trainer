// Simulation: fixed 1-second tick, scheduler, ACE medical state machine, actions, snapshots and the event log.
// Deterministic: the same seed, settings and timed action list always give the same result (replay and scoring).
import { makeRng, PART_INDEX } from "./util.js";
import { createPatient } from "./patient.js";
import { addWound, bandage, wrap, stitch, updateWoundBleeding, coagulationStep, ibCoagulationStep, woundTimers } from "./wounds.js";
import { addMedication, medicationCount, medicationTypeMap, pharmacologyTimers, isOverdosed } from "./pharmacology.js";
import { airwayState } from "./oxygen.js";
import { airwayTimers, resetAirway, onUnconsciousAirway } from "./airway.js";
import { breathingTimers, handleChestInjury } from "./breathing.js";
import { circulationTimers } from "./circulation.js";
import { aedTimers, updateAED } from "./aed.js";
import { disabilityTimers, handleFracture, initDisability } from "./disability.js";
import { cbrnTimers, cbrnTick } from "./cbrn.js";
import { isBloodCompatible } from "./blood.js";
import {
    handleUnitVitals, vitalsTimers, onCardiacArrest, administerShock, wakeUpCheck, hasPulse, bloodPressure,
    updateCirculationState, recentAEDShock, attemptROSC, hasStableVitals,
} from "./vitals.js";

/** ACE 3.21.2 setting defaults used by the engine (initSettings.inc.sqf of each ACE medical component). */
export const ACE_DEFAULTS = {
    ivFlowRate: 1, bleedingCoefficient: 1, woundReopenChance: 1, spontaneousWakeUpChance: 0.1,
    cardiacArrestBleedoutEnabled: true, treatmentTimeTourniquet: 7, treatmentTimeAutoinjector: 5,
    medicMorphine: 0, medicEpinephrine: 0, medicSurgicalKit: 1, consumeSurgicalKit: 0, allowSelfStitch: 0, woundStitchTime: 5,
    fractures: 1, fractureChance: 0.8, medicSplint: 0,
};

export class Simulation {
    /**
     * @param {object} o { data, meds, seed, settings: {ACM var: value}, aceSettings: {name: value}, patient: createPatient opts }
     */
    constructor({ data, meds, seed = 1, settings = {}, aceSettings = {}, patient = {} }) {
        this.data = data;
        this.meds = meds;
        this.seed = seed;
        this.rng = makeRng(seed);
        this.settingsOverride = settings;
        this.aceSettings = aceSettings;
        this.settingDefaults = Object.fromEntries(data.settings.map((s) => [s.variable, s.default]));
        this.medTypeCaps = {
            hr: medicationTypeMap(meds, "maxHRIncrease", "hrIncrease"),
            rr: medicationTypeMap(meds, "maxRRAdjust", "rrAdjust"),
            pain: medicationTypeMap(meds, "maxPainReduce", "painReduce"),
        };
        this.p = createPatient(data, this.rng, patient);
        this.p.bp = bloodPressure(this.p);
        this.timers = [];
        this.timerSeq = 0;
        this.events = [];
        this.actions = [];
        this.listeners = [];
        this.handlers = { ...woundTimers, ...vitalsTimers, ...airwayTimers, ...breathingTimers, ...circulationTimers, ...pharmacologyTimers, ...aedTimers, ...disabilityTimers, ...cbrnTimers, ...simTimers };
        initDisability(this.p);
        resetAirway(this);
    }

    // ---------------------------------------------------------------- services used by the modules
    setting(name) {
        if (name in this.settingsOverride) return this.settingsOverride[name];
        if (name in this.settingDefaults) return this.settingDefaults[name];
        throw new Error("Unknown ACM setting " + name);
    }
    aceSetting(name, fallback) { return name in this.aceSettings ? this.aceSettings[name] : name in ACE_DEFAULTS ? ACE_DEFAULTS[name] : fallback; }
    medCount(name, partIndex = -1) { return medicationCount(this.p, name, partIndex); }
    emit(event, args = {}) {
        const e = { t: this.p.t, event, ...args };
        this.events.push(e);
        for (const fn of this.listeners) fn(e);
    }
    on(fn) { this.listeners.push(fn); }
    schedule(delay, kind, args = {}) {
        this.timers.push({ at: this.p.t + delay, seq: this.timerSeq++, kind, args });
    }
    isOverdosed() { return isOverdosed(this); }
    attemptROSC() { return attemptROSC(this); }
    hasStableVitals() { return hasStableVitals(this); }

    // Coagulation loops: checked every second; attempts at the ACM intervals
    startCoagulation() {
        const p = this.p;
        if (p.coagulationNext !== -1 || p.woundBleeding <= 0) return;
        p.coagulationLastClot = p.t;
        p.coagulationNext = p.t + 9 + this.rng.random(5);
        this.schedule(1, "coagulationTick");
    }
    startIBCoagulation() {
        const p = this.p;
        if (p.ibCoagulationNext !== -1 || p.internalBleeding <= 0) return;
        p.ibCoagulationNext = p.t + 5 + this.rng.random(4);
        this.schedule(1, "ibCoagulationTick");
    }

    // ---------------------------------------------------------------- ACE state machine events
    fatalVitals() {
        const p = this.p;
        if (!p.alive || p.cardiacArrest) return;
        // setCardiacArrestState(true)
        p.cardiacArrest = true;
        p.hrLast = p.hr;
        p.hr = 0;
        if (!p.unconscious) this.setUnconscious(true);
        this.emit("cardiacArrest", {});
        onCardiacArrest(this);
    }
    criticalVitals() {
        if (!this.p.unconscious && this.p.alive) this.setUnconscious(true);
    }
    setUnconscious(state) {
        const p = this.p;
        if (p.unconscious === state) return;
        p.unconscious = state;
        this.emit(state ? "unconscious" : "wokeUp", {});
        if (state) {
            // core/onUnconscious -> handleKnockOut; airway/onUnconscious -> handleAirway
            p.knockOut = true;
            // core/handleKnockOut: AI only get the knock-out timer if random > AI Stay Down Chance (default 1: never)
            if (!p.ai || this.rng.random(1) > this.setting("ACM_damage_AIStayDownChance")) this.schedule(15 + this.rng.random(20), "knockOutEnds");
            p.lastWakeUpCheck = null;
            onUnconsciousAirway(this);
        } else {
            // core/onUnconscious on waking: a patient treated while down stays lying (Lying_State)
            if (p.wasTreated) { p.lying = true; p.wasTreated = false; }
            p.lastBreath = -1;
            resetAirway(this); // airway/onUnconscious on waking -> resetVariables
        }
    }
    cprSucceeded() {
        const p = this.p;
        // ACE: CardiacArrest -> Unconscious; setCardiacArrestState(false)
        p.cardiacArrest = false;
        p.hrLast = p.hr;
        p.hr = 100;
        p.arrestLoop = false;
        p.reversibleActive = false;
        // ACM CPRSucceeded handler
        p.rhythm = "Sinus";
        this.emit("rosc", {});
        if (this.medCount("Adenosine_IV") > 0.1) return;
        p.roscTime = p.t;
        if (recentAEDShock(p)) p.lastShock = 0;
    }
    wakeUp() { this.setUnconscious(false); }
    fracture(i) { handleFracture(this, i); }

    /** woundsHandlerBase critical hit (head, or torso above the penetration threshold): trauma check, then chest injury. */
    criticalHit(part, type, size, damage) {
        const p = this.p;
        if (this.setting("ACM_damage_enable")) {
            // damage/handleTrauma and handleCardiacArrestTrauma (player thresholds; 0 disables)
            const [head, body] = [p.bodyPartDamage[0], p.bodyPartDamage[1]];
            const ai = p.ai ? "AI" : ""; // AI casualties (training computer) use the AI thresholds
            const hd = this.setting(`ACM_damage_headTraumaDeathThreshold${ai}`), bd = this.setting(`ACM_damage_bodyTraumaDeathThreshold${ai}`);
            const hc = this.setting(`ACM_damage_headTraumaCardiacArrestThreshold${ai}`), bc = this.setting(`ACM_damage_bodyTraumaCardiacArrestThreshold${ai}`);
            if (!p.instantDeathImmune && ((hd > 0 && head > hd) || (bd > 0 && body > bd))) { this.die("Fatal Injury"); return; }
            if ((hc > 0 && head > hc) || (bc > 0 && body > bc)) this.fatalVitals();
        }
        if (part === "body") handleChestInjury(this, type, size, damage);
    }
    die(cause) {
        const p = this.p;
        if (!p.alive) return;
        p.alive = false;
        p.causeOfDeath = cause;
        p.timeOfDeath = p.t;
        p.hr = 0; p.rr = 0; p.cpr = false; p.bvm = false;
        p.rhythm = "Asystole";
        this.emit("death", { cause });
    }

    // ---------------------------------------------------------------- time
    /** Advances one second: due timers first (in time order), then the state machine's vitals update. */
    tick() {
        const p = this.p;
        if (!p.alive) { p.t += 1; return; }
        p.t += 1;
        this.runTimers();
        if (!p.alive) return;
        if (p.cbrn) { cbrnTick(this); if (!p.alive) return; }
        handleUnitVitals(this, 1);
        updateAED(this);
        if (p.alive && p.unconscious && !p.cardiacArrest) wakeUpCheck(this);
    }
    runTimers() {
        const p = this.p;
        for (;;) {
            let next = null;
            for (const tm of this.timers) if (tm.at <= p.t && (!next || tm.at < next.at || (tm.at === next.at && tm.seq < next.seq))) next = tm;
            if (!next) break;
            this.timers.splice(this.timers.indexOf(next), 1);
            const h = this.handlers[next.kind];
            if (!h) throw new Error("No timer handler " + next.kind);
            if (p.alive) h(this, next.args);
        }
    }
    run(seconds) { for (let i = 0; i < seconds; i++) this.tick(); }

    // ---------------------------------------------------------------- actions (effects at completion; the UI handles durations)
    act(name, args = {}) {
        const fn = actions[name];
        if (!fn) throw new Error("Unknown action " + name);
        this.actions.push({ t: this.p.t, name, args });
        const result = fn(this, args);
        this.emit("action", { name, args, result });
        return result;
    }

    /** Plain copy of the patient for display, storage and the instructor view. */
    snapshot() {
        const p = this.p;
        return JSON.parse(JSON.stringify({ ...p, pulse: hasPulse(p), palpable: hasPulse(p, true) }));
    }
}

const simTimers = {
    coagulationTick(sim) {
        const p = sim.p;
        if (p.coagulationLastClot + 120 < p.t) { p.coagulationNext = -1; return; }
        if (p.coagulationNext > p.t) { sim.schedule(1, "coagulationTick"); return; }
        const txa = Math.min(2, sim.medCount("TXA_IV"));
        p.coagulationNext = p.t + 12 - (txa * 3 + p.platelets);
        const r = coagulationStep(sim);
        if (r === false) { p.coagulationNext = -1; return; }
        sim.schedule(1, "coagulationTick");
    },
    ibCoagulationTick(sim) {
        const p = sim.p;
        if (p.ibCoagulationNext > p.t) { sim.schedule(1, "ibCoagulationTick"); return; }
        const txa = Math.min(2.2, sim.medCount("TXA_IV"));
        p.ibCoagulationNext = p.t + 9 - (txa * 3 + p.platelets);
        const r = ibCoagulationStep(sim);
        if (r === false) { p.ibCoagulationNext = -1; return; }
        sim.schedule(1, "ibCoagulationTick");
    },
};

/** Actions. Each mirrors the end state of the ACM/ACE treatment; conditions are checked by the menu layer. */
export const actions = {
    wound(sim, { part, type, damage, count = 1 }) { addWound(sim, part, type, damage, count); return true; },
    bandage(sim, { part, bandage: cls }) { return bandage(sim, part, cls); },
    wrap(sim, { part, clotted = false }) { return wrap(sim, part, clotted); },
    stitch(sim, { part, state = "bandaged" }) { return stitch(sim, part, state); },
    tourniquet(sim, { part }) {
        const p = sim.p, i = PART_INDEX[part];
        if (p.tourniquets[i]) return false;
        p.tourniquets[i] = 1; p.tourniquetTime[i] = p.t;
        updateWoundBleeding(sim);
        return true;
    },
    removeTourniquet(sim, { part }) {
        const p = sim.p, i = PART_INDEX[part];
        if (!p.tourniquets[i]) return false;
        p.tourniquets[i] = 0; p.tourniquetTime[i] = -1;
        updateWoundBleeding(sim);
        // ACE: occluded medications are given once the tourniquet comes off
        const held = p.occludedMeds.filter((m) => m.part === i);
        p.occludedMeds = p.occludedMeds.filter((m) => m.part !== i);
        for (const m of held) addMedication(sim, part, m.name, m.dose, m.iv);
        return true;
    },
    medication(sim, { part, name, dose = 1, iv = false }) { return addMedication(sim, part, name, dose, iv); },
    insertIV(sim, { part, site = 0, device = "IV_16g" }) { sim.p.ivAccess[PART_INDEX[part]][site] = device; return true; },
    insertIO(sim, { part, device = "IO_EZ" }) { sim.p.ioAccess[PART_INDEX[part]] = device; return true; },
    addBag(sim, { part, site = 0, iv = true, type, volume, bloodType = null, donorAlive = true }) {
        sim.p.ivBags.push({ type, remaining: volume, original: volume, part, site, iv, bloodType, donorAlive, collectedAt: sim.p.t });
        // as ivBagLocal: incompatible blood starts a hemolytic reaction 30-60 s later (scripted bags emit no bagAdded event)
        if (type === "Blood" && bloodType && !isBloodCompatible(sim.data, sim.p.bloodType, bloodType)) sim.schedule(30 + sim.rng.random(30), "hemolyticStart");
        return true;
    },
    setFlow(sim, { part, site = 0, iv = true, on }) {
        const i = PART_INDEX[part];
        if (iv) sim.p.ivFlow[i][site] = on; else sim.p.ioFlow[i] = on;
        return true;
    },
    cprStart(sim, { skill = 0 } = {}) {
        const p = sim.p;
        if (p.cpr) return false;
        p.cpr = true;
        p.cprSkill = skill;
        p.cprSession++;
        p.cprStartTime = p.t + 0.2;
        sim.schedule(5, "cprRoll", { session: p.cprSession });
        return true;
    },
    cprPause(sim) {
        // The provider is cleared while paused, which ends ACM's roll loop (it is not restarted on resume).
        if (!sim.p.cpr) return false;
        sim.p.cpr = false; sim.p.cprPaused = true;
        return true;
    },
    cprResume(sim) {
        if (!sim.p.cprPaused) return false;
        sim.p.cpr = true; sim.p.cprPaused = false;
        return true;
    },
    cprStop(sim) {
        const p = sim.p;
        if (!p.cpr && !p.cprPaused) return false;
        p.cprStoppedTotal = p.t - p.cprStartTime;
        p.cprStoppedTime = p.t;
        p.cpr = false; p.cprPaused = false;
        return true;
    },
    bvmStart(sim, { oxygen = false } = {}) { sim.p.bvm = true; sim.p.bvmOxygen = oxygen; sim.p.bvmSqueezes = 0; return true; },
    /** One squeeze (every 6 s in game). The first squeeze of a session and squeezes into a closed airway don't count. */
    bvmBreath(sim) {
        const p = sim.p;
        if (!p.bvm) return false;
        p.bvmSqueezes = (p.bvmSqueezes || 0) + 1;
        if (p.bvmSqueezes === 1 || airwayState(p) <= 0) return false;
        p.lastBreath = p.t;
        if (p.bvmOxygen) p.lastBreathOxygen = p.t;
        return true;
    },
    bvmStop(sim) { sim.p.bvm = false; return true; },
    recoveryPosition(sim, { on = true } = {}) { sim.p.recoveryPosition = on; return true; },
    headTilt(sim, { on = true } = {}) { sim.p.headTilt = on; return true; },
    airwayItem(sim, { slot, item }) { if (slot === "nasal") sim.p.airwayNasal = item; else sim.p.airwayOral = item; return true; },
    shock(sim) { administerShock(sim); return true; },
    /** Scenario/instructor control: set any state fields directly (e.g. {ptx: 2} or {blood: 4.5}). */
    setState(sim, { fields }) {
        Object.assign(sim.p, fields);
        if ("blood" in fields || "plasma" in fields || "saline" in fields) sim.p.bloodVolume = Math.min(6, sim.p.blood + sim.p.plasma + sim.p.saline);
        updateCirculationState(sim.p);
        sim.p.bp = bloodPressure(sim.p);
        return true;
    },
};
