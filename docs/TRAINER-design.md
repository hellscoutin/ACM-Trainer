# ACM Trainer: design

A web application that simulates ACM casualties in a browser with an interface modelled on the ACE/ACM medical menu. Used for solo practice and for instructor-led training sessions with live viewing, scenario control and stored scores.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-13 | Hosting: **GitHub Pages** (static site) + **Firebase** (real-time database, sign-in, stored scores). Trainees join with a session code; no claude.ai accounts needed. |
| 2026-11-13 | Two modes: **instructor-led sessions** (live viewing, scenario control, injects, stored scores) and **solo practice** (no instructor, local scoring, optional saved history). |
| 2026-11-13 | The interface reproduces the ACE medical menu and ACM's procedure windows. The ACM team (including Blue) allows copying ACM code and interfaces; credit ACM and ACE in the app. |
| 2026-11-13 | Simulation fidelity target: ACM 1.4.8 behaviour with default settings, as documented in the ACM Combat Medic Guide, including its code notes (for example the CPR pause behaviour). |
| 2026-11-13 | Unit-neutral. |
| 2026-11-13 | Instructor sign-in with **Discord**. Firebase Auth has no built-in Discord provider, so a small token exchange (Discord OAuth to a Firebase custom token) runs on a free Cloudflare Worker; this keeps the Firebase project on the free Spark plan (Cloud Functions would need the Blaze billing plan). |
| 2026-11-13 | Saving practice history **requires sign-in** (Discord). Without sign-in, practice works fully but nothing is kept after the page closes. |
| 2026-11-13 | **ACM's sound files may be used** (confirmed by the user under the ACM team's permission); credit ACM. |
| 2026-11-13 | Target devices: **tablets and desktops only**; phones are not supported. |
| 2026-11-13 | English only. |
| 2026-11-13 | Repository `hellscoutin/ACM-Trainer` is **public**, so GitHub Pages works on the free plan. Nothing secret is stored in it (the Firebase web config is public by design; the Discord client secret lives only in the Cloudflare Worker's encrypted settings). Firebase project: `acm-trainer`. |
| 2026-11-13 | Menu lists only actions that are possible now, as in game; a "Show unavailable actions" switch (off by default) shows the rest with the reason (fidelity first; the switch is a training aid). |
| 2026-11-13 | In solo practice the speed buttons (pause to 10x) also shorten progress bars, since they run on simulation time (one clock for everything; instructor control of this comes with sessions). |
| 2026-11-13 | Menu text uses the ACM and ACE English stringtables (`data/acm-strings-en.json`, `data/ace-strings-en.json`); body diagram is our own drawing (exact wording without copying ACE artwork). |
| 2026-11-13 | The transfusion menu moved forward from step 6 to step 3 so IV/IO access is usable; procedure windows use ACM's artwork and sounds, converted to web formats in `app/assets/acm/` (allowed under the ACM team's permission). |

## 1. Architecture

```
GitHub Pages (static)                       Firebase
┌───────────────────────────────┐          ┌──────────────────────────────┐
│ app/      UI (menu, windows)  │◄────────►│ Auth: anonymous + optional    │
│ engine/   patient simulation  │  live    │       Discord/Google sign-in  │
│ scenarios/ scenario files     │  sync    │ Firestore: sessions, events,  │
│ data/     acm-1.4.8.json      │          │   vitals snapshots, scores    │
│ rules/    guidance rules      │          │ Security rules per role       │
└───────────────────────────────┘          └──────────────────────────────┘
```

- **Static front end:** plain ES modules and Web Components, or a small framework (Preact via a pinned CDN build) if the menu's complexity warrants it. No build server needed; a GitHub Action runs tests and deploys Pages.
- **Engine runs in the trainee's browser.** It is deterministic: a seeded random number generator and a fixed 1-second simulation tick (with a separate render loop), so the same seed and the same actions replay exactly. The instructor never runs a second copy; they receive state.
- **Firebase:**
  - Auth: anonymous for trainees in a session; Discord (via the Cloudflare Worker token exchange) for instructors and for anyone saving practice history.
  - Firestore for sessions, live state and stored results.
  - The Firebase web config is public by design; security comes from the rules.

## 2. Simulation engine

A JavaScript port of ACM's patient model, organised like ACM's modules so each piece can be checked against the original SQF.

| Engine module | Ports | Source in ACM (see guide notes) |
|---|---|---|
| `vitals` | 1 s vitals loop: heart rate, blood pressure, vasoconstriction, death and arrest checks, critical grace period | core/ov/handleUnitVitals, updateHeartRate, getBloodPressure, handleCriticalVitals |
| `oxygen` | SpO2, respiration rate, BVM and oxygen effects | core/ov/updateOxygen, breathing/updateRespirationRate |
| `blood` | Blood, plasma, saline volumes, platelets, fluid overload, calcium, transfusions, blood types, hemolytic reaction, fresh blood | core/ov/getBloodVolumeChange, circulation IV/transfusion functions |
| `wounds` | Wound generation from damage, bandages and effectiveness, re-opening, clotting, wrapping, stitching, internal bleeding | core/ov/woundsHandlerBase, damage module, ACE bandage config |
| `airway` | Reflex loss, blood/vomit obstruction, collapse, maneuvers, adjuncts, suction, surgical airway | airway module |
| `breathing` | Pneumothorax, tension, hemothorax, chest treatments | breathing module |
| `circulation` | Rhythms, cardiac arrest, reversible arrest, CPR rolls, AED, IV/IO access and complications | circulation module |
| `pharmacology` | Medication effect curves, stacking caps, overdose, special drug handlers | core/ov/medicationLocal, circulation handlers |
| `disability` | Fractures, splints, tourniquet necrosis and pain, waking | disability module |
| `cbrn` | Agent buildup, effects, protection, antidotes (optional, off by default) | cbrn module |

**Engine requirements:**
- Constants come from `data/acm-1.4.8.json`, never hard-coded.
- Pure functions where possible; the patient is one state object; every treatment is an **action** with a validator (the same conditions as ACM) and an effect.
- Time controls: pause, 1×, 2×, 5×, 10× (the fixed tick runs faster; random results stay seeded).
- Hidden state (blood volume, platelets, rhythm and so on) is never shown to the trainee unless an examination or monitor would reveal it, exactly as in game.
- Unit tests per module against values computed from the ACM formulas (for example the CPR chance table and SpO2 decline used in the guide's charts).

## 3. User interface

The interface reproduces the in-game layout.

- **Medical menu:**
  - body diagram (head, torso, arms, legs) with bleeding and fracture overlays;
  - category tabs (Examine, Bandage, Medication, Airway, Advanced, Drag);
  - action list with item icons and greyed-out unavailable actions (reason shown);
  - injury list with ACM status lines;
  - triage card;
  - activity and quick-view logs.
- **Progress bars** with the real treatment times (shortened by the time controls in practice mode only if the instructor allows it).
- **Procedure windows:**
  - Feel Pulse (beating heart icon)
  - stethoscope (drag the bell, real breath and heart sounds)
  - manual blood pressure (bulb and valve)
  - syringe preparation
  - transfusion menu
  - AED monitor (EKG, SpO2, NIBP, CO2, buttons, voice prompts)
  - surgical airway (palpate, cut, tools)
  - CPR and BVM controls (mouse buttons as in game)
- **Patient view:** a simple 3D-free illustration of the casualty (lying, recovery position, splints and devices drawn on), plus sound cues (vomiting, breathing, AED voice).
- **Inventory:** the trainee's loadout from the scenario (item counts, used items consumed), plus the patient's and a vehicle's inventory where the scenario provides one.
- **Devices:** tablets (landscape, touch: every mouse-button control has a touch equivalent) and desktops (keyboard operation of every action). Phones are not supported; the site shows a notice below 900 px.

## 4. Scenarios

Scenario files (JSON in `scenarios/`, versioned in the repo) define:

```json
{
  "id": "cm3-tension-ptx",
  "title": "Tension pneumothorax after a gunshot",
  "track": "combat-medic", "module": "CM-3",
  "seed": 1842,
  "patient": { "weight": 83, "bloodType": "A+", "conscious": true },
  "injuries": [ { "part": "body", "type": "VelocityWound", "size": "large", "chest": "pneumothorax", "level": 3 } ],
  "loadout": { "ACM_ChestSeal": 1, "ACM_NCDKit": 1, "ACM_BVM": 1, "ACM_PulseOximeter": 1 },
  "settings": { "pneumothoraxDeteriorateChance": 1 },
  "timeline": [ { "at": 60, "event": "ptx_deteriorate" } ],
  "objectives": [ "chest seal before tension", "NCD within 60 s of tension", "SpO2 above 90 % at end" ],
  "rubric": "rubrics/cm3.json",
  "timeLimit": 600
}
```

- **Library:** scenarios for every module of the three tracks, plus random patient generation matching ACM's training computer (Routine, Priority, Immediate, Expectant; gunshot, shrapnel, explosion, collision, falling, backblast).
- **Scenario editor:** instructors create and edit scenarios in the app; saved to Firestore (shared) and exportable as JSON for the repo.

## 5. Sessions

### 5.1 Instructor-led

1. The instructor signs in and creates a **session**: picks scenarios (one for all, or one per trainee), settings, time controls allowed, and whether hints are on.
2. Trainees open the site, enter the **session code** and a display name. No account needed.
3. **Live dashboard** for the instructor:
   - a grid of trainee tiles (patient status, vitals, current action, elapsed time, alerts such as "no pulse");
   - click a tile to open that trainee's full view, a read-only mirror of their menu plus the hidden patient state.
4. **Controls:**
   - start, pause and resume all or one trainee;
   - time acceleration;
   - injects ("vomits now", "new hit to the chest", "tourniquet slipped", "patient wakes");
   - change a value (blood volume, SpO2) like a Zeus module;
   - end the scenario.
5. **Messaging:** short instructor-to-trainee messages shown as an in-app notice.
6. **End:** each run is scored and stored; the instructor sees a session summary and can run a group debrief with replay.

**Live data flow:**
- The trainee client writes its **action log** (every action, with simulation time) and a **vitals snapshot** every 2 s to `sessions/{id}/runs/{runId}`.
- The instructor subscribes to these.
- Instructor commands go to `sessions/{id}/commands`, which trainee clients subscribe to and apply at the next tick, logged in the action log so replays include them.

### 5.2 Solo practice

- Pick a track, module and scenario (or random), then play.
- Hints optional, driven by the shared guidance rules at a chosen depth (the same rules as the future ATAK patient monitor).
- Scored locally at the end with the same rubric.
- Saving history requires Discord sign-in; without it, results show at the end and are not kept.
- Works offline once loaded (service worker), except for saving.

## 6. Scoring and debrief

- **Rubric:** a list of checks per scenario.
  - Each check is a condition on the action log and state history: "tourniquet applied within 30 s of the first heavy bleed", "no NCD on a patient without tension", "CPR not paused for more than 5 s".
  - Each check has a weight and a critical flag; a critical fail is an automatic no-go.
- **Outcome measures:** patient alive, time to key interventions, blood volume and SpO2 at the end, items used.
- **Debrief view:**
  - timeline of actions against the vitals chart;
  - each failed check with what should have happened and a link to the guide chapter;
  - a replay: scrub through the run second by second (body, injuries, true vitals, timeline). Built in step 7 from recorded frames, because procedure windows change state outside the menu path; re-simulation from seed and action log stays the tamper check for menu actions.
- **Records:** per trainee, per track (passed modules, scores, dates). Exportable as CSV for the unit's own records. Until step 5 (sign-in) they are kept in the browser (localStorage, last 3 replays).

## 7. Data model (Firestore)

| Path | Contents | Who writes |
|---|---|---|
| `scenarios/{id}` | Shared scenario definitions | Instructors |
| `sessions/{id}` | Code, instructor, settings, status | Instructor |
| `sessions/{id}/runs/{runId}` | Trainee name, scenario, seed, action log, snapshots, result | That trainee (own run only); instructor reads |
| `sessions/{id}/commands/{cmdId}` | Instructor commands | Instructor |
| `trainees/{uid}` | Display name, qualification records | Instructor (records); trainee reads own |
| `results/{resultId}` | Final scored results | Written by the trainee client, verified fields locked by rules |

**Security rules:**
- Trainees can write only their own run documents while the session is open.
- Only instructors (a custom claim or an `instructors` allow-list) can create sessions, send commands and edit records.
- Results are append-only.
- **Anti-cheat note:** scoring runs on the trainee's machine, so a determined trainee could fake a score. Instructors can re-simulate any run from its seed and action log (the replay uses the same engine), which detects tampering. Good enough for training.

**Free tier:** a unit-sized session (one instructor, about 10 trainees, 2 s snapshots, 30 minutes) stays well within Firebase's free daily limits.

## 8. Fidelity verification

- **Unit tests** per engine module against the guide's computed values.
- **Golden scenarios:** a set of scripted runs whose outcomes are predicted from the ACM code (for example "untreated level-1 pneumothorax reaches tension in 4-12 minutes", "CPR without pauses by a medic in VF at 6 L restores circulation with these odds"). The user runs the matching setups in game (Zeus modules, test mission), and the results are compared.
- **ACM updates:** a new data file version triggers a review of changed constants and functions; engine tests are updated alongside.

## 9. Repository

- Repo `hellscoutin/ACM-Trainer` (public), deployed to GitHub Pages from `main` by a GitHub Action.
- Layout: `app/`, `engine/`, `data/`, `rules/`, `scenarios/`, `rubrics/`, `tests/`, `docs/`.
- Firebase project: one per environment (test and live), config in `app/firebase-config.js`, security rules in `firebase/firestore.rules`, deployed with the Firebase CLI.

## 10. Build order

1. Data file and engine core (vitals, oxygen, blood, wounds) with tests.
2. Medical menu interface and solo practice with three Combat Lifesaver scenarios.
3. Airway, breathing, circulation modules and their procedure windows.
4. Scoring, rubrics and debrief.
5. Firebase: sessions, live dashboard, commands, stored results. Built 2026-11-13: `app/instructor.html`, `app/join.html`, session mode in `play.html` (`app/js/play-session.js`), `worker/` (Discord to Firebase custom token), saved history on the records page; Firestore in nam5. Setup: `docs/SESSIONS-setup.md`.
6. Pharmacology, AED, surgical airway, transfusion menu; Combat Medic scenarios.
7. Scenario editor, random patients, replay, records export. Done 2026-11-13, with CLS-5 grenade fragments, CM-7 IED blast and CM-8 helicopter hard landing.
8. Guidance rules (shared with the ATAK monitor), hints in practice mode. Done 2026-11-13: 53 rules at three depths, hints selector in practice (remembered per browser, runs with hints marked in records).
9. CBRN (optional), Advanced Medic scenarios. Done 2026-11-13: CBRN engine module and the Interaction tab; AM-1a massive transfusion, AM-1b wrong blood, AM-2 reversible arrest (PEA), AM-4a nerve agent, AM-4b blister agent.

## 11. Open questions

None open as of 2026-11-13. Still needed for deployment: Firebase CLI and Cloudflare (wrangler) logins on the user's PC, and the Discord client secret entered into the Worker.
