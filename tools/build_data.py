"""Builds data/acm-1.4.8.json, the single source of ACM facts for the trainer, the references and the ATAK apps.

Inputs:
  ../ACM Guide/notes/01-settings.txt  (CBA settings, parsed from every ACM XEH_preInit.sqf)
  ../ACM Guide/notes/02-actions.tsv   (merged ACE + ACM treatment actions, from derapified configs)
  ../ACM Guide/notes/03-bandages.txt  (bandage effectiveness / re-opening tables)
  ../ACM Guide/notes/04-items.txt     (scope-2 ACM items with names, mass, descriptions)
  + the hand-entered constants below, each with the ACM/ACE function it comes from.

Run: python -I tools/build_data.py
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTES = ROOT.parent / "ACM Guide" / "notes"
OUT = ROOT / "data" / "acm-1.4.8.json"

SKILL = ["anyone", "medic", "doctor"]
LOCATION = ["anywhere", "vehicle", "facility", "vehicle_or_facility", "disabled"]


# ------------------------------------------------------------------ parsed inputs
NAME_FIX = {  # names the raw extraction couldn't resolve (localized via another addon's stringtable)
    "airwayCollapseChance": "Airway Collapse Chance Multiplier",
    "airwayObstructionBloodChance": "Airway Obstruction (Blood) Chance Multiplier",
    "airwayObstructionVomitChance": "Airway Obstruction (Vomit) Chance Multiplier",
    "pneumothoraxEnabled": "Enable Pneumothorax",
    "treatmentTimeWrap": "Wrap Time (unused in 1.4.8)",
    "allowWrap": "Allow Wrapping",
    "wrappedWoundReopenChance": "Wrapped Wound Reopen Chance Multiplier",
    "treatmentTimeWrappedStitch": "Wrapped Stitch Time",
    "treatmentTimeSutureStitch": "Suture Stitch Time Multiplier",
    "overlayBodyPart": "Show overlay for selected body part",
}


def parse_settings():
    out = []
    for line in (NOTES / "01-settings.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        module, var, typ, name, category, value = (line.split("|") + [""] * 6)[:6]
        entry = {"module": module, "variable": "ACM_%s_%s" % (module, var), "type": typ.lower(), "name": NAME_FIX.get(var, name),
                 "category": category or None}
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", value)]
        if typ == "CHECKBOX":
            entry["default"] = "true" in value
        elif typ == "SLIDER":
            entry.update({"min": nums[0], "max": nums[1], "default": nums[2], "percent": value.strip().endswith("true]")})
        elif typ == "LIST":
            m = re.search(r"idx=(\d+)", value)
            idx = int(m.group(1)) if m else 0
            if value.startswith("skill"):
                entry.update({"options": SKILL, "default": SKILL[idx]})
            elif value.startswith("location"):
                entry.update({"options": LOCATION, "default": LOCATION[idx]})
            else:
                entry.update({"options": [False, True], "default": bool(idx)})
        else:
            entry["default"] = ""
        out.append(entry)
    return out


def parse_actions(settings):
    by_var = {s["variable"].lower(): s for s in settings}
    out = []
    for line in (NOTES / "02-actions.tsv").read_text(encoding="utf-8").splitlines():
        cols = line.split("\t")
        if len(cols) < 11:
            continue
        cls, name, cat, items, time, medic, sel, self_, loc, consume, cond = cols[:11]
        if name.startswith("$") or name == "__EVAL" or cond.strip() == "false":
            continue

        def resolve(v, kind):
            v = v.strip()
            if re.fullmatch(r"-?\d+(\.\d+)?", v):
                return float(v) if kind == "time" else int(float(v))
            low = v.lower()
            if low in by_var:  # ACM setting
                return {"setting": by_var[low]["variable"], "default": by_var[low]["default"]}
            if low.startswith("ace_medical_treatment_") and "fnc_" not in low:
                return {"aceSetting": v}
            return {"computed": v}

        medic_v = resolve(medic, "level")
        if isinstance(medic_v, int):
            medic_v = SKILL[medic_v] if 0 <= medic_v < 3 else medic_v
        out.append({
            "class": cls, "name": name, "category": cat,
            "items": [i for i in items.split(",") if i],
            "time": resolve(time, "time"),
            "trainingLevel": medic_v,
            "bodyParts": [p.lower() for p in sel.split(",") if p],
            "selfAllowed": resolve(self_, "level") if not re.fullmatch(r"[01]", self_) else self_ == "1",
            "consumesItem": consume == "1" if re.fullmatch(r"[01]", consume) else resolve(consume, "level"),
            "conditionExcerpt": cond,  # first 160 characters of the config condition
        })
    return out


def parse_bandages():
    out, cur = {}, None
    for line in (NOTES / "03-bandages.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"== (\w+)", line)
        if m:
            cur = m.group(1)
            out[cur] = {}
            continue
        m = re.match(r"\s+(\w+)\s+(.*)", line)
        if cur and m and "|" in line:
            sizes = []
            for cell in m.group(2).split("|"):
                e, r, d = cell.strip().split("/", 2)
                if e == "None":
                    break
                lo, hi = d.split("-")
                sizes.append({"effectiveness": float(e), "reopenChance": float(r), "reopenDelay": [float(lo), float(hi)]})
            if sizes:
                out[cur][m.group(1)] = dict(zip(["minor", "medium", "large"], sizes))
    return {k: v for k, v in out.items() if v}


def parse_items():
    out = []
    for line in (NOTES / "04-items.txt").read_text(encoding="utf-8").splitlines():
        sec, cls, name, mass, count, desc = (line.split("|") + [""] * 6)[:6]
        if not name or name == "__EVAL" and not desc:
            continue
        out.append({"class": cls, "kind": sec, "name": None if name == "__EVAL" else name,
                    "mass": None if mass in ("", "None") else float(mass),
                    "count": int(count) if count.isdigit() else None, "description": desc})
    return out


# ------------------------------------------------------------------ hand-entered constants
THRESHOLDS = {
    "_source": "ACM_main/script_macros.hpp; ACE medical_engine/script_macros_medical.hpp; core/ov/handleUnitVitals",
    "bloodVolume": {"default": 6.0, "class1": 5.95, "class2": 5.1, "class3": 4.2, "class4": 3.6, "fatalBleedout": 3.0,
                    "stableVitalsMin": 5.1, "bpDropStart": 4.8, "reversibleArrest": 4.2, "asystole": 3.1,
                    "vasoconstrictionStart": 5.9, "vasoconstrictionFull": 4.5},
    "spo2": {"targetPlayer": [98.5, 99.0], "cyanosisSlight": 91, "cyanosisModerate": 82, "cyanosisSevere": 67,
             "visionEffects": 85, "unconscious": 80, "hypoxicArrest": 67, "death": 55,
             "noBreathingDecline": {"heartStopped": 0.10, "heartBeating": [0.12, 0.10], "ramp": [90, 75]}},
    "heartRate": {"restingPlayer": [75, 82], "maxPlayer": [195, 202], "fatalLow": 40, "fatalHigh": 220,
                  "criticalRecoverLow": 45, "criticalRecoverHigh": 200, "criticalExtremeLow": 10, "criticalExtremeHigh": 245},
    "map": {"fatalLow": 55, "fatalHigh": 200, "criticalRecoverLow": 60, "criticalRecoverHigh": 180,
            "criticalExtremeLow": 30, "criticalExtremeHigh": 220},
    "respiration": {"restingPlayer": [16, 20], "unconsciousBelow": 6, "checkSlowBelow": 15.9, "checkRapidAbove": 22,
                    "bvm": 10, "cpr": [20, 30], "max": 60},
    "criticalGrace": {"seconds": [15, 30], "extraBeforeArrest": 15},
    "reversibleArrestWindow": 360,
    "chest": {"tensionHemothoraxFluid": 1.2, "maxFluid": 1.5, "noBreathingFluid": 1.4},
    "bodyWeight": {"ideal": 83, "playerRange": [75, 105]},
    "platelets": {"default": 3},
    "aceConstants": {"penetrationThreshold": 0.35, "fractureDamageThreshold": 0.5, "limpingDamageThreshold": 0.3,
                     "knockOutBleedThreshold": 0.5, "ivChangePerSecond": 4.1667, "wakeUpCheckInterval": 15},
}

TRAUMA = {
    "_source": "damage/handleTrauma, handleCardiacArrestTrauma, ACM_damage XEH_preInit",
    "player": {"head": {"cardiacArrest": 8, "death": 9}, "torso": {"cardiacArrest": 11, "death": 12}},
    "ai": {"head": {"cardiacArrest": 2, "death": 4}, "torso": {"cardiacArrest": 5, "death": 7}},
}

WOUNDS = {
    "_source": "ACE medical_damage config ACE_Medical_Injuries; damage/inflictInternalBleeding; breathing/generatePTXMap",
    "types": {
        "Abrasion": {"bleeding": 0.001, "pain": 0.4},
        "Avulsion": {"bleeding": 0.1, "pain": 1.0, "limp": True, "internal": [0.2, 0.4], "chest": {"medium": [0.25, 0, 0.5, 0.2], "large": [0.5, 0.2, 2, 0.5]}},
        "Contusion": {"bleeding": 0, "pain": 0.3, "internal": [0.01, 0.1]},
        "Crush": {"bleeding": 0.05, "pain": 0.8, "limp": True, "fracture": True, "internal": [0.2, 0.3]},
        "Cut": {"bleeding": 0.01, "pain": 0.1},
        "Laceration": {"bleeding": 0.05, "pain": 0.2},
        "VelocityWound": {"bleeding": 0.2, "pain": 0.9, "limp": True, "fracture": True, "internal": [0.45, 1.0], "chest": {"medium": [0.25, 0, 0.5, 0.3], "large": [0.5, 0.5, 1, 0.9]}},
        "PunctureWound": {"bleeding": 0.05, "pain": 0.4, "limp": True, "internal": [0.3, 0.7], "chest": {"medium": [0.25, 0, 0.5, 0.25], "large": [0.5, 0.3, 1, 0.8]}},
        "ThermalBurn": {"bleeding": 0, "pain": 0.7},
        "ChemicalBurn": {"bleeding": 0, "pain": 0.8},
    },
    "_internal": "chance for [medium, large]; + lin(partDamage 2..4 -> 0..0.5) capped 0.8; x setting internalBleedingChanceMultiplier",
    "_chest": "[minDamage, minChance, maxDamage, maxChance] linear; x chestInjuryChance; hemothoraxChance (0.2) picks HTX",
    "internalBleedShareByPart": {"head": 0.6, "torso": 0.6, "leftarm": 0.3, "rightarm": 0.3, "leftleg": 0.45, "rightleg": 0.45},
    "bandageTime": {"_source": "damage/getBandageTime", "perWound": [4, 6, 8], "cap": 8, "etdMin": 10,
                    "medic": -2, "self": 4, "perExtraWound": -2, "min": 2.25},
}

ACCESS = {
    "_source": "circulation/getIVFlowRate, setIV, setIVComplication, ACM_main/script_macros.hpp",
    "devices": {
        "IV_16g": {"flow": 1.0, "sites": 3, "limbs": True, "insertTime": 6},
        "IV_14g": {"flow": 1.5, "sites": 3, "limbs": True, "insertTime": 8},
        "IO_EZ": {"flow": 0.55, "limbs": True, "insertTime": 4, "pain": 0.31},
        "IO_FAST1": {"flow": 0.65, "torso": True, "insertTime": 4, "pain": 0.31},
    },
    "ivSuccess": {"armSystolic": [70, 90], "legSystolic": [60, 80], "caWithCpr": {"bv": [6, 3], "chance": [0.7, 0]},
                  "caNoCpr": {"seconds": 120, "chance": [0.6, 0]}, "dead": {"seconds": 90, "chance": [0.5, 0]},
                  "tourniquetPenalty": {"seconds": 90, "penalty": [0.2, 0.9]}, "doctorBonus": 0.1, "nonMedicPenalty": 0.1},
    "complications": {"14g": {"damage": [0, 6]}, "16g": {"damage": [5, 10], "maxChance": 0.5},
                      "slowFlow": {"16gDamage": 8, "14gDamage": 3, "flow": 0.9}, "leak": {"damage": 8, "flow": 0.85, "passRatio": 0.8}},
    "fluidFactor": {"Blood": 0.8, "Plasma": 1.0, "Saline": 1.2, "FBTK": 1.2, "FreshBlood": [0.8, 1.2]},
    "cardiacArrestFlow": {"ivNoCpr": {"setting": "ACM_circulation_cardiacArrestBleedRate", "default": 0.05}, "ivCpr": 0.9, "ioNoCpr": 0.9, "ioCpr": 1.0},
}

BLOOD = {
    "_source": "ACM_main/script_macros.hpp BLOODTYPE_*; circulation/isBloodTypeCompatible, generateBloodType",
    "types": ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"],
    "defaultShare": {"O+": 39, "O-": 5, "A+": 28, "A-": 3, "B+": 18, "B-": 2, "AB+": 4, "AB-": 1},
    "compatible": {"O+": ["O+", "O-"], "O-": ["O-"], "A+": ["A+", "A-", "O+", "O-"], "A-": ["A-", "O-"],
                   "B+": ["B+", "B-", "O+", "O-"], "B-": ["B-", "O-"], "AB+": ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"],
                   "AB-": ["AB-", "A-", "B-", "O-"]},
    "conversionPerSecond": {"plasma": 0.003, "saline": 0.0007, "freshBloodMultiplier": 2},
    "plasmaOxygenShare": 0.3, "plasmaPlateletsPerLitre": 1.6667,
    "transfusedBloodHrPenaltyPer50ml": 1,
    "calcium": {"minDose": 900, "unitsPerGram": 2, "firstDoseBonus": 0.5, "clearancePerUnitPerSecond": 0.005},
    "hemolytic": {"delay": [30, 60], "severityVolume": [0.1, 1.0], "severityRange": [1, 10],
                  "perSeverity": {"hr": 15, "rr": -5, "resistance": -15, "breathing": -0.05, "painMin": 0.07}, "clearPerSecond": 0.00125},
}

# Drugs: ACM_core/ACM_Medication.hpp (Medications, Concentration), core/ov/medicationLocal, circulation handlers.
# time = [onset, plateau, totalInSystem] seconds for a full dose; doses in "unit".
DRUGS = {
    "Epinephrine": {"unit": "mg", "concentration": 1, "vial": "ACM_Vial_Epinephrine", "type": "Epinephrine",
        "IV": {"full": 1, "time": [5, 180, 300], "hr": [10, 20], "rr": [2, 8], "breathing": [0.01, 0.04], "unstable": 4, "cprFactor": 1.8},
        "IM": {"full": 0.3, "time": [30, 240, 360], "hr": [2, 10], "rr": [1, 6], "breathing": [0, 0.01], "unstable": 6, "autoinjector": "ACE_epinephrine"}},
    "Adenosine": {"unit": "mg", "concentration": 3, "vial": "ACM_Vial_Adenosine",
        "IV": {"full": 6, "time": [60, 25, 100], "hr": [-5, -24], "unstable": 2, "special": "induces asystole above 0.9 count; restarts in target rhythm below 0.5 (VT->sinus)"}},
    "Amiodarone": {"unit": "mg", "concentration": 50, "vial": "ACM_Vial_Amiodarone", "type": "Amiodarone",
        "IV": {"full": 150, "time": [10, 480, 720], "hr": [-5, -10], "max": 2200, "dev": 200, "unstable": 900,
               "special": "in VF/pVT every 12-16 s chance 0.4 (VF) / 0.5 (pVT) x (count/2)/0.9 of ROSC; adds to CPR medication factor"}},
    "Atropine": {"unit": "mg", "concentration": 1, "vial": "ACM_Vial_Atropine", "type": "Atropine",
        "IV": {"full": 1, "time": [5, 600, 900], "hr": [10, 30], "rr": [2, 8], "breathing": [0.01, 0.04], "max": 20, "dev": 2, "unstable": 10, "belowOneMg": {"hr": [-18, 0]}},
        "IM": {"full": 2, "time": [30, 600, 900], "hr": [8, 15], "rr": [1, 4], "breathing": [0, 0.01], "max": 20, "dev": 2, "unstable": 12, "belowOneMg": {"hr": [-10, 0]}, "autoinjector": "ACM_Autoinjector_ATNA"},
        "special": "count>=3: sarin buildup -2*count/3 per 20-30 s (half in CA), spasm mitigated; count>=4: may clear spasm"},
    "Lidocaine": {"unit": "mg", "concentration": 20, "vial": "ACM_Vial_Lidocaine",
        "IV": {"full": 83, "time": [5, 360, 600], "hr": [-2, -10], "max": 270, "dev": 50, "unstable": 240, "type": "Lidocaine"},
        "IM": {"full": 100, "time": [10, 240, 600], "max": 200, "dev": 50, "local": True,
               "special": "local anesthetic per body part: IO pain (0.24 count -> 95 %), thoracostomy/realignment (>=0.7 none, <0.5 conscious knocked out for thoracostomy), IM injection pain (<0.5)"}},
    "TXA": {"unit": "mg", "concentration": 100, "vial": "ACM_Vial_TXA", "type": "TXA",
        "IV": {"full": 1000, "time": [15, 600, 900], "special": "bleeding x lin(0.5..2 count): ext ->0.9, internal/capillary ->0.85, hemothorax ->0.8; platelet loss x0.9; recovery x2; starts clotting loops"}},
    "Morphine": {"unit": "mg", "concentration": 5, "vial": "ACM_Vial_Morphine", "type": "Opioid", "weightBased": True,
        "IV": {"full": 8.3, "min": 4.15, "time": [25, 900, 1300], "pain": [0.6, 0.85], "painMax": 1, "hr": [-4, -10], "co2": [-0.04, -0.08], "max": 12, "dev": 3, "unstable": 10, "cprFactor": -0.6},
        "IM": {"full": 8.3, "min": 5.83, "time": [100, 1200, 1800], "pain": [0.5, 0.9], "painMax": 0.95, "hr": [-2, -6], "co2": [-0.06, -0.07], "max": 14, "dev": 3, "unstable": 15, "autoinjector": "ACE_morphine", "autoinjectorDose": 5, "cprFactor": -0.3}},
    "Fentanyl": {"unit": "mcg", "concentration": 50, "vial": "ACM_Vial_Fentanyl", "type": "Opioid", "weightBased": True,
        "IV": {"full": 83, "min": 41.5, "time": [10, 840, 960], "pain": [0.6, 1.0], "hr": [-2, -5], "co2": [-0.06, -0.07], "breathing": [-0.01, -0.04], "max": 150, "dev": 50, "unstable": 110, "cprFactor": -0.6},
        "IM": {"full": 83, "min": 58.1, "time": [30, 900, 1200], "pain": [0.5, 0.99], "hr": [-0.5, -3], "co2": [-0.05, -0.06], "breathing": [-0.01, -0.02], "max": 180, "dev": 75, "unstable": 130, "cprFactor": -0.3},
        "BUC": {"time": [90, 600, 900], "pain": [0.25, 0.95], "hr": [-0.5, -2], "max": 2, "dev": 1, "unstable": 2, "item": "ACM_Lozenge_Fentanyl", "absorbSeconds": 180}},
    "Ketamine": {"unit": "mg", "concentration": 50, "vial": "ACM_Vial_Ketamine", "type": "Ketamine", "weightBased": True,
        "IV": {"full": 16.6, "min": 8.3, "time": [5, 540, 660], "pain": [0.5, 0.85], "hr": [-0.1, -0.5], "max": 250, "dev": 50},
        "IM": {"full": 62.25, "min": 41.5, "time": [20, 600, 900], "pain": [0.4, 0.95], "max": 500, "dev": 100}},
    "Ondansetron": {"unit": "mg", "concentration": 2, "vial": "ACM_Vial_Ondansetron",
        "IV": {"full": 4, "time": [15, 600, 720], "hr": [-0.5, -2], "max": 8, "dev": 8, "unstable": 8},
        "IM": {"full": 4, "time": [45, 720, 900], "hr": [-0.1, -2], "max": 8, "dev": 8, "unstable": 8}},
    "CalciumChloride": {"unit": "mg", "concentration": 100, "vial": "ACM_Vial_CalciumChloride",
        "IV": {"full": 1000, "time": [15, 300, 600], "hr": [1, 10], "unstable": 4000}},
    "Ertapenem": {"unit": "mg", "concentration": 312.5, "vial": "ACM_Vial_Ertapenem", "type": "Ertapenem",
        "IV": {"full": 1000, "time": [5, 600, 900]}, "IM": {"full": 1000, "time": [30, 900, 1200]},
        "special": "required (>=0.9 count) before casualty conversion when ACM_evacuation_requireAntibiotics"},
    "Esmolol": {"unit": "mg", "concentration": 10, "vial": "ACM_Vial_Esmolol", "weightBased": True,
        "IV": {"full": 41.5, "min": 20.75, "time": [20, 240, 320], "hr": [-10, -25], "unstable": 45}},
    "Midazolam": {"unit": "mg", "IM": {"full": 10, "time": [30, 900, 1200], "hr": [-1, -5], "rr": [-1, -4], "max": 30, "dev": 10, "unstable": 30, "autoinjector": "ACM_Autoinjector_Midazolam"},
        "special": "stops sarin tremors at count >= 0.95"},
    "Dimercaprol": {"unit": "mg", "concentration": 100, "vial": "ACM_Ampule_Dimercaprol",
        "IM": {"full": 249, "time": [30, 900, 1800], "hr": [10, 20], "max": 600, "dev": 50, "unstable": 500},
        "special": "lewisite buildup -8*min(count,2) per 20-30 s (half in CA); item hidden in 1.4.8"},
    "Paracetamol": {"PO": {"time": [240, 900, 3000], "pain": [0.35, 0.35], "painMax": 0.45, "weightBased": True}},
    "Penthrox": {"INHALE": {"time": [3, 90, 240], "pain": [0.5, 0.5], "painMax": 0.7, "hr": [-0.1, -0.5], "breathing": [-0.001, -0.01], "max": 5, "dev": 1}},
    "AmmoniaInhalant": {"INHALE": {"time": [3, 6, 40], "hr": [5, 25], "rr": [3, 3], "special": "wake chance lin(SpO2 80..99 -> 0.5..1) if stable vitals; 10 s cooldown"}},
    "Naloxone": {"INHALE": {"time": [3, 120, 360], "special": "removes Overdose_Opioid and all Opioid-type adjustments"}},
}

PHARMACOLOGY = {
    "_source": "core/ov/medicationLocal, onMedicationUsage, circulation/getMedicationEffect, handleOverdose, isOverdosed, getCardiacMedicationEffects",
    "concentrationRatioClamp": {"onset": [0.5, 1.1], "duration": [0.5, 1.1]},
    "imAbsorptionByBloodVolume": [4.5, 3.6, 1.0, 0.1],
    "weightScaling": "full and min doses x bodyWeight / 83 when weightBased",
    "overdoseDeviation": "random(lin(weight 75..100 -> dev/20 .. dev))",
    "overdoseEffects": {
        "Opioid": {"hr": [-10, -20], "rr": [-40, -50], "co2": [-0.9, -1.0], "breathing": [-0.01, -0.1], "time": [60, 240, 360]},
        "Penthrox": {"hr": [-10, -20], "rr": [-40, -50], "co2": [-0.9, -1.0], "breathing": [-0.01, -0.1], "time": [30, 120, 300]},
        "Ketamine": {"hr": [-20, -40], "co2": [-0.9, -1.0], "breathing": [-0.01, -0.1], "time": [60, 240, 360]},
        "Lidocaine": {"hr": [-40, -50], "co2": [-0.9, -1.0], "time": [60, 240, 360]},
        "Amiodarone": {"hr": [-100, -120], "time": [60, 300, 360]},
    },
    "unstableLists": {"lastHrBelow50": ["Amiodarone_IV", "Morphine", "Morphine_IV", "Fentanyl", "Fentanyl_IV", "Fentanyl_BUC", "Midazolam", "Lidocaine_IV", "Ondansetron", "Ondansetron_IV", "Adenosine_IV", "Esmolol_IV"],
                      "lastHrAboveMax": ["Epinephrine", "Epinephrine_IV", "Atropine", "Atropine_IV", "Dimercaprol"]},
    "cprMedication": {"epinephrineIV": {"multiplier": 1.8, "cap": 2}, "amiodaroneIV": {"cap": 2}, "lidocaineIV": {"cap": 1.5},
                      "morphineIM": {"multiplier": 0.3, "cap": 0.5}, "morphineIV": {"multiplier": 0.6, "cap": 0.8},
                      "fentanylIM": {"multiplier": 0.3, "cap": 0.5}, "fentanylIV": {"multiplier": 0.6, "cap": 0.8},
                      "vfPvtRange": [1, 2.2], "asystole": "max(1, epinephrine) - opioids"},
    "tourniquetOcclusion": "drugs into a limb with a tourniquet are held until removal, except IV via IO in an arm",
}

CPR = {
    "_source": "circulation/beginCPR, handleCPR, AED_AdministerShock, handleCardiacArrest, handleReversibleCardiacArrest, attemptROSC",
    "rollInterval": 5, "minChanceToRoll": 0.1, "skill": {"doctor": 0.55, "medic": 0.4, "anyone": 0.2},
    "bloodFactor": [3.6, 5.1], "consistency": {"t0": 65, "t1": 120, "f0": 0.1, "f1": 1.0, "unclamped": True, "cap": 1.2,
                                               "previousSession": "clamp(0.5..1.5, f(prevLength) * 30 / secondsSinceStopped)"},
    "rhythmFactor": {"PVT": 0.9, "VF": 0.85, "Asystole": 1.2},
    "shockFactor": "clamp(0.8..1.7, 120 / secondsSinceLastShock)",
    "pauseEndsRolls": True,
    "asystoleSuccess": "converts to VF or PVT (50/50)",
    "rosc": "circulation OK and blood volume > 4.2",
    "aed": {"analyzeSeconds": "4 + random 4 + 4*(1 - BV/7)", "shockable": ["VF", "PVT", "VT"], "noRepeatSeconds": 60, "chargeSeconds": 4.1,
            "chargeTimeout": 30, "shockOnBeatingHeart": "asystole + cardiac arrest", "noPulseAfterShock": 60,
            "padsTime": {"default": 5, "duringCpr": 10}, "distanceLimit": {"setting": "ACM_circulation_AEDDistanceLimit", "default": 5},
            "directRosc": "only if shock-resistant (30 % per shock) and amiodarone effect > 1.9: chance = CPR(60..120 s -> 0..10) + 0.2 + 0.2*amio"},
    "rhythmEkg": {"VF": [150, 200], "PVT": [200, 240], "Asystole": 0},
    "codeNotes": ["rhythm deterioration never triggers (inverted time check)", "pausing CPR ends the 5 s roll loop until CPR is restarted"],
}

AIRWAY = {
    "_source": "airway/getAirwayState, handleAirway, handleAirwayCollapse, handleAirwayObstruction_*, getSuctionTime",
    "state": {"reflexIntact": 0.88, "reflexLost": 0.78, "collapseFactor": "1 - collapse/3", "recovery": 0.97, "headTilt": 0.98,
              "igel": 0.99, "opaNpa": 0.95, "surgical": 1.0, "surgicalUnsecured": 0.75, "obstructed": 0},
    "timeline": {"reflexLoss": [20, 45], "collapseStartAfterReflex": [240, 300], "collapseInterval": [30, 45], "collapseChance": 0.3,
                 "vomitStartAfterReflex": [60, 120], "vomitInterval": [10, 20], "vomitChance": 0.4, "vomitEpisodes": [2, 4],
                 "vomitBaseChance": 0.3, "vomitHeadDamageChance": 0.8, "bloodInterval": [5, 10], "bloodChance": [0.05, 0.5, 0, 0.5]},
    "suction": {"uncheckedSeconds": 12, "checkedWindow": 45, "perLevel": 1.25, "min": 3, "max": 8, "accuvacMax": 6},
    "knockout": [15, 35],
}

BREATHING = {
    "_source": "breathing/getBreathingState, handlePneumothorax, handleHemothorax, treatments",
    "ptx": {"maxLevel": 4, "interval": [40, 80], "chance": "40 + 15*breathingState (%) x setting", "breathingPerLevel": 0.1,
            "bpPerLevel": -8, "hrPerLevel": -5, "tension": {"breathing": 0.1, "bp": -35, "hr": -35, "deviation": [200, 300]}},
    "htx": {"startLevel": [5, 10], "maxLevel": 10, "bleedPerLevel": 0.006, "clotInterval": [10, 20], "hardcoreInterval": [15, 30],
            "clotChance": "max(0.25*platelets/4, 0.5*min(TXA,1.2))"},
    "bvm": {"squeezeInterval": 6, "firstSqueezeCounts": False, "gain": 1.3, "gainCA": 1.2, "oxygen": 1.6, "lasting": 35,
            "tank": {"item": "ACM_OxygenTank_425", "breaths": 283}},
    "ncdOnNonTension": "PTX level 3 if no chest seal",
    "chestTubeUnsealSeconds": [60, 120],
}

DISABILITY = {
    "_source": "disability/handleFracture, splintLocal, handleTourniquetEffects, core/ov/updateDamageEffects",
    "fracture": {"mild": 3, "severe": 5, "complex": 7, "refractureInterval": 30, "refractureChance": {"leg": 0.25, "arm": 0.1}, "painChance": 0.3},
    "splintFallOff": {"setting": "ACM_disability_splintFallOffTime", "default": 60, "extra": [0, 60]},
    "tourniquet": {"painAfter": 120, "painPerSecond": 0.001, "necrosisPer5s": 0.01, "recoveryPer5s": 0.1,
                   "legEffects": {"0.1": "blockSprint", "0.5": "forceWalk", "0.9": "limp"}},
    "wake": {"shake": [90, 99, 0.3, 0.7], "slap": [80, 99, 0.05, 0.4], "ammonia": [80, 99, 0.5, 1.0]},
}

CBRN = {
    "_source": "ACM_cbrn/ACM_CBRN_Hazards.hpp, initHazardUnit, effect*.sqf",
    "agents": {
        "CS": {"inhale": 0.5, "skin": 0, "elim": -0.5, "thresholds": [0, 50], "pos": [1, 0.5], "neg": [1, 1]},
        "Chlorine": {"inhale": 1, "skin": 0.35, "elim": -0.25, "thresholds": [0, 25, 50, 70], "pos": [1, 1, 1, 0.5], "neg": [1, 0.5, 0.3, 0.2]},
        "Sarin": {"inhale": 1.5, "skin": 0.5, "elim": -0.15, "thresholds": [0, 25, 50, 70], "pos": [1, 1, 1, 0.5], "neg": [1, 0.5, 0.25, 0.1]},
        "Lewisite": {"inhale": 1, "skin": 1.5, "elim": -0.15, "thresholds": [0, 25, 70], "pos": [1, 1, 0.5], "neg": [1, 0.5, 0.3]},
    },
    "_bands": "band = thresholds[firstIndex(>buildup) - 1]; above the last threshold the modifier is 1 (code)",
    "filterSeconds": 600, "inflammation": {"mild": 15, "serious": 40, "severe": 70}, "lungDamageMild": 20,
}


def main():
    settings = parse_settings()
    data = {
        "meta": {"acm": "1.4.8", "ace": "3.21.2", "schema": 1,
                 "credits": "Advanced Combat Medicine by Blue and the ACM team; ACE3 by the ACE team",
                 "sources": "ACM Guide/notes (code-verified extraction); constants list their source functions"},
        "thresholds": THRESHOLDS, "trauma": TRAUMA, "wounds": WOUNDS, "bandages": parse_bandages(),
        "access": ACCESS, "blood": BLOOD, "drugs": DRUGS, "pharmacology": PHARMACOLOGY, "cpr": CPR,
        "airway": AIRWAY, "breathing": BREATHING, "disability": DISABILITY, "cbrn": CBRN,
        "settings": settings, "treatments": parse_actions(settings), "items": parse_items(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote %s: %d settings, %d treatments, %d bandage types, %d items, %d drugs" % (
        OUT.name, len(settings), len(data["treatments"]), len(data["bandages"]), len(data["items"]), len(DRUGS)))


if __name__ == "__main__":
    main()
