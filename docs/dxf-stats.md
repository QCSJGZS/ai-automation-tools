# dxf_stats.py —— DXF 批量体检

一次性看清一批 DXF 的规模与形状，先筛后看，不用逐个打开 CAD。

## 用法

```bash
python scripts/dxf_stats.py <目录或文件> [--recursive] [--json] [--limit N]
```

| 参数 | 说明 |
| --- | --- |
| `target` | DXF 文件，或包含 DXF 的目录（只看顶层） |
| `-r, --recursive` | 递归子目录 |
| `--json` | 输出机器可读 JSON，便于二次处理 |
| `--limit N` | 最多处理 N 个文件，先看样本 |

零依赖，Python 3.8+ 即可运行。

## 实测样例

在一批真实图纸上跑（5 个 DXF）：

```
文件         图元  主要类型                        外包尺寸(mm)     单位
----------   ----  ------------------------------  ---------------  ----
-5.dxf       23    ARC×11 ELLIPSE×11 CIRCLE×1      8.51 × 7.40      mm
-6.1.dxf     24    LINE×14 ARC×10                  16.00 × 18.43    mm
1106-02.dxf  25    LINE×10 ARC×8 CIRCLE×4 MTEXT×2  184.20 × 235.45  mm
1106-2.dxf   47    LWPOLYLINE×45 ARC×1 CIRCLE×1    8.20 × 15.20     mm
```

## JSON 字段

| 字段 | 含义 |
| --- | --- |
| `entities` | 图元总数（不含 VERTEX/SEQEND） |
| `types` | 各类型图元数量，按数量降序 |
| `layers` | 各图层图元数，按数量降序 |
| `unit` / `insunits` | `$INSUNITS` 解释出的单位与原始值 |
| `width_mm` / `height_mm` | 几何外包尺寸（换算到 mm） |
| `geom_bbox_mm` | 几何外包框 `[xmin, ymin, xmax, ymax]` |
| `bbox_mm` | 含文字/标注/块参照的总外包框 |

## 已知限制

- **只支持 ASCII DXF**。二进制 DXF 会直接报错提示另存，不会静默出错。
- **INSERT 不展开**：块参照只计 1 个图元、只取插入点，不含块内几何，外包尺寸可能偏小。
- **SPLINE 取控制点**近似外包，能包住曲线但略大于真实形状。
- **尺寸标注的尺寸界线属于 LINE**，会被算进几何外包，排版图可能因此偏大（这类图看 `types` 和图层更有意义）。
- 单位只认 `$INSUNITS`；老图纸不写这个头时按 `unitless`（系数 1，按图内单位原样输出）。
- 中文图层名兼容 UTF-8 与 GBK 编码的 DXF。

## 为什么先做这个

图纸识别的踩坑经验：**先量化，再判断**。图元数、类型分布、外包尺寸这三个数对不上，就不用往下看轮廓识别了 —— 问题通常已经暴露在解析层。