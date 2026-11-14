// Surgical airway (cricothyroidotomy). Ports ACM_airway: canEstablishSurgicalAirway, establishSurgicalAirway (start,
// cancel/finish, per-frame palpation colours), SurgicalAirway_mousePress (incisions and their checks),
// SurgicalAirway_action (progress steps), getAirwayIncisionBleedRate, secureSurgicalAirway, stitchAirwayIncision,
// getStitchAirwayIncisionTime. Geometry is in ACM's GUI grid units (Stethoscope/SurgicalAirway_Dialog layout).
import { lin } from "./util.js";
import { cardiacOutput } from "./patient.js";
import { addWound } from "./wounds.js";

/** SurgicalAirway_Dialog zones [x, y, w, h] in grid units. */
export const ZONES = {
    actionArea: [10, 4, 20, 14],
    shape: [18.1, 7.1, 5, 3.9], shape2: [18.8, 10.8, 3.5, 7],
    upper: [17.8, 7.7, 5.5, 2], upperMiddle: [20.35, 7.4, 0.5, 2.3], lower: [18.5, 10.2, 4.2, 1.4],
    entryArea: [18.4, 9.5, 4.4, 1], entry: [19.5, 9.7, 2.2, 0.7],
    incisionVertical: [20.35, 9.1, 0.5, 1.9], incisionHorizontal: [20, 9.7, 1.2, 0.7],
    // action buttons (the area you click with the tool selected)
    liftIncision: [19.6, 9, 2, 2], insertTube: [20.2, 10, 5.5, 8.5], removeHook: [20.2, 10, 5.5, 8.5],
    inflateCuff: [3.5, 17.6, 6, 2], removeStylet: [18.6, 8.8, 3, 3], connectStrap: [12.7, 9, 5.4, 2.5], secureStrap: [22, 9, 5.4, 2.5],
};
export const inZone = ([x, y, w, h], [px, py]) => px >= x && px <= x + w && py >= y && py <= y + h;
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const GRID_H = 0.04; // screen units per grid unit (incision size is measured in screen units in ACM)

/** Palpation marker colour at a point (per-frame palpation branch). */
export function palpate(sa, pt) {
    if (sa.tube) return "rgba(255,255,255,0.2)";
    if (sa.verticalSuccess && inZone(ZONES.entry, pt)) return "rgba(0,255,255,0.7)"; // the opening
    if (!sa.verticalSuccess && inZone(ZONES.entryArea, pt)) return "rgba(255,26,179,0.7)"; // cricothyroid membrane
    if (inZone(ZONES.upperMiddle, pt)) return "rgba(255,230,0,0.7)";
    if (inZone(ZONES.upper, pt)) return "rgba(255,179,128,0.7)";
    if (inZone(ZONES.lower, pt)) return "rgba(255,128,128,0.7)";
    if (inZone(ZONES.shape, pt) || inZone(ZONES.shape2, pt)) return "rgba(255,0,0,0.7)";
    return "rgba(255,255,255,0.2)";
}

export function canEstablish(p) {
    if ((!p.unconscious && p.alive) || p.surgicalAirway) return false;
    return !p.bvm && !p.cpr && !p.sa?.inProgress;
}

/** establishSurgicalAirway on start: resets the procedure state. */
export function startProcedure(sim) {
    const p = sim.p;
    p.sa = {
        inProgress: true, failed: false, progress: 0, hook: false, tube: false, cuff: false, stylet: true,
        strapConnected: false, strapSecure: false, verticalSuccess: false, horizontalSuccess: false, spread: false,
        incisionCount: 0, severity: 0, incisionX: -1,
    };
    p.incisionStitched = false;
    p.incisionBleedBase = 0;
    return p.sa;
}

/** Left mouse down with the scalpel inside the action area: a new incision (+0.9 pain). */
export function beginIncision(sim) {
    const sa = sim.p.sa;
    sa.incisionCount++;
    sim.p.pain = Math.max(0, Math.min(1, Math.max(sim.p.pain, 0.9)));
    updateBleed(sim.p);
}

/**
 * Left mouse up: rect = incision space [x, y, w, h] (grid), vertical = direction, length = grid units cut (vertical only;
 * ACM only measures vertical incisions). Returns { failed, verticalSuccess, horizontalSuccess }.
 */
export function finishIncision(sim, rect, vertical, length) {
    const sa = sim.p.sa;
    if (!overlap(rect, ZONES.shape)) { sa.failed = true; return { failed: true }; }
    if (vertical) {
        const site = ZONES.incisionVertical;
        if (!sa.verticalSuccess && overlap(rect, site) && rect[1] < site[1] && rect[1] + rect[3] > site[1] + site[3]) {
            sa.verticalSuccess = true;
            sa.incisionX = rect[0];
        }
    } else {
        const site = ZONES.incisionHorizontal;
        if (overlap(rect, site) && rect[0] < site[0] && rect[0] + rect[2] > site[0] + site[2]) {
            sa.horizontalSuccess = true;
            action(sim, 0);
        }
    }
    const size = vertical ? length * GRID_H : 0;
    sa.severity += size === 0 ? 0.5 : lin(0, 0.09, size, 0.5, 1, false);
    updateBleed(sim.p);
    return { failed: false, verticalSuccess: sa.verticalSuccess, horizontalSuccess: sa.horizontalSuccess };
}

/** SurgicalAirway_action: 0 open (horizontal incision done), 1 lift with hook, 2 insert tube, 3 remove hook,
 *  4 inflate cuff, 5 remove stylet, 6 connect strap, 7 secure strap. Returns the hint text or null. */
export function action(sim, type) {
    const p = sim.p, sa = p.sa;
    let progress = sa.progress;
    if (progress > 0) {
        if (progress === type && progress < 4) { progress = type + 1; sa.progress = progress; }
        if (!sa.hook && progress === 2) { sa.hook = true; return "Lifted incision with tracheal hook"; }
        if (sa.hook && progress === 4) { sa.hook = false; return "Removed tracheal hook"; }
        if (!sa.tube && progress === 3) { sa.tube = true; return "Inserted cric-key"; }
        if (progress > 3 && type === 4 && sa.tube && !sa.hook) {
            sa.cuff = true;
            if (!p.surgicalAirway && !sa.stylet) establish(p);
            return "Inflated cric-key cuff";
        }
        if (progress > 3 && type === 5 && sa.tube && !sa.hook) {
            sa.stylet = false;
            if (!p.surgicalAirway && sa.cuff) establish(p);
            return "Removed cric-key stylet";
        }
        if (progress > 3 && type === 6 && sa.tube && !sa.stylet) { sa.strapConnected = true; return "Connected neck strap"; }
        if (progress > 3 && type === 7 && sa.tube && !sa.stylet && sa.strapConnected) { sa.strapSecure = true; return "Secured neck strap"; }
        return null;
    }
    if (type === 0) { sa.progress = 1; p.incisionOpen = true; }
    return null;
}
function establish(p) { p.surgicalAirway = true; p.surgicalAirwayUnsecure = false; }

/**
 * Closing the dialog (cancel or finish). A failed attempt or one abandoned after cutting turns each incision into a
 * wound on the head; abandoning before any cut returns the kit. Returns { established, kitReturned, failed }.
 */
export function endProcedure(sim) {
    const p = sim.p, sa = p.sa;
    sa.inProgress = false;
    const woundIt = () => { for (let i = 0; i < sa.incisionCount; i++) addWound(sim, "head", "Cut", 1); };
    if (sa.failed) { woundIt(); return { failed: true }; }
    if (!p.surgicalAirway) {
        if (sa.incisionCount === 0) return { kitReturned: true };
        woundIt();
        sa.progress = 0;
        p.incisionOpen = false;
        return { cancelled: true };
    }
    // ACM starts a loop that should loosen an unsecured tube when dragged/carried, but only when the strap IS secure,
    // and it exits at once: unsecured tubes never loosen in 1.4.8.
    return { established: true };
}

/** getAirwayIncisionBleedRate base: count x 0.02 x severity (until stitched). Note: not reset by a failed attempt. */
function updateBleed(p) { p.incisionBleedBase = p.sa ? p.sa.incisionCount * 0.02 * p.sa.severity : 0; }
export function incisionBleedRate(sim) {
    const p = sim.p;
    if (!p.incisionBleedBase || p.incisionStitched) return 0;
    return p.incisionBleedBase * Math.max(cardiacOutput(p), sim.setting("ACM_circulation_cardiacArrestBleedRate")) * (100 / p.resistance) * sim.aceSetting("bleedingCoefficient", 1);
}

export const canSecure = (p) => p.surgicalAirway && !p.sa?.strapSecure && !p.bvm && !p.sa?.inProgress;
export function secureStrap(sim) { sim.p.sa.strapSecure = true; sim.p.surgicalAirwayUnsecure = false; return "Secured neck strap"; }
export const canStitchIncision = (p) => p.surgicalAirway && !p.incisionStitched && !p.sa?.inProgress;
export function stitchIncision(sim) { sim.p.incisionStitched = true; return "Stitched surgical airway incision"; }
export const stitchIncisionTime = (p, suture = false) => (p.sa?.incisionCount || 0) * (suture ? 0.5 : 5);
