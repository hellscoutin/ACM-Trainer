# ACM Trainer

A browser trainer for **Advanced Combat Medicine (ACM)**, the Arma 3 medical mod that runs on ACE3. It simulates ACM casualties with an interface modelled on the ACE/ACM medical menu, for solo practice and for instructor-led sessions with live viewing, scenario control and stored scores.

> **Status:** in development. The design is in [`docs/TRAINER-design.md`](docs/TRAINER-design.md).

## Fidelity

The simulation follows ACM **1.4.8** with default settings. Every constant comes from [`data/acm-1.4.8.json`](data/acm-1.4.8.json), which was extracted from ACM's own scripts and config and lists the ACM function behind each value.

## Layout

| Folder | Contents |
|---|---|
| `app/` | User interface (static site) |
| `engine/` | Patient simulation (JavaScript port of ACM's patient model) |
| `data/` | `acm-1.4.8.json`: ACM facts used by the engine, scenarios and references |
| `scenarios/`, `rubrics/` | Training scenarios and their scoring checklists |
| `rules/` | Guidance rules (shared with the planned ATAK patient monitor) |
| `firebase/` | Firestore security rules |
| `tests/` | Engine tests (`npm test`, Node 20+, no dependencies) |
| `tools/` | Data extraction (`build_data.py`, reads the ACM guide's research notes) |
| `docs/` | Design documents |

## Running locally

```
npm test                 # engine tests
npx serve .              # or any static server, then open /app/
```

## Credits

- **Advanced Combat Medicine** by Blue and the ACM team. Reproduction of ACM's code, interfaces and sounds is used with their permission.
- **ACE3** by the ACE team (GPL-2.0). `data/ace-strings-en.json` holds ACE's English medical stringtables, used for display text only; the body diagram is drawn for this project.
- Not an official ACM or ACE product.
