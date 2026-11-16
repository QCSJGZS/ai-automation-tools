/**
 * DXF 解析器（从 AutoDie `js/import-dxf.js` 抽取）。
 *
 * 职责：ASCII DXF 文本 -> 离散化的线段集合 -> 闭合轮廓 loops。
 * 支持 LINE / ARC / CIRCLE / LWPOLYLINE / POLYLINE / SPLINE / ELLIPSE / INSERT(块)。
 *
 * 输出与 AutoDie 一致，便于回归比对：
 *   { loops, warnings, entityCount, unitScale, texts, segsRaw, tolBase, diag }
 */

import * as G from './geom.mjs';

export function parsePairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const c = parseInt(lines[i].trim(), 10);
    if (isNaN(c)) continue;
    pairs.push({ code: c, value: lines[i + 1] });
    i++;
  }
  return pairs;
}

function collectSections(pairs) {
  const sections = {};
  let i = 0;
  while (i < pairs.length) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === 'SECTION') {
      i++;
      const name = (pairs[i] && pairs[i].code === 2) ? pairs[i].value.trim() : '';
      i++;
      const start = i;
      while (i < pairs.length && !(pairs[i].code === 0 && pairs[i].value.trim() === 'ENDSEC')) i++;
      if (name) sections[name] = pairs.slice(start, i);
      i++;
    } else i++;
  }
  return sections;
}

function parseEntityList(pairs) {
  const ents = [];
  let cur = null;
  for (const p of pairs) {
    if (p.code === 0) {
      if (cur) ents.push(cur);
      cur = { type: p.value.trim(), items: [] };
    } else if (cur) {
      cur.items.push({ code: p.code, value: p.value });
    }
  }
  if (cur) ents.push(cur);
  return ents;
}

function nums(ent, code) {
  const out = [];
  for (const it of ent.items) if (it.code === code) out.push(parseFloat(it.value));
  return out;
}

function str(ent, code) {
  for (const it of ent.items) if (it.code === code) return it.value;
  return '';
}

function lwPolyline(ent, tol) {
  const verts = [];
  let flags = 0;
  for (const it of ent.items) {
    if (it.code === 10) verts.push({ x: parseFloat(it.value), y: 0, b: 0 });
    else if (it.code === 20 && verts.length) verts[verts.length - 1].y = parseFloat(it.value);
    else if (it.code === 42 && verts.length) verts[verts.length - 1].b = parseFloat(it.value);
    else if (it.code === 70) flags = parseInt(it.value, 10) || 0;
  }
  const pts = [];
  for (let v = 0; v < verts.length; v++) {
    const a = verts[v], b = verts[(v + 1) % verts.length];
    if (v === verts.length - 1 && !(flags & 1)) break;
    const seg = a.b ? G.bulgePoints([a.x, a.y], [b.x, b.y], a.b, tol) : [[a.x, a.y], [b.x, b.y]];
    for (let k = 0; k < seg.length - 1; k++) pts.push(seg[k]);
  }
  if (flags & 1) pts.push(pts[0]);
  return pts;
}

function polylineOld(header, verts, tol) {
  const flags = parseInt(str(header, 70) || '0', 10);
  const pts = [];
  for (let v = 0; v < verts.length; v++) {
    const p = [parseFloat(str(verts[v], 10) || '0'), parseFloat(str(verts[v], 20) || '0')];
    const b = parseFloat(str(verts[v], 42) || '0');
    if (b && v < verts.length - 1) {
      const q = [parseFloat(str(verts[v + 1], 10) || '0'), parseFloat(str(verts[v + 1], 20) || '0')];
      const seg = G.bulgePoints(p, q, b, tol);
      for (let k = 0; k < seg.length - 1; k++) pts.push(seg[k]);
    } else if (b && v === verts.length - 1 && (flags & 1)) {
      const q0 = [parseFloat(str(verts[0], 10) || '0'), parseFloat(str(verts[0], 20) || '0')];
      const seg2 = G.bulgePoints(p, q0, b, tol);
      for (let k2 = 0; k2 < seg2.length - 1; k2++) pts.push(seg2[k2]);
    } else {
      pts.push(p);
    }
  }
  if (flags & 1 && pts.length) pts.push(pts[0]);
  return pts;
}

/** NURBS 采样：knots 完整时求值，否则退化为中心折线 */
function spline(ent, tol) {
  const degree = parseInt(str(ent, 71) || '3', 10);
  const flags = parseInt(str(ent, 70) || '0', 10);
  const knots = nums(ent, 40);
  const ctrl = [], fit = [];
  let curX = null;
  for (const it of ent.items) {
    if (it.code === 10) curX = parseFloat(it.value);
    else if (it.code === 20 && curX !== null) { ctrl.push([curX, parseFloat(it.value)]); curX = null; }
    else if (it.code === 11) curX = parseFloat(it.value);
    else if (it.code === 21 && curX !== null) { fit.push([curX, parseFloat(it.value)]); curX = null; }
  }
  if (ctrl.length < 2) return fit.length >= 2 ? fit : [];

  if (knots.length === ctrl.length + degree + 1) {
    const n = ctrl.length - 1;
    const out = [];
    const u0 = knots[degree], u1 = knots[knots.length - 1 - degree];
    const samples = Math.max(24, Math.min(400, ctrl.length * 8));
    for (let s = 0; s <= samples; s++) {
      let u = u0 + (u1 - u0) * s / samples;
      if (u >= u1) u = u1 - 1e-9;
      let k = degree;
      while (k < n && u >= knots[k + 1]) k++;
      const d = [];
      for (let j = 0; j <= degree; j++) d.push([ctrl[k - degree + j][0], ctrl[k - degree + j][1]]);
      for (let r = 1; r <= degree; r++) {
        for (let jj = degree; jj >= r; jj--) {
          const den = knots[k + 1 + jj - r] - knots[k + jj - degree];
          const alpha = (den === 0) ? 0 : (u - knots[k + jj - degree]) / den;
          d[jj] = [
            (1 - alpha) * d[jj - 1][0] + alpha * d[jj][0],
            (1 - alpha) * d[jj - 1][1] + alpha * d[jj][1],
          ];
        }
      }
      out.push(d[degree]);
    }
    if (flags & 1 && G.dist(out[0], out[out.length - 1]) > 1e-9) out.push(out[0]);
    return out;
  }
  return ctrl;
}

function ellipse(ent) {
  const cx = parseFloat(str(ent, 10) || '0'), cy = parseFloat(str(ent, 20) || '0');
  const mx = parseFloat(str(ent, 11) || '1'), my = parseFloat(str(ent, 21) || '0');
  const ratio = parseFloat(str(ent, 40) || '1');
  const t0 = parseFloat(str(ent, 41) || '0');
  const t1 = parseFloat(str(ent, 42) || String(Math.PI * 2));
  const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio;
  const segs = Math.max(16, Math.min(240, Math.ceil(Math.abs(t1 - t0) * 24)));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = t0 + (t1 - t0) * i / segs;
    const x = a * Math.cos(t), y = b * Math.sin(t);
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}

function applyXf(pts, xf) {
  if (!xf) return pts;
  return pts.map((p) => {
    const x = p[0] * xf.sx, y = p[1] * xf.sy;
    const c = Math.cos(xf.rot), s = Math.sin(xf.rot);
    return [xf.tx + x * c - y * s, xf.ty + x * s + y * c];
  });
}

function entitiesToSegments(ents, blocks, tol, xf, depth) {
  let segs = [];
  depth = depth || 0;
  for (let i = 0; i < ents.length; i++) {
    const ent = ents[i];
    const t = ent.type;
    let pts = null;

    if (t === 'LINE') {
      pts = [[parseFloat(str(ent, 10) || '0'), parseFloat(str(ent, 20) || '0')],
             [parseFloat(str(ent, 11) || '0'), parseFloat(str(ent, 21) || '0')]];
    } else if (t === 'ARC') {
      pts = G.arcPoints(parseFloat(str(ent, 10) || '0'), parseFloat(str(ent, 20) || '0'),
        parseFloat(str(ent, 40) || '0'), parseFloat(str(ent, 50) || '0') * Math.PI / 180,
        parseFloat(str(ent, 51) || '0') * Math.PI / 180, tol);
    } else if (t === 'CIRCLE') {
      pts = G.arcPoints(parseFloat(str(ent, 10) || '0'), parseFloat(str(ent, 20) || '0'),
        parseFloat(str(ent, 40) || '0'), 0, Math.PI * 2, tol);
    } else if (t === 'LWPOLYLINE') {
      pts = lwPolyline(ent, tol);
    } else if (t === 'POLYLINE') {
      const verts = [];
      let j = i + 1;
      while (j < ents.length && ents[j].type === 'VERTEX') { verts.push(ents[j]); j++; }
      if (j < ents.length && ents[j].type === 'SEQEND') j++;
      pts = polylineOld(ent, verts, tol);
      i = j - 1;
    } else if (t === 'SPLINE') {
      pts = spline(ent, tol);
    } else if (t === 'ELLIPSE') {
      pts = ellipse(ent);
    } else if (t === 'INSERT' && depth < 4) {
      const name = str(ent, 2).trim();
      const block = blocks[name];
      if (block) {
        const bx = parseFloat(str(ent, 10) || '0'), by = parseFloat(str(ent, 20) || '0');
        const sx = parseFloat(str(ent, 41) || '1'), sy = parseFloat(str(ent, 42) || '1');
        const rot = parseFloat(str(ent, 50) || '0') * Math.PI / 180;
        const merged = {
          sx: (xf ? xf.sx : 1) * sx,
          sy: (xf ? xf.sy : 1) * sy,
          rot: (xf ? xf.rot : 0) + rot,
          tx: (xf ? xf.tx : 0) + (xf ? xf.sx : 1) * (bx * Math.cos(xf ? xf.rot : 0) - by * Math.sin(xf ? xf.rot : 0)),
          ty: (xf ? xf.ty : 0) + (xf ? xf.sy : 1) * (bx * Math.sin(xf ? xf.rot : 0) + by * Math.cos(xf ? xf.rot : 0)),
        };
        segs = segs.concat(entitiesToSegments(block, blocks, tol, merged, depth + 1));
        continue;
      }
    }

    if (pts && pts.length >= 2) segs.push(applyXf(pts, xf));
  }
  return segs;
}

/**
 * 解析 DXF 文本。
 * @param {string} text ASCII DXF 内容
 * @param {{scale?: number}} [opts] scale = 用户附加比例（1:N 图纸用）
 */
export function parse(text, opts) {
  opts = opts || {};
  if (text.slice(0, 20).indexOf('AutoCAD Binary DXF') >= 0) {
    throw new Error('二进制 DXF，请在 CAD 中另存为 ASCII DXF');
  }

  const pairs = parsePairs(text);
  const sections = collectSections(pairs);
  const warnings = [];
  if (!sections.ENTITIES) warnings.push('文件中未找到 ENTITIES 段，可能不是 ASCII DXF。');

  const blocks = {};
  if (sections.BLOCKS) {
    const blockEnts = parseEntityList(sections.BLOCKS);
    let list = null;
    for (const b of blockEnts) {
      if (b.type === 'BLOCK') {
        list = [];
        blocks[str(b, 2).trim()] = list;
      } else if (b.type === 'ENDBLK') {
        list = null;
      } else if (list) {
        list.push(b);
      }
    }
  }

  const ents = sections.ENTITIES ? parseEntityList(sections.ENTITIES) : [];

  // 文字/标注数量：判断「图纸图框」还是「零件外轮廓」的关键旁证
  let texts = 0;
  for (const e of ents) {
    if (/^(TEXT|MTEXT|ATTRIB|ATTDEF|DIMENSION|LEADER|MLEADER)$/.test(e.type)) texts++;
  }

  // 单位：$INSUNITS -> mm
  let unitScale = 1;
  if (sections.HEADER) {
    const header = sections.HEADER;
    for (let hi = 0; hi < header.length; hi++) {
      if (header[hi].code === 9 && header[hi].value.trim() === '$INSUNITS') {
        for (let hj = hi + 1; hj < header.length; hj++) {
          if (header[hj].code === 9) break;
          if (header[hj].code === 70) { unitScale = parseInt(header[hj].value, 10) || 0; break; }
        }
        break;
      }
    }
    const uiMap = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 25.4e-6, 9: 0.0254, 10: 914.4 };
    unitScale = uiMap[unitScale] || 1;
  }
  const k = unitScale * (opts.scale || 1);

  // 先按粗略容差展开，用尺寸反推合适容差，再按实际尺寸重新离散化
  let segs = entitiesToSegments(ents, blocks, 0.05, null, 0);
  if (!segs.length) {
    return {
      loops: [], warnings: warnings.concat(['未解析到可用图元。']),
      entityCount: ents.length, unitScale: k, texts, segsRaw: [],
      tolBase: 0, diag: 0,
    };
  }

  let all = [];
  for (const s of segs) all = all.concat(s);
  const bb = G.bbox(all);
  const diag = Math.hypot(bb.w, bb.h);
  const tol = Math.max(diag * 2e-4, 0.02);

  segs = entitiesToSegments(ents, blocks, tol, null, 0);

  if (k !== 1) segs = segs.map((s) => s.map((p) => [p[0] * k, p[1] * k]));

  const eps = Math.max(diag * k * 1e-5, 0.005);
  segs = segs.map((s) => G.simplify(s, eps, false)).filter((s) => s.length >= 2);

  const minArea = Math.max(0.2, diag * diag * 1e-7);
  const chains = G.chain(segs, tol * k);
  let loops = G.normalizeLoops(chains, minArea);
  let bridgeInfo = null;

  // 0 环：按缺口容差阶梯重试，把开口链首尾桥接起来。
  // 手绘/转图常见几毫米缺口；上限取图面尺寸 2%，避免把不相干的件连起来。
  if (!loops.length) {
    const cap = Math.max(diag * k * 0.02, 0.5);
    for (let bg = Math.max(tol * k * 2, 0.05); bg <= cap * 1.001 && !loops.length; bg *= 2) {
      const chB = G.chain(segs, tol * k, { bridge: bg });
      const lpB = G.normalizeLoops(chB, minArea);
      if (lpB.length) { loops = lpB; bridgeInfo = chB._bridge || { count: 0, max: bg }; }
    }
    if (!loops.length) {
      const chC = G.chain(segs, tol * k, { bridge: cap });
      const lpC = G.normalizeLoops(chC, minArea);
      if (lpC.length) { loops = lpC; bridgeInfo = chC._bridge || { count: 0, max: cap }; }
    }
    if (loops.length) {
      warnings.push('轮廓有缺口，已自动闭合' +
        (bridgeInfo ? '（' + bridgeInfo.count + ' 处，最大 ' + bridgeInfo.max.toFixed(2) + 'mm）' : '') +
        '，请核对预览尺寸。');
    }
  }

  // 居中到原点
  if (loops.length) {
    let allPts = [];
    for (const l of loops) allPts = allPts.concat(l.pts);
    const b2 = G.bbox(allPts);
    const cx = (b2.minX + b2.maxX) / 2, cy = (b2.minY + b2.maxY) / 2;
    for (const l of loops) {
      l.pts = l.pts.map((p) => [p[0] - cx, p[1] - cy]);
      l.center = G.centroid(l.pts);
      l.bbox = G.bbox(l.pts);
    }
  }

  if (!loops.length) warnings.push('图元未能闭合。请在 CAD 中检查轮廓是否闭合，或使用图片识别。');

  return {
    loops,
    warnings,
    entityCount: ents.length,
    unitScale: k,
    texts,
    segsRaw: segs,
    tolBase: tol * k,
    diag: diag * k,
  };
}

export default { parse, parsePairs };