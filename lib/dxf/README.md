# lib/dxf

从 AutoDie（口模智造）抽取的 DXF 截面识别链路，纯 ESM、零第三方依赖，浏览器与 Node 通用（不含 DOM 依赖）。

| 模块 | 职责 | 上游来源 |
| --- | --- | --- |
| [`parse.mjs`](parse.mjs) | ASCII DXF 文本 → 离散线段 → 闭合轮廓；单位换算、块展开、缺口桥接 | `js/import-dxf.js` |
| [`geom.mjs`](geom.mjs) | 平面几何内核：端点聚类 + 图行走成环、轮廓归一化（外轮廓/内孔） | `js/geom.js` |
| [`profile.mjs`](profile.mjs) | 图框剔除、视图聚类、框中框识别、角色重判、居中 | `js/app.js smartLoops` |
| [`../../scripts/dxf_profile.mjs`](../../scripts/dxf_profile.mjs) | 命令行入口 | — |

## 用法

```js
import { readFileSync } from 'node:fs';
import { parse } from './lib/dxf/parse.mjs';
import { recognize } from './lib/dxf/profile.mjs';

const text = readFileSync('a.dxf', 'utf8');
const res = parse(text);                       // { loops, warnings, texts, ... }
const smart = recognize(res.loops, { texts: res.texts });
// smart.loops: role = outer | hole | aux
```

## 为什么要拆成两层

`parse` 只回答「图里有哪些闭合环」，`recognize` 只回答「哪个环才是产品截面」。
两者职责分开，才能分别回归：几何错了看 `parse`，视图选错看 `recognize`。

## 修改前必读

- `chain()` 的图行走逻辑是修复过三次的结果，别改回贪心拼接（会拆断闭合轮廓）。
- `recognize()` 的判定顺序不能调换：图框 → 聚类 → 框中框 → 角色。
- 任何改动跑 `npm test`，并对照 `docs/dxf-recognize.md` 的验收基线。