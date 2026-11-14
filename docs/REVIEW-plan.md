# Trainer review and fix plan (2026-11-14)

A review of the web trainer against the ACM 1.4.8 and ACE source and artwork, with a plan for the fixes. Nothing in this document is built yet.

## Decisions

| Date | Decision |
|---|---|
| open | Body figure: use ACE's own body images (needs a GPL-2.0 licence file in this repo), or redraw the figure ourselves to look like it. See section 3.1. |
| open | Menu layout: move to ACE's three columns with the logs along the bottom, or keep the current layout. See section 3.2. |
| open | Which of the missing ACM actions to add (section 2.2). |
| open | Whether the body should show the selection outline and the L/R labels, which ACM turns off by default (section 3.4). |

## 1. What was checked

| Check | Result |
|---|---|
| Engine tests (`npm test`) | 147 pass |
| All 109 ACM setting defaults in `data/acm-1.4.8.json` against ACM's settings | all match |
| Trainer action list against ACM's and ACE's 248 configured actions | 31 not in the trainer; 12 of them are real gaps (section 2.2) |
| Show conditions, body parts, levels and times of about 45 main actions against ACM's config | 2 differences (section 2.1) |
| Body diagram code against `ACM_gui` `updateBodyImage` and `gui.hpp` | same rules; colours differ (section 2.1) |
| Every trainer page loaded in a browser, console watched | no script errors |
| Trainer screens compared with ACE's and ACM's menu artwork, converted from the mods | section 3 |

**Not checked in this pass:** the simulation modules (vitals, blood, oxygen, drugs, CPR, chest) were not compared line by line with the ACM source again. They were ported from that source and are covered by the tests, but this review does not prove they match the game. Section 4, phase 5 proposes a way to prove it. The instructor session, sign-in and written-test pages were only loaded, not exercised.

## 2. Simulation and menu findings

### 2.1 Bugs

| # | Finding | Where | Fix |
|---|---|---|---|
| B1 | A manual pressure cuff can be attached to the arm that already carries the AED's cuff. ACM blocks it (`!hasAED(part, 3)` in the Attach Pressure Cuff condition). | `engine/menu.js`, `pressurecuff_attach` | Add the AED-cuff check. |
| B2 | Body part colours are our own pink and lavender ramps. ACE uses two fixed 10-step palettes: blood loss runs pale yellow, orange, red; damage runs pale cyan to blue. | `engine/injuryList.js`, `bodyPartColors` | Copy the two palettes from ACE `medical_gui/initSettings.inc.sqf` into the data file and index them as ACE does (`ceil(fraction × 9)`). |
| B3 | Body colours for training-computer casualties use the player trauma thresholds (head 9, body 12). These casualties are AI, and ACM colours AI with the AI thresholds (4 and 7). Read from the code, not yet reproduced on screen. | same function | Use the AI thresholds when the casualty is AI. |
| B4 | Give Fentanyl Lozenge needs the casualty lying. ACM accepts lying or sitting. The trainer has no sitting state. | `engine/menu.js`, `fentanyllozenge` | Low priority: add only if a sitting posture is added. |
| B5 | Long item names are cut off in the inventory panel ("Emergency Trauma ...", "Calcium Chloride Vi..."). | `app/css/trainer.css` | Let names wrap, or show the full name on hover. |

### 2.2 ACM actions the trainer does not have

These are enabled in ACM by default and are missing from the trainer:

| Action | ACM details | Training value |
|---|---|---|
| Attempt To Shake Awake | body and arms, 1.5 s, casualty not awake | part of the CLS response check |
| Attempt To Slap Awake | head, 3 s | same |
| Use Ammonia Inhalant | head, 3 s, medic by default | waking a casualty |
| Use Naloxone Spray | head, 4 s, anyone | opioid overdose; the drug itself is already modelled |
| Wrap Bruises (elastic wrap) | all parts, medic by default | bruise treatment |
| Use BVM with Oxygen (portable tank, vehicle) | head | oxygen therapy; already listed as not ported |
| Use Adenosine Autoinjector | limbs | ACE action that ACM keeps and renames |
| Stitch with sutures (3 variants) | only when ACE's surgical kit setting is "consume sutures" | low: off by default |

Also missing, and part of the ACE menu itself: the **triage card** tab and the **triage status** selector under the body (None, Minimal, Delayed, Immediate, Deceased).

Left out on purpose and fine as they are: body bags, grave, ACE's own bandage, splint, IV bag and Personal Aid Kit actions, Diagnose (hidden when advanced diagnose is on).

To confirm before building: whether ACE's Administer Painkillers action is still offered in ACM alongside Paracetamol.

## 3. Interface compared with ACE and ACM

### 3.1 Patient model

**Now:** a flat mannequin drawn in `app/js/body.js` from six simple shapes. Devices are drawn as coloured boxes and dots, airway items as text tags on the head, the tourniquet as a black bar.

**In game:** ACE draws a shaded anatomical figure. It stacks one background image and six body part images (512 × 512 each), and tints each part with the colour from B2. On top it has, per part, a selection outline, a bone image for fractures and a tourniquet image. ACM adds 43 overlay images in the same frame, one per device and site: OPA, NPA, i-gel, surgical airway (two stages), lozenge, capnograph, chest seal, AED pads, pulse oximeters, pressure cuffs, FAST1, EZ-IO on each limb, IVs at upper, middle and lower on each limb, and its own arm tourniquets. Each has a fixed colour in `gui.hpp`, which the trainer already uses.

**Can it be the same? Yes.** Every image converts cleanly with `hemtt utils paa convert`, and all of them share one 512 × 512 frame, so they stack without any positioning work. In the browser each layer is an element with the image as a CSS mask and the tint as its background colour, which is how Arma applies `colorText`. ACE's click areas are six rectangles defined in `medical_gui/gui.hpp` and can be copied as they are.

**The choice:**

| Option | Result | Cost |
|---|---|---|
| A. ACE's body images and ACM's overlays | Identical to the game | ACE is GPL-2.0. The repo must carry a GPL-2.0 licence and credit the ACE team for the artwork. The repo has no licence file today, and it already holds ACE's stringtables and a port of ACE functions, so it probably needs this licence anyway. |
| B. ACM's overlays on a figure we redraw | Devices identical, figure similar | No new licence question (ACM's team allowed copying). The redrawn figure must line up with ACM's overlays, which were made for ACE's figure. |

Recommendation: A. It is less work than B, it is exact, and the licence file is overdue.

**One thing to confirm with a screenshot from the game:** in this ACE version the first palette colour (no damage, no bleeding) is black, not white, so an unhurt part would be drawn as a dark tint over the grey background figure. An in-game screenshot of an uninjured casualty's medical menu will settle how the layers combine.

### 3.2 Layout

ACE's menu is three equal columns under a title bar that carries the patient's name:

- left: "Examine & Treatment", a row of category icons, then the action list;
- centre: the body, with the triage status button under it;
- right: "Overview", the injury list;
- along the bottom: Activity Log and Quick View side by side.

The trainer puts the injuries under the body, and the logs, guidance and inventory in the right column. The inventory, guidance, clock and speed controls are the trainer's own and need to stay, but the injuries, logs and title can sit where ACE has them, with the trainer's panels in a separate strip.

### 3.3 Icons

| Element | Now | In game | Available |
|---|---|---|---|
| Category tabs | our own line icons with text labels | ACE's seven category images (triage card, examine, bandage, medication, airway, advanced, drag), tooltip only | ACE `medical_gui/data/categories` (GPL, as in 3.1) |
| Action buttons | text, item count at the right | ACM puts the item's picture on each button (`showActionItemIcons`, on by default); the count is in the tooltip | about 45 pictures: ACM's own items in each ACM module's `ui` folder, ACE's for tourniquet, autoinjectors, surgical kit, elastic bandage |
| Tourniquet warning | none | examine, medication and IV actions on a limb with a tourniquet get a yellow tooltip | text is in ACE's stringtable |
| Pulse, blood pressure, stethoscope, AED, syringe, surgical airway windows | ACM's artwork already | same | done |

### 3.4 Defaults that differ

ACM turns off the selected-part outline (`overlayBodyPart`) and the patient side labels (`showPatientSideLabels`) by default. The trainer always shows both. They help a trainee, so keeping them is reasonable; the alternative is to make them options that default to the game's behaviour.

## 4. Plan

**Phase 0: decisions.** The four open decisions at the top.

**Phase 1: small fixes.** B1, B2, B3, B5. Tests for each. B2 changes every replay frame's colours, so the replay tests need new expected values.

**Phase 2: patient model** (option A or B).
1. A tool script converts the body images to WebP into `app/assets/` and writes a manifest: image, tint, the state that shows it.
2. `body.js` becomes a stack of masked layers driven by the manifest, with ACE's six click rectangles. The same component serves play, replay and the editor preview.
3. Checks: a test that every state in ACM's `updateBodyImage` has a layer; screenshots of five set patients compared with in-game screenshots.

**Phase 3: menu chrome.** Category icons, item pictures on action buttons, count and tourniquet-warning tooltips, title bar with the patient's name, then the layout if approved. Triage status and triage card (the card lists the treatments given, which the trainer already logs).

**Phase 4: missing actions.** Shake and slap awake, ammonia inhalant, naloxone spray, wrap bruises, adenosine autoinjector, BVM with oxygen. Each is ported from its ACM function, with a test. Then the follow-on work: guidance rules that mention them, rubrics where a scenario should use them, re-export of the guidance fixtures, and `build_cards.py` in ACM Training so the ATAK monitor stays in step.

**Phase 5: prove the simulation against the game.** The ACM Training repo already runs a dedicated server with CBA, ACE and ACM loaded. Extend that test mission to create scripted casualties (set wounds, blood volume, chest injury, arrest), apply timed treatments, and log heart rate, blood pressure, SpO2, blood volume and respiration every second. Run the same scripts in the trainer and compare the curves within a tolerance. Random rolls differ between the two, so the scripts use states that don't depend on chance, or compare ranges. This replaces reading the code side by side with a measurement, and it will also catch drift when ACM updates.

**Order and size.** Phase 1 is an hour or two. Phases 2 and 3 are the visible change and are about a session each. Phase 4 is a session. Phase 5 is the largest and can run alongside.

## 5. Open items carried over

- The scenario editor cannot create CBRN scenarios.
- The surgical airway window has only been checked by eye.
- The trainer needs a screen at least 900 px wide; phones are blocked with a notice.
- Not ported, as recorded in `ENGINE-progress.md`: nausea drugs' effect on vomiting, the ketamine screen effect, fresh whole blood.
