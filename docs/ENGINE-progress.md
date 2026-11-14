# Engine progress (handoff notes)

Status 2026-11-13: build step 1 (engine core) is done and covered by tests (`npm test`, 23 passing).

## Modules
| File | Ports (ACM 1.4.8 / ACE 3.21.2) |
|---|---|
| `engine/util.js` | SQF `linearConversion`, seeded RNG (`random`, `random [a,b,c]` as triangular), body parts |
| `engine/patient.js` | Patient state (comments name the ACM/ACE variables), cardiac output, effective blood volume, MAP |
| `engine/wounds.js` | woundsHandlerBase, updateWoundBloodLoss, bandaging and re-opening, wrapping, stitching, clotting attempts, internal bleeding |
| `engine/blood.js` | core/ov/getBloodVolumeChange (compartments, platelets, TXA, IV/IO bags, incompatible blood, overload, calcium), bleed rates |
| `engine/oxygen.js` | getAirwayState, getBreathingState, updateRespirationRate, core/ov/updateOxygen |
| `engine/pharmacology.js` | medicationLocal (dose scaling), getMedicationEffect curves, getMedicationCount, per-type caps, cardiac medication effects |
| `engine/vitals.js` | handleUnitVitals, updateHeartRate, getBloodPressure, hasStableVitals, critical grace, onCardiacArrest, handleCardiacArrest, reversible arrest (PEA), attemptROSC, handleCPR rolls, AED shock, wake-up |
| `engine/sim.js` | `Simulation`: 1 s tick, timers, ACE state-machine events, coagulation loops, actions, snapshot, event and action logs |

Data: `data/acm-1.4.8.json` (from `tools/build_data.py`) and `data/medications-1.4.8.json` (from `tools/extract_medications.py`, which reads a derapified ACM_core config: `hemtt utils config derapify`).

## Behaviour kept as in the code (deliberate)
- Respiration effect stays 1 when RR is above target (the computed value is never assigned in updateOxygen).
- Rhythm deterioration is omitted: its time check is inverted in handleCardiacArrest and never fires.
- A CPR roll that falls during a pause ends the roll loop; resuming does not restart it (stop and start CPR again).
- Cardiac medication effects for CPR ignore dose (getMedicationEffect's concentration argument is unused).
- Fluid overload uses ACM's double-counted change terms.

## Not ported yet (next modules)
1. Airway timeline: reflex loss 20-45 s after going down, collapse, vomiting, blood obstruction, suction, adjunct rules (data.airway).
2. Breathing: chest injury from torso hits, PTX progression and tension, HTX levels and self-clotting, chest seal, NCD, thoracostomy, chest tube, drain (data.breathing). State fields already exist (`ptx`, `tensionPtx`, `htxState`, `htxFluid`).
3. Overdose (onMedicationUsage, handleOverdose, isOverdosed; `sim.isOverdosed()` returns false for now) and per-drug handlers: adenosine, amiodarone ROSC rolls, calcium, naloxone, ammonia, atropine/dimercaprol (CBRN).
4. Hemolytic reaction onset (30-60 s, severity from reaction volume); `reactionSeverity` is read but never set yet.
5. IV/IO insertion success chance and complications (data.access); trauma death thresholds; fractures; CBRN.
6. Simplifications to revisit: `bandage()` spreads one bandage's effectiveness by bleeding (approximates ACE findMostEffectiveWounds); clot re-opening uses only the "unstable" delay; wound size uses worstDamage 2 with no damage-type multipliers (scenarios give wounds directly).

## Next build step
Step 2 of `docs/TRAINER-design.md`: the medical menu interface and solo practice with Combat Lifesaver scenarios. Port the airway and breathing modules above alongside, since CLS scenarios need them.
