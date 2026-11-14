"""Extracts ACM's medication config (class ACM_Medication) from a derapified ACM_core config.cpp
into data/medications-1.4.8.json, with class inheritance resolved.

Usage: python tools/extract_medications.py <path to derapified ACM_core config.cpp>

Derapify with: hemtt utils config derapify ACM_core/config.bin
"""
import json
import re
import sys
from pathlib import Path

TOKEN = re.compile(r'\s*(?:(//[^\n]*)|(class)\b|([A-Za-z_][A-Za-z0-9_]*)(\[\])?|("(?:[^"]|"")*")|(-?[0-9.]+(?:e-?[0-9]+)?)|(.))', re.S)


def tokens(text):
    pos = 0
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m or m.end() == pos:
            break
        pos = m.end()
        comment, cls, ident, arr, string, number, sym = m.groups()
        if comment:
            continue
        if cls:
            yield ("class", None)
        elif ident:
            yield ("ident", ident + (arr or ""))
        elif string:
            yield ("value", string[1:-1].replace('""', '"'))
        elif number:
            yield ("value", float(number) if "." in number or "e" in number else int(number))
        elif sym and sym.strip():
            yield ("sym", sym)


def parse_block(it):
    """Parses entries until the closing brace. Returns dict; classes are {'__parent': name, ...}."""
    out = {}
    for kind, val in it:
        if kind == "sym" and val == "}":
            return out
        if kind == "class":
            _, name = next(it)
            kind2, val2 = next(it)
            parent = None
            if kind2 == "sym" and val2 == ":":
                _, parent = next(it)
                kind2, val2 = next(it)
            if val2 == ";":  # forward declaration
                out.setdefault(name, {"__parent": parent})
                continue
            body = parse_block(it)
            body["__parent"] = parent
            out[name] = body
            next(it)  # ;
        elif kind == "ident":
            name = val
            next(it)  # =
            if name.endswith("[]"):
                out[name[:-2]] = parse_array(it)
            else:
                _, v = next(it)
                out[name] = v
            next(it)  # ;
    return out


def parse_array(it):
    kind, val = next(it)
    assert val == "{", val
    arr = []
    for kind, val in it:
        if kind == "sym" and val == "}":
            return arr
        if kind == "sym" and val == "{":
            # nested array: push back and parse
            arr.append(parse_array(_prepend(("sym", "{"), it)))
        elif kind == "value":
            arr.append(val)
    return arr


def _prepend(tok, it):
    yield tok
    yield from it


def resolve(classes, name, base):
    c = classes[name]
    parent = c.get("__parent")
    merged = dict(base)
    if parent:
        merged.update(resolve(classes, parent, base))
    merged.update({k: v for k, v in c.items() if not k.startswith("__") and not isinstance(v, dict)})
    return merged


def main():
    text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    start = text.index("class ACM_Medication")
    it = tokens(text[start:])
    next(it); next(it)  # class ACM_Medication
    next(it)  # {
    root = parse_block(it)
    meds = root["Medications"]
    base = {k: v for k, v in meds.items() if not isinstance(v, dict) and not k.startswith("__")}
    classes = {k: v for k, v in meds.items() if isinstance(v, dict)}
    templates = {"ACM_PO_Medication", "ACM_Inhalant_Medication", "ACM_IM_Medication", "ACM_IV_Medication"}
    resolved = {name: resolve(classes, name, base) for name in classes if name not in templates}
    types = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("__")} for k, v in root.get("MedicationType", {}).items() if isinstance(v, dict)}
    out = {
        "_source": "ACM 1.4.8 ACM_core config.cpp class ACM_Medication (inheritance resolved by tools/extract_medications.py)",
        "routes": {"0": "IM", "1": "IV", "2": "PO", "3": "INHALE"},
        "order": [n for n in classes if n not in templates],
        "medications": resolved,
        "medicationTypes": types,
    }
    dest = Path(__file__).resolve().parent.parent / "data" / "medications-1.4.8.json"
    dest.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(resolved)} medications, {len(types)} types -> {dest}")


if __name__ == "__main__":
    main()
