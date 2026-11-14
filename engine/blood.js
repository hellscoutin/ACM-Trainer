// Blood volume model. Port of ACM core/ov/getBloodVolumeChange plus the bleed-rate functions
// (core/ov/getBloodLoss, circulation/getInternalBleedingRate, getHemothoraxBleedingRate).
// SQF operator precedence is kept where it changes results; those lines are marked "as SQF".
import { lin, PART_INDEX } from "./util.js";
import { cardiacOutput, addPain } from "./patient.js";
import { incisionBleedRate } from "./surgicalAirway.js";

const DEFAULT_BLOOD = 6;

/** core/ov/getBloodLoss: external bleed rate in L/s. */
export function bloodLossRate(sim) {
    const { p } = sim;
    if (p.woundBleeding === 0) return 0;
    const caRate = sim.setting("ACM_circulation_cardiacArrestBleedRate");
    return p.woundBleeding * Math.max(cardiacOutput(p), caRate) * (100 / p.resistance) * sim.aceSetting("bleedingCoefficient", 1);
}

/** circulation/getInternalBleedingRate: blood still moves slowly when the heart stops (half the arrest rate). */
export function internalBleedRate(sim) {
    const { p } = sim;
    if (p.internalBleeding === 0) return 0;
    const caRate = sim.setting("ACM_circulation_cardiacArrestBleedRate");
    return p.internalBleeding * Math.max(cardiacOutput(p), caRate / 2) * (100 / p.resistance) * sim.aceSetting("bleedingCoefficient", 1);
}

/** circulation/getCapillaryDamageBleedingRate: lewisite capillary damage (0-100) x 0.0004, flowing like wound bleeding. */
export function capillaryBleedRate(sim) {
    const { p } = sim;
    const base = (p.cbrn?.capillary || 0) * 0.0004;
    if (base === 0) return 0;
    return base * Math.max(cardiacOutput(p), sim.setting("ACM_circulation_cardiacArrestBleedRate")) * (100 / p.resistance) * sim.aceSetting("bleedingCoefficient", 1);
}

/** circulation/getHemothoraxBleedingRate: 0.006 per hemothorax level. */
export function hemothoraxBleedRate(sim) {
    const { p } = sim;
    const base = p.htxState * 0.006;
    if (base === 0) return 0;
    const caRate = sim.setting("ACM_circulation_cardiacArrestBleedRate");
    return base * Math.max(cardiacOutput(p), caRate) * (100 / p.resistance) * sim.aceSetting("bleedingCoefficient", 1);
}

/** circulation/isBloodTypeCompatible. */
export function isBloodCompatible(data, recipient, donor) {
    return (data.blood.compatible[recipient] || []).includes(donor);
}

/** circulation/getIVFlowRate: ml/s for the access device. */
function accessFlow(data, access) {
    const d = data.access.devices[access];
    return data.thresholds.aceConstants.ivChangePerSecond * (d ? d.flow : 1);
}

/**
 * One blood-volume step of deltaT seconds. Updates the compartments, platelets, overload, calcium,
 * transfused and reaction volumes, hemothorax fluid and the IV bags. Returns the ACE blood volume (sum, max 6).
 */
export function bloodVolumeStep(sim, dt) {
    const { p, data } = sim;
    let blood = p.blood, plasma = p.plasma, saline = p.saline, platelets = p.platelets;
    let dBlood = 0, dPlasma = 0, dSaline = 0, dPlatelets = 0, dTransfused = 0, dReaction = 0;

    let bloodLoss = -dt * bloodLossRate(sim);
    let internal = -dt * internalBleedRate(sim);
    let capillary = -dt * capillaryBleedRate(sim); // CBRN lewisite capillary damage
    const inCA = p.cardiacArrest;
    const txa = sim.medCount("TXA_IV");

    const ibSeverity = p.internalBleeding > 0.3 || (platelets < 0.1 && txa < 0.1) ? 1 : 0;

    let htx = 0;
    const plateletBleedRatio = inCA ? 0 : Math.max(0, Math.min(0.8, lin(2.9, 1.8, platelets, 0.8, 0.5, false)));
    const plateletInternalRatio = inCA ? 0 : Math.max(0, Math.min(0.8, lin(2.4, 1.6, platelets, 0.8, 0.5, false)));

    if (p.htxState > 0) {
        htx = -dt * hemothoraxBleedRate(sim);
        p.htxFluid = Math.min(1.5, p.htxFluid - htx * (1 - plateletBleedRatio));
    }
    const incision = incisionBleedRate(sim);
    if (incision > 0) bloodLoss += -dt * incision;

    const active = (blood > 0 ? 1 : 0) + (plasma > 0 ? 1 : 0) + (saline > 0 ? 1 : 0);

    if (platelets > 0.1) {
        if (txa > 0.5 && !inCA) {
            bloodLoss *= lin(0.5, 2, txa, 1, 0.9);
            internal *= lin(0.5, 2, txa, 1, 0.85);
            htx *= lin(0.5, 2, txa, 1, 0.8);
            capillary *= lin(0.5, 2, txa, 1, 0.85);
        }
        dPlatelets = bloodLoss * plateletBleedRatio + internal * 0.6 * plateletInternalRatio + htx * plateletBleedRatio + capillary * plateletBleedRatio;
        if (txa > 0.1 && !inCA) dPlatelets *= 0.9;
    }

    const loss = bloodLoss * (1 - plateletBleedRatio) + internal * ibSeverity * (1 - plateletInternalRatio) + htx * (1 - plateletBleedRatio) + capillary * (1 - plateletBleedRatio);
    if (blood > 0) dBlood = loss / active;
    if (plasma > 0) dPlasma = loss / active;
    if (saline > 0) dSaline = loss / active;

    // ----- IV / IO bags
    let transfusionPain = 0;
    let freshEffect = 0;
    if (p.ivBags.length) {
        let ivMult = 1, ioMult = 1;
        if (inCA) {
            ivMult = sim.setting("ACM_circulation_cardiacArrestBleedRate");
            ioMult = 0.9;
            if (p.cpr) { ivMult = 0.9; ioMult = 1; }
        }
        const flowing = (b) => {
            const pi = PART_INDEX[b.part];
            const tqOk = !p.tourniquets[pi] || (!b.iv && (pi === 2 || pi === 3));
            const on = b.iv ? p.ivFlow[pi][b.site] : p.ioFlow[pi];
            return tqOk && on && (b.type !== "FBTK" || (b.remaining <= b.original && b.iv));
        };
        // circulation/updateActiveFluidBags: a site's flow is split by the number of DIFFERENT fluid types on it
        // (two saline bags on one site both run at full rate); with fewer than 2 bags on the part, or a tourniquet, 1.
        const siteKey = (b) => `${b.part}|${b.iv ? "iv" + b.site : "io"}`;
        const perSite = {};
        const typesAt = {};
        for (const b of p.ivBags) (typesAt[siteKey(b)] ??= new Set()).add(b.type);
        for (const b of p.ivBags) {
            const onPart = p.ivBags.filter((x) => x.part === b.part).length;
            perSite[siteKey(b)] = onPart < 2 || p.tourniquets[PART_INDEX[b.part]] ? 1 : typesAt[siteKey(b)].size;
        }

        for (const b of p.ivBags) {
            if (!flowing(b)) continue;
            const pi = PART_INDEX[b.part];
            let flowFactor = 1, pass = 1;
            let freshValid = false;
            if (b.type === "Blood") flowFactor = 0.8;
            else if (b.type === "FBTK" || b.type === "Saline") flowFactor = 1.2;
            else if (b.type === "FreshBlood") {
                const timeEffect = Math.min(1, Math.max(0.67, 900 / Math.max(0.001, p.t - b.collectedAt)));
                freshValid = b.donorAlive;
                flowFactor = freshValid ? 1.2 * timeEffect : 0.8;
                freshEffect = timeEffect;
            }
            const access = b.iv ? p.ivAccess[pi][b.site] : p.ioAccess[pi];
            let change = dt * sim.aceSetting("ivFlowRate", 1) * accessFlow(data, access) * (b.iv ? ivMult : ioMult) * flowFactor;
            change = b.type === "FBTK" ? Math.min(change, b.original - b.remaining) : Math.min(change, b.remaining);
            if (b.iv && sim.setting("ACM_circulation_IVComplications")) {
                const c = p.ivComplicationFlow[pi][b.site];
                change = [change, change * 0.9, change * 0.85][c];
                pass = [1, 1, 0.8][c];
            }
            if (b.remaining > 1) change /= perSite[siteKey(b)];
            b.remaining += b.type === "FBTK" ? change : -change;

            const L = change / 1000;
            switch (b.type) {
                case "Plasma":
                    dPlasma = (dPlasma + L) * pass; // as SQF: the pass ratio scales the running total
                    dPlatelets = (dPlatelets + change / 600) * pass;
                    break;
                case "Saline":
                    dSaline = (dSaline + L) * pass;
                    break;
                case "FBTK":
                    dBlood = (dBlood - L) * pass;
                    dPlatelets = (dPlatelets - change / 2000) * pass;
                    break;
                default:
                    if (isBloodCompatible(data, p.bloodType, b.bloodType) && (b.type === "Blood" || (b.type === "FreshBlood" && freshValid))) {
                        dBlood = (dBlood + L) * pass;
                        dTransfused = (dTransfused + L) * pass;
                    } else {
                        dSaline = (dSaline + L) * pass;
                        dPlatelets = (dPlatelets - L) * pass;
                        dReaction = (dReaction + L) * pass;
                        freshEffect = 0;
                    }
            }
            if (access === "IO_EZ" || access === "IO_FAST1") {
                const suppression = lin(0, 0.24, sim.medCount("Lidocaine_IV", pi), 0, 0.95);
                transfusionPain += Math.max(0, change / 3 - suppression);
            } else {
                const cp = p.ivComplicationPain[pi][b.site];
                if (cp > 0) transfusionPain += L * cp;
            }
        }
        const before = p.ivBags.length;
        p.ivBags = p.ivBags.filter((b) => b.type === "FBTK" || b.remaining >= 0.01);
        for (const b of p.ivBags) b.remaining = Math.min(b.remaining, b.original);
        if (p.ivBags.length < before) sim.emit("bagEmpty", {});
        p.freshBloodEffect = p.ivBags.length ? freshEffect : 0;
    }
    if (transfusionPain > 0) addPain(p, Math.min(0.8, transfusionPain), data);

    // ----- plasma / saline conversion into blood
    if (blood < 6) {
        const mod = p.freshBloodEffect > 0.83 ? 2 : 1;
        if (plasma + dPlasma > 0) {
            const r = Math.min(dt * 0.003 * mod, plasma + dPlasma);
            dPlasma -= r; dBlood += r;
        }
        if (saline + dSaline > 0) {
            const r = Math.min(dt * 0.0007 * mod, saline + dSaline);
            dSaline -= r; dBlood += r;
        }
    }

    // ----- compartments and fluid overload (as SQF, including the double-counted change terms)
    let overload = p.overload;
    let dOverload = 0;
    let plasmaSpace = DEFAULT_BLOOD, salineSpace = DEFAULT_BLOOD;
    blood = Math.min(DEFAULT_BLOOD, Math.max(0, blood) + dBlood);
    dOverload += blood + dBlood - DEFAULT_BLOOD;
    plasmaSpace -= blood; salineSpace -= blood;
    plasma = Math.min(DEFAULT_BLOOD, Math.max(0, plasma) + dPlasma);
    dOverload += plasma + dPlasma - plasmaSpace;
    plasma = Math.max(0, Math.min(plasma, plasmaSpace));
    salineSpace -= plasma;
    saline = Math.min(DEFAULT_BLOOD, Math.max(0, saline) + dSaline);
    dOverload += saline + dSaline - salineSpace;
    saline = Math.max(0, Math.min(saline, salineSpace));
    overload = Math.max(0, overload + dOverload / 2);
    if (overload > 0 && dOverload <= 0) overload = Math.max(0, overload - dt * 0.001);
    p.overload = overload;

    // ----- calcium clears transfused blood and restores platelets
    let dCalcium = 0;
    if (p.transfused > 0 && p.calcium > 0) {
        dTransfused -= Math.min(dt * 0.005, p.transfused);
        dCalcium -= Math.min(dt * 0.005, p.calcium);
        dPlatelets += Math.min(dt * 0.005, p.calcium);
    }
    p.calcium = Math.min(3, Math.max(0, p.calcium) + dCalcium);
    p.transfused = Math.min(DEFAULT_BLOOD, Math.max(0, p.transfused) + dTransfused);
    if (p.reactionVolume > 0 && dReaction === 0) dReaction -= Math.min(dt * 0.00125, p.reactionVolume);
    p.reactionVolume = Math.min(DEFAULT_BLOOD, Math.max(0, p.reactionVolume) + dReaction);

    // ----- platelet regeneration towards 3
    const target = 3;
    if (platelets !== target) {
        let speed = lin(3, 6, blood, 10000, 1000);
        if (txa > 0.1) speed /= 2;
        if (dBlood >= 0 && platelets > target) speed = 100;
        dPlatelets += ((target - platelets) / speed) * dt;
    }
    p.platelets = Math.min(DEFAULT_BLOOD, Math.max(0, platelets + dPlatelets));
    p.blood = blood; p.plasma = plasma; p.saline = saline;
    return Math.min(DEFAULT_BLOOD, blood + plasma + saline);
}

