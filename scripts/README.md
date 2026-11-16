# scripts

可独立运行的命令行小工具。原则：一个脚本解决一个问题，零依赖优先，带 `--help` 和至少一个真实用例。

| 脚本 | 作用 | 依赖 |
| --- | --- | --- |
| [`dxf_stats.py`](dxf_stats.py) | DXF 批量体检：图元数、类型分布、图层、外包尺寸、图纸单位 | Python 3.8+ 标准库 |
| [`dxf_profile.mjs`](dxf_profile.mjs) | DXF 截面识别：剔除图框、选主视图、输出外轮廓与内孔 | Node 18+，依赖 `lib/dxf/` |

## 约定

- Python 脚本使用 `argparse`，Node 脚本手工解析 `--flag`；统一提供 `--json` 便于二次处理。
- 出错时返回非 0 退出码，错误信息走 stderr。
- 批量处理单个文件失败不中断整批，最后汇总失败项。
- 不改动输入文件；需要产物时写到 `out/`（已被 .gitignore 忽略）。

## dxf_stats.py

```bash
python scripts/dxf_stats.py D:\图纸
python scripts/dxf_stats.py D:\图纸 --recursive --limit 50
python scripts/dxf_stats.py D:\图纸\某件.dxf --json
```

## dxf_profile.mjs

```bash
node scripts/dxf_profile.mjs D:\图纸\-6.1.dxf
node scripts/dxf_profile.mjs D:\图纸\1106-02.dxf --json
node scripts/dxf_profile.mjs D:\图纸\-6.1.dxf --svg out/preview.svg
```

详见 [docs/dxf-stats.md](../docs/dxf-stats.md)、[docs/dxf-recognize.md](../docs/dxf-recognize.md)。