import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../lib/dxf/parse.mjs';
import { recognize } from '../lib/dxf/profile.mjs';
import * as G from '../lib/dxf/geom.mjs';

/* ---------- 造一张最小 ASCII DXF ---------- */

function dxf(entities, opts = {}) {
  const insunits = opts.insunits === undefined ? 4 : opts.insunits;
  const header = insunits === null ? '' : `9\n$INSUNITS\n70\n${insunits}\n`;
  return [
    '0', 'SECTION', '2', 'HEADER', ...header.split('\n').filter(Boolean), '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC',
    '0', 'EOF', '',
  ].join('\n');
}

function line(x1, y1, x2, y2) {
  return ['0', 'LINE', '8', '0', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
}

function textAt(x, y) {
  return ['0', 'TEXT', '8', '0', '10', String(x), '20', String(y), '40', '2.5', '1', 'PART'];
}

function rect(x0, y0, x1, y1) {
  return [
    ...line(x0, y0, x1, y0),
    ...line(x1, y0, x1, y1),
    ...line(x1, y1, x0, y1),
    ...line(x0, y1, x0, y0),
  ];
}

/* ---------- 用例 ---------- */

test('矩形带内孔：2 条轮廓，外轮廓 + 内芯，净面积正确', () => {
  const res = parse(dxf([...rect(0, 0, 20, 10), ...rect(6, 3, 14, 7)]));
  assert.equal(res.loops.length, 2);

  const smart = recognize(res.loops, { texts: res.texts });
  const live = smart.loops.filter((l) => l.role !== 'aux');
  assert.equal(live.length, 2);
  assert.equal(live.filter((l) => l.role === 'outer').length, 1);
  assert.equal(live.filter((l) => l.role === 'hole').length, 1);

  const stats = G.profileStats(live);
  assert.ok(Math.abs(stats.area - 168) < 1e-6, '净面积应为 200 - 32 = 168');
  assert.ok(Math.abs(stats.bbox.w - 20) < 1e-6);
  assert.ok(Math.abs(stats.bbox.h - 10) < 1e-6);
});

test('轮廓有缺口：按阶梯容差桥接自动闭合并给出警告', () => {
  // 底边短 0.4mm，形成 0.4mm 缺口
  const ents = [
    ...line(0.4, 0, 20, 0),
    ...line(20, 0, 20, 10),
    ...line(20, 10, 0, 10),
    ...line(0, 10, 0, 0),
  ];
  const res = parse(dxf(ents));
  assert.equal(res.loops.length, 1);
  assert.ok(res.warnings.some((w) => w.includes('缺口')), '应提示缺口已闭合');
  assert.ok(Math.abs(res.loops[0].area - 199.6) < 0.5);
});

test('单位换算：$INSUNITS=1 (inch) 换算到 mm', () => {
  const res = parse(dxf(rect(0, 0, 1, 0.5), { insunits: 1 }));
  assert.equal(res.unitScale, 25.4);
  const smart = recognize(res.loops, { texts: 0 });
  const live = smart.loops.filter((l) => l.role !== 'aux');
  assert.ok(Math.abs(live[0].bbox.w - 25.4) < 1e-6);
  assert.ok(Math.abs(live[0].bbox.h - 12.7) < 1e-6);
});

test('图框剔除：有文字旁证时保留零件、忽略图框', () => {
  const ents = [...rect(0, 0, 210, 297), ...rect(20, 30, 40, 40), ...textAt(150, 20)];
  const res = parse(dxf(ents));
  const smart = recognize(res.loops, { texts: res.texts });
  const live = smart.loops.filter((l) => l.role !== 'aux');
  assert.equal(live.length, 1);
  assert.equal(live[0].role, 'outer');
  assert.ok(Math.abs(live[0].bbox.w - 20) < 1e-6);
  assert.ok(Math.abs(live[0].bbox.h - 10) < 1e-6);
  assert.ok(smart.note.includes('主视图'));
});

test('无外框旁证时保留大矩形为产品轮廓', () => {
  const res = parse(dxf([...rect(0, 0, 20, 10), ...rect(6, 3, 14, 7)]));
  const smart = recognize(res.loops, { texts: 0 });
  assert.ok(smart.note.includes('外框已保留'), '无旁证时应保留大矩形并说明');
  const live = smart.loops.filter((l) => l.role !== 'aux');
  assert.equal(live[0].role, 'outer');
  assert.ok(Math.abs(live[0].area - 200) < 1e-6);
});

test('二进制 DXF 明确报错', () => {
  assert.throws(() => parse('AutoCAD Binary DXF\r\nxx'), /二进制 DXF/);
});

/* 真实图纸基准：设 AUTODIE_DXF 指向 -6.1.dxf 跑
 * 期望（AutoDie 修复 G.chain 后的验收值）：外 73.24mm² 9.03×11.34，内 36.03mm² 7.13×5.60 */
test('真实图纸基准 -6.1.dxf', { skip: !process.env.AUTODIE_DXF }, () => {
  const text = fs.readFileSync(process.env.AUTODIE_DXF, 'utf8');
  const res = parse(text);
  const smart = recognize(res.loops, { texts: res.texts });
  const live = smart.loops.filter((l) => l.role !== 'aux').sort((a, b) => b.area - a.area);
  assert.equal(live.length, 2);
  assert.ok(Math.abs(live[0].area - 73.24) < 0.5);
  assert.ok(Math.abs(live[0].bbox.w - 9.03) < 0.05);
  assert.ok(Math.abs(live[0].bbox.h - 11.34) < 0.05);
  assert.ok(Math.abs(live[1].area - 36.03) < 0.5);
});