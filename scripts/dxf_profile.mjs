#!/usr/bin/env node
/**
 * dxf_profile.mjs —— DXF 截面识别：一张图 -> 外轮廓 + 内孔。
 *
 * 用法：
 *   node scripts/dxf_profile.mjs <file.dxf> [--json] [--svg out.svg] [--scale N]
 *
 * 例：
 *   node scripts/dxf_profile.mjs 图纸/-6.1.dxf
 *   node scripts/dxf_profile.mjs 图纸/-6.1.dxf --json
 *   node scripts/dxf_profile.mjs 图纸/1106-02.dxf --svg out/preview.svg
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '../lib/dxf/parse.mjs';
import { recognize } from '../lib/dxf/profile.mjs';
import * as G from '../lib/dxf/geom.mjs';

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function pad(text, width) {
  const w = [...text].reduce((s, ch) => s + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - w));
}

function fmt(n, d) {
  return n.toFixed(d === undefined ? 2 : d);
}

function writeSVG(loops, file, stats) {
  const b = stats.bbox;
  const w = Math.max(b.w, 1e-6), h = Math.max(b.h, 1e-6);
  const margin = Math.max(w, h) * 0.08;
  const vb = [b.minX - margin, -b.maxY - margin, w + margin * 2, h + margin * 2];
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map((v) => fmt(v, 3)).join(' ')}" width="800">`);
  parts.push('<rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="#0f1115"/>');
  for (const l of loops) {
    if (l.role === 'aux') continue;
    const d = l.pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p[0], 3)} ${fmt(-p[1], 3)}`).join('') + 'Z';
    const stroke = l.role === 'hole' ? '#facc15' : '#ffffff';
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${fmt(Math.max(w, h) * 0.004, 4)}"/>`);
  }
  parts.push('</svg>');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, parts.join('\n'), 'utf8');
}

function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('用法: node scripts/dxf_profile.mjs <file.dxf> [--json] [--svg out.svg] [--scale N]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error('文件不存在: ' + file);
    process.exit(2);
  }

  const scale = Number(arg('--scale', '1')) || 1;
  const text = decode(fs.readFileSync(file));
  const res = parse(text, { scale });
  const smart = recognize(res.loops, { texts: res.texts });
  const loops = smart.loops;
  const stats = G.profileStats(loops.filter((l) => l.role !== 'aux'));

  const svgOut = arg('--svg', null);
  if (svgOut) writeSVG(loops, svgOut, stats);

  if (process.argv.includes('--json')) {
    const out = {
      file: path.basename(file),
      entityCount: res.entityCount,
      unitScale: res.unitScale,
      texts: res.texts,
      note: smart.note,
      warnings: res.warnings,
      stats: {
        area: Number(stats.area.toFixed(4)),
        outerArea: Number(stats.outerArea.toFixed(4)),
        holes: stats.holes,
        outers: stats.outers,
        perimeter: Number(stats.perimeter.toFixed(3)),
        bbox: {
          w: Number(stats.bbox.w.toFixed(3)),
          h: Number(stats.bbox.h.toFixed(3)),
          minX: Number(stats.bbox.minX.toFixed(3)),
          minY: Number(stats.bbox.minY.toFixed(3)),
        },
      },
      loops: loops.map((l) => ({
        role: l.role,
        area: Number(l.area.toFixed(4)),
        width: Number(l.bbox.w.toFixed(3)),
        height: Number(l.bbox.h.toFixed(3)),
        points: l.pts.length,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(stats.area > 0 ? 0 : 1);
  }

  if (!loops.length) {
    console.log('未识别到闭合轮廓。');
    for (const w of res.warnings) console.log('! ' + w);
    process.exit(1);
  }

  const head = ['角色', '面积(mm²)', '尺寸(mm)', '点数'];
  const rows = loops
    .slice()
    .sort((a, b) => (a.role === 'aux') - (b.role === 'aux') || b.area - a.area)
    .map((l) => [
      l.role === 'outer' ? '外轮廓' : l.role === 'hole' ? '内芯' : '忽略',
      fmt(l.area, 2),
      fmt(l.bbox.w, 2) + ' × ' + fmt(l.bbox.h, 2),
      String(l.pts.length),
    ]);
  const widths = head.map((h, i) => Math.max(...[h, ...rows.map((r) => r[i])].map((t) => {
    return [...t].reduce((s, ch) => s + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  })));
  console.log('文件: ' + path.basename(file) + '  图元: ' + res.entityCount + '  单位系数: ' + res.unitScale);
  console.log(head.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join('  '));
  console.log('');
  console.log('净面积 ' + fmt(stats.area) + ' mm²  外包 ' + fmt(stats.bbox.w) + ' × ' + fmt(stats.bbox.h) +
    ' mm  内孔 ' + stats.holes + ' 个');
  if (smart.note) console.log('说明: ' + smart.note);
  for (const w of res.warnings) console.log('! ' + w);
  if (svgOut) console.log('预览已写入: ' + svgOut);
  process.exit(stats.area > 0 ? 0 : 1);
}

main();