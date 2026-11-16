# ai-automation-tools

AI 自动化工具集：把重复劳动固化成可复用的脚本、工作流与 Agent 能力。

## 目标

- **能脚本化的不手工做**：一次性操作沉淀为可重复执行的脚本。
- **能验证的再交付**：每个工具都带最小可运行示例与真实实测数据。
- **小而专**：一个工具解决一个问题，组合起来完成复杂任务。

## 目录结构

```
.
├── scripts/      # 命令行工具（Python / Node 入口）
├── lib/          # 可复用库（零依赖，浏览器与 Node 通用）
├── tests/        # 回归测试（node --test）
├── workflows/    # 可编排的自动化流程
├── agents/       # Agent 提示词、技能与配置
└── docs/         # 使用说明与踩坑记录
```

各目录的约定见目录内 README。

## 工具列表

| 工具 | 作用 | 说明 |
| --- | --- | --- |
| `scripts/dxf_stats.py` | DXF 批量体检：图元数、类型、图层、外包尺寸、单位 | Python 3.8+，[文档](docs/dxf-stats.md) |
| `scripts/dxf_profile.mjs` | DXF 截面识别：图框剔除、视图选择、外轮廓 + 内孔 | Node 18+，[文档](docs/dxf-recognize.md) |
| `scripts/dxf_batch.mjs` | 批量识别一个目录的 DXF，产出 CSV 报告 | Node 18+，[文档](docs/dxf-batch.md) |
| `lib/dxf/` | 截面识别链路（解析 / 几何 / 归类三段） | [说明](lib/dxf/README.md) |

## 快速开始

```bash
git clone https://github.com/QCSJGZS/ai-automation-tools.git
cd ai-automation-tools

# 体检一批 DXF
python scripts/dxf_stats.py D:\图纸 --recursive

# 识别单张图的截面
node scripts/dxf_profile.mjs D:\图纸\-6.1.dxf
node scripts/dxf_profile.mjs D:\图纸\-6.1.dxf --json --svg out/preview.svg

# 批量识别一个目录，产出 CSV 报告
node scripts/dxf_batch.mjs D:\图纸 --csv out\dxf-report.csv

# 跑测试
npm test
```

## 使用约定

1. 优先使用跨平台脚本（Python / Node.js），零第三方依赖优先。
2. 敏感信息通过环境变量传入，不写入仓库。
3. 破坏性操作必须先确认目标路径，不改动输入文件。
4. 新增工具同时补：目录 README 的一行说明 + `docs/` 里的用法与限制 + 至少一个回归测试。

## 贡献

欢迎提交 Issue 描述需求或问题；提交 PR 前请确保附有可复现的示例。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。