import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'scripts', 'dxf_batch.mjs');

/* 造最小 DXF */
function dxf(entities) {
  return ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
}
function line(x1, y1, x2, y2) {
  return ['0', 'LINE', '8', '0', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
}
function rect(x0, y0, x1, y1) {
  return [...line(x0, y0, x1, y0), ...line(x1, y0, x1, y1), ...line(x1, y1, x0, y1), ...line(x0, y1, x0, y0)];
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxfbatch-'));
  fs.writeFileSync(path.join(dir, 'ok.dxf'), dxf([...rect(0, 0, 20, 10), ...rect(6, 3, 14, 7)]), 'utf8');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'open.dxf'), dxf(line(0, 0, 10, 0)), 'utf8');
  fs.writeFileSync(path.join(dir, 'broken.dxf'), 'AutoCAD Binary DXF\r\nxxxx', 'utf8');
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'not a dxf', 'utf8');
  return dir;
}

function run(dir, csv) {
  return spawnSync(process.execPath, [CLI, dir, '--csv', csv, '--quiet'], { encoding: 'utf8' });
}

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '');
  return clean.trim().split(/\r\n/).map((l) => l.split(','));
}

test('批量识别：CSV 表头、逐文件状态、BOM、只收集 .dxf', () => {
  const dir = fixture();
  const csv = path.join(dir, 'out', 'report.csv');
  const res = run(dir, csv);
  assert.equal(res.status, 1, '有报错文件时退出码应为 1');
  assert.ok(fs.existsSync(csv));

  const raw = fs.readFileSync(csv, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff, 'CSV 应带 UTF-8 BOM（Excel 中文不乱码）');

  const rows = parseCSV(raw);
  assert.equal(rows.length, 4, '表头 + 3 个 dxf');
  assert.deepEqual(rows[0].slice(0, 3), ['文件', '状态', '轮廓数']);

  const byFile = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
  assert.equal(byFile['ok.dxf'][1], '成功');
  assert.equal(byFile['ok.dxf'][2], '2', '外轮廓 + 内芯共 2 条有效轮廓');
  assert.equal(byFile['ok.dxf'][7], '168.00', '净面积 200 - 32');
  assert.equal(byFile['sub/open.dxf'][1], '无闭合轮廓');
  assert.equal(byFile['broken.dxf'][1], '报错');
  assert.ok(byFile['broken.dxf'][11].includes('二进制'));
  assert.ok(!byFile['ignore.txt'], '非 .dxf 文件不应入报告');
});

test('--flat 不进子目录；--json 输出稳定 status token', () => {
  const dir = fixture();
  const csv = path.join(dir, 'flat.csv');
  const res = spawnSync(process.execPath, [CLI, dir, '--csv', csv, '--flat', '--json', '--quiet'], { encoding: 'utf8' });
  const json = JSON.parse(res.stdout);
  assert.deepEqual(json.rows.map((r) => r.file).sort(), ['broken.dxf', 'ok.dxf']);
  assert.deepEqual(json.rows.map((r) => r.status).sort(), ['error', 'ok']);
});

test('没有 dxf 的目录：退出码 1 且提示清楚', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxfempty-'));
  const res = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('没有 .dxf'));
});

test('--limit 截断', () => {
  const dir = fixture();
  const csv = path.join(dir, 'limit.csv');
  spawnSync(process.execPath, [CLI, dir, '--csv', csv, '--limit', '1', '--quiet'], { encoding: 'utf8' });
  const rows = parseCSV(fs.readFileSync(csv, 'utf8'));
  assert.equal(rows.length, 2);
});