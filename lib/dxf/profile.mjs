/**
 * 轮廓归类与视图选择（从 AutoDie `js/app.js smartLoops` 抽取）。
 *
 * 解决的问题：一张 DXF 往往带图框、标题栏、多个视图、排版多件。
 * 这里按证据逐层剥离，最终只留「产品截面」：1 条外轮廓 + 直接内孔，
 * 其余置为 aux（仍保留在结果里，调用方可自行改回）。
 *
 * 判定顺序（顺序不能变，改前先读 docs/dxf-recognize.md）：
 *   1. 图框：几乎占满图幅的少点简单环，且需旁证（有文字/框内 ≥2 个图形/面积悬殊）
 *   2. 空间聚类：按外包框邻近把同一视图的轮廓聚成一簇，取最大一簇
 *   3. 框中框：主轮廓是轴对齐矩形且内含 ≥2 组同尺寸图形 → 排版图，改取其中最大一组
 *   4. 角色重判：簇内最大者为 outer，其余完全落在其内为 hole，否则 outer
 *   5. 居中到原点
 */

import * as G from './geom.mjs';

export function recognize(list, opts) {
  opts = opts || {};
  let note = '';
  const hasText = opts.texts > 0;
  if (!list.length) return { loops: list, note };

  // pickProfile 可能已标 aux：这里全部复位，由本函数重新判定
  for (const l of list) if (l.role === 'aux') l.role = 'outer';

  const boxes = list.map((l) => l.bbox || G.bbox(l.pts));
  const corners = [];
  for (const b of boxes) corners.push([b.minX, b.minY], [b.maxX, b.maxY]);
  const GB = G.bbox(corners);
  const GW = Math.max(GB.w, 1e-6), GH = Math.max(GB.h, 1e-6);

  // 1) 图框：占满图幅的少点简单环只是候选，必须有旁证才剔除
  //    （占满图幅的矩形也可能就是产品本身，比如带内孔的板）
  const frame = list.map((l, i) => {
    const b = boxes[i];
    return l.pts.length <= 12 && b.w >= GW * 0.9 && b.h >= GH * 0.9;
  });
  const rest = [];
  list.forEach((l, i) => { if (!frame[i]) rest.push(i); });
  if (rest.length) {
    const rc = [];
    for (const i of rest) {
      const b = boxes[i];
      rc.push([b.minX, b.minY], [b.maxX, b.maxY]);
    }
    const RB = G.bbox(rc);
    if (frame.some(Boolean) && Math.max(RB.w / GW, RB.h / GH) < 0.75) {
      let restArea = 0, frameArea = 0;
      for (const i of rest) restArea += Math.abs(list[i].area || 0);
      list.forEach((l, i) => { if (frame[i]) frameArea = Math.max(frameArea, Math.abs(l.area || 0)); });
      const evidence = hasText || rest.length >= 2 || (restArea > 0 && frameArea / restArea > 15);
      if (evidence) {
        frame.forEach((f, i) => { if (f) list[i].role = 'aux'; });
      } else {
        note = '外框已保留为产品外轮廓（未发现图框特征），如需按图框处理可在列表里改；';
      }
    }
  }

  const live = [];
  list.forEach((l, i) => { if (l.role !== 'aux') live.push(i); });
  if (!live.length) return { loops: list, note };

  // 2) 空间聚类：同一视图的轮廓归为一簇
  const parent = live.map((_, i) => i);
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  function near(a, b) {
    const A = boxes[live[a]], B = boxes[live[b]];
    const gap = Math.max(3, 0.06 * Math.max(A.w, A.h, B.w, B.h));
    return !(A.maxX < B.minX - gap || B.maxX < A.minX - gap || A.maxY < B.minY - gap || B.maxY < A.minY - gap);
  }
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) if (near(a, b)) uni(a, b);
  }
  const groups = {};
  live.forEach((_, i) => {
    const r = find(i);
    (groups[r] = groups[r] || []).push(live[i]);
  });
  const clusters = Object.keys(groups).map((k) => groups[k]);
  function sumArea(ix) { let s = 0; for (const i of ix) s += Math.abs(list[i].area || 0); return s; }
  clusters.sort((A, B) => B.length - A.length || sumArea(B) - sumArea(A));

  // 3) 只留主视图，其余置为忽略（调用方可在结果里改回）
  let best = clusters[0];
  let keep = {};
  for (const i of best) keep[i] = 1;
  list.forEach((l, i) => { if (!keep[i]) l.role = 'aux'; });

  // 3.5) 框中框：矩形大环 + 框内 ≥2 组同尺寸图形 → 排版图，改取最大一组
  (function boxInBox() {
    const oi = best[0], ol = list[oi], OB = boxes[oi];
    if (!ol || ol.pts.length < 4 || ol.pts.length > 8) return;
    const tolA = (OB.w + OB.h) * 5e-4;
    for (let i = 0; i < ol.pts.length; i++) {
      const a = ol.pts[i], b = ol.pts[(i + 1) % ol.pts.length];
      if (Math.abs(a[0] - b[0]) > tolA && Math.abs(a[1] - b[1]) > tolA) return; // 有斜边，不是图框
    }
    const tops = [];
    for (const i of best) {
      if (i === oi) continue;
      const b = boxes[i];
      const inside = b.minX >= OB.minX - 1e-6 && b.maxX <= OB.maxX + 1e-6 &&
                     b.minY >= OB.minY - 1e-6 && b.maxY <= OB.maxY + 1e-6;
      if (!inside) continue;
      const nested = tops.some((j) => {
        const bj = boxes[j];
        return b.minX >= bj.minX && b.maxX <= bj.maxX && b.minY >= bj.minY && b.maxY <= bj.maxY;
      });
      if (!nested) tops.push(i);
    }
    if (tops.length < 2) return;
    let sameMax = 0;
    for (const i of tops) {
      const bi = boxes[i];
      const n = tops.filter((j) => {
        const bj = boxes[j];
        return Math.abs(bj.w - bi.w) < Math.max(bi.w * 0.02, 0.05) &&
               Math.abs(bj.h - bi.h) < Math.max(bi.h * 0.02, 0.05);
      }).length;
      if (n > sameMax) sameMax = n;
    }
    if (sameMax < 2) return;
    tops.sort((i, j) => Math.abs(list[j].area || 0) - Math.abs(list[i].area || 0));
    const gi = tops[0], GB2 = boxes[gi];
    const newBest = [gi];
    for (const i of best) {
      if (i === gi || i === oi) continue;
      const b = boxes[i];
      const inside = b.minX >= GB2.minX - 1e-6 && b.maxX <= GB2.maxX + 1e-6 &&
                     b.minY >= GB2.minY - 1e-6 && b.maxY <= GB2.maxY + 1e-6;
      if (inside) newBest.push(i);
    }
    note = '检测到排版图框（内含 ' + tops.length + ' 组图形），已取最大一组，其余可在列表改回；';
    best = newBest;
    keep = {};
    for (const i of best) keep[i] = 1;
    list.forEach((l, i) => { if (!keep[i]) l.role = 'aux'; });
  })();

  // 4) 重新判外轮廓 / 内孔
  best.sort((i, j) => Math.abs(list[j].area || 0) - Math.abs(list[i].area || 0));
  const oi = best[0], OB = boxes[oi];
  for (const i of best) {
    if (i === oi) { list[i].role = 'outer'; continue; }
    const b = boxes[i];
    const inside = b.minX >= OB.minX - 1e-6 && b.maxX <= OB.maxX + 1e-6 &&
                   b.minY >= OB.minY - 1e-6 && b.maxY <= OB.maxY + 1e-6;
    list[i].role = inside ? 'hole' : 'outer';
  }

  // 5) 主视图平移到原点
  let pts = [];
  for (const i of best) pts = pts.concat(list[i].pts);
  const bb = G.bbox(pts);
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  for (const i of best) {
    const l = list[i];
    l.pts = l.pts.map((p) => [p[0] - cx, p[1] - cy]);
    l.bbox = G.bbox(l.pts);
    l.area = Math.abs(G.area(l.pts));
    l.perimeter = G.perimeter(l.pts);
  }

  const dropped = list.length - best.length;
  note = note + '主视图 ' + best.length + ' 条轮廓' +
    (dropped > 0 ? '（已忽略图框/其它视图 ' + dropped + ' 条）' : '') + ' · 已居中到原点';
  return { loops: list, note };
}

/** 便捷入口：DXF 文本 -> 最终轮廓（解析 + 归类） */
export function recognizeDXF(text, parseFn, opts) {
  opts = opts || {};
  const res = parseFn(text, opts);
  const smart = recognize(res.loops, { texts: res.texts });
  return { ...res, loops: smart.loops, note: smart.note, recognized: smart };
}

export default { recognize, recognizeDXF };