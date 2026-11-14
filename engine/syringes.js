// Syringes and vials. Ports ACM_circulation Syringe_Draw / Syringe_PrepareFinish (draw a vial into a syringe, 4 s)
// and Syringe_Inject (push IV through an IV/IO on that part, or inject IM; 2 s from the menu, 2.5 s from the draw window).
import { PART_INDEX, lin } from "./util.js";
import { addMedication, medicationCount } from "./pharmacology.js";

/** ACM_Medication >> Concentration: mg per ml (fentanyl in mg: 0.05 mg/ml = 50 mcg/ml) and vial volume in ml. */
export const VIALS = {
    Naloxone: { conc: 4, volume: 0.1, label: "4mg/0.1ml" }, Amiodarone: { conc: 50, volume: 3, label: "150mg/3ml" },
    Atropine: { conc: 1, volume: 1, label: "1mg/1ml" }, TXA: { conc: 100, volume: 10, label: "1g/10ml" },
    Morphine: { conc: 5, volume: 2, label: "10mg/2ml" }, Fentanyl: { conc: 0.05, volume: 2, label: "100mcg/2ml" },
    Epinephrine: { conc: 1, volume: 1, label: "1mg/1ml" }, Adenosine: { conc: 3, volume: 4, label: "12mg/4ml" },
    Lidocaine: { conc: 20, volume: 5, label: "100mg/5ml" }, Ketamine: { conc: 50, volume: 10, label: "500mg/10ml" },
    Ondansetron: { conc: 2, volume: 2, label: "4mg/2ml" }, CalciumChloride: { conc: 100, volume: 10, label: "1g/10ml" },
    Ertapenem: { conc: 312.5, volume: 3.2, label: "1g/3.2ml" }, Esmolol: { conc: 10, volume: 10, label: "100mg/10ml" },
    Dimercaprol: { conc: 100, volume: 3, label: "300mg/3ml" },
};
export const SYRINGE_SIZES = [10, 5, 3, 1];
/** Drugs with push/inject syringe actions in ACM. Dimercaprol comes in a (hidden) ampule; only IM works (no Dimercaprol_IV class). */
export const SYRINGE_DRUGS = ["Adenosine", "Amiodarone", "Atropine", "CalciumChloride", "Dimercaprol", "Epinephrine", "Ertapenem", "Esmolol", "Fentanyl", "Ketamine", "Lidocaine", "Morphine", "Ondansetron", "TXA"];
export const DRUG_NAME = { CalciumChloride: "Calcium Chloride" };
export const drugName = (d) => DRUG_NAME[d] || d;
export const vialItem = (d) => (d === "Dimercaprol" ? "ACM_Ampule_Dimercaprol" : `ACM_Vial_${d}`);

/** Dose text as ACM writes it on the log and triage card. */
export function doseText(drug, ml) {
    const mg = VIALS[drug].conc * ml;
    if (drug === "Fentanyl") return `${Math.round(mg * 1000)}mcg`;
    if (mg < 1) return `${Math.round(mg * 10) / 10}mg`;
    const r = Math.round(mg);
    return r >= 1000 ? `${r / 1000}g` : `${r}mg`;
}

/** Syringe_PrepareFinish: uses the whole vial and an empty syringe; the syringe holds the drawn amount (0.01 ml steps). */
export function drawSyringe(ctx, size, drug, ml) {
    const vial = vialItem(drug);
    if ((ctx.inventory[vial] || 0) < 1 || (ctx.inventory[`ACM_Syringe_${size}`] || 0) < 1) return { ok: false };
    const amount = Math.floor(Math.min(ml, size, VIALS[drug].volume) * 100) / 100;
    if (amount <= 0) return { ok: false };
    ctx.inventory[vial]--;
    ctx.inventory[`ACM_Syringe_${size}`]--;
    ctx.syringes ??= [];
    const s = { size, drug, ml: amount };
    ctx.syringes.push(s);
    return { ok: true, syringe: s, hint: [`${drugName(drug)} Drawn`] };
}

/** Syringe_Inject: push IV (needs IV or IO on the part) or inject IM. Returns the result for the menu. */
export function injectSyringe(sim, ctx, part, syringe, iv) {
    const { p } = sim;
    const i = PART_INDEX[part];
    if (iv && !p.ivAccess[i].some(Boolean) && !p.ioAccess[i]) {
        return { ok: false, refund: true, hint: ["Medication push failed", `Patient has no IV access on the ${({ body: "torso", leftarm: "left arm", rightarm: "right arm", leftleg: "left leg", rightleg: "right leg" })[part]}`] };
    }
    ctx.syringes.splice(ctx.syringes.indexOf(syringe), 1);
    if (sim.setting("ACM_circulation_reusableSyringe")) ctx.inventory[`ACM_Syringe_${syringe.size}`] = (ctx.inventory[`ACM_Syringe_${syringe.size}`] || 0) + 1;
    const dose = VIALS[syringe.drug].conc * syringe.ml;
    const r = addMedication(sim, part, iv ? `${syringe.drug}_IV` : syringe.drug, dose, iv);
    // IM injection hurts unless local lidocaine is in that part (unclamped linearConversion over the ml given)
    if (!iv && medicationCount(p, "Lidocaine", i) < 0.5) p.pain = Math.max(0, Math.min(1, Math.max(p.pain, lin(1, 10, syringe.ml, 0.1, 0.4, false))));
    const how = iv ? "IV" : "IM";
    const hint = [`${iv ? "Pushed" : "Injected"} ${how} ${drugName(syringe.drug)}`];
    if (r?.occluded) hint.push("No effect until tourniquet removed");
    return { ok: true, hint, log: `${iv ? "pushed" : "injected"} ${drugName(syringe.drug)} ${how} (${doseText(syringe.drug, syringe.ml)})` };
}
