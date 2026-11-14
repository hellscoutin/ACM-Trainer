// Medical menu read-outs. Ports ACM_gui overrides updateInjuryList and updateBodyImage (body part colours),
// core/getBleedSeverity, with the default display settings (ACE showBleeding 2, showBloodlossEntry on,
// showDamageEntry off; ACM showInactiveStatuses off, showExactPainAmount on, showFracture on).
import { BODY_PARTS, PART_INDEX, SIZES } from "./util.js";
import { cardiacOutput } from "./patient.js";
import { bloodLossRate } from "./blood.js";

const C = {
    white: "#ffffff", airway: "#30e8ed", breathing: "#4dcccc", circulation: "#339933",
    seal: "#fff200", tq: "#ffffff", aed: "#2e99f5", grey: "#b3b3b3",
};
const rgb = (r, g, b) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

export const PART_NAMES = { head: "Head", body: "Torso", leftarm: "Left Arm", rightarm: "Right Arm", leftleg: "Left Leg", rightleg: "Right Leg" };

const WOUND_NAMES = {
    Abrasion: "Scrape", Avulsion: "Avulsion", Contusion: "Bruise", Crush: "Crushed Tissue", Cut: "Cut",
    Laceration: "Tear", VelocityWound: "Velocity Wound", PunctureWound: "Puncture Wound", ThermalBurn: "Thermal Burn", ChemicalBurn: "Chemical Burn",
};
const MINOR_WORD = { Cut: "Small", Laceration: "Small", VelocityWound: "Small" };
export function woundName(type, size) {
    if (type === "ThermalBurn" && size === 2) return "Major Thermal Burn";
    const word = size === 0 ? MINOR_WORD[type] || "Minor" : SIZES[size][0].toUpperCase() + SIZES[size].slice(1);
    return `${word} ${WOUND_NAMES[type] || type}`;
}

/** core/getBleedSeverity: 0 slow, 1 moderate, 2 severe, 3 massive. */
export function bleedSeverity(sim) {
    const rate = bloodLossRate(sim);
    const ko = 0.5 * Math.max(cardiacOutput(sim.p), 0.05);
    return rate < ko * 0.1 ? 0 : rate < ko * 0.5 ? 1 : rate < ko * 1.0 ? 2 : 3;
}

/** Injury list entries [{text, color}] for a selected body part (or general only with part = null). */
export function injuryList(sim, part) {
    const { p } = sim;
    const e = [];
    if (p.woundBleeding > 0) {
        const [text, color] = [["Slow bleeding", "#ffff00"], ["Moderate bleeding", rgb(1, 0.67, 0)], ["Severe bleeding", rgb(1, 0.33, 0)], ["Massive bleeding", "#ff0000"]][bleedSeverity(sim)];
        e.push({ text, color });
    }
    const lost = ["", "Lost some blood", "Lost a lot of blood", "Lost a large amount of blood", "Lost a fatal amount of blood"][p.hemorrhage];
    const lostColor = ["", "#ffff00", rgb(1, 0.67, 0), rgb(1, 0.33, 0), "#ff0000"][p.hemorrhage];
    if (lost) e.push({ text: lost, color: lostColor });
    const bags = { Blood: 0, Plasma: 0, Saline: 0 };
    for (const b of p.ivBags) if (b.type in bags) bags[b.type]++;
    if (bags.Blood) e.push({ text: `Transfusing Blood [${bags.Blood}x]`, color: C.white });
    if (bags.Plasma) e.push({ text: `Transfusing Plasma [${bags.Plasma}x]`, color: C.white });
    if (bags.Saline) e.push({ text: `Transfusing Saline [${bags.Saline}x]`, color: C.white });
    if (!p.unconscious && p.alive && p.lying) e.push({ text: "Lying down", color: C.grey });
    if (!p.unconscious && p.alive) {
        const pain = Math.max(0, Math.min(1, p.pain - p.painSuppress));
        if (pain > 0) e.push({ text: pain > 0.5 ? "In severe pain" : pain > 0.1 ? "In pain" : "In mild pain", color: C.white });
    }
    if (part === null || part === undefined) return e;
    if (e.length) e.push({ text: "", color: C.white });
    const i = PART_INDEX[part];
    e.push({ text: PART_NAMES[part], color: C.white });
    if ((i === 0 || i === 1) && p.recoveryPosition) {
        e.push({ text: "In Recovery Position", color: C.airway });
        if (i === 0 && p.headTilt) e.push({ text: "Head Tilted & Chin Lifted", color: C.airway });
    } else if (i === 0 && p.headTilt) {
        e.push({ text: "Head Tilted & Chin Lifted", color: C.airway });
    }
    if (i === 1 && (p.cpr || p.cprPaused)) e.push({ text: `CPR ${p.cpr ? "In Progress" : "Paused"} (You)`, color: C.white });
    if (i === 0) {
        if (p.airwayNasal === "NPA") e.push({ text: "NPA", color: C.airway });
        if (p.airwayOral) e.push({ text: p.airwayOral === "SGA" ? "i-gel" : "OPA", color: C.airway });
    }
    // Cyanosis (head and arms)
    if ((i === 0 || i === 2 || i === 3) && (!p.alive || p.spo2 < 91 || p.tourniquets[i])) {
        let tqTime = 0;
        let scale = Math.max(0.13, Math.min(0.47, 0.47 + ((p.spo2 - 91) / (55 - 91)) * (0.13 - 0.47)));
        if (p.tourniquets[i]) {
            tqTime = p.t - p.tourniquetTime[i];
            scale = Math.min(scale, Math.max(0.13, Math.min(0.47, 0.47 + ((tqTime - 1) / 89) * (0.13 - 0.47))));
        }
        const sev = p.spo2 < 67 || tqTime > 120 ? "Severe" : p.spo2 < 82 || tqTime > 60 ? "Moderate" : "Slight";
        e.push({ text: `${sev} Cyanosis`, color: rgb(0.16, scale, 1) });
    }
    if (i === 0 && p.tensionTime !== null && p.t - p.tensionTime > 300) e.push({ text: "Noticable Tracheal Deviation", color: rgb(0.5, 0.1, 0.9) });
    if (i === 0 && p.bvm) e.push({ text: "BVM Active (You)", color: C.white });
    if (p.ioAccess[i]) e.push({ text: withBags(p.ioAccess[i] === "IO_FAST1" ? "FAST1 IO" : "EZ-IO", bagLabel(p, part, false)), color: C.circulation });
    p.ivAccess[i].forEach((a, s) => { if (a) e.push({ text: withBags(`${a === "IV_14g" ? "14g IV" : "16g IV"} (${["Upper", "Middle", "Lower"][s]})`, bagLabel(p, part, true, s)), color: C.circulation }); });
    if ((i === 2 || i === 3) && p.pulseOx[i - 2]) {
        const [sp, pr] = (p.pulseOxDisplay || [[0, 0], [0, 0]])[i - 2];
        e.push({ text: `Pulse Oximeter [PR: ${sp < 1 || pr < 1 ? "--" : pr} SpO2: ${sp < 1 || pr < 1 ? "--" : sp}]`, color: C.circulation });
    }
    if (i === 1 && p.chestSeal) e.push({ text: "Chest Seal Applied", color: C.seal });
    if ((i === 2 || i === 3) && p.pressureCuff[i - 2]) e.push({ text: "Pressure Cuff", color: C.circulation });
    if (p.tourniquets[i]) e.push({ text: `Tourniquet [CAT] [${formatTime(p.t - p.tourniquetTime[i])}]`, color: C.tq });
    // Internal bleeding bruising / hemothorax
    const ib = p.internalWounds[part].reduce((a, w) => a + w.count * w.bleeding, 0);
    if (i === 1 && p.htxFluid > 0.5) e.push({ text: `Extensive Bruising (${ib > 0.15 ? "Lower & Upper Chest" : "Upper Chest"})`, color: rgb(0.6, 0.1, 0.6) });
    else if (ib > 0.15) e.push({ text: "Extensive Bruising", color: rgb(0.6, 0.1, 0.6) });
    if (i === 1 && p.thoracostomy >= 0) e.push({ text: `Thoracostomy Incision (${["Sealed", "Open", "Sealed Chest Tube", "Unsealed Chest Tube"][p.thoracostomy]})`, color: C.airway });
    // Wounds
    const w = [];
    const add = (list, fmt, color) => {
        for (const x of list[part]) {
            if (!(x.count > 0)) continue;
            const name = woundName(x.type, x.size);
            const d = x.count >= 1 ? `${Math.ceil(x.count)}x ${name}` : `Partial ${name}`;
            w.push({ text: fmt.replace("%1", d), color });
        }
    };
    add(p.openWounds, "%1", C.white);
    add(p.bandagedWounds, "[B] %1", rgb(0.88, 0.7, 0.65));
    add(p.stitchedWounds, "[S] %1", rgb(0.7, 0.7, 0.7));
    add(p.clottedWounds, "[C] %1", rgb(1, 0.5, 0.1));
    add(p.wrappedWounds, "[W] %1", rgb(0.7, 0.5, 0.1));
    if (!w.length) e.push({ text: "No injuries on this body part", color: "rgba(255,255,255,0.33)" });
    else e.push(...w);
    return e;
}

/** getBodyPartIVBags: "B: 450ml S: 1000ml" for one IV site (iv) or all IO bags on the part. */
function bagLabel(p, part, iv, site) {
    const v = { FBTK: 0, FreshBlood: 0, Blood: 0, Plasma: 0, Saline: 0 };
    for (const b of p.ivBags) if (b.part === part && b.iv === iv && (!iv || b.site === site)) v[b.type] += b.remaining;
    const short = { FBTK: "FBTK", FreshBlood: "FWB", Blood: "B", Plasma: "P", Saline: "S" };
    return Object.entries(v).filter(([, x]) => x > 0).map(([k, x]) => `${short[k]}: ${Math.floor(x)}ml`).join(" ");
}
const withBags = (text, bags) => (bags ? `${text} [${bags}]` : text);

export function formatTime(s) {
    s = Math.max(0, Math.floor(s));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** updateBodyImage colours: bleeding parts shade white -> red (0.5 = full red), otherwise damage white -> blue. */
export function bodyPartColors(sim) {
    const { p } = sim;
    const thresholds = [sim.setting("ACM_damage_headTraumaDeathThreshold"), sim.setting("ACM_damage_bodyTraumaDeathThreshold"), 2, 2, 1.2, 1.2];
    return BODY_PARTS.map((part, i) => {
        const loss = p.openWounds[part].reduce((a, w) => a + w.count * w.bleeding, 0);
        if (loss > 0) {
            const f = Math.ceil(Math.min(1, loss / 0.5) * 9) / 9;
            return rgb(1, 1 - f * 0.9, 1 - f);
        }
        const dmg = p.bodyPartDamage[i] / Math.max(0.01, thresholds[i]);
        const f = Math.ceil(Math.min(1, dmg / 0.8) * 9) / 9;
        return rgb(1 - f * 0.8, 1 - f * 0.8, 1);
    });
}
