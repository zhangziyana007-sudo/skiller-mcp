# 🎨 Skiller MCP — AI 技能管理器

<p align="center">
  <strong>为 Cursor 打造的 AI Agent 技能管理 MCP Server</strong><br>
  搜索 · 分类 · 预览 · 安装 · 社区共享 — 一站式管理你的所有 AI Skills
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MCP-Compatible-blue?style=flat-square" alt="MCP">
  <img src="https://img.shields.io/badge/Node.js-20+-green?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License">
</p>

---

## ✨ 功能特性

### 🔍 智能搜索与分类
- 自动扫描 `~/.cursor/skills/`、`~/.cursor/superpowers/skills/`、`~/.cursor/skills-cursor/` 三个目录
- 基于关键词的智能分类（9 大类 25+ 子分类）
- 全文搜索 + Token 预估，按需加载节省 Token

### 🏪 技能广场 (Skill Plaza)
- 从 Anthropic 官方、Superpowers 等在线仓库浏览技能
- 一键安装在线技能到本地
- 预览 SKILL.md 内容后再决定是否安装

### 🌍 社区共享
- **多源订阅**：添加多个社区仓库，聚合浏览所有来源的技能
- **一键上传**：将本地技能推送到你的 GitHub 社区仓库
- **Issue 投稿**：没有写权限？通过 Issue 提交技能等待审核
- **投稿管理**：查看投稿状态（待审核/已通过/已拒绝）

### 📊 可视化 Dashboard
- 蜡笔小新风格的现代化 Web UI
- 实时监听 MCP 工具使用（SSE 推送 + Toast 通知）
- 子技能树状结构展示
- 使用日志追踪

### 🛠️ MCP 工具集 (7 个工具)

| 工具 | 说明 |
|------|------|
| `list_categories` | 浏览技能分类树 |
| `search_skills` | 搜索技能（关键词 + 分类过滤） |
| `get_skill_detail` | 加载技能完整内容 |
| `scan_skills` | 重新扫描并重建索引 |
| `skill_stats` | 查看技能库统计 |
| `search_online` | 在线搜索 GitHub Skills |
| `fetch_online_skill` | 获取在线技能预览 |

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
      "args": ["tsx", "/path/to/.cursor/skiller/src/index.ts"]
    }
  }
}
```

### 4. 启动 Dashboard（可选）

```bash
npm run dashboard
# 访问 http://localhost:3737
```

---

## 🌍 社区共享指南

### 作为分享者

1. 创建一个公开的 GitHub 仓库（如 `your-name/skill-community`）
2. 在 Dashboard 的社区设置中配置仓库和 Token
3. 选择技能点击「上传」即可

### 作为使用者

1. 打开 Dashboard → 社区 → 订阅源管理
2. 添加别人的仓库地址（如 `someone/their-skills`）
3. 浏览并安装感兴趣的技能

### 没有写权限？

通过「Issue 投稿」功能提交技能到任意社区仓库，等待管理员审核。

---

## 📁 项目结构

```
skiller/
├── src/
│   ├── index.ts        # MCP Server 入口（7 个工具）
│   ├── dashboard.ts    # Web Dashboard 服务器
│   ├── indexer.ts      # 技能扫描与索引构建
│   ├── searcher.ts     # 搜索引擎
│   ├── types.ts        # 类型定义与分类树
│   ├── logger.ts       # 使用日志
│   ├── plaza.ts        # 技能广场（在线仓库）
│   ├── community.ts    # 社区功能（多源/上传/投稿）
│   └── skill-parser.ts # 子技能树解析器
├── dashboard/
│   └── index.html      # Dashboard 前端页面
├── data/               # 运行时数据（不提交）
├── package.json
└── README.md
```

---

## 🤝 贡献

欢迎提交 Pull Request！

---

## 📜 License

MIT
