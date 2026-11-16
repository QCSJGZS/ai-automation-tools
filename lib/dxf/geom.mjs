/**
 * 平面几何内核（从 AutoDie `js/geom.js` 抽取，只保留识别链路需要的部分）。
 *
 * 已剔除与识别无关的三角剖分、壁厚统计等，保持纯函数、零依赖。
 * 关键逻辑（G.chain 的图行走成环、缺口桥接）与 AutoDie 保持一致，
 * 改动请同步 `docs/dxf-recognize.md` 的验收基线。
 */

export function area(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function perimeter(pts, closed) {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < (closed === false ? n - 1 : n); i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(pts) {
  const a = area(pts);
  if (Math.abs(a) < 1e-12) {
    const bx = bbox(pts);
    return [(bx.minX + bx.maxX) / 2, (bx.minY + bx.maxY) / 2];
  }
  let cx = 0, cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cr = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * cr;
    cy += (p[1] + q[1]) * cr;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPoly(pt, pts) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function distPointSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = p[0] - a[0], wy = p[1] - a[1];
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export function simplify(pts, eps, closed) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : [];
  let src = pts.slice();
  if (closed && dist(src[0], src[src.length - 1]) < eps) src = src.slice(0, -1);
  if (src.length < 3) return src;

  function rdp(points, epsilon) {
    if (points.length < 3) return points;
    const first = points[0], last = points[points.length - 1];
    let maxD = -1, idx = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = distPointSeg(points[i], first, last);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon) {
      const left = rdp(points.slice(0, idx + 1), epsilon);
      const right = rdp(points.slice(idx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  const out = closed ? rdp(src.concat([src[0]]), eps).slice(0, -1) : rdp(src, eps);
  return out.length >= 3 ? out : src;
}

export function dedupe(pts, tol) {
  tol = tol || 1e-6;
  const out = [];
  for (const p of pts) {
    if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p.slice());
  }
  return out;
}

export function arcPoints(cx, cy, r, a0, a1, tol) {
  let sweep = a1 - a0;
  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  let segs = Math.max(4, Math.ceil(Math.abs(sweep) * Math.sqrt(Math.max(r, 1e-6) / Math.max(tol || 0.02, 1e-4))));
  if (segs > 720) segs = 720;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + sweep * i / segs;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** LWPOLYLINE 的 bulge 段 -> 点列 */
export function bulgePoints(p1, p2, bulge, tol) {
  if (!bulge) return [p1, p2];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [p1, p2];
  const theta = 4 * Math.atan(Math.abs(bulge));
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const h = Math.sqrt(Math.max(r * r - chord * chord / 4, 0));
  const nx = -dy / chord, ny = dx / chord;
  const sign = bulge > 0 ? 1 : -1;
  const flip = Math.abs(bulge) > 1 ? -1 : 1;
  const cx = mx - nx * h * sign * flip;
  const cy = my - ny * h * sign * flip;
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  let a1 = Math.atan2(p2[1] - cy, p2[0] - cx);
  const sweep = theta * sign;
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.sign(d) !== Math.sign(sweep)) a1 = a0 + sweep;
  return arcPoints(cx, cy, r, a0, a1, tol);
}

/* 去重：完全重叠的线段（同一图元画两遍）会让链环断开，先剔除 */
function dedupeSegments(segments, tol) {
  const kept = [];
  function polyLen(p) {
    let L = 0;
    for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
    return L;
  }
  for (const s of segments) {
    const lenS = polyLen(s);
    let dup = false;
    for (const k of kept) {
      if (Math.abs(polyLen(k) - lenS) > tol * 3) continue;
      const same = (dist(k[0], s[0]) < tol && dist(k[k.length - 1], s[s.length - 1]) < tol) ||
                   (dist(k[0], s[s.length - 1]) < tol && dist(k[k.length - 1], s[0]) < tol);
      if (same) { dup = true; break; }
    }
    if (!dup) kept.push(s);
  }
  return kept;
}

/**
 * 线段链接成闭合环：端点聚类成节点 + 邻接图行走（分支点取转角最小的延续）。
 *
 * 为什么不用「贪心首尾拼接」：共享顶点或重复端点会把一条闭合轮廓拆成两条开口链，
 * 表现为内芯丢失、面积对不上。图行走的闭合判断是确定的。
 *
 * @param {Array<Array<[number,number]>>} segments 折线/线段列表
 * @param {number} tol 端点聚类容差（mm）
 * @param {{bridge?: number}} [opts] bridge = 开口链首尾桥接容差
 */
export function chain(segments, tol, opts) {
  tol = tol || 0.05;
  opts = opts || {};

  const closedChains = [], edgeList = [], adj = {}, nodes = [], grid = {};

  function nodeOf(p) {
    const cx = Math.floor(p[0] / tol), cy = Math.floor(p[1] / tol);
    let best = -1, bd = tol + 1e-9;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const list = grid[ix + '|' + iy];
        if (!list) continue;
        for (const id of list) {
          const d = dist(nodes[id], p);
          if (d <= bd) { bd = d; best = id; }
        }
      }
    }
    if (best >= 0) return best;
    const id = nodes.length;
    nodes.push([p[0], p[1]]);
    const k = cx + '|' + cy;
    (grid[k] = grid[k] || []).push(id);
    return id;
  }

  dedupeSegments(segments, tol).forEach((s) => {
    if (!s || s.length < 2) return;
    const pts = dedupe(s, tol * 0.2).map((p) => [p[0], p[1]]);
    if (pts.length < 2) return;
    if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < tol) {
      pts.pop();
      closedChains.push({ pts, closed: true });
      return;
    }
    const a = nodeOf(pts[0]), b = nodeOf(pts[pts.length - 1]);
    if (a === b) { closedChains.push({ pts, closed: true }); return; }
    const ei = edgeList.length;
    edgeList.push({ a, b, pts });
    (adj[a] = adj[a] || []).push(ei);
    (adj[b] = adj[b] || []).push(ei);
  });

  function dirOf(pts, fromEnd) {
    let dx, dy, L;
    if (fromEnd) {
      for (let i = pts.length - 2; i >= 0; i--) {
        dx = pts[pts.length - 1][0] - pts[i][0];
        dy = pts[pts.length - 1][1] - pts[i][1];
        L = Math.hypot(dx, dy);
        if (L > tol * 0.5) return [dx / L, dy / L];
      }
    } else {
      for (let i = 1; i < pts.length; i++) {
        dx = pts[i][0] - pts[0][0];
        dy = pts[i][1] - pts[0][1];
        L = Math.hypot(dx, dy);
        if (L > tol * 0.5) return [dx / L, dy / L];
      }
    }
    return null;
  }

  const used = edgeList.map(() => false);

  function pickNext(node, dirIn) {
    const out = [];
    for (const e of adj[node] || []) if (!used[e]) out.push(e);
    if (!out.length) return -1;
    if (out.length === 1) return out[0];
    let best = -1, bestDot = -2;
    for (const ei of out) {
      const ed = edgeList[ei];
      const pts = (ed.a === node) ? ed.pts : ed.pts.slice().reverse();
      const d = dirOf(pts, false);
      const dot = (d && dirIn) ? (d[0] * dirIn[0] + d[1] * dirIn[1]) : 1;
      if (dot > bestDot) { bestDot = dot; best = ei; }
    }
    return best;
  }

  const chains = closedChains.slice();

  for (let i = 0; i < edgeList.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const e0 = edgeList[i];
    let pts = e0.pts.slice();
    let closed = false;

    let node = e0.b, dirIn = dirOf(pts, true), guard = 0;
    while (guard++ < edgeList.length + 2) {
      const nx = pickNext(node, dirIn);
      if (nx < 0) break;
      const ed = edgeList[nx];
      const seg = (ed.a === node) ? ed.pts.slice() : ed.pts.slice().reverse();
      pts = pts.concat(seg.slice(1));
      used[nx] = true;
      node = (ed.a === node) ? ed.b : ed.a;
      dirIn = dirOf(seg, true);
      if (node === e0.a) { closed = true; break; }
    }

    if (!closed) {
      node = e0.a;
      let pre = [], guard2 = 0;
      while (guard2++ < edgeList.length + 2) {
        let pdx = null;
        const cands0 = (adj[node] || []).filter((e) => !used[e]);
        if (cands0.length > 1) {
          const fwd0 = edgeList[cands0[0]];
          const f0 = (fwd0.a === node) ? fwd0.pts : fwd0.pts.slice().reverse();
          pdx = dirOf(f0, false);
        }
        const nx2 = cands0.length === 1 ? cands0[0] : pickNext(node, pdx || dirIn);
        if (nx2 == null || nx2 < 0) break;
        const ed2 = edgeList[nx2];
        const seg2 = (ed2.a === node) ? ed2.pts.slice() : ed2.pts.slice().reverse();
        pre = seg2.slice(0, -1).reverse().concat(pre);
        used[nx2] = true;
        const arriveDir = dirOf(seg2, false);
        node = (ed2.a === node) ? ed2.b : ed2.a;
        dirIn = arriveDir;
        if (node === e0.b) { closed = true; break; }
      }
      if (pre.length) pts = pre.concat(pts);
    }

    if (closed) {
      if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < tol * 2) pts.pop();
      if (pts.length >= 3) chains.push({ pts, closed: true });
    } else if (pts.length >= 2) {
      chains.push({ pts, closed: false });
    }
  }

  // 缺口桥接：开口链首尾距离在 bridge 容差内就接起来（手绘/导出图纸常见小缺口）
  if (opts.bridge > tol) {
    const bridge = opts.bridge;
    let bCount = 0, bMax = 0, more = true;
    while (more) {
      more = false;
      let best = null;
      for (let bi = 0; bi < chains.length; bi++) {
        const A = chains[bi];
        if (A.closed) continue;
        for (let bj = bi + 1; bj < chains.length; bj++) {
          const B = chains[bj];
          if (B.closed) continue;
          const aS = A.pts[0], aE = A.pts[A.pts.length - 1];
          const bS = B.pts[0], bE = B.pts[B.pts.length - 1];
          let d;
          d = dist(aE, bS); if (d <= bridge && (!best || d < best.d)) best = { d, i: bi, j: bj, how: 0 };
          d = dist(aE, bE); if (d <= bridge && (!best || d < best.d)) best = { d, i: bi, j: bj, how: 1 };
          d = dist(aS, bE); if (d <= bridge && (!best || d < best.d)) best = { d, i: bi, j: bj, how: 2 };
          d = dist(aS, bS); if (d <= bridge && (!best || d < best.d)) best = { d, i: bi, j: bj, how: 3 };
        }
      }
      if (!best) break;
      const cA = chains[best.i], cB = chains[best.j];
      const pB = cB.pts.slice();
      let merged;
      if (best.how === 0) merged = cA.pts.concat(pB.slice(1));
      else if (best.how === 1) merged = cA.pts.concat(pB.slice(0, -1).reverse());
      else if (best.how === 2) merged = pB.concat(cA.pts.slice(1));
      else merged = pB.reverse().concat(cA.pts.slice(1));
      chains[best.i] = { pts: merged, closed: false, bridged: true };
      chains.splice(best.j, 1);
      bCount++;
      if (best.d > bMax) bMax = best.d;
      more = true;
    }
    if (bCount) chains._bridge = { count: bCount, max: bMax };
  }

  for (const c of chains) {
    if (c.closed) continue;
    const d0 = dist(c.pts[0], c.pts[c.pts.length - 1]);
    const bb = bbox(c.pts);
    const diag = Math.hypot(bb.w, bb.h);
    const closeTol = Math.max(tol * 4, diag * 0.01, opts.bridge || 0);
    if (d0 < closeTol) {
      c.closed = true;
      if (d0 > 0.0001) c.bridgedGap = d0;
      if (d0 < tol * 2 && c.pts.length > 3) c.pts.pop();
    }
  }

  return chains;
}

/** 轮廓归一化：外轮廓 + 内孔（按包含深度奇偶判定） */
export function normalizeLoops(chains, minArea) {
  minArea = minArea || 0.5;
  chains = chains.map((c) => {
    if (c.closed) return c;
    const pts = c.pts || c;
    if (!pts || pts.length < 3) return c;
    const g = dist(pts[0], pts[pts.length - 1]);
    if (g <= 0.02) return { pts, closed: true };
    const bb = bbox(pts), dg = Math.hypot(bb.w, bb.h);
    if (dg > 0 && g <= Math.max(0.05, dg * 0.01)) return { pts, closed: true };
    return c;
  });

  const loops = chains
    .filter((c) => c.closed && c.pts.length >= 3)
    .map((c) => {
      const pts = dedupe(c.pts, 1e-6);
      return {
        pts,
        area: Math.abs(area(pts)),
        bbox: bbox(pts),
        perimeter: perimeter(pts),
        role: 'outer',
      };
    })
    .filter((l) => l.area >= minArea && l.perimeter > 0);

  loops.sort((a, b) => b.area - a.area);

  for (let i = 0; i < loops.length; i++) {
    const l = loops[i];
    l.depth = 0;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      const o = loops[j];
      if (o.area <= l.area) continue;
      const inside = l.bbox.minX >= o.bbox.minX - 1e-6 && l.bbox.maxX <= o.bbox.maxX + 1e-6 &&
                     l.bbox.minY >= o.bbox.minY - 1e-6 && l.bbox.maxY <= o.bbox.maxY + 1e-6 &&
                     pointInPoly(l.pts[0], o.pts);
      if (inside) l.depth++;
    }
    l.role = (l.depth % 2 === 0) ? 'outer' : 'hole';
  }
  return loops;
}

export function profileStats(loops) {
  const outers = loops.filter((l) => l.role === 'outer');
  const holes = loops.filter((l) => l.role === 'hole');
  let net = 0;
  for (const l of outers) net += l.area;
  for (const l of holes) net -= l.area;
  let per = 0;
  const all = [];
  for (const l of loops) {
    per += l.perimeter;
    for (const p of l.pts) all.push(p);
  }
  return {
    area: Math.max(net, 0),
    outerArea: outers.reduce((s, l) => s + l.area, 0),
    holes: holes.length,
    outers: outers.length,
    perimeter: per,
    bbox: bbox(all),
  };
}

export default {
  area, perimeter, bbox, centroid, pointInPoly, dist, distPointSeg,
  simplify, dedupe, arcPoints, bulgePoints, chain, normalizeLoops, profileStats,
};