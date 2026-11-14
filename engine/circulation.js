// Vascular access, fluids and blood pressure measurement. Ports ACM_circulation: setIV (success chance and
// complications), setIVLocal, setIVComplication, handleIVComplication, inspectIV, ivBagLocal (core override),
// getReturnVolume, updateActiveFluidBags, handleHemolyticReaction, setPressureCuff, and the measureBP per-frame logic.
import { lin, PART_INDEX } from "./util.js";
import { hasPulse } from "./vitals.js";
import { isBloodCompatible } from "./blood.js";

const C14_L = 0, C14_H = 6, C16_L = 5, C16_H = 10, FLOW_14 = 3, FLOW_16 = 8, LEAK = 8; // ACM_IV_COMPLICATION_*
const SITE = ["Upper", "Middle", "Lower"];
export const DEVICE_NAME = { IV_16g: "16g IV", IV_14g: "14g IV", IO_EZ: "EZ-IO", IO_FAST1: "FAST1 IO" };
export const DEVICE_ITEM = { IV_16g: "ACM_IV_16g", IV_14g: "ACM_IV_14g", IO_EZ: "ACM_IO_EZ", IO_FAST1: "ACM_IO_FAST" };

const pain = (p, level) => { p.pain = Math.max(0, Math.min(1, Math.max(p.pain, level))); };

/** canInsertIV: site free and (upper arm site) no pressure cuff. */
export function canInsertIV(p, part, site) {
    const i = PART_INDEX[part];
    if (p.ivAccess[i][site]) return false;
    if (site === 0 && (i === 2 || i === 3) && p.pressureCuff[i - 2]) return false;
    return true;
}

/** setIV (insert). level: 0 anyone, 1 medic, 2 doctor. Returns { ok, hint, refund }. */
export function insertIV(sim, part, site, device, level) {
    const { p, rng } = sim;
    const i = PART_INDEX[part];
    if (p.ivAccess[i][site]) return { ok: false, refund: true, hint: [`Patient already has an IV on the ${part.replace(/(left|right)/, "$1 ")} (${SITE[site]})`] };
    if (site === 0 && (i === 2 || i === 3) && p.pressureCuff[i - 2]) return { ok: false, refund: true, hint: ["IV placement blocked by applied pressure cuff"] };
    let chance;
    if (!p.alive) chance = lin(0, 90, p.t - (p.timeOfDeath ?? p.t), 0.5, 0);
    else if (p.cardiacArrest) chance = p.cpr ? lin(6, 3, p.bloodVolume, 0.7, 0) : lin(0, 120, p.t - p.arrestTime, 0.6, 0);
    else chance = i === 2 || i === 3 ? lin(70, 90, p.bp[1], 0, 1) : lin(60, 80, p.bp[1], 0, 1);
    if (p.tourniquets[i]) chance = Math.max(0, chance - lin(0, 90, p.t - p.tourniquetTime[i], 0.2, 0.9));
    let complication = false, severe = false;
    if (chance > 0.1) {
        const dmg = p.bodyPartDamage[i];
        let mod;
        if (device === "IV_14g") { mod = lin(C14_L, C14_H, dmg, 0, 1); complication = rng.random(1) < lin(C14_L, C14_H, dmg, 0, 1); }
        else { mod = lin(C16_L, C16_H, dmg, 0, 0.2); complication = rng.random(1) < lin(C16_L, C16_H, dmg, 0, 0.5); }
        chance -= mod;
        if (mod > 0.6) severe = true;
        chance = Math.max(0, chance);
    }
    if (chance > 0 && chance < 1) {
        if (level >= 2) chance += 0.1;
        else if (level < 1) chance = Math.max(0, chance - 0.1);
    }
    if (!(rng.random(1) < chance)) {
        return { ok: false, refund: true, hint: [severe ? "Failed to locate vein, body part too damaged" : "Failed to locate vein"] };
    }
    p.ivAccess[i][site] = device;
    p.ivFlow[i][site] = true;
    if (complication && sim.setting("ACM_circulation_IVComplications")) setIVComplication(sim, i, site, device);
    return { ok: true, log: `inserted ${DEVICE_NAME[device]} (${SITE[site]})` };
}

function setIVPain(sim, i, site, amount) {
    sim.p.ivComplicationPain[i][site] = amount;
    pain(sim.p, (sim.rng.random(0.1) + 0.05) * amount);
}

/** setIVComplication (add). */
function setIVComplication(sim, i, site, device) {
    const dmg = sim.p.bodyPartDamage[i];
    if (dmg > LEAK) { sim.p.ivComplicationFlow[i][site] = 2; setIVPain(sim, i, site, 2); }
    else if ((dmg > FLOW_16 && device === "IV_16g") || (dmg > FLOW_14 && device === "IV_14g")) { sim.p.ivComplicationFlow[i][site] = 1; setIVPain(sim, i, site, 2); }
    else setIVPain(sim, i, site, 1);
    if (sim.setting("ACM_circulation_IVComplicationsDeteriorate") && !sim.p.ivComplicationLoop) {
        sim.p.ivComplicationLoop = true;
        const every = 15 + sim.rng.random(15);
        sim.schedule(every, "ivComplicationTick", { every });
    }
}

export const circulationTimers = {
    /** handleIVComplication loop */
    ivComplicationTick(sim, { every }) {
        const { p, rng } = sim;
        const anyIV = p.ivAccess.some((s) => s.some(Boolean));
        const anyComp = p.ivComplicationPain.some((s) => s.some((x) => x > 0)) || p.ivComplicationFlow.some((s) => s.some((x) => x > 0));
        if (!anyIV || !anyComp) { p.ivComplicationLoop = false; return; }
        sim.schedule(every, "ivComplicationTick", { every });
        p.bodyPartDamage.forEach((dmg, i) => {
            p.ivAccess[i].forEach((type, s) => {
                if (!type || !p.ivFlow[i][s]) return;
                const painOn = p.ivComplicationPain[i][s], flow = p.ivComplicationFlow[i][s];
                if (painOn <= 0 && flow <= 0) return;
                let tryFlow = false, tryLeak = false, target = 0;
                if (dmg > LEAK) { tryLeak = true; target = 3; }
                else if ((dmg > FLOW_16 && type === "IV_16g") || (dmg > FLOW_14 && type === "IV_14g")) { tryFlow = true; target = 3; }
                else if ((dmg > C16_L && type === "IV_16g") || (dmg > C14_L && type === "IV_14g")) target = 2;
                if (target > painOn) setIVPain(sim, i, s, Math.min(target, painOn + 1));
                if (flow >= 2) return;
                if ((tryFlow || tryLeak) && flow < 1) {
                    const c = type === "IV_14g" ? lin(FLOW_14, FLOW_14 + 3, dmg, 0.3, 1) : lin(FLOW_16, FLOW_16 + 3, dmg, 0.2, 1);
                    if (rng.random(1) < c) p.ivComplicationFlow[i][s] = 1;
                }
                if (tryLeak && flow === 1) { // ACM reads the flow state before this tick's change
                    if (rng.random(1) < lin(LEAK, LEAK + 5, dmg, 0.3, 1)) p.ivComplicationFlow[i][s] = 2;
                }
            });
        });
    },
    /** handleHemolyticReaction: starts 30-60 s after incompatible blood is connected */
    hemolyticStart(sim) {
        const { p } = sim;
        if (p.hemolyticLoop) return;
        p.hemolyticLoop = true;
        p.reactionSeverity = 1;
        sim.emit("hemolyticReaction", {});
        sim.schedule(1, "hemolyticTick");
    },
    hemolyticTick(sim) {
        const { p } = sim;
        if (!p.alive || (p.reactionVolume <= 0 && p.ivBags.length === 0)) { p.hemolyticLoop = false; p.reactionSeverity = 0; return; }
        sim.schedule(1, "hemolyticTick");
        if (p.reactionVolume > 0.1) {
            const sev = lin(0.1, 1, p.reactionVolume, 1, 10, false);
            if (p.pain < sev * 0.07) pain(p, Math.min(1, sev * 0.07));
            p.reactionSeverity = sev;
        } else p.reactionSeverity = 0;
    },
};

/** getReturnVolume: a removed bag comes back as the largest full size it still fills. */
export const returnVolume = (v) => (v >= 1000 ? 1000 : v >= 500 ? 500 : v >= 250 ? 250 : 0);

/** setIV (remove) + setIVLocal: connected bags on that site come back to the medic. Returns item classes to return. */
export function removeIV(sim, part, site) {
    const { p } = sim;
    const i = PART_INDEX[part];
    const device = p.ivAccess[i][site];
    if (!device) return { ok: false };
    p.ivAccess[i][site] = null;
    p.ivComplicationPain[i][site] = 0;
    p.ivComplicationFlow[i][site] = 0;
    const back = detachBags(sim, (b) => b.part === part && b.iv && b.site === site);
    return { ok: true, log: `removed ${DEVICE_NAME[device]} (${SITE[site]})`, returned: back };
}

export function insertIO(sim, part, device) {
    const { p } = sim;
    const i = PART_INDEX[part];
    if (p.ioAccess[i]) return { ok: false, refund: true, hint: [`Patient already has an IO on the ${part}`] };
    p.ioAccess[i] = device;
    p.ioFlow[i] = true;
    const suppress = lin(0, 0.4, sim.medCount("Lidocaine", i), 0, 0.3);
    pain(p, Math.max(0, 0.31 - suppress));
    return { ok: true, log: `inserted ${DEVICE_NAME[device]}` };
}

export function removeIO(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    const device = p.ioAccess[i];
    if (!device) return { ok: false };
    p.ioAccess[i] = null;
    const back = detachBags(sim, (b) => b.part === part && !b.iv);
    return { ok: true, log: `removed ${DEVICE_NAME[device]}`, returned: back };
}

function detachBags(sim, match) {
    const back = [];
    sim.p.ivBags = sim.p.ivBags.filter((b) => {
        if (!match(b)) return true;
        const v = returnVolume(b.remaining);
        if (v > 0) back.push(bagItemClass(b.type, v, b.bloodType));
        return false;
    });
    return back;
}

/** inspectIV */
export function inspectIV(sim, part, site) {
    const { p } = sim;
    const i = PART_INDEX[part];
    const flowOn = p.ivFlow[i][site];
    const bag = p.ivBags.some((b) => b.part === part && b.iv && b.site === site);
    const [hint, short] = !flowOn ? ["IV Catheter has no flow", "No flow"] : bag ? ["IV Catheter has normal flow", "Normal flow"] : ["IV Catheter is clear", "Clear"];
    return { hint: [hint], quick: `inspected IV Catheter (${SITE[site]}): ${short}` };
}

// ------------------------------------------------------------------ fluid bags (items)
const BLOOD_CODE = { O: "O+", ON: "O-", A: "A+", AN: "A-", B: "B+", BN: "B-", AB: "AB+", ABN: "AB-" };
const BLOOD_CODE_REV = Object.fromEntries(Object.entries(BLOOD_CODE).map(([k, v]) => [v, k]));

/** Item class -> {type, volume, bloodType} or null. ACE blood bags count as O- (ACM replaces them). */
export function bagInfo(cls) {
    let m = /^ACE_(saline|plasma|blood)IV(?:_(500|250))?$/.exec(cls);
    if (m) {
        const type = { saline: "Saline", plasma: "Plasma", blood: "Blood" }[m[1]];
        return { type, volume: Number(m[2] || 1000), bloodType: type === "Blood" ? "O-" : null };
    }
    m = /^ACM_BloodBag_([A-Z]+)_(\d+)$/.exec(cls);
    if (m && BLOOD_CODE[m[1]]) return { type: "Blood", volume: Number(m[2]), bloodType: BLOOD_CODE[m[1]] };
    return null;
}
export function bagItemClass(type, volume, bloodType) {
    if (type === "Blood") return `ACM_BloodBag_${BLOOD_CODE_REV[bloodType] || "ON"}_${volume}`;
    return `ACE_${type.toLowerCase()}IV${volume === 1000 ? "" : "_" + volume}`;
}
export function bagName(cls) {
    const b = bagInfo(cls);
    if (!b) return cls;
    return b.type === "Blood" ? `Blood Bag ${b.bloodType} (${b.volume}ml)` : `${b.type} (${b.volume}ml)`;
}

/** ivBagLocal: connects a bag to an IV site (iv=true) or the part's IO. Incompatible blood starts a hemolytic reaction. */
export function addBag(sim, part, site, iv, cls) {
    const { p, data } = sim;
    const b = bagInfo(cls);
    if (!b) return { ok: false };
    p.ivBags.push({ type: b.type, remaining: b.volume, original: b.volume, part, site: iv ? site : 0, iv, bloodType: b.bloodType, donorAlive: true, collectedAt: p.t });
    if (b.bloodType && !isBloodCompatible(data, p.bloodType, b.bloodType)) sim.schedule(30 + sim.rng.random(30), "hemolyticStart");
    return { ok: true, log: `added ${bagName(cls)} to ${iv ? `IV (${SITE[site]})` : "IO"}` };
}

/** TransfusionMenu_RemoveBag: returns the bag rounded down to a full size, or nothing. */
export function removeBag(sim, index) {
    const b = sim.p.ivBags[index];
    if (!b) return { ok: false };
    sim.p.ivBags.splice(index, 1);
    const v = returnVolume(b.remaining);
    return { ok: true, returned: v > 0 ? [bagItemClass(b.type, v, b.bloodType)] : [] };
}

// ------------------------------------------------------------------ pressure cuff and manual blood pressure
export function attachCuff(sim, part) {
    const i = PART_INDEX[part] - 2;
    if (sim.p.pressureCuff[i]) return { ok: false, refund: true };
    if (sim.p.ivAccess[i + 2][0]) return { ok: false, refund: true, hint: ["Pressure cuff placement blocked by IV"] };
    sim.p.pressureCuff[i] = true;
    return { ok: true, log: "attached Pressure Cuff" };
}
export function removeCuff(sim, part) {
    const i = PART_INDEX[part] - 2;
    if (!sim.p.pressureCuff[i]) return { ok: false };
    sim.p.pressureCuff[i] = false;
    return { ok: true, log: "removed Pressure Cuff" };
}

/**
 * What the cuff dialog can pick up this instant (measureBP per-frame).
 * Returns { hr (0 = nothing), systolic, diastolic, strength }. Nothing below systolic 80, under a tourniquet,
 * or without a palpable pulse.
 */
export function cuffSignal(sim, part) {
    const { p } = sim;
    const i = PART_INDEX[part];
    let hr = p.hr;
    if (p.tourniquets[i] || !hasPulse(p, true)) hr = 0;
    const [dia, sys] = p.bp;
    if (hr <= 0 || sys < 80 || !p.alive) return { hr: 0, systolic: sys, diastolic: dia, strength: 0 };
    return { hr, systolic: sys, diastolic: dia, strength: lin(80.1, 120, sys, 0.01, 1) };
}
