#!/usr/bin/env node
/**
 * dxf_batch.mjs —— 批量识别 DXF 截面，输出 CSV 报告。
 *
 * 用法：
 *   node scripts/dxf_batch.mjs <目录> [选项]
 *
 * 选项：
 *   --csv <path>   报告路径，默认 out/dxf-report.csv
 *   --json         同时把结果打到 stdout（CSV 仍写入文件）
 *   --flat         只扫当前目录，不进子目录
 *   --limit N      最多处理 N 个文件（先看样本）
 *   --no-bom       CSV 不写 UTF-8 BOM（默认写，Excel 打开中文才不乱码）
 *   --quiet        不打印进度
 *
 * 退出码：0 = 全部处理完成；1 = 有文件报错或没有识别成功；2 = 参数/路径错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '../lib/dxf/parse.mjs';
import { recognize } from '../lib/dxf/profile.mjs';
import * as G from '../lib/dxf/geom.mjs';

// 内部用稳定 token，CSV 给人看时转中文
const STATUS_CN = { ok: '成功', empty: '无闭合轮廓', error: '报错' };

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

function has(name) {
  return process.argv.includes(name);
}

function collect(dir, flat) {
  const out = [];
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (!flat) walk(full);
      } else if (ent.name.toLowerCase().endsWith('.dxf')) {
        out.push(full);
      }
    }
  })(dir);
  return out.sort();
}

function num(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : '';
}

/** 单张图：解析 + 归类，返回一行报告数据 */
function analyze(file, root) {
  const row = {
    file: path.relative(root, file).replace(/\\/g, '/') || path.basename(file),
    status: 'ok',
    loops: 0,
    outerArea: 0,
    outerW: 0,
    outerH: 0,
    holes: 0,
    netArea: 0,
    points: 0,
    entities: 0,
    unitScale: 1,
    note: '',
  };
  try {
    const text = decode(fs.readFileSync(file));
    const res = parse(text);
    const smart = recognize(res.loops, { texts: res.texts });
    const live = smart.loops.filter((l) => l.role !== 'aux');
    const stats = G.profileStats(live);

    row.entities = res.entityCount;
    row.unitScale = res.unitScale;
    row.loops = live.length;
    row.outerArea = stats.outerArea;
    row.outerW = stats.bbox.w;
    row.outerH = stats.bbox.h;
    row.holes = stats.holes;
    row.netArea = stats.area;
    row.points = live.reduce((s, l) => s + l.pts.length, 0);
    row.note = [smart.note, ...res.warnings].filter(Boolean).join('；');

    if (!live.length) row.status = 'empty';
  } catch (err) {
    row.status = 'error';
    row.note = String(err && err.message ? err.message : err);
  }
  return row;
}

const HEADERS = ['文件', '状态', '轮廓数', '外轮廓面积mm2', '外轮廓宽mm', '外轮廓高mm',
  '内孔数', '净面积mm2', '轮廓点数', '图元数', '单位系数', '说明'];

function esc(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows, withBom) {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.file, STATUS_CN[r.status] || r.status, r.loops, num(r.outerArea), num(r.outerW), num(r.outerH),
      r.holes, num(r.netArea), r.points, r.entities, r.unitScale, r.note,
    ].map(esc).join(','));
  }
  return (withBom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}

function main() {
  const target = process.argv[2];
  if (!target || target.startsWith('--')) {
    console.error('用法: node scripts/dxf_batch.mjs <目录> [--csv path] [--json] [--flat] [--limit N] [--no-bom] [--quiet]');
    process.exit(2);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('目录不存在: ' + target);
    process.exit(2);
  }

  const csvPath = arg('--csv', path.join('out', 'dxf-report.csv'));
  const limit = Number(arg('--limit', '0')) || 0;
  const quiet = has('--quiet');
  let files = collect(target, has('--flat'));
  if (limit > 0) files = files.slice(0, limit);

  if (!files.length) {
    console.error('目录下没有 .dxf 文件: ' + target);
    process.exit(1);
  }

  const rows = [];
  for (let i = 0; i < files.length; i++) {
    const row = analyze(files[i], target);
    rows.push(row);
    if (!quiet) {
      const mark = row.status === 'ok' ? '✓' : row.status === 'empty' ? '○' : '✗';
      process.stderr.write(`[${i + 1}/${files.length}] ${mark} ${row.file}\n`);
    }
  }

  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, toCSV(rows, !has('--no-bom')), 'utf8');

  const ok = rows.filter((r) => r.status === 'ok');
  const empty = rows.filter((r) => r.status === 'empty');
  const errs = rows.filter((r) => r.status === 'error');
  const totalNet = ok.reduce((s, r) => s + r.netArea, 0);

  if (has('--json')) {
    console.log(JSON.stringify({ csv: csvPath, rows }, null, 2));
  } else {
    console.log(`共 ${rows.length} 张：成功 ${ok.length} · 无闭合轮廓 ${empty.length} · 报错 ${errs.length}`);
    if (ok.length) console.log(`识别面积合计 ${totalNet.toFixed(2)} mm²`);
    for (const r of empty) console.log('○ ' + r.file + '：' + (r.note || '未识别到闭合轮廓'));
    for (const r of errs) console.log('✗ ' + r.file + '：' + r.note);
    console.log('报告已写入: ' + csvPath);
  }
  process.exit(errs.length || !ok.length ? 1 : 0);
}

main();