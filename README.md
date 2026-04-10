# 🎨 Skiller MCP — AI 技能管理器

<p align="center">
  <strong>为 Cursor 打造的一站式 AI Agent 技能管理平台</strong><br>
  本地仓库 · 6 种安装模式 · 社区共享 · 可视化 Dashboard · 项目级配置
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.3.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/MCP-Compatible-blueviolet?style=flat-square" alt="MCP">
  <img src="https://img.shields.io/badge/Node.js-20+-green?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License">
</p>

---

## 核心理念

Skiller 将所有 AI 技能统一管理到一个**本地仓库**中，无论是自建技能、社区下载还是全局安装的 Skill，都能在同一个面板中浏览、搜索、安装到任意项目。

```
本地仓库（统一视图）
├── ~/.cursor/skills/          ← 全局 Skill（Agent 按需加载）
├── ~/.cursor/skills-cursor/   ← Cursor 内置技能
├── ~/.cursor/superpowers/skills/ ← Superpowers 插件技能
└── ~/.cursor/skiller/data/repository/ ← 社区下载的技能
```

---

## ✨ 功能全景

### 📦 本地仓库 + 6 种安装模式

技能统一存储在本地仓库中，安装到项目时支持 Cursor 官方定义的 6 种模式：

| 模式 | 存储位置 | 触发方式 | Token 消耗 |
|------|----------|----------|-----------|
| **全局 Skill** | `~/.cursor/skills/` | Agent 按需加载 | 🟢 省 |
| **.cursorrules** | 项目根目录 | 始终生效 | 🔴 多 |
| **Always Rule** | `.cursor/rules/` | 始终注入上下文 | 🔴 多 |
| **Auto Rule** | `.cursor/rules/` | 匹配文件模式时激活 | 🟡 中 |
| **Agent Rule** | `.cursor/rules/` | Agent 根据描述按需加载 | 🟢 省 |
| **Manual Rule** | `.cursor/rules/` | 用户 @引用时加载 | 🟢 省 |

### 🌍 社区共享

- **多源订阅**：添加多个 GitHub 社区仓库，聚合浏览所有来源的技能
- **智能缓存**：30 分钟自动缓存 + 描述渐进回写，1400+ 技能秒开
- **一键上传**：将本地技能推送到你的 GitHub 社区仓库
- **Issue 投稿**：没有写权限？通过 Issue 提交技能等待审核
- **链接安装**：粘贴 GitHub 链接直接安装，支持目录和文件链接

### 📁 项目驱动工作区

- 添加/管理多个项目目录，每个项目独立配置技能
- 从本地仓库一键安装技能到项目（自动选择安装模式）
- 批量管理：全选 / 批量删除 / 拖拽排序
- 项目分组 + 自定义排序
- 检查项目技能更新

### 📊 可视化 Dashboard

- **6 种主题**：简洁（默认）、蜡笔小新、暗黑、海洋、森林、日落
- **实时监听**：MCP 工具调用 SSE 推送 + Toast 通知
- **技能详情**：点击卡片查看完整内容、Token 预估、安装模式
- **分类管理**：自定义分层分类 + 多标签归类
- **MCP 管理**：查看/重启 MCP Server 状态
- **使用日志**：追踪工具调用历史

### ⚡ 性能优化

| 优化策略 | 说明 |
|---------|------|
| **mtime 缓存** | 目录无变化时跳过索引重建，启动 0ms |
| **延迟加载** | 项目规则按需扫描，不拖慢首屏 |
| **文件拆分** | HTML/CSS/JS 独立文件，浏览器并行加载+缓存 |

### 🛠️ MCP 工具集

| 工具 | 说明 |
|------|------|
| `list_categories` | 浏览技能分类树 |
| `search_skills` | 搜索技能（关键词 + 分类过滤） |
| `get_skill_detail` | 加载技能完整 SKILL.md 内容 |
| `scan_skills` | 重新扫描并重建索引 |
| `skill_stats` | 技能库统计（总数/来源/分类分布） |
| `search_online` | 在线搜索 GitHub 上的 AI Skills |
| `fetch_online_skill` | 获取在线技能预览（不安装） |
| `community_guide` | 获取社区功能使用指南 |

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/zhangziyana007-sudo/skiller-mcp.git ~/.cursor/skiller
cd ~/.cursor/skiller
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 Cursor MCP

在 `~/.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "skiller": {
      "command": "npx",
      "args": ["tsx", "~/.cursor/skiller/src/index.ts"]
    }
  }
}
```

### 4. 启动 Dashboard

```bash
npm run dashboard
# 访问 http://localhost:3737
```

---

## 🌍 社区使用指南

### 分享技能

1. 创建一个公开的 GitHub 仓库（如 `your-name/skill-community`）
2. 在 Dashboard 社区设置中配置仓库名和 GitHub Token
3. 在本地仓库的技能卡片上点击 📤 上传

### 安装技能

1. 打开 Dashboard → 🌍 社区
2. 订阅别人的仓库地址（如 `someone/their-skills`）
3. 浏览技能列表，点击安装到本地仓库
4. 在项目配置中选择合适模式安装到具体项目

### 链接安装

粘贴 GitHub 文件/目录链接，自动解析并安装：
```
https://github.com/user/repo/tree/main/skills/my-skill
```

---

## 📁 项目结构

```
skiller/
├── src/
│   ├── index.ts          # MCP Server 入口（工具注册）
│   ├── dashboard.ts      # Web Dashboard HTTP 服务器 + API
│   ├── indexer.ts         # 技能扫描、索引构建、mtime 缓存
│   ├── searcher.ts        # 搜索引擎（关键词 + 分类过滤）
│   ├── types.ts           # TypeScript 类型定义
│   ├── logger.ts          # 使用日志记录
│   ├── community.ts       # 社区功能（多源订阅/缓存/上传/投稿）
│   ├── categories.ts      # 分类系统 + 项目管理 + 安装记录
│   └── skill-parser.ts    # 子技能树解析器
├── dashboard/
│   ├── index.html         # Dashboard 入口页（轻量 5KB）
│   ├── style.css          # 样式（6 主题 + 响应式）
│   └── app.js             # 前端逻辑（视图渲染/API 交互）
├── data/                  # 运行时数据（gitignore）
│   ├── repository/        # 本地技能仓库（社区下载）
│   ├── skills_index.json  # 技能索引缓存
│   ├── community_cache.json
│   ├── community_config.json
│   ├── overrides.json     # 用户自定义名称/描述
│   ├── user_categories.json
│   ├── project_groups.json
│   └── usage_log.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📋 更新日志

### v2.4.0 (2026-04-10)
**Feature: 本地仓库统一架构 + 性能优化 + UI 重构**
- 新增本地仓库概念：社区下载的技能统一存储到 `~/.cursor/skiller/data/repository/`
- 项目配置数据源统一为"本地仓库"，包含所有来源的技能
- 社区安装简化为两个按钮：下载到本地仓库 / 安装为全局 Skill
- 项目技能卡片支持点击查看详情（描述/Token/内容预览）
- 本地仓库卡片新增 📤 上传到社区快捷按钮
- 所有图标按钮改为文字按钮，提升可读性
- mtime 指纹缓存：目录无变化时 0ms 加载索引
- 延迟加载：项目规则按需扫描，不拖慢首屏渲染
- HTML 拆分：381KB 单文件 → index.html(5KB) + style.css(103KB) + app.js(272KB)

### v2.3.1 (2026-04-09)
- 安全加固 + 全量 Bug 修复（社区模块 #6-#30）
- XSS 防护、输入校验、路径穿越防护

### v2.3.0 (2026-04-09)
- 项目驱动工作区 + UX 全面优化
- 项目分组、拖拽排序、批量管理

### v2.2.0 (2026-04-09)
- 流畅度深度优化

### v1.8.0 (2026-04-08)
- 上传/投稿页全面美化

### v1.7.0 (2026-04-08)
- MCP Server 管理面板

### v1.6.0 (2026-04-08)
- 链接安装 + 上传美化

### v1.0.0 (2026-04-06)
- 初始版本：MCP 工具集 + Dashboard + 社区共享

---

## 🤝 贡献

欢迎提交 Pull Request 或 Issue！

---

## 📜 License

MIT
