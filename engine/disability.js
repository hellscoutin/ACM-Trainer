// Fractures and splints. Ports ACM_disability: handleFracture (severity by limb damage, pain and re-fracture loop),
// inspectForFracture, performFractureRealignmentLocal, splintLocal (SAM splint), wrapSplintLocal, removeSplintLocal.
// ACE fracture states (VAR_FRACTURES): 0 none, 1 fractured, -1 splinted. ACM severity (Fracture_State): 1 mild, 2 severe, 3 complex.
import { PART_INDEX } from "./util.js";

const MILD = 3, SEVERE = 5, COMPLEX = 7; // FRACTURE_THRESHOLD_*

export function initDisability(p) {
    const z = () => [0, 0, 0, 0, 0, 0], f = () => [false, false, false, false, false, false];
    Object.assign(p, { fractures: z(), fractureState: z(), fracturePrepared: f(), fracturePain: f(), refracture: f(), fractureNoEffect: f(), splints: z() });
}

/** ACE fracture event + ACM handleFracture. */
export function handleFracture(sim, i) {
    const { p, rng } = sim;
    p.fractures[i] = 1;
    sim.emit("fracture", { part: i });
    if (!sim.setting("ACM_disability_enableFractureSeverity")) return;
    const dmg = p.bodyPartDamage[i];
    p.fracturePrepared[i] = false;
    const complication = rng.random(1) < 0.5;
    let target = 0, noEffect = false, pain = false, refr = false;
    if (sim.setting("ACM_disability_Hardcore_ComplexFracture") && dmg > COMPLEX) { pain = true; noEffect = true; target = 3; }
    else if (dmg < MILD || (dmg < SEVERE && !complication)) target = 1;
    else if (dmg < SEVERE && complication) { pain = rng.random(1) < 0.5; refr = rng.random(1) < 0.3; target = 1; }
    else { noEffect = rng.random(1) < 0.3; if (!noEffect) refr = rng.random(1) < 0.5; target = 2; }
    if (target > p.fractureState[i]) p.fractureState[i] = target;
    if (pain) p.fracturePain[i] = true;
    if (refr) p.refracture[i] = true;
    if (sim.setting("ACM_disability_Hardcore_ComplexFracture") && noEffect) p.fractureNoEffect[i] = true;
    // the recurring pain / re-fracture loop only starts for re-fracturable, effective fractures (as written in ACM)
    if (p.fractureLoop || (!refr && !noEffect) || noEffect) return;
    p.fractureLoop = true;
    sim.schedule(30, "fractureTick");
}

export const disabilityTimers = {
    fractureTick(sim) {
        const { p, rng } = sim;
        if (p.fractureState.every((x) => x === 0)) { p.fractureLoop = false; return; }
        sim.schedule(30, "fractureTick");
        let givePain = false;
        for (let i = 2; i <= 5; i++) {
            if (!givePain && p.fracturePain[i]) givePain = rng.random(1) < 0.3;
            if (p.fractures[i] === -1 && p.refracture[i] && rng.random(1) < (i <= 3 ? 0.1 : 0.25)) { p.fractures[i] = 1; sim.emit("refracture", { part: i }); }
        }
        if (givePain) p.pain = 1;
    },
    splintFallOff(sim, { i }) {
        const { p } = sim;
        if (p.splints[i] !== 1 || !p.alive) return;
        removeSplint(sim, i, true);
        sim.emit("splintFellOff", { part: i });
    },
};

/** inspectForFracture */
export function inspectForFracture(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    const s = p.fractureState[i];
    let hint, short;
    if (p.splints[i] > 0) [hint, short] = ["Patient has splint applied to limb", "Splinted"];
    else if (s === 3) [hint, short] = ["Patient has significant swelling on limb", "Significant Swelling"];
    else if (s === 2) [hint, short] = ["Patient has swelling on limb", "Swelling"];
    else if (s === 1) [hint, short] = ["Patient has severe bruising on limb", "Severe Bruising"];
    else if (p.bodyPartDamage[i] > 1) [hint, short] = ["Patient limb is bruised", "Bruised"];
    else [hint, short] = ["Patient has no substantial damage on limb", "No Significant Injury"];
    const lines = [hint];
    if (p.fracturePrepared[i]) { lines.push("Fracture realignment performed"); short += ", realignment performed"; }
    return { hint: lines, short };
}
export const canInspect = (sim, part) => {
    const { p } = sim; const i = PART_INDEX[part];
    return sim.setting("ACM_disability_enableFractureSeverity") && p.splints[i] === 0 && (p.fractureState[i] > 0 || p.bodyPartDamage[i] >= 0.3);
};
export const canRealign = (sim, part) => sim.setting("ACM_disability_enableFractureSeverity") && sim.p.fractureState[PART_INDEX[part]] > 0 && sim.p.splints[PART_INDEX[part]] === 0;

/** performFractureRealignmentLocal: pain (1 minus local lidocaine); prepares the fracture (not complex/no-effect). */
export function realign(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    const a = sim.medCount("Lidocaine", i);
    if (a < 0.7) p.pain = Math.max(0, Math.min(1, Math.max(p.pain, 1 - a)));
    if (p.fractureState[i] === 0 || p.fracturePrepared[i] || p.fractureNoEffect[i]) return;
    p.fracturePrepared[i] = true;
}

export const canSplint = (p, part) => { const i = PART_INDEX[part]; return p.splints[i] === 0 && (p.bodyPartDamage[i] > 0 || p.fractures[i] > 0); };

/** splintLocal (SAM splint): sets the bone if realigned; tracked (and falls off unless wrapped) only with ACE Fractures > 1. */
export function applySplint(sim, part) {
    const { p, rng } = sim;
    const i = PART_INDEX[part];
    if ((p.fracturePrepared[i] && p.fractureState[i] < 3) || !sim.setting("ACM_disability_enableFractureSeverity")) p.fractures[i] = -1;
    if (sim.aceSetting("fractures", 1) > 1) {
        p.splints[i] = 1;
        const t = sim.setting("ACM_disability_splintFallOffTime");
        sim.schedule(rng.tri(t, t + 30, t + 60), "splintFallOff", { i });
    }
}
export const canWrapSplint = (p, part) => p.splints[PART_INDEX[part]] === 1;
export function wrapSplint(sim, part) { sim.p.splints[PART_INDEX[part]] = 2; }
export const canRemoveSplint = (p, part) => p.splints[PART_INDEX[part]] > 0;
/** removeSplintLocal: a fracture comes back (and loses its realignment). Returns the splint to the medic. */
export function removeSplint(sim, i, reFracture = true) {
    const { p } = sim;
    p.splints[i] = 0;
    if (reFracture && p.fractureState[i] > 0) { p.fractures[i] = 1; p.fracturePrepared[i] = false; }
}
