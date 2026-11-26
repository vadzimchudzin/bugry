#!/usr/bin/env python3
"""Decode LD/FBD bodies of a PLCopen XML export (CODESYS / Machine Expert)
into readable pseudo-ST, one network per block.

    python3 tools/ld_decode.py Bugry.xml docs/plc

Each POU becomes docs/plc/<name>.txt with its variable declarations, ST
bodies verbatim and LD networks rewritten as assignments:
    coil      x := expr              set/reset coils: IF expr THEN x := TRUE/FALSE
    block     inst(IN := a, PT := b) ; outputs as inst.Q
"""
import html
import os
import re
import sys
import xml.etree.ElementTree as ET

NS = {"p": "http://www.plcopen.org/xml/tc6_0200", "x": "http://www.w3.org/1999/xhtml"}
P = "{http://www.plcopen.org/xml/tc6_0200}"


def text_of(el):
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def type_str(t):
    if t is None:
        return "?"
    for c in t:
        tag = c.tag.replace(P, "")
        if tag == "derived":
            return c.get("name")
        if tag == "array":
            dims = ",".join(f"{d.get('lower')}..{d.get('upper')}" for d in c.findall(P + "dimension"))
            return f"ARRAY[{dims}] OF {type_str(c.find(P + 'baseType'))}"
        if tag == "string":
            return "STRING"
        return tag
    return "?"


def decl(pou):
    out = []
    iface = pou.find(P + "interface")
    if iface is None:
        return out
    for sec in iface:
        kind = sec.tag.replace(P, "")
        for v in sec.findall(P + "variable"):
            init = v.find(f"{P}initialValue/{P}simpleValue")
            doc = text_of(v.find(P + "documentation"))
            s = f"  {kind[:-4]:7} {v.get('name')} : {type_str(v.find(P + 'type'))}"
            if init is not None:
                s += f" := {init.get('value')}"
            if doc:
                s += f"  // {' '.join(doc.split())}"
            out.append(s)
    return out


def paren(e):
    return e if re.fullmatch(r"[\w.\[\]#]+|NOT [\w.\[\]#]+|\(.*\)", e) else f"({e})"


def and_(a, b):
    if a == "TRUE":
        return b
    if b == "TRUE":
        return a
    return f"{paren(a)} AND {paren(b)}" if " OR " in a or " OR " in b else f"{a} AND {b}"


def decode_graph(body):
    els = list(body)
    by_id = {}
    for e in els:
        lid = e.get("localId")
        if lid is not None:
            by_id[lid] = e
    memo = {}
    referenced = {c.get("refLocalId") for c in body.iter(P + "connection")}

    def inputs_expr(cpi):
        if cpi is None:
            return "TRUE"
        parts = []
        for c in cpi.findall(P + "connection"):
            parts.append(out_expr(c.get("refLocalId"), c.get("formalParameter")))
        if not parts:
            return "TRUE"
        if len(parts) == 1:
            return parts[0]
        uniq = []
        for p_ in parts:
            if p_ not in uniq:
                uniq.append(p_)
        if "TRUE" in uniq:
            return "TRUE"
        return "(" + " OR ".join(paren(p_) for p_ in uniq) + ")" if len(uniq) > 1 else uniq[0]

    def out_expr(lid, formal):
        key = (lid, formal)
        if key in memo:
            return memo[key]
        e = by_id.get(lid)
        if e is None:
            return f"?{lid}"
        tag = e.tag.replace(P, "")
        memo[key] = f"<loop {lid}>"
        if tag == "leftPowerRail":
            r = "TRUE"
        elif tag == "contact":
            var = text_of(e.find(P + "variable"))
            edge = e.get("edge")
            v = var
            if edge == "rising":
                v = f"R_TRIG({var})"
            elif edge == "falling":
                v = f"F_TRIG({var})"
            if e.get("negated") == "true":
                v = f"NOT {v}"
            r = and_(inputs_expr(e.find(P + "connectionPointIn")), v)
        elif tag == "coil":
            r = inputs_expr(e.find(P + "connectionPointIn"))
        elif tag in ("inVariable", "inOutVariable"):
            r = text_of(e.find(P + "expression"))
            if e.get("negated") == "true":
                r = f"NOT {r}"
        elif tag == "block":
            name = e.get("instanceName") or e.get("typeName")
            if formal in (None, "", "ENO"):
                formal = "ENO"
            outs = e.find(P + "outputVariables")
            out_names = [o.get("formalParameter") for o in outs] if outs is not None else []
            if e.get("instanceName"):
                r = f"{name}.{formal}" if formal != "ENO" or "ENO" in out_names else f"{name}.ENO"
            else:
                r = block_call(e)
                if formal not in ("ENO",) and len(out_names) > 1:
                    r = f"{r}.{formal}"
            neg = None
            if outs is not None:
                for o in outs:
                    if o.get("formalParameter") == formal and o.get("negated") == "true":
                        neg = True
            if neg:
                r = f"NOT {r}"
        else:
            r = f"<{tag} {lid}>"
        memo[key] = r
        return r

    def block_call(e):
        args = []
        ins = e.find(P + "inputVariables")
        if ins is not None:
            for iv in ins:
                fp = iv.get("formalParameter")
                ex = inputs_expr(iv.find(P + "connectionPointIn"))
                if iv.get("negated") == "true":
                    ex = f"NOT {paren(ex)}"
                if fp == "EN" and ex == "TRUE":
                    continue
                args.append((fp, ex))
        tn = e.get("typeName")
        if not e.get("instanceName"):
            ops = {"AND": " AND ", "OR": " OR ", "ADD": " + ", "SUB": " - ", "MUL": " * ", "DIV": " / ",
                   "GT": " > ", "GE": " >= ", "LT": " < ", "LE": " <= ", "EQ": " = ", "NE": " <> ", "XOR": " XOR "}
            vals = [paren(a) for f, a in args if f != "EN"]
            en = [a for f, a in args if f == "EN"]
            core = None
            if tn in ops and len(vals) >= 2:
                core = "(" + ops[tn].join(vals) + ")"
            elif tn == "MOVE" and vals:
                core = vals[0]
            elif tn == "NOT" and vals:
                core = f"NOT {vals[0]}"
            else:
                core = f"{tn}(" + ", ".join(f"{f}:={a}" for f, a in args if f != "EN") + ")"
            if en and en[0] != "TRUE":
                core = f"{core} /*EN={en[0]}*/"
            return core
        return f"{e.get('instanceName')}(" + ", ".join(f"{f}:={a}" for f, a in args) + ")"

    lines = []
    title = None
    for e in els:
        tag = e.tag.replace(P, "")
        if tag == "comment":
            c = " ".join(text_of(e.find(P + "content")).split())
            lines.append("")
            lines.append(f"// --- {c}" if c else "// ---")
        elif tag == "coil":
            var = text_of(e.find(P + "variable"))
            ex = inputs_expr(e.find(P + "connectionPointIn"))
            st = e.get("storage")
            if e.get("negated") == "true" and st in (None, "none"):
                lines.append(f"{var} := NOT {paren(ex)};")
            elif st == "set":
                lines.append(f"IF {ex} THEN {var} := TRUE; END_IF")
            elif st == "reset":
                lines.append(f"IF {ex} THEN {var} := FALSE; END_IF")
            else:
                lines.append(f"{var} := {ex};")
        elif tag == "block":
            outs = e.find(P + "outputVariables")
            targets = []
            if outs is not None:
                for o in outs:
                    ex_ = o.find(f"{P}connectionPointOut/{P}expression")
                    if ex_ is not None and text_of(ex_):
                        targets.append((o.get("formalParameter"), text_of(ex_), o.get("negated") == "true"))
            inst = e.get("instanceName")
            if inst:
                lines.append(block_call(e) + ";")
                for fp, tgt, neg in targets:
                    lines.append(f"{tgt} := {'NOT ' if neg else ''}{inst}.{fp};")
            else:
                en = None
                ins = e.find(P + "inputVariables")
                if ins is not None:
                    for iv in ins:
                        if iv.get("formalParameter") == "EN":
                            en = inputs_expr(iv.find(P + "connectionPointIn"))
                call = re.sub(r" /\*EN=.*\*/$", "", block_call(e))
                if targets:
                    body_ = " ".join(f"{tgt} := {'NOT ' if neg else ''}{call};" for _, tgt, neg in targets)
                    lines.append(f"IF {en} THEN {body_} END_IF" if en and en != "TRUE" else body_)
                elif e.get("localId") not in referenced:
                    lines.append((f"IF {en} THEN {call}; END_IF" if en and en != "TRUE" else call + ";"))
        elif tag in ("outVariable", "inOutVariable"):
            ex = inputs_expr(e.find(P + "connectionPointIn"))
            lines.append(f"{text_of(e.find(P + 'expression'))} := {ex};")
        elif tag == "jump":
            lines.append(f"IF {inputs_expr(e.find(P + 'connectionPointIn'))} THEN GOTO {e.get('label')}; END_IF")
        elif tag == "label":
            lines.append(f"{e.get('label')}:")
        elif tag == "return":
            lines.append(f"IF {inputs_expr(e.find(P + 'connectionPointIn'))} THEN RETURN; END_IF")
    # outputs of instance blocks wired to coils/outVariables are already covered
    return lines


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    raw = open(src, encoding="utf-8-sig").read()
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        # the export in the archive is cut off after <instances>; the POUs are intact
        root = ET.fromstring(raw[: raw.index("</types>") + len("</types>")] + "</project>")
    for pou in root.iter(P + "pou"):
        name = pou.get("name")
        out = [f"{pou.get('pouType')} {name}", "VAR"] + decl(pou) + ["END_VAR", ""]
        for body in pou.iter(P + "body"):
            for kind in body:
                k = kind.tag.replace(P, "")
                if k == "ST":
                    out.append("(* ST *)")
                    out.append(text_of(kind))
                elif k in ("LD", "FBD"):
                    out.append(f"(* {k} *)")
                    out.extend(decode_graph(kind))
                out.append("")
        with open(os.path.join(dst, name + ".txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(out))
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
