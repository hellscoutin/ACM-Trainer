"""Writes rubrics/*.json for the built-in scenarios and links each scenario to its rubric.

Rubrics are data: see engine/scoring.js for the check types. Edit here (or the JSON directly) and re-run:
    python tools/build_rubrics.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANDAGES = ["fielddressing", "packingbandage", "elasticbandage", "quikclot", "pressurebandage", "emergencytraumadressing"]
IVIO = [f"insertiv_{g}_{s}" for g in ("16", "14") for s in ("upper", "middle", "lower")] + ["insertio_fast1", "insertio_ez"]
SIZES = (10, 5, 3, 1)
def push(drug): return [f"{drug}_{n}_iv" for n in SIZES]


def P(field, op, value):
    return {"field": field, "op": op, "value": value}


ALIVE = P("alive", "==", True)

RUBRICS = {
    "cls1-leg-hemorrhage": {"passMark": 0.7, "checks": [
        {"id": "tq-fast", "text": "Tourniquet on the bleeding leg within 30 s", "type": "action-within", "actions": ["applytourniquet"], "parts": ["leftleg"], "within": 30, "weight": 3, "critical": True,
         "why": "A large velocity wound to the thigh bleeds out in about 4 minutes. A tourniquet takes 7 s and stops limb bleeding at once; apply it before anything else.", "guide": "External bleeding"},
        {"id": "tq-first", "text": "Tourniquet before dressings on that leg", "type": "action-order", "first": ["applytourniquet"], "then": BANDAGES, "parts": ["leftleg"], "weight": 1,
         "why": "Massive limb bleeding first gets a tourniquet; dressings come after the bleeding is stopped.", "guide": "External bleeding"},
        {"id": "bleed-controlled", "text": "All external bleeding stopped within 90 s", "type": "state-within", "state": P("woundBleeding", "==", 0), "within": 90, "weight": 2,
         "why": "Bandage the forearm too: every open wound keeps draining blood volume and platelets.", "guide": "External bleeding"},
        {"id": "pain", "text": "Pain treated", "type": "action-done", "actions": ["paracetamol", "penthrox", "morphine"], "weight": 1,
         "why": "Once bleeding is controlled, treat pain: an awake casualty in severe pain stays tachycardic.", "guide": "Pain and consciousness"},
        {"id": "no-tq-off", "text": "Tourniquet not removed while the wound still bleeds", "type": "action-forbidden", "actions": ["removetourniquet"], "parts": ["leftleg"], "when": P("bleeding_leftleg", ">", 0), "weight": 1,
         "why": "Taking the tourniquet off an unbandaged wound restarts the bleed. A combat lifesaver leaves it on for the medic.", "guide": "External bleeding"},
        {"id": "alive", "text": "Casualty alive at handover", "type": "end-state", "state": ALIVE, "weight": 2, "critical": True,
         "why": "The casualty must survive to handover.", "guide": "The patient model"},
    ]},
    "cls2-unconscious-airway": {"passMark": 0.7, "checks": [
        {"id": "assess", "text": "Response, breathing or airway checked within 60 s", "type": "action-within", "actions": ["checkresponse", "checkbreathing", "checkairway"], "within": 60, "weight": 1,
         "why": "Start with a quick assessment: response, then airway and breathing.", "guide": "Assessment"},
        {"id": "bleed", "text": "Arm bleeding stopped within 2 minutes", "type": "state-within", "state": P("bleeding_leftarm", "==", 0), "within": 120, "weight": 2,
         "why": "Even small bleeds add up; a pressure bandage on the arm takes seconds.", "guide": "External bleeding"},
        {"id": "recovery", "text": "Recovery position before the first vomit", "type": "action-before-event", "actions": ["recoveryposition"], "event": "vomit", "weight": 3, "critical": True,
         "why": "A head injury makes vomiting likely 1.5-3 minutes after going down. In the recovery position vomit does not obstruct, and it holds the airway open against collapse.", "guide": "How airways fail"},
        {"id": "blocked", "text": "Airway blocked for no more than 30 s in total", "type": "state-duration-max", "state": P("airwayBlocked", "==", True), "max": 30, "weight": 2,
         "why": "An obstructed airway means no breathing at all. Head turning clears a light obstruction; suction clears any.", "guide": "Airway management"},
        {"id": "hypoxia", "text": "SpO2 below 80 % for no more than 60 s", "type": "state-duration-max", "state": {"all": [ALIVE, P("spo2", "<", 80)]}, "max": 60, "weight": 2,
         "why": "An unconscious casualty without airway support loses the reflex, then the airway collapses; with no breathing SpO2 falls about 0.1 %/s.", "guide": "How airways fail"},
        {"id": "breathing", "text": "Casualty alive and breathing at the end", "type": "end-state", "state": {"all": [ALIVE, P("rr", ">", 0)]}, "weight": 2, "critical": True,
         "why": "The airway must be open at handover.", "guide": "Airway management"},
    ]},
    "cls3-chest-gunshot": {"passMark": 0.7, "checks": [
        {"id": "seal-fast", "text": "Chest seal within 60 s", "type": "action-within", "actions": ["applychestseal"], "within": 60, "weight": 3,
         "why": "A chest seal resets an open pneumothorax and stops it getting worse. Every minute without it risks tension.", "guide": "Chest treatment"},
        {"id": "seal-before-tension", "text": "Chest sealed before tension pneumothorax", "type": "action-before-event", "actions": ["applychestseal"], "event": "tensionPneumothorax", "weight": 2, "critical": True,
         "why": "Once the pneumothorax reaches tension a seal no longer fixes it, and a combat lifesaver cannot decompress.", "guide": "Chest injuries"},
        {"id": "leg", "text": "Leg bleeding stopped within 2 minutes", "type": "state-within", "state": P("bleeding_rightleg", "==", 0), "within": 120, "weight": 2,
         "why": "Bandage the leg once the chest is sealed.", "guide": "External bleeding"},
        {"id": "monitor", "text": "Breathing checked or pulse oximeter placed", "type": "action-done", "actions": ["checkbreathing", "placepulseoximeter"], "weight": 1,
         "why": "Reassess breathing after the seal; a pulse oximeter shows SpO2 recovering.", "guide": "Assessing breathing"},
        {"id": "spo2-end", "text": "SpO2 above 90 % at the end", "type": "end-state", "state": P("spo2", ">", 90), "weight": 2,
         "why": "With the seal on and the pneumothorax at 0, oxygen recovers within minutes.", "guide": "Ventilation and oxygen"},
        {"id": "alive", "text": "Casualty alive at the end", "type": "end-state", "state": ALIVE, "weight": 2, "critical": True,
         "why": "The casualty must survive.", "guide": "Chest injuries"},
    ]},
    "cm1-hemorrhagic-shock": {"passMark": 0.75, "checks": [
        {"id": "tq-fast", "text": "Tourniquet on the leg within 30 s", "type": "action-within", "actions": ["applytourniquet"], "parts": ["leftleg"], "within": 30, "weight": 3, "critical": True,
         "why": "He has already lost 1.5 L. Stop the bleeding before anything else.", "guide": "External bleeding"},
        {"id": "access", "text": "IV or IO access within 2 minutes", "type": "action-within", "actions": IVIO, "within": 120, "weight": 2,
         "why": "IV success falls with blood pressure (arm: none below 70 systolic). Get access early, or go to the IO, which always succeeds.", "guide": "IV and IO access"},
        {"id": "blood", "text": "Compatible blood started within 3 minutes", "type": "event-within", "event": "bagAdded", "match": {"type": "Blood", "compatible": True}, "within": 180, "weight": 3,
         "why": "Blood restores oxygen-carrying volume directly; saline only converts slowly (0.7 ml/s). O- is safe for any recipient.", "guide": "Fluids and blood"},
        {"id": "no-reaction", "text": "No incompatible blood given", "type": "event-never", "event": "bagAdded", "match": {"compatible": False}, "weight": 2, "critical": True,
         "why": "Check the dog tag before giving typed blood: incompatible blood causes a hemolytic reaction and only counts as saline.", "guide": "Fluids and blood"},
        {"id": "bp", "text": "Blood pressure measured", "type": "action-done", "actions": ["measurebloodpressure", "measurebloodpressurestethoscope"], "weight": 1,
         "why": "Measure blood pressure to judge shock and the response to fluids.", "guide": "Assessment"},
        {"id": "dressing", "text": "Leg wounds dressed", "type": "action-done", "actions": BANDAGES, "parts": ["leftleg"], "weight": 1,
         "why": "Dress the wounds under the tourniquet so it can come off later.", "guide": "External bleeding"},
        {"id": "bv", "text": "Blood volume at least 5.1 L at the end", "type": "end-state", "state": P("bloodVolume", ">=", 5.1), "weight": 3,
         "why": "Below 5.1 L a casualty cannot wake up, whatever else you do.", "guide": "The patient model"},
        {"id": "alive", "text": "Casualty alive at the end", "type": "end-state", "state": ALIVE, "weight": 2, "critical": True,
         "why": "The casualty must survive.", "guide": "The patient model"},
    ]},
    "cm2-tension-chest": {"passMark": 0.75, "checks": [
        {"id": "assess", "text": "Breathing assessed within 90 s (check, inspect, stethoscope)", "type": "action-within", "actions": ["checkbreathing", "inspectchest", "usestethoscope"], "within": 90, "weight": 1,
         "why": "Shallow breathing and uneven chest rise point to a pneumothorax; dull breath sounds on one side to tension or blood.", "guide": "Assessing breathing"},
        {"id": "seal", "text": "Chest seal within 60 s", "type": "action-within", "actions": ["applychestseal"], "within": 60, "weight": 3,
         "why": "Sealing early resets the pneumothorax and prevents tension altogether.", "guide": "Chest treatment"},
        {"id": "decompress", "text": "Tension relieved within 60 s of developing", "type": "state-within", "from": {"event": "tensionPneumothorax"}, "state": P("tensionPtx", "==", False), "within": 60, "weight": 3, "critical": True,
         "why": "Tension pneumothorax stops circulation (reversible arrest). Needle decompression or thoracostomy relieves it at once.", "guide": "Chest treatment"},
        {"id": "no-ncd", "text": "No needle decompression without tension", "type": "action-forbidden", "actions": ["performncd"], "when": P("tensionPtx", "==", False), "weight": 2,
         "why": "In ACM a decompression on a chest without tension sets the pneumothorax to level 3 (worse) unless a seal is on.", "guide": "Chest treatment"},
        {"id": "hypoxia", "text": "SpO2 below 80 % for no more than 90 s", "type": "state-duration-max", "state": {"all": [ALIVE, P("spo2", "<", 80)]}, "max": 90, "weight": 2,
         "why": "Support airway and ventilation (recovery position or adjuncts, BVM) while the chest is fixed.", "guide": "Ventilation and oxygen"},
        {"id": "spo2-end", "text": "SpO2 above 90 % at the end", "type": "end-state", "state": P("spo2", ">", 90), "weight": 2,
         "why": "Oxygen should recover once the chest is treated.", "guide": "Ventilation and oxygen"},
        {"id": "alive", "text": "Casualty alive at the end", "type": "end-state", "state": ALIVE, "weight": 2, "critical": True,
         "why": "The casualty must survive.", "guide": "Chest injuries"},
    ]},
    "cm4-hemothorax": {"passMark": 0.75, "checks": [
        {"id": "seal", "text": "Chest seal within 60 s", "type": "action-within", "actions": ["applychestseal"], "within": 60, "weight": 2,
         "why": "Seal the open chest wound first; it resets the pneumothorax.", "guide": "Chest treatment"},
        {"id": "txa", "text": "TXA IV within 3 minutes", "type": "action-within", "actions": push("txa"), "within": 180, "weight": 3, "critical": True,
         "why": "A level 5-10 hemothorax keeps bleeding while platelets last. TXA (1 g IV) raises the self-clotting chance to about 50 % per check and clears 2-3 levels at a time.", "guide": "Internal bleeding, platelets and TXA"},
        {"id": "thoracostomy", "text": "Thoracostomy and chest tube placed", "type": "action-done", "actions": ["insertchesttube"], "weight": 2,
         "why": "Thoracostomy opens the chest; the chest tube re-seals it so the lung can work, and lets you drain the blood.", "guide": "Chest treatment"},
        {"id": "drain", "text": "Pleural blood drained", "type": "action-done", "actions": ["drainfluid_accuvac", "drainfluid_suctionbag"], "weight": 2,
         "why": "Blood in the chest above 0.3 L reduces breathing; above 1.2 L it stops circulation.", "guide": "Chest treatment"},
        {"id": "no-tension-blood", "text": "Chest fluid never above 1.2 L", "type": "state-duration-max", "state": P("htxFluid", ">", 1.2), "max": 0, "weight": 2,
         "why": "Above 1.2 L of chest fluid the circulation stops (reversible arrest). Drain early and repeatedly.", "guide": "Chest injuries"},
        {"id": "spo2-end", "text": "SpO2 above 90 % at the end", "type": "end-state", "state": P("spo2", ">", 90), "weight": 2,
         "why": "With the bleeding stopped, the chest drained and the tube sealed, oxygen recovers.", "guide": "Ventilation and oxygen"},
        {"id": "alive", "text": "Casualty alive at the end", "type": "end-state", "state": ALIVE, "weight": 2, "critical": True,
         "why": "The casualty must survive.", "guide": "Chest injuries"},
    ]},
    "cm5-cardiac-arrest": {"passMark": 0.75, "checks": [
        {"id": "cpr-fast", "text": "CPR started within 30 s", "type": "action-within", "actions": ["cpr"], "within": 30, "weight": 3, "critical": True,
         "why": "Without CPR SpO2 falls about 0.1 %/s and there is no restart chance at all. Compress first, then bring the AED.", "guide": "Cardiac arrest"},
        {"id": "pads", "text": "AED pads on within 90 s", "type": "action-within", "actions": ["aed_applypads"], "within": 90, "weight": 2,
         "why": "VF is shockable. A shock multiplies the CPR success chance by up to 1.7 for about 70 s.", "guide": "Cardiac arrest"},
        {"id": "shock", "text": "Shock given", "type": "action-done", "actions": ["aed_shock"], "weight": 2,
         "why": "Analyze (stop compressions: the AED detects motion), then shock when advised and go straight back to CPR.", "guide": "Cardiac arrest"},
        {"id": "no-shock-pulse", "text": "No shock on a patient with a pulse", "type": "action-forbidden", "actions": ["aed_shock"], "when": P("cardiacArrest", "==", False), "weight": 2, "critical": True,
         "why": "A shock on a beating heart causes asystole and cardiac arrest.", "guide": "Cardiac arrest"},
        {"id": "epi", "text": "IV epinephrine given", "type": "action-done", "actions": push("epinephrine"), "weight": 2,
         "why": "Only IV epinephrine counts toward CPR success (up to x2); IM and autoinjectors do not. Use an IO if there is no IV.", "guide": "Medications"},
        {"id": "rosc", "text": "Return of circulation", "type": "event-within", "event": "rosc", "within": 900, "weight": 3,
         "why": "Continuous CPR for more than a minute, a recent shock, IV epinephrine and the best-trained compressor give the best odds.", "guide": "Cardiac arrest"},
        {"id": "spo2-end", "text": "SpO2 above 90 % at the end", "type": "end-state", "state": {"all": [ALIVE, P("spo2", ">", 90)]}, "weight": 2,
         "why": "After ROSC keep the airway open and ventilate until oxygen recovers.", "guide": "Ventilation and oxygen"},
    ]},
    "cm6-surgical-airway": {"passMark": 0.75, "checks": [
        {"id": "check", "text": "Airway checked within 60 s", "type": "action-within", "actions": ["checkairway"], "within": 60, "weight": 1,
         "why": "Check Airway reports light or full obstruction, collapse and what is in place.", "guide": "Airway management"},
        {"id": "bleed", "text": "Head bleeding stopped within 2 minutes", "type": "state-within", "state": P("bleeding_head", "==", 0), "within": 120, "weight": 2,
         "why": "Blood obstruction keeps coming while the head bleeds; bandaging the head slows it at the source.", "guide": "How airways fail"},
        {"id": "cric", "text": "Surgical airway established", "type": "action-done", "actions": ["surgicalairway_established"], "weight": 3, "critical": True,
         "why": "A surgical airway gives a full airway whatever is in the throat. It needs the landmarks: vertical cut across the membrane, then horizontal through it.", "guide": "Airway management"},
        {"id": "blocked", "text": "Airway blocked for no more than 90 s in total", "type": "state-duration-max", "state": P("airwayBlocked", "==", True), "max": 90, "weight": 2,
         "why": "With the airway blocked there is no breathing at all; clear it first (head turn, suction) and then secure it.", "guide": "Airway management"},
        {"id": "strap", "text": "Neck strap secured", "type": "action-done", "actions": ["surgicalairway_securestrap"], "weight": 1,
         "why": "Secure the strap during the procedure or afterwards from the menu.", "guide": "Airway management"},
        {"id": "stitch", "text": "Airway incision stitched", "type": "action-done", "actions": ["stitchairwayincision"], "weight": 2,
         "why": "Each incision keeps bleeding (count x 0.02 x severity, scaled by cardiac output) until stitched with the surgical kit.", "guide": "Airway management"},
        {"id": "spo2-end", "text": "SpO2 above 90 % at the end", "type": "end-state", "state": {"all": [ALIVE, P("spo2", ">", 90)]}, "weight": 2,
         "why": "Once the airway is secure, breathing restores oxygen.", "guide": "Ventilation and oxygen"},
    ]},
}


def main():
    (ROOT / "rubrics").mkdir(exist_ok=True)
    for sid, rubric in RUBRICS.items():
        (ROOT / "rubrics" / f"{sid}.json").write_text(json.dumps({"scenario": sid, **rubric}, indent=1) + "\n", encoding="utf-8")
        sp = ROOT / "scenarios" / f"{sid}.json"
        d = json.loads(sp.read_text(encoding="utf-8"))
        d["rubric"] = f"rubrics/{sid}.json"
        sp.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
    print(f"{len(RUBRICS)} rubrics written")


if __name__ == "__main__":
    main()
