#!/usr/bin/env python3
"""dxf_stats.py —— DXF 图纸批量体检（零依赖，纯标准库）。

用途：一次扫描一批 DXF，快速看清每张图的图元规模、类型分布、图层、
外包尺寸与图纸单位，避免逐个打开 CAD 目检。

用法：
    python dxf_stats.py <目录或文件> [--recursive] [--json] [--limit N]

示例：
    python dxf_stats.py D:\\图纸
    python dxf_stats.py D:\\图纸\\-6.1.dxf --json
    python dxf_stats.py D:\\图纸 --recursive --limit 50

限制：只解析 ASCII DXF 的 ENTITIES 段；INSERT 不展开（只计数）；
SPLINE 取控制点近似外包；尺寸标注只取定义点，不代表真实轮廓。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from typing import Dict, List, Optional, Tuple

Pair = Tuple[int, str]

# $INSUNITS -> (名称, 换算到 mm 的系数)
UNITS = {
    0: ("unitless", 1.0),
    1: ("inch", 25.4),
    2: ("feet", 304.8),
    3: ("mile", 1609344.0),
    4: ("mm", 1.0),
    5: ("cm", 10.0),
    6: ("m", 1000.0),
    7: ("km", 1000000.0),
    8: ("microinch", 0.0000254),
    9: ("mil", 0.0254),
    10: ("yard", 914.4),
}


def read_pairs(path: str) -> List[Pair]:
    """把 DXF 拆成 (组码, 值) 序列；兼容 UTF-8 / GBK / Latin-1 编码。"""
    with open(path, "rb") as f:
        raw_bytes = f.read()
    if raw_bytes.startswith(b"AutoCAD Binary DXF"):
        raise ValueError("二进制 DXF，请在 CAD 中另存为 ASCII DXF 后再跑")
    text = None
    for enc in ("utf-8", "gbk", "cp936", "latin-1"):
        try:
            text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw_bytes.decode("utf-8", errors="replace")
    lines = text.splitlines()
    pairs: List[Pair] = []
    i = 0
    n = len(lines)
    while i + 1 < n:
        raw = lines[i].strip()
        i += 1
        if not raw:
            continue
        try:
            code = int(raw)
        except ValueError:
            continue
        pairs.append((code, lines[i].strip()))
        i += 1
    return pairs


def sections(pairs: List[Pair]) -> Dict[str, List[Pair]]:
    """按 SECTION 名切分，返回 {段名: 段内容}。"""
    out: Dict[str, List[Pair]] = {}
    i = 0
    while i < len(pairs):
        if pairs[i] == (0, "SECTION") and i + 1 < len(pairs) and pairs[i + 1][0] == 2:
            name = pairs[i + 1][1]
            body: List[Pair] = []
            j = i + 2
            while j < len(pairs) and pairs[j] != (0, "ENDSEC"):
                body.append(pairs[j])
                j += 1
            out.setdefault(name, []).extend(body)
            i = j + 1
        else:
            i += 1
    return out


def split_entities(body: List[Pair]) -> List[Tuple[str, List[Pair]]]:
    """把 ENTITIES 段切成 (类型, 组码表) 列表。"""
    out: List[Tuple[str, List[Pair]]] = []
    cur_type: Optional[str] = None
    cur: List[Pair] = []
    for code, value in body:
        if code == 0:
            if cur_type is not None:
                out.append((cur_type, cur))
            cur_type, cur = value, []
        elif cur_type is not None:
            cur.append((code, value))
    if cur_type is not None:
        out.append((cur_type, cur))
    return out


def nums(codes: List[Pair], code: int) -> List[float]:
    vals = []
    for c, v in codes:
        if c == code:
            try:
                vals.append(float(v))
            except ValueError:
                pass
    return vals


def first(codes: List[Pair], code: int, default: float = 0.0) -> float:
    v = nums(codes, code)
    return v[0] if v else default


def merge(box: Optional[Tuple[float, float, float, float]],
          pts: List[Tuple[float, float]]) -> Optional[Tuple[float, float, float, float]]:
    for x, y in pts:
        if box is None:
            box = (x, y, x, y)
        else:
            box = (min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y))
    return box


def arc_points(cx: float, cy: float, r: float, a0: float, a1: float) -> List[Tuple[float, float]]:
    """圆弧外包关键点：两端点 + 扫掠范围内的四个象限点。"""
    import math
    start, end = a0 % 360.0, a1 % 360.0
    sweep = (end - start) % 360.0
    if sweep == 0:
        sweep = 360.0
    pts = [(cx + r * math.cos(math.radians(start)), cy + r * math.sin(math.radians(start))),
           (cx + r * math.cos(math.radians(end)), cy + r * math.sin(math.radians(end)))]
    for q in (0.0, 90.0, 180.0, 270.0):
        if (q - start) % 360.0 <= sweep:
            pts.append((cx + r * math.cos(math.radians(q)), cy + r * math.sin(math.radians(q))))
    return pts


def entity_points(kind: str, codes: List[Pair]) -> List[Tuple[float, float]]:
    import math
    if kind == "LINE":
        xs = nums(codes, 10)[:1] + nums(codes, 11)[:1]
        ys = nums(codes, 20)[:1] + nums(codes, 21)[:1]
        return list(zip(xs, ys))
    if kind in ("CIRCLE", "ARC"):
        cx, cy, r = first(codes, 10), first(codes, 20), first(codes, 40)
        if kind == "CIRCLE":
            return [(cx - r, cy - r), (cx + r, cy + r)]
        return arc_points(cx, cy, r, first(codes, 50), first(codes, 51, 360.0))
    if kind in ("LWPOLYLINE", "POLYLINE"):
        xs, ys = nums(codes, 10), nums(codes, 20)
        return list(zip(xs, ys))
    if kind == "ELLIPSE":
        cx, cy = first(codes, 10), first(codes, 20)
        mx, my = first(codes, 11), first(codes, 21)
        a = math.hypot(mx, my)
        b = a * first(codes, 40, 1.0)
        phi = math.atan2(my, mx)
        hw = math.hypot(a * math.cos(phi), b * math.sin(phi))
        hh = math.hypot(a * math.sin(phi), b * math.cos(phi))
        return [(cx - hw, cy - hh), (cx + hw, cy + hh)]
    if kind == "SPLINE":
        xs = nums(codes, 11) or nums(codes, 10)
        ys = nums(codes, 21) or nums(codes, 20)
        return list(zip(xs, ys))
    if kind in ("POINT", "TEXT", "MTEXT", "INSERT", "DIMENSION"):
        return [(first(codes, 10), first(codes, 20))]
    return []


def analyse(path: str) -> Dict[str, object]:
    pairs = read_pairs(path)
    secs = sections(pairs)
    header = secs.get("HEADER", [])
    insunits = 0
    for i, (code, value) in enumerate(header):
        if code == 9 and value.upper() == "$INSUNITS" and i + 1 < len(header):
            try:
                insunits = int(float(header[i + 1][1]))
            except ValueError:
                insunits = 0
    unit_name, factor = UNITS.get(insunits, ("unitless", 1.0))

    ents = split_entities(secs.get("ENTITIES", []))

    counts: Dict[str, int] = {}
    layers: Dict[str, int] = {}
    box: Optional[Tuple[float, float, float, float]] = None
    box_geom: Optional[Tuple[float, float, float, float]] = None
    ANNOTATION = ("TEXT", "MTEXT", "DIMENSION", "INSERT", "LEADER", "TOLERANCE")

    idx = 0
    while idx < len(ents):
        kind, codes = ents[idx]
        idx += 1
        if kind == "VERTEX" or kind == "SEQEND":
            continue
        if kind == "POLYLINE":
            # 收集紧随其后的 VERTEX，作为折线顶点
            vpts: List[Tuple[float, float]] = []
            while idx < len(ents) and ents[idx][0] == "VERTEX":
                vc = ents[idx][1]
                vpts.append((first(vc, 10), first(vc, 20)))
                idx += 1
            if idx < len(ents) and ents[idx][0] == "SEQEND":
                idx += 1
            box = merge(box, vpts)
            box_geom = merge(box_geom, vpts)
        else:
            pts = entity_points(kind, codes)
            box = merge(box, pts)
            if kind not in ANNOTATION:
                box_geom = merge(box_geom, pts)
        counts[kind] = counts.get(kind, 0) + 1
        layer = ""
        for c, v in codes:
            if c == 8:
                layer = v
                break
        if layer:
            layers[layer] = layers.get(layer, 0) + 1

    result: Dict[str, object] = {
        "file": os.path.basename(path),
        "entities": sum(counts.values()),
        "types": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "layers": dict(sorted(layers.items(), key=lambda kv: -kv[1])),
        "unit": unit_name,
        "insunits": insunits,
    }
    main_box = box_geom or box
    result["width_mm"] = round((main_box[2] - main_box[0]) * factor, 3) if main_box else None
    result["height_mm"] = round((main_box[3] - main_box[1]) * factor, 3) if main_box else None
    result["geom_bbox_mm"] = [round(v * factor, 3) for v in main_box] if main_box else None
    result["bbox_mm"] = [round(v * factor, 3) for v in box] if box else None
    return result


def dwidth(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


def pad(text: str, width: int) -> str:
    return text + " " * max(0, width - dwidth(text))


def print_table(rows: List[Dict[str, object]]) -> None:
    if not rows:
        print("没有找到可解析的 DXF 文件。")
        return
    head = ["文件", "图元", "主要类型", "外包尺寸(mm)", "单位"]
    body = []
    for r in rows:
        tops = list((r["types"] or {}).items())[:4]
        types = " ".join("%s×%d" % (k, v) for k, v in tops) if tops else "-"
        size = "%.2f × %.2f" % (r["width_mm"], r["height_mm"]) if r["width_mm"] is not None else "-"
        body.append([str(r["file"]), str(r["entities"]), types, size, str(r["unit"])])
    widths = [max(dwidth(h), *(dwidth(b[i]) for b in body)) for i, h in enumerate(head)]
    print("  ".join(pad(h, widths[i]) for i, h in enumerate(head)))
    print("  ".join("-" * widths[i] for i in range(len(head))))
    for b in body:
        print("  ".join(pad(cell, widths[i]) for i, cell in enumerate(b)))
    print("\n共 %d 张图，合计 %d 个图元。" % (len(rows), sum(int(r["entities"]) for r in rows)))


def collect(target: str, recursive: bool) -> List[str]:
    if os.path.isfile(target):
        return [target]
    files = []
    if recursive:
        for root, _, names in os.walk(target):
            for name in names:
                if name.lower().endswith(".dxf"):
                    files.append(os.path.join(root, name))
    else:
        for name in os.listdir(target):
            full = os.path.join(target, name)
            if os.path.isfile(full) and name.lower().endswith(".dxf"):
                files.append(full)
    return sorted(files)


def main() -> int:
    # 统一 UTF-8 输出，避免 Windows 控制台/重定向乱码
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description="DXF 图纸批量体检")
    ap.add_argument("target", help="DXF 文件或目录")
    ap.add_argument("-r", "--recursive", action="store_true", help="递归子目录")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--limit", type=int, default=0, help="最多处理 N 个文件")
    args = ap.parse_args()

    if not os.path.exists(args.target):
        print("路径不存在: %s" % args.target, file=sys.stderr)
        return 2

    files = collect(args.target, args.recursive)
    if args.limit > 0:
        files = files[: args.limit]

    rows = []
    errors = []
    for path in files:
        try:
            rows.append(analyse(path))
        except Exception as exc:  # 单张图失败不影响整批
            errors.append({"file": os.path.basename(path), "error": str(exc)})

    if args.json:
        print(json.dumps({"files": rows, "errors": errors}, ensure_ascii=False, indent=2))
    else:
        if rows:
            print_table(rows)
        elif not files:
            print("未找到 .dxf 文件。")
        for e in errors:
            print("! 解析失败 %s: %s" % (e["file"], e["error"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())