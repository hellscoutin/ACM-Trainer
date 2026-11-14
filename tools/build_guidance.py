"""Writes rules/guidance.json (the shared guidance rules) and rules/guidance.sqf (the same rules as an SQF array for the
ATAK patient monitor). Edit the RULES list here and re-run: python tools/build_guidance.py

Rule fields:
  id, depth (1 Basic, 2 Intermediate, 3 Advanced), priority (lower is more urgent; MARCH order), when (predicate on the
  knowledge view; see rules/README.md), text ({field} fills a value, {part}/{Part} the body part), optional each
  ("parts", "limbs", "core": the rule runs once per body part with {part} substituted in field names), minLevel/maxLevel
  (trainee training level 0 anyone, 1 medic, 2 doctor), supersedes (rule ids hidden while this rule matches),
  dead (true: only for a dead casualty), guide (ACM Combat Medic Guide chapter).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def P(field, op="==", value=True):
    return {"field": field, "op": op, "value": value}


def ALL(*x): return {"all": list(x)}
def ANY(*x): return {"any": list(x)}
def NOT(x): return {"not": x}


R = []
def rule(id, depth, priority, when, text, guide, **kw):
    R.append({"id": id, "depth": depth, "priority": priority, "when": when, "text": text, "guide": guide, **kw})


# ------------------------------------------------------------------ dead
rule("dead", 1, 0, P("alive", "==", False), "The casualty has died. Move on to the next casualty.", "The patient model", dead=True)

# ------------------------------------------------------------------ Basic: what the menu shows and devices read
rule("m-tourniquet", 1, 10, ALL(P("heavy_{part}"), NOT(P("tourniquet_{part}"))), "Heavy bleeding from the {part}: apply a tourniquet high on the limb.", "External bleeding", each="limbs")
rule("m-core-heavy", 1, 12, P("heavy_{part}"), "Heavy bleeding from the {part}: dress it now (packing or emergency trauma dressing). A tourniquet cannot go here.", "External bleeding", each="core")
rule("m-bandage", 1, 20, ALL(P("bleeding_{part}"), NOT(P("heavy_{part}")), NOT(P("tourniquet_{part}"))), "The {part} is still bleeding: bandage it.", "External bleeding", each="parts")
rule("m-dress-under-tq", 1, 58, ALL(P("tourniquet_{part}"), P("openWounds_{part}")), "Tourniquet on the {part}: dress its wounds while the tourniquet holds, then consider taking it off.", "External bleeding", each="limbs")
rule("a-check", 1, 30, ALL(P("unconscious"), P("since_checkairway", ">", 120)), "Unconscious casualty: check the airway.", "Airway management")
rule("a-open", 1, 34, ALL(P("unconscious"), NOT(P("airwayManaged"))), "Keep the airway open: head tilt-chin lift, an NPA or OPA, or the recovery position.", "Airway management")
rule("r-check", 1, 40, ALL(P("unconscious"), P("since_chestexam", ">", 180)), "Check breathing and inspect the chest.", "Assessing breathing")
rule("r-check-awake", 1, 40, ALL(NOT(P("unconscious")), P("torsoWound"), P("since_chestexam", ">", 180)), "Torso wound: check breathing and listen with the stethoscope (Inspect Chest works only on an unconscious casualty).", "Assessing breathing")
rule("r-spo2-low", 1, 42, P("spo2", "<", 90), "SpO2 {spo2} %: find the cause (airway, chest, blood loss) and support breathing with the BVM if it is poor.", "Ventilation and oxygen")
rule("c-pulse", 1, 44, ALL(P("unconscious"), P("since_checkpulse", ">", 120), NOT(P("aedPads")), NOT(P("cpr"))), "Feel a pulse (carotid, at the head).", "Assessment")
rule("c-sys-low", 1, 46, P("sys", "<", 90), "Systolic {sys}: the casualty is in shock. Stop all bleeding and give blood.", "Fluids and blood")
rule("c-access", 1, 50, ALL(P("bloodLoss", ">=", 1), NOT(P("hasAccess"))), "Blood has been lost: get IV or IO access.", "IV and IO access", minLevel=1)
rule("c-dogtag", 1, 52, ALL(P("bloodLoss", ">=", 2), P("bagsRunning", "==", 0), NOT(P("bloodTypeKnown"))), "Check the dog tag for the blood type before hanging blood (O- suits anyone).", "Fluids and blood", minLevel=1)
rule("c-fluids", 1, 54, ALL(P("bloodLoss", ">=", 2), P("hasAccess"), P("bagsRunning", "==", 0)), "A lot of blood lost: hang blood (compatible type, or O-).", "Fluids and blood", minLevel=1)
rule("c-casevac", 1, 56, ALL(P("bloodLoss", ">=", 2)), "A lot of blood lost: call for a medic and keep the bleeding stopped.", "External bleeding", maxLevel=0)
rule("d-fracture", 1, 60, ALL(P("fractured_{part}"), NOT(P("splinted_{part}"))), "The {part} is fractured: splint it (a medic realigns it first).", "Fractures", each="limbs", maxLevel=0)
rule("d-fracture-medic", 1, 60, ALL(P("fractured_{part}"), NOT(P("splinted_{part}")), NOT(P("realigned_{part}"))), "The {part} is fractured: realign it (lidocaine first eases the pain), then splint it.", "Fractures", each="limbs", minLevel=1)
rule("d-splint", 1, 61, ALL(P("fractured_{part}"), P("realigned_{part}")), "The {part} is realigned: apply the SAM splint now.", "Fractures", each="limbs", minLevel=1)
rule("monitor", 1, 70, ALL(NOT(P("pulseOx")), ANY(P("unconscious"), P("bloodLoss", ">=", 1))), "Place a pulse oximeter to watch SpO2 and heart rate.", "Assessment")
rule("e-pain", 1, 80, P("inPain"), "Treat the pain: paracetamol, or morphine for severe pain.", "Pain and consciousness", maxLevel=0)
rule("e-pain-medic", 1, 80, P("inPain"), "Treat the pain: paracetamol for mild pain, a small IV morphine or fentanyl dose for severe pain (watch the total).", "Pain and consciousness", minLevel=1)

# CBRN (scene first: mask and move the casualty out of the cloud)
rule("cbrn-cloud", 1, 5, ALL(P("inCloud"), NOT(P("gasMask")), P("unconscious")), "Still in the chemical cloud: put a gas mask on the casualty and drag them out of the contaminated area first.", "Protection and antidotes")
rule("cbrn-cloud-awake", 1, 5, ALL(P("inCloud"), NOT(P("gasMask")), NOT(P("unconscious"))), "Still in the chemical cloud: drag the casualty out of the contaminated area first (you can only put a mask on an unconscious casualty).", "Protection and antidotes")
rule("cbrn-cloud-masked", 1, 6, ALL(P("inCloud"), P("gasMask")), "Still in the contaminated area: drag the casualty out (the mask filter runs down while they stay).", "Protection and antidotes")
rule("cbrn-filter", 1, 6, ALL(P("inCloud"), P("gasMask"), P("filterSpent")), "The gas mask filter is spent: replace it.", "Protection and antidotes")
rule("cbrn-atna", 1, 14, ALL(P("cbrnAgent", "==", "Sarin"), P("atropineGiven", "<", 2)), "Nerve agent: give 2-3 ATNA autoinjectors now (3 or more active doses keep breathing going; 4 or more clear the airway spasm).", "Protection and antidotes")
rule("cbrn-midazolam", 1, 65, ALL(P("cbrnAgent", "==", "Sarin"), NOT(P("midazolamGiven"))), "Nerve agent: the midazolam autoinjector stops the tremors and seizures.", "Protection and antidotes")
rule("cbrn-dimercaprol", 1, 26, ALL(P("cbrnAgent", "==", "Lewisite"), NOT(P("dimercaprolGiven"))), "Blister agent: draw the dimercaprol ampule into a syringe and inject it IM (an IV push does nothing); it removes lewisite from the body.", "Protection and antidotes", minLevel=1)
rule("cbrn-wash-eyes", 1, 75, P("canWashEyes"), "Wash the casualty's eyes with water (chlorine or lewisite above 50 makes the blindness permanent).", "Protection and antidotes")

# ------------------------------------------------------------------ Intermediate: examination findings
rule("i-no-carotid", 2, 3, ALL(P("f_carotid", "==", 0), P("since_checkpulse", "<", 120), NOT(P("cpr"))), "No carotid pulse: start CPR now and connect the AED.", "Cardiac arrest", supersedes=["c-pulse"])
rule("i-shockable", 2, 4, ALL(P("f_shockable"), P("aedPads")), "Shockable rhythm: charge and shock, then resume CPR at once for 2 minutes.", "Cardiac arrest")
rule("i-not-breathing", 2, 6, ALL(P("f_noBreathing"), NOT(P("bvm"))), "Not breathing: open the airway and ventilate with the BVM; feel for a pulse.", "Ventilation and oxygen")
rule("i-deviation", 2, 15, ALL(P("f_deviation"), P("chestSeal")), "Tracheal deviation: tension pneumothorax. Needle decompression (NCD) now.", "Chest treatment", minLevel=1)
rule("i-deviation-noseal", 2, 15, ALL(P("f_deviation"), NOT(P("chestSeal"))), "Tracheal deviation: tension pneumothorax. Chest seal first, then needle decompression (NCD); without the seal the pneumothorax builds up again.", "Chest treatment", minLevel=1)
rule("i-deviation-cls", 2, 15, P("f_deviation"), "Tracheal deviation: tension pneumothorax. Get a medic for needle decompression now.", "Chest treatment", maxLevel=0)
rule("i-obstructed", 2, 24, ALL(P("f_obstructed"), NOT(P("recoveryPosition"))), "Airway obstructed (vomit or blood): suction it or turn the head, then the recovery position.", "Airway management")
rule("i-collapse", 2, 26, ALL(P("f_collapse"), NOT(P("airwayManaged"))), "Airway collapsing: head tilt-chin lift now, then an NPA, OPA or i-gel.", "Airway management", supersedes=["a-open"])
rule("i-uneven-seal", 2, 35, ALL(P("f_uneven"), NOT(P("chestSeal")), P("torsoWound")), "Uneven chest rise: apply a chest seal, then inspect the chest again.", "Chest treatment")
rule("i-uneven-sealed", 2, 45, ALL(P("f_uneven"), P("chestSeal")), "Chest still uneven after the seal: watch for tension (tracheal deviation, worse breathing) and decompress only then; NCD on a chest without tension makes it worse.", "Chest treatment")
rule("i-bruising", 2, 38, P("f_bruising"), "Extensive chest bruising: more than 0.5 L of blood in the chest (hemothorax). TXA 1 g IV, then a thoracostomy (lidocaine first) and chest tube to drain it.", "Chest injuries", minLevel=1)
rule("i-shallow-chest", 2, 36, ALL(P("f_shallow"), P("torsoWound"), NOT(P("chestSeal"))), "Shallow breathing with a torso wound: suspect a pneumothorax. Apply a chest seal, then check breathing again.", "Chest treatment")
rule("i-shallow", 2, 41, ALL(P("f_shallow"), NOT(P("f_uneven")), ANY(NOT(P("torsoWound")), P("chestSeal"))), "Shallow breathing: check the airway and look for the cause in the chest.", "Assessing breathing")
rule("i-crt", 2, 47, ALL(P("f_crtSlow"), P("bloodBags", "==", 0)), "Capillary refill {f_crt} s: poor circulation. Stop bleeding and give blood.", "Fluids and blood", minLevel=1)
rule("i-limb-pulse", 2, 48, ALL(P("f_limbPulse", "==", 0), P("since_checkpulse", "<", 120)), "No pulse in that limb: blood pressure is very low (or a tourniquet is on). Feel the carotid.", "Assessment")
rule("i-fx-severe", 2, 59, ALL(P("f_fx_{part}", ">=", 2), NOT(P("splinted_{part}"))), "Severe fracture of the {part}: lidocaine, realign, then splint; expect it to hurt again.", "Fractures", each="limbs", minLevel=1)

rule("i-inflammation", 2, 23, ALL(P("f_inflammation", ">=", 2), NOT(P("surgicalAirway"))), "Significant airway inflammation: an i-gel will not go in. Prepare a surgical airway if breathing fails.", "Chemical agents", minLevel=1)
rule("i-inflammation-severe", 2, 9, ALL(P("f_inflammation", "==", 3), NOT(P("surgicalAirway"))), "Severe airway inflammation: the airway is closing. Surgical airway now.", "Chemical agents", minLevel=1, supersedes=["i-inflammation"])

# ------------------------------------------------------------------ Advanced: true state, exact procedures
rule("x-spasm", 3, 3, ALL(P("spasm"), P("atropine", "<", 3), NOT(P("surgicalAirway"))), "Sarin airway spasm: breathing has stopped (a BVM cannot help). Atropine to 3+ active doses to breathe, 4+ to clear the spasm; a surgical airway bypasses it.", "Chemical agents", supersedes=["i-not-breathing", "x-spo2"])
rule("x-sarin", 3, 13, ALL(P("sarin", ">=", 20), P("atropine", "<", 3)), "Sarin buildup {sarin} (airway spasm at 60): with 3 or more doses of atropine active it falls every 20-30 s.", "Protection and antidotes", supersedes=["cbrn-atna"])
rule("x-lewisite", 3, 25, ALL(P("lewisite", ">", 0), P("dimercaprol", "<", 0.5)), "Lewisite buildup {lewisite}: dimercaprol IM removes up to 16 every 20-30 s.", "Protection and antidotes", minLevel=1, supersedes=["cbrn-dimercaprol"])
rule("x-inflammation", 3, 22, ALL(P("inflammation", ">", 40), NOT(P("surgicalAirway")), P("unconscious")), "Airway inflammation {inflammation} (closes at 100, never heals): the i-gel is blocked; a surgical airway bypasses it.", "Chemical agents", supersedes=["i-inflammation"])
rule("x-lung", 3, 37, P("lungDamage", ">", 20), "Lung tissue damage {lungDamage} (permanent): breathing is weaker; support it with the BVM to keep SpO2 up.", "Chemical agents")
rule("x-capillary", 3, 31, P("capillary", ">", 20), "Capillary damage {capillary} (permanent): blood leaks from the circulation and blood pressure is up to 30 % lower. Replace the volume with blood.", "Chemical agents")

rule("x-hemolytic", 3, 1, P("hemolytic"), "Incompatible blood reaction: remove the blood bag now (transfusion menu) and switch to O- or the right type ({bloodType}).", "Fluids and blood")
ARREST_HIDES = ["c-pulse", "a-check", "r-check", "i-no-carotid", "i-not-breathing"]
rule("x-arrest-shock", 3, 2, ALL(P("cardiacArrest"), P("shockable")), "Cardiac arrest ({rhythm}, shockable): continuous CPR (pausing ends the restart rolls), AED shock, then CPR again for 2 minutes; epinephrine 1 mg IV and amiodarone IV early.", "Cardiac arrest", supersedes=ARREST_HIDES + ["i-shockable"])
rule("x-arrest-asystole", 3, 2, ALL(P("cardiacArrest"), P("rhythm", "==", "Asystole")), "Cardiac arrest (asystole): do not shock. Raise the blood volume ({bloodVolume} L; below 3.1 L causes asystole), CPR and epinephrine 1 mg IV; CPR can turn it into a shockable rhythm.", "Cardiac arrest", supersedes=ARREST_HIDES)
rule("x-arrest-pea", 3, 2, ALL(P("cardiacArrest"), P("rhythm", "==", "PEA")), "Reversible arrest (PEA): CPR will not restart it and a shock makes it asystole. Fix every cause within 6 minutes (blood volume above 4.2 L, SpO2 above 67 %, tension, more than 1.2 L of chest blood) and the heart restarts by itself.", "Cardiac arrest", supersedes=ARREST_HIDES)
rule("x-bv-critical", 3, 7, ALL(P("bloodVolume", "<", 3.6), P("cardiacArrest", "==", False)), "Blood volume {bloodVolume} L (class IV): blood now, on two lines if you can. Below 3.1 L the heart stops in asystole.", "Fluids and blood")
rule("x-tension", 3, 8, ALL(P("tensionPtx"), P("chestSeal")), "Tension pneumothorax: needle decompression (NCD) now, then check breathing again.", "Chest treatment", supersedes=["i-deviation", "i-deviation-noseal", "i-deviation-cls"])
rule("x-tension-noseal", 3, 8, ALL(P("tensionPtx"), NOT(P("chestSeal"))), "Tension pneumothorax: chest seal, then needle decompression (NCD). Without the seal the pneumothorax starts again after the NCD.", "Chest treatment", supersedes=["i-deviation", "i-deviation-noseal", "i-deviation-cls"])
rule("x-airway-closed", 3, 9, P("airwayBlocked"), "Airway closed right now: head tilt-chin lift, then an NPA/OPA or i-gel (or the recovery position).", "Airway management", supersedes=["a-open", "i-collapse"])
rule("x-obstructed", 3, 11, P("obstructed"), "Airway obstructed: suction (suction bag or ACCUVAC) or turn the head; the recovery position stops more vomit blocking it.", "Airway management", supersedes=["i-obstructed"])
rule("x-spo2", 3, 16, ALL(P("spo2True", "<", 85), P("unconscious"), NOT(P("bvm")), P("cardiacArrest", "==", False)), "True SpO2 {spo2True} %: ventilate with the BVM and treat the cause (airway, chest, blood volume).", "Ventilation and oxygen")
rule("x-ib", 3, 27, ALL(P("internalBleeding", ">", 0), P("txa", "<", 0.1)), "Internal bleeding ({ibRate} ml/min): TXA 1 g IV (the 10 ml vial in a 10 ml syringe).", "Internal bleeding, platelets and TXA")
rule("x-htx", 3, 28, P("htxFluid", ">=", 0.5), "Hemothorax: {htxFluid} L in the chest (tension and arrest above 1.2 L). TXA 1 g IV, thoracostomy (lidocaine first), chest tube, drain.", "Chest injuries", supersedes=["i-bruising"])
rule("x-bv-low", 3, 29, ALL(P("bloodVolume", "<", 5.1), P("bloodBags", "==", 0)), "Blood volume {bloodVolume} L: transfuse {bloodType} or O- blood. Below 5.1 L the casualty cannot wake up.", "Fluids and blood", supersedes=["c-fluids", "i-crt"])
rule("x-open-ptx", 3, 33, ALL(P("ptx", ">", 0), P("chestInjury"), NOT(P("chestSeal")), NOT(P("tensionPtx"))), "Open pneumothorax (level {ptx}): chest seal now; it stops the pneumothorax getting worse.", "Chest treatment", supersedes=["i-uneven-seal", "i-shallow-chest"])
rule("x-severe-pain", 3, 81, P("severePain"), "Pain {painLevel} %: it keeps the casualty from settling. Analgesia once the bleeding is controlled.", "Pain and consciousness")


def sqf(v):
    if isinstance(v, bool): return "true" if v else "false"
    if v is None: return "nil"
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, str): return '"' + v.replace('"', '""') + '"'
    if isinstance(v, list): return "[" + ",".join(sqf(x) for x in v) + "]"
    raise TypeError(v)


def pred_sqf(p):
    """Predicates as SQF arrays: ["all",[...]], ["any",[...]], ["not",p], ["cmp","field","op",value]."""
    if "all" in p: return ["all", [pred_sqf(x) for x in p["all"]]]
    if "any" in p: return ["any", [pred_sqf(x) for x in p["any"]]]
    if "not" in p: return ["not", pred_sqf(p["not"])]
    return ["cmp", p["field"], p.get("op", "=="), p["value"]]


def main():
    ids = [r["id"] for r in R]
    assert len(ids) == len(set(ids)), "duplicate rule id"
    for r in R:
        for s in r.get("supersedes", []): assert s in ids, f"{r['id']} supersedes unknown {s}"
    out = {"format": "acm-guidance-rules", "version": 1, "acm": "1.4.8", "rules": R}
    (ROOT / "rules").mkdir(exist_ok=True)
    (ROOT / "rules/guidance.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    lines = ["// Generated by tools/build_guidance.py from rules/guidance.json. Do not edit.",
             "// Each rule: [id, depth, priority, each, minLevel, maxLevel, dead, when, text, supersedes, guide]",
             "// Predicates: [\"all\",[...]] [\"any\",[...]] [\"not\",p] [\"cmp\",field,op,value]; nil field fails every cmp except \"!=\".", "["]
    rows = []
    for r in R:
        rows.append("    " + sqf([r["id"], r["depth"], r["priority"], r.get("each", ""), r.get("minLevel", -1), r.get("maxLevel", 99), bool(r.get("dead")),
                                  pred_sqf(r["when"]), r["text"], r.get("supersedes", []), r["guide"]]))
    lines.append(",\n".join(rows))
    lines.append("]")
    (ROOT / "rules/guidance.sqf").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(R)} rules written")


if __name__ == "__main__":
    main()
