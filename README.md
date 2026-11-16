# ai-automation-tools

AI 自动化工具集：把重复劳动固化成可复用的脚本、工作流与 Agent 能力。

## 目标

- **能脚本化的不手工做**：一次性操作沉淀为可重复执行的脚本。
- **能验证的再交付**：每个工具都带最小可运行示例与真实实测数据。
- **小而专**：一个工具解决一个问题，组合起来完成复杂任务。

## 目录结构

```
.
├── scripts/      # 命令行脚本与自动化小工具
├── workflows/    # 可编排的自动化流程
├── agents/       # Agent 提示词、技能与配置
└── docs/         # 使用说明与踩坑记录
```

各目录的约定见目录内 README。

## 工具列表

| 工具 | 作用 | 说明 |
| --- | --- | --- |
| `scripts/dxf_stats.py` | DXF 批量体检：图元数、类型、图层、外包尺寸、单位 | 零依赖，[文档](docs/dxf-stats.md) |

## 快速开始

```bash
git clone https://github.com/QCSJGZS/ai-automation-tools.git
cd ai-automation-tools

# 对一批 DXF 做体检
python scripts/dxf_stats.py D:\图纸 --recursive
```

## 使用约定

1. 优先使用跨平台脚本（Python / Node.js），零第三方依赖优先。
2. 敏感信息通过环境变量传入，不写入仓库。
3. 破坏性操作必须先确认目标路径，不改动输入文件。
4. 新增工具同时补：目录 README 的一行说明 + `docs/` 里的用法与限制。

## 贡献

欢迎提交 Issue 描述需求或问题；提交 PR 前请确保附有可复现的示例。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。