# Guidance rules

`guidance.json` holds the guidance rules that drive the trainer's hints. The future ATAK patient monitor will use the same rules, so the trainer and the monitor always give the same advice. Don't edit the generated files. Edit the `RULES` list in `tools/build_guidance.py` and run:

```
python tools/build_guidance.py
```

That writes both `guidance.json` (read by the trainer) and `guidance.sqf`, the same rules as an SQF array for the ATAK monitor. `tests/step8.test.js` fails if `guidance.sqf` is out of date, or if a rule uses a field the knowledge view doesn't have.

## How a rule works

| Key | Meaning |
|---|---|
| `id` | Unique name |
| `depth` | 1 Basic, 2 Intermediate, 3 Advanced. A rule shows at its own depth and every depth above it. |
| `priority` | Lower is more urgent. Rules follow MARCH order: arrest and tension 0-9, massive bleeding 10-20, airway 24-34, breathing 35-45, circulation 44-58, fractures 59-61, monitoring 70, pain 80. |
| `when` | A predicate on the knowledge view (below). It uses the same grammar as the rubric predicates: `{field, op, value}`, `{all: [...]}`, `{any: [...]}`, `{not: p}`. |
| `text` | The recommendation. `{field}` is replaced with that field's value, and `{part}` / `{Part}` with the body part name. |
| `each` | Optional. `parts`, `limbs` or `core` (head and torso) runs the rule once per body part, with `{part}` replaced inside field names. |
| `minLevel`, `maxLevel` | Optional. Limits the rule to a trainee training level (0 anyone, 1 medic, 2 doctor). |
| `supersedes` | Optional. Rule ids that are hidden while this rule matches. For example, the Advanced arrest procedure hides "feel a pulse". |
| `dead` | `true` means the rule applies only to a dead casualty. Every other rule needs the casualty to be alive. |
| `guide` | Chapter title in the ACM Combat Medic Guide. |

**Missing values.** A field that is missing or null fails every comparison except `!=` (in SQF: `isNil` gives false). This is how "no pulse oximeter" stops `spo2 < 90` from matching.

The trainer shows the four most urgent matching rules. Ties keep the order the rules appear in the file.

## The knowledge view

Each interpreter (`engine/guidance.js` in the trainer, and the future SQF monitor) builds one flat object per evaluation. Basic contains only what a player could know without examining the casualty. Intermediate adds the results of examinations already done, with their values as they were at the time of the exam. Advanced adds the true patient state. Body-part fields exist for `head, body, leftarm, rightarm, leftleg, rightleg`.

### Basic (depth 1)

| Field | Meaning | ACM / ACE source |
|---|---|---|
| `level` | Trainee training level 0/1/2 | ACE medic class of the player |
| `alive`, `unconscious` | | `alive`, `ace_isUnconscious` |
| `cpr`, `bvm`, `headTilt`, `recoveryPosition` | Ongoing care | ACM CPR provider, BVM state, `ACM_airway_HeadTilt`, `ACM_airway_RecoveryPosition` |
| `airwayAdjunct`, `sga`, `airwayManaged` | An adjunct is in (OPA/NPA/i-gel); i-gel; any of head tilt, recovery position or adjunct | `ACM_airway_Airway_Item` (oral/nasal) |
| `chestSeal` | | `ACM_breathing_ChestSeal_State` |
| `pulseOx`, `aedPads` | Devices attached | `ACM_breathing_PulseOximeter_Attached`, AED connections |
| `hasAccess`, `bagsRunning`, `bloodBags` | Any IV/IO; number of bags running; blood bags | `ACM_circulation_IV_Placement` / `IO_Placement`, ACE IV bags |
| `bleedingAny`, `bleedSeverity` | Bleeding; 0 slow to 3 massive (-1 none) | `ace_medical_woundBleeding`, ACM `getBleedSeverity` |
| `bloodLoss` | Injury list "Lost ... blood" level 0-4 | `ace_medical_hemorrhage` |
| `inPain`, `severePain` | Conscious with perceived pain above 0.1 / 0.5 | pain minus pain suppression |
| `torsoWound` | The torso has any wound the injury list shows (open, bandaged, clotted, wrapped, stitched) | ACE wound arrays |
| `bloodTypeKnown` | Dog tag checked | |
| `spo2`, `hr`, `sys` | Device readings: pulse oximeter or AED SpO2, AED or pulse oximeter heart rate, AED cuff (or a blood pressure measured in the last 5 minutes). Null when nothing measures them. | the displayed device values |
| `since_<exam>` | Seconds since the exam was last done (1e9 = never). Exams: `checkairway, checkbreathing, inspectchest, usestethoscope, checkpulse, checkcrt, bp, checkresponse, aedanalyze`; `since_chestexam` is the most recent of breathing, inspect chest and stethoscope. | the treatment log |
| `bleeding_<part>`, `heavy_<part>` | The part bleeds (not under a tourniquet); the part loses at least 0.08 L/min (about one large bleeding wound, which the wound sizes in the injury list show) | ACE open wounds, `ace_medical_tourniquets` |
| `openWounds_<part>`, `tourniquet_<part>` | | |
| `fractured_<part>`, `splinted_<part>`, `realigned_<part>` | ACE fracture state 1 / -1; ACM realigned | `ace_medical_fractures`, `ACM_disability_Fracture_Prepared` |

### Intermediate (depth 2): examination findings

Each finding is the result of the last exam of that kind. Most expire, so the rules prompt for a re-check instead of trusting old information.

| Field | Exam | True when (at the time of the exam) | Expires |
|---|---|---|---|
| `f_obstructed`, `f_collapse` | Check Airway | vomit or blood obstruction; airway collapse with no maneuver or i-gel | 300 s |
| `f_breathing`, `f_noBreathing`, `f_shallow` | Check Breathing | its text ("None", "Rapid and shallow", ...) | 120 / 300 s |
| `f_uneven`, `f_deviation`, `f_bruising` | Inspect Chest (or stethoscope for `f_uneven`) | uneven rise and fall; tracheal deviation; extensive bruising | 600 / 300 / 600 s |
| `f_carotid`, `f_limbPulse` | Feel Pulse (head / limb) | the felt rate, 0 = nothing felt | none (rules check `since_checkpulse`) |
| `f_crt`, `f_crtSlow` | Capillary refill | its value; "~3" or ">4" | 300 s |
| `f_sys` | Measure blood pressure | systolic | none |
| `f_shockable` | AED analyze | VF or pulseless VT | 120 s |
| `f_heartSoundsAbsent` | Stethoscope | arrest | 120 s |
| `f_fx_<limb>` | Inspect for fracture | ACM fracture severity 1-3 (0 not inspected) | none |

### Advanced (depth 3): true state

`bloodVolume` (L), `internalBleeding` (L/min) and `ibRate` (ml/min), `woundBleeding`, `ptx` (0-4), `tensionPtx`, `htxFluid` (L), `chestInjury`, `rhythm` (Sinus, VF, VT, PVT, PEA, Asystole), `cardiacArrest`, `shockable` (VF or PVT), `airwayBlocked` (unconscious with airway state 0), `obstructed`, `spo2True`, `hrTrue`, `sysTrue`, `bloodType`, `txa` and `epinephrine` (active IV amounts), `hemolytic` (incompatible blood reaction running), `painLevel` (perceived pain in %).

## Facts the rules depend on (ACM 1.4.8, from the code-verified guide)

- A tension pneumothorax needs the chest seal first. An NCD without a seal resets the pneumothorax, and it starts building again. An NCD on a chest without tension sets the pneumothorax to level 3.
- Inspect Chest is only available on an unconscious casualty. For an awake casualty, use Check Breathing and the stethoscope.
- PEA is a reversible arrest: CPR never restarts it, and a shock turns it into asystole. The heart restarts by itself within 6 minutes once every cause is fixed: blood volume above 4.2 L, SpO2 above 67 %, no tension, less than 1.2 L of blood in the chest.
- Pausing CPR ends the restart rolls until CPR is started again. Below 3.1 L of blood the arrest rhythm is asystole. Below 5.1 L the casualty cannot wake up.
- Hemothorax: bruising shows above 0.5 L, tension and arrest happen above 1.2 L. Treat with TXA 1 g IV, then a thoracostomy (lidocaine first) and a chest tube.
