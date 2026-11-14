# Engine progress (handoff notes)

Status 2026-11-13: build steps 1 (engine core), 2 (medical menu, solo practice, three Combat Lifesaver scenarios) 3 (circulation and chest procedures with their windows, two Combat Medic scenarios) and 4 (rubrics, scoring, debrief) are done; step 6 is done (medications with syringes and vials, overdose, drug handlers, AED and monitor, surgical airway; CM-4 hemothorax, CM-5 cardiac arrest, CM-6 surgical airway). Step 7 is done (damage types and fractures, training computer, scenario editor, replay, records and CSV; CLS-5 grenade fragments, CM-7 IED blast, CM-8 helicopter hard landing). `npm test` runs 98 tests.

## Modules
| File | Ports (ACM 1.4.8 / ACE 3.21.2) |
|---|---|
| `engine/util.js` | SQF `linearConversion`, seeded RNG (`random`, `random [a,b,c]` as triangular), body parts |
| `engine/patient.js` | Patient state (comments name the ACM/ACE variables), cardiac output, effective blood volume, MAP |
| `engine/wounds.js` | woundsHandlerBase, updateWoundBloodLoss, bandaging and re-opening, wrapping, stitching, clotting attempts, internal bleeding |
| `engine/blood.js` | core/ov/getBloodVolumeChange (compartments, platelets, TXA, IV/IO bags, incompatible blood, overload, calcium), bleed rates |
| `engine/oxygen.js` | getAirwayState, getBreathingState, updateRespirationRate, core/ov/updateOxygen |
| `engine/pharmacology.js` | medicationLocal (dose scaling), getMedicationEffect curves, getMedicationCount, per-type caps, cardiac medication effects, onMedicationUsage/handleOverdose/isOverdosed, handleMedicationEffects (TXA, calcium, adenosine, naloxone, ammonia), nausea |
| `engine/vitals.js` | handleUnitVitals, updateHeartRate, getBloodPressure, hasStableVitals, critical grace, onCardiacArrest, handleCardiacArrest, reversible arrest (PEA), attemptROSC, handleCPR rolls, AED shock, wake-up |
| `engine/airway.js` | handleAirway timeline (reflex loss, collapse, vomiting, blood), checkAirway, head turn, suction, recovery position, adjuncts, reset on waking |
| `engine/breathing.js` | handleChestInjury (PTX map chances), pneumothorax progression and tension, hemothorax levels and self-clotting, chest seal, NCD, check breathing, inspect chest, lung state, thoracostomy sweep, chest tube (and unsealing when the patient is up), drain, close incision |
| `engine/circulation.js` | setIV (success chance, complications), IO, removal with bag return, inspectIV, IV complication deterioration, bag items (ivBagLocal), transfusion menu add/remove, hemolytic reaction onset, pressure cuff, measureBP signal |
| `engine/exams.js` | Feel Pulse (rate and strength per site), capillary refill, Check Response (advancedDiagnose 2), dog tag, pulse oximeter readings |
| `engine/injuryList.js` | ACM injury list (exact strings), bleed severity, body diagram colours |
| `engine/menu.js` | Action catalogue from the treatment config: categories, parts, items, training level, times, conditions, effects |
| `engine/scenario.js` | Scenario loader and timeline |
| `engine/syringes.js` | Vial concentrations, draw (Syringe_PrepareFinish), push IV / inject IM (Syringe_Inject: needs IV/IO, IM pain, reusable syringes) |
| `engine/aed.js` | AED connections, analyze (motion detection), auto/manual charge with 30 s timeout, shock, CPR tracking prompts, NIBP, monitor refresh, EKG rate (PEA generator), EtCO2; voice prompts as `aedSound` events |
| `engine/surgicalAirway.js` | Surgical airway: dialog zones (grid units), palpation colours, incisions and their checks (vertical then horizontal, a cut off the landmark fails), steps (hook, Cric-Key, remove hook, cuff, stylet, strap), cancel/fail wounds, incision bleeding until stitched, strap and stitch actions |
| `engine/scoring.js` | Rubric engine: keyState snapshot, recorder (per-second history + treatment log `sim.menuLog`), predicates, 10 check types, scoreRun (weights, critical checks, pass mark, not-applicable checks left out) |
| `engine/runner.js` | Headless trainee session: menu actions with real durations, inventory, transfusion bags, recorder, scoring (tests; later replays and instructor re-simulation) |
| `engine/damage.js` | ACE damage types (ACE_Medical_Injuries >> damageTypes: bullet, grenade, explosive, shell, vehiclecrash, collision, falling, backblast, stab, punch), interpolatePoints with random rounding, woundsHandlerBase per hit (weighted wound selection, size/pain multipliers); ACM training computer generatePatient (severity multipliers and counts, causes per severity, AI casualty immune to instant death) |
| `engine/disability.js` | ACE fractures (wound fracture chance x fractureChance) and ACM_disability: severity (mild/severe/complex), pain and re-fracture loop, inspectForFracture (exact strings), realignment (lidocaine), SAM splint, wrap, remove (splint tracking and fall-off only when ACE fractures > 1) |
| `engine/custom.js` | Step 7 helpers: training-computer scenarios with role kits, generic rubric (random and custom scenarios), scenario validation, item catalogue, replay frames (deltas), records and CSV (formula-safe) |
| `engine/sim.js` | `Simulation`: 1 s tick, timers, ACE state-machine events, coagulation loops, actions, snapshot, event and action logs |

Data: `data/acm-1.4.8.json` (from `tools/build_data.py`), `data/medications-1.4.8.json` (from `tools/extract_medications.py`, which reads a derapified ACM_core config: `hemtt utils config derapify`), `data/acm-strings-en.json` and `data/ace-strings-en.json` (English stringtables, for exact in-game wording).

App (step 7): `app/editor.html` + `app/js/editor.js` (scenario editor: mechanism or exact wounds, chest, kit, preview with untreated outcome, save in browser, export/import `.acm-scenario.json`), `app/records.html` (records table, filters, CSV export, replays), `app/js/replay.js` (scrubber over per-second frames: body, injuries per part, true vitals, timeline), `app/js/store.js` (guarded localStorage: records, custom scenarios, last 3 replays). `play.html?random=1&sev=&cause=&role=&seed=` runs a training-computer casualty, `play.html?c=<id>` a custom one; test aids `openreplay=1` (play) and `preview=1` (editor). The body diagram draws ACE's bone icon (red fractured; blue splinted only with ACE fractures 2/3).

App: `app/js/windows-cric.js` (surgical airway window on ACM's art: tool tray, right-button palpation or palpate mode, drag to cut, step zones), `app/js/windows-med.js` (syringe draw window with ACM syringe art; AED monitor on ACM's Lifepak art with button hit areas from Defibrillator_Monitor_Dialog, canvas vitals and EKG/pleth/capnography traces; device sounds), `app/index.html` (scenario list), `app/play.html` + `app/js/play.js` (solo practice), `app/js/body.js` (body diagram, own drawing), `app/js/windows.js` (manual blood pressure, stethoscope and transfusion menu rebuilt on ACM's GUI grid with ACM art and sounds; Web Audio), `app/css/trainer.css`, `app/assets/acm/` (ACM art converted with `hemtt utils paa convert` + ffmpeg to webp/png; ACM sounds to 64 kbps mono mp3). Test aid: `play.html?s=<id>&autostart=1&script=action@part,...&ff=<seconds>&part=&cat=` runs actions through the button path and fast-forwards (used for headless screenshots).

## Rubrics
`rubrics/<scenario>.json`, generated by `tools/build_rubrics.py` (edit there and re-run, or edit the JSON). Each check has `text`, `type`, its parameters, `weight`, optional `critical`, `why` (what should have happened) and `guide` (chapter title in the ACM Combat Medic Guide). Check types are documented at `evaluateCheck` in `engine/scoring.js`. Scenarios point to their rubric with `"rubric"`. The debrief shows GO / NO-GO, the score against the pass mark, each check with its detail, and for failed checks the reason and the guide chapter; treatment times are marked on the charts.

## Behaviour kept as in the code (deliberate)
- Respiration effect stays 1 when RR is above target (the computed value is never assigned in updateOxygen).
- Rhythm deterioration is omitted: its time check is inverted in handleCardiacArrest and never fires.
- A CPR roll that falls during a pause ends the roll loop; resuming does not restart it (stop and start CPR again).
- Cardiac medication effects for CPR ignore dose (getMedicationEffect's concentration argument is unused).
- Fluid overload uses ACM's double-counted change terms.
- The knock-out timer (15-35 s) restores the airway reflex when it ends, so a reflex lost earlier (20-45 s) comes back; it is lost for good only when the reflex-loss timer fires last, or when airway collapse starts (4-5 min).
- Recovery position also sets head tilt (the injury list shows both lines).
- Amiodarone's own restart routine is registered but never dispatched (handleMedicationEffects leaves Amiodarone_IV out); it only acts through the CPR medication factor and the AED shock-resistant path. Guide corrected 2026-11-13.
- Naloxone removes Overdose_Opioid only; its removal of the "Opioid" family matches class names, so morphine/fentanyl stay. Guide corrected 2026-11-13.
- The overdose check uses the drug's current effect (near 0 right after a push) or this single dose, so several doses pushed within seconds are not added up.
- IM classes without config (e.g. IM TXA) have no effect.
- A patient treated while unconscious with an ACM_rollToBack action (check airway/breathing, CPR, IV, pads, cuff...) stays lying after waking; a chest tube unseals 60-120 s after a patient who is not lying wakes.
- Surgical airway: a failed attempt keeps its incision count, so the incisions keep bleeding, and they can only be stitched once an airway is established (canStitchAirwayIncision needs the surgical airway). A patient with a surgical airway cannot wake. The strap loop that should loosen unsecured tubes never runs.
- Surgical kits are not consumed by stitching (ACE consumeSurgicalKit default 0); fixed in the catalogue, which had treated setting-based consumption as always consuming.
- CPR stops when a dialog opens in game, so the AED monitor and syringe windows are blocked during CPR (stop compressions to use them).
- Bags on one IV site split its flow by the number of different fluid types (updateActiveFluidBags), so two saline bags on one site both run at full rate.
- A thoracostomy without local lidocaine (>= 0.5 in the torso) knocks the patient unconscious; the sweep report uses ACM's strings.
- A chest seal on an open pneumothorax sets it to 0 and stops progression, so an early seal prevents tension entirely.
- Training-computer casualties are AI (AI trauma thresholds, AI stay-down chance 1: they stay unconscious until revived) and immune to instant trauma death, as in ACM. They start unconscious (generatePatient calls criticalVitals first).
- Replay is frame-based (what the trainee saw, second by second), not re-simulation: windows (AED, cric, transfusion) mutate state outside the menu path, so an input log would not reproduce every run. The runner can re-simulate menu-only runs deterministically from seed + actions (used by the tests).
- Hemothorax keeps bleeding into the chest while platelets last; without TXA a level 5-10 hemothorax is not survivable in a 10-minute scenario (hence CM-3 is tension-only until TXA/syringes exist).

## Not ported yet (next modules)
2. Nausea medication effects on vomiting (getNauseaMedicationEffects is taken as 0).
3. Fentanyl lozenge, ketamine screen effect, atropine/dimercaprol (CBRN), fresh whole blood, BVM oxygen sources.
5. Fresh whole blood (FBTK); BVM with oxygen sources; CBRN. (Trauma death and arrest thresholds are in `sim.criticalHit`.)
6. Simplifications to revisit: `bandage()` spreads one bandage's effectiveness by bleeding (approximates ACE findMostEffectiveWounds); clot re-opening uses only the "unstable" delay; scenarios with `type` wounds skip the damage-type multipliers (use `mechanism` for the in-game roll).

## Next build step
Step 5 of `docs/TRAINER-design.md`: Firebase sessions (instructor creates a session, trainees join with a code, live dashboard, commands, stored results). Needs the user's `firebase-tools login` (rules deploy) and the Cloudflare Worker for Discord sign-in (`wrangler login`). Steps 6 and 7 are done; after step 5 come step 8 (guidance rules and hints) and step 9 (CBRN, Advanced Medic scenarios).
