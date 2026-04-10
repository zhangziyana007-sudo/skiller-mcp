# Skiller MCP — 产品介绍

## 这是什么？

**Skiller** 是一个为 Claude Code 打造的 **AI Agent 技能管理平台**。它通过 MCP (Model Context Protocol) 协议与 Claude Code 深度集成，让 AI Agent 能够自动发现和加载你定义的技能，同时提供一个 Web Dashboard 来可视化管理所有技能资源。

简单来说：**Skiller = 技能仓库 + 社区市场 + 项目配置器 + 可视化管理面板**。

---

## 解决什么问题？

在使用 Claude Code 开发时，你可能遇到这些痛点：

- **技能散落各处**：全局技能、项目规则、社区技能分布在不同位置，管理起来很混乱
- **安装模式选择困难**：全局 Skill、项目 CLAUDE.md、.claude/rules/ 目录规则，该用哪种？
- **社区技能难以发现**：GitHub 上有大量优质 AI Skill，但缺少一个统一的浏览和安装入口
- **项目技能配置繁琐**：不同项目需要不同的技能组合，每次手动配置很费时

Skiller 用一个**统一的本地仓库**解决了这些问题。

---

## 核心功能

### 1. 统一本地仓库

所有技能来源汇聚到一个视图中：

```
本地仓库
├── 全局 Skill           (~/.claude/skills/)
└── 社区下载的技能        (data/repository/)
```

无论技能从哪里来，都可以在同一个面板中搜索、浏览、安装到项目。

### 2. 智能安装到项目

从仓库安装技能到项目时，支持 3 种模式，并给出 Token 消耗建议：

- **全局 Skill**（`~/.claude/skills/`）：Agent 按需加载，最省 Token，所有项目共享
- **常驻 Rule**（项目 `CLAUDE.md`）：追加到项目根目录的 CLAUDE.md，始终生效
- **按需 Rule**（`.claude/rules/`）：Agent 根据描述按需加载，省 Token

### 3. 社区生态

- **订阅**：添加任意 GitHub 仓库作为技能源，支持多源聚合
- **缓存**：30 分钟智能缓存 + 渐进描述回写，1400+ 技能秒开
- **上传**：一键将本地技能推送到你的 GitHub 社区仓库
- **投稿**：没有写权限？通过 Issue 提交技能等待审核
- **链接安装**：粘贴 GitHub URL 直接安装

### 4. 项目驱动工作区

以**项目为中心**管理技能：

- 项目网格首页，一目了然
- 每个项目独立配置已安装的技能
- 项目分组 + 拖拽排序
- 支持从 `~/.claude.json` 和本地目录自动扫描项目
- 安装注册表追踪版本，一键检查更新

### 5. 可视化 Dashboard

Web 管理面板（默认 http://localhost:3737）：

- **6 种主题**：简洁、蜡笔小新、暗黑、海洋、森林、日落
- **实时监听**：MCP 工具调用通过 SSE 推送到面板
- **技能详情**：点击卡片查看完整内容、Token 预估
- **MCP 管理**：查看所有 MCP Server 状态，一键重启
- **使用日志**：调用次数统计、工具/技能排行、7 天活跃度图表

### 6. MCP 工具集

在 Claude Code 对话中可直接使用的 8 个工具：

| 工具 | 作用 |
|------|------|
| `search_skills` | 搜索技能（关键词 + 分类） |
| `get_skill_detail` | 加载技能完整内容 |
| `list_categories` | 浏览分类树 |
| `scan_skills` | 重建索引 |
| `skill_stats` | 查看统计 |
| `search_online` | 搜索 GitHub 上的 Skill |
| `fetch_online_skill` | 预览在线技能 |
| `community_guide` | 社区使用指南 |

---

## 技术特点

- **零框架前端**：Dashboard 使用原生 HTML/CSS/JS，无 React/Vue 依赖，极致轻量
- **mtime 缓存**：目录无变化时跳过索引重建，启动 0ms
- **乐观更新**：增删操作立即反映到 UI，后台异步同步
- **API 去重**：并发请求自动合并，避免重复网络开销
- **安全加固**：XSS 防护、输入校验、路径穿越防护、Token 掩码保护
- **平台兼容**：通过 `SKILLER_PLATFORM` 环境变量支持 Claude Code 和 Cursor 双平台

---

## 适用人群

- **Claude Code 重度用户**：日常使用 AI Agent 辅助编码，需要管理大量技能与规则
- **团队协作者**：通过 GitHub 社区仓库共享团队专属的 AI 技能库
- **多项目开发者**：同时维护多个项目，每个项目需要不同的技能配置
- **AI Skill 创作者**：希望发布自己的 Skill 到社区供他人使用

---

## 一句话总结

> **Skiller 是 Claude Code 的 AI 技能包管理器 — 像 npm 管理依赖一样，管理你的 AI Agent 技能。**
