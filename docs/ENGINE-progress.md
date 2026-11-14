# Engine progress (handoff notes)

Status 2026-11-13: build steps 1 (engine core) and 2 (medical menu, solo practice, three Combat Lifesaver scenarios) are done; `npm test` runs 38 tests.

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
| `engine/airway.js` | handleAirway timeline (reflex loss, collapse, vomiting, blood), checkAirway, head turn, suction, recovery position, adjuncts, reset on waking |
| `engine/breathing.js` | handleChestInjury (PTX map chances), pneumothorax progression and tension, hemothorax levels and self-clotting, chest seal, NCD, check breathing, inspect chest, lung state |
| `engine/exams.js` | Feel Pulse (rate and strength per site), capillary refill, Check Response (advancedDiagnose 2), dog tag, pulse oximeter readings |
| `engine/injuryList.js` | ACM injury list (exact strings), bleed severity, body diagram colours |
| `engine/menu.js` | Action catalogue from the treatment config: categories, parts, items, training level, times, conditions, effects |
| `engine/scenario.js` | Scenario loader and timeline |
| `engine/sim.js` | `Simulation`: 1 s tick, timers, ACE state-machine events, coagulation loops, actions, snapshot, event and action logs |

Data: `data/acm-1.4.8.json` (from `tools/build_data.py`), `data/medications-1.4.8.json` (from `tools/extract_medications.py`, which reads a derapified ACM_core config: `hemtt utils config derapify`), `data/acm-strings-en.json` and `data/ace-strings-en.json` (English stringtables, for exact in-game wording).

App: `app/index.html` (scenario list), `app/play.html` + `app/js/play.js` (solo practice), `app/js/body.js` (body diagram, own drawing), `app/css/trainer.css`. Test aid: `play.html?s=<id>&autostart=1&script=action@part,...&ff=<seconds>&part=&cat=` runs actions through the button path and fast-forwards (used for headless screenshots).

## Behaviour kept as in the code (deliberate)
- Respiration effect stays 1 when RR is above target (the computed value is never assigned in updateOxygen).
- Rhythm deterioration is omitted: its time check is inverted in handleCardiacArrest and never fires.
- A CPR roll that falls during a pause ends the roll loop; resuming does not restart it (stop and start CPR again).
- Cardiac medication effects for CPR ignore dose (getMedicationEffect's concentration argument is unused).
- Fluid overload uses ACM's double-counted change terms.
- The knock-out timer (15-35 s) restores the airway reflex when it ends, so a reflex lost earlier (20-45 s) comes back; it is lost for good only when the reflex-loss timer fires last, or when airway collapse starts (4-5 min).
- Recovery position also sets head tilt (the injury list shows both lines).

## Not ported yet (next modules)
1. Breathing procedures: thoracostomy, chest tube, drainage, stethoscope window; surgical airway; ACCUVAC.
2. Nausea medication effects on vomiting (getNauseaMedicationEffects is taken as 0).
3. Overdose (onMedicationUsage, handleOverdose, isOverdosed; `sim.isOverdosed()` returns false for now) and per-drug handlers: adenosine, amiodarone ROSC rolls, calcium, naloxone, ammonia, atropine/dimercaprol (CBRN).
4. Hemolytic reaction onset (30-60 s, severity from reaction volume); `reactionSeverity` is read but never set yet.
5. IV/IO insertion success chance and complications (data.access); fractures; CBRN. (Trauma death and arrest thresholds are in `sim.criticalHit`.)
6. Simplifications to revisit: `bandage()` spreads one bandage's effectiveness by bleeding (approximates ACE findMostEffectiveWounds); clot re-opening uses only the "unstable" delay; wound size uses worstDamage 2 with no damage-type multipliers (scenarios give wounds directly).

## Next build step
Step 3 of `docs/TRAINER-design.md`: circulation procedures and windows (IV/IO with insertion chance, transfusion menu, pressure cuff and manual BP, stethoscope), plus the remaining breathing procedures. Then step 4: rubrics, scoring and debrief checks (the debrief already shows outcome, true vitals, charts and the timeline).
