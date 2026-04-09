# 🎨 Skiller MCP — AI 技能管理器

<p align="center">
  <strong>为 Cursor 打造的 AI Agent 技能管理 MCP Server</strong><br>
  搜索 · 自定义分类 · 多主题面板 · 社区订阅 — 一站式管理你的所有 AI Skills
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MCP-Compatible-blue?style=flat-square" alt="MCP">
  <img src="https://img.shields.io/badge/Node.js-20+-green?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License">
</p>

---

## ✨ 功能特性

### 🔍 智能搜索与自定义分类
- 自动扫描 `~/.cursor/skills/`、`~/.cursor/superpowers/skills/`、`~/.cursor/skills-cursor/` 三个目录
- 用户自定义分层分类体系 + 多标签归类（每个 skill 可属于多个分类）
- 全文搜索 + Token 预估，按需加载节省 Token

### 🏪 技能广场 (Skill Plaza)
- 从 Anthropic 官方、Superpowers 等在线仓库浏览技能
- 一键安装在线技能到本地
- 预览 SKILL.md 内容后再决定是否安装

### 🌍 社区共享
- **多源订阅**：添加多个社区仓库，聚合浏览所有来源的技能
- **智能缓存**：30 分钟自动缓存 + 描述渐进回写，1400+ skill 秒开加载
- **一键上传**：将本地技能推送到你的 GitHub 社区仓库（附描述模板）
- **Issue 投稿**：没有写权限？通过 Issue 提交技能等待审核
- **投稿管理**：查看投稿状态（待审核/已通过/已拒绝）

### 📊 可视化 Dashboard
- 6 种主题切换：简洁（默认）、蜡笔小新、暗色、海洋、森林、日落
- 实时监听 MCP 工具使用（SSE 推送 + Toast 通知）
- 子技能树状结构展示
- 自定义分类管理器
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
3. 选择技能点击「上传」即可（支持描述模板引导）

### 作为使用者

1. 打开 Dashboard → 社区 → 订阅源管理
2. 添加别人的仓库地址（如 `someone/their-skills`）
3. 浏览并安装感兴趣的技能
4. 首次加载自动缓存，后续秒开

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
│   ├── types.ts        # 类型定义
│   ├── logger.ts       # 使用日志
│   ├── plaza.ts        # 技能广场（在线仓库）
│   ├── community.ts    # 社区功能（多源/缓存/上传/投稿）
│   ├── categories.ts   # 自定义分类系统
│   └── skill-parser.ts # 子技能树解析器
├── dashboard/
│   └── index.html      # Dashboard 前端（多主题）
├── data/               # 运行时数据（不提交）
├── package.json
└── README.md
```

---

## 📋 更新日志

### v1.8.0 (2026-04-08)
**Feature: 上传/投稿页全面美化**
- 顶部统计概览：已上架/本地技能/待上传三色卡片
- 上传列表增加搜索过滤功能
- 每个技能卡片增加图标（已上传✅/未上传📄）和副标题
- 已上架区标题栏显示仓库名 + 刷新按钮
- Issue 投稿改为双栏布局（仓库 + 技能选择并排）
- 所有 section 统一 2px 实线边框 + 对应颜色
- 修复链接安装函数模板字符串转义导致页面空白的 bug

### v1.7.0 (2026-04-08)
**Feature: MCP Server 管理面板**
- 顶栏新增「🔌 MCP」按钮，一键打开 MCP 管理面板
- 实时显示所有 MCP 服务器状态（运行中/已停止）
- 显示每个服务器的命令、参数、进程数和 PID
- 一键重启按钮（终止进程，Cursor 自动重连）
- 查看 mcp.json 原始配置
- MCP 连接排查指南
- 新增 API: `/api/mcp/status`、`/api/mcp/restart`、`/api/mcp/config`

### v1.6.0 (2026-04-08)
**Feature: 移除广场 + 链接安装 + 上传美化**
- 移除技能广场功能，社区为唯一入口
- 新增「🔗 链接安装」标签页：粘贴 GitHub 链接一键安装 Skill
  - 自动解析 repo/branch/path
  - 支持目录链接（自动查找 SKILL.md）和文件链接
  - 自定义技能名 + 安装历史记录（localStorage）
- 新增 API: `/api/community/install-url`
- 上传卡片交互增强：hover 上浮 + 阴影过渡 + focus 高亮
- Issue 投稿按钮改为紫色渐变 + 下拉框 focus 效果

### v1.5.0 (2026-04-08)
**Feature: 上传/投稿页缓存 + 按钮美化**
- 「我的社区技能」列表 5 分钟内存缓存，避免每次切换重新请求
- 投稿列表同样 5 分钟缓存，附带缓存状态提示和手动刷新按钮
- 上传/下架操作自动失效缓存
- 投稿状态标签渐变背景：待审核(黄)、已通过(绿)、已拒绝(红)
- 所有操作按钮统一为 `btn-preview` / `btn-upload` / `btn-install` 现代风格
- Issue 投稿按钮改为紫色渐变，select 控件增加 focus 效果

### v1.4.0 (2026-04-08)
**Feature: 社区源独立授权**
- 每个订阅源支持独立 Token（私有仓库授权）
- 不填 Token 自动使用全局 Token（公开仓库 / 协作者场景）
- 订阅时折叠式 Token 输入框，已订阅源显示 🔐 标签
- API 返回脱敏 Token（`••••末4位`），完整 Token 仅存本地
- 订阅源列表支持编辑 Token / 清除 Token

### v1.3.0 (2026-04-08)
**Feature: 本地技能管理 + UI 美化**
- 技能详情面板新增「管理操作」区域（删除、复制内容）
- 新增 API：`/api/skill/delete`、`/api/skill/export`、`/api/skill/toggle`
- 社区技能上传/下架管理 — 「我的社区技能」面板
- 浏览页自有 skill 标记「我的」标签 + 下架按钮
- 全面美化按钮：渐变背景 + 阴影 + hover 动效 + 统一设计语言

### v1.2.0 (2026-04-08)
**Bug Fix: 社区大仓库加载超时**
- 使用 GitHub Tree API 替代逐目录请求，1 次请求获取整棵目录树
- SKILL.md 描述抓取从串行改为 10 并发（`parallelLimit`）
- 新增两阶段加载：先 Light 模式秒加载名称，再后台渐进补充描述
- 新增智能缓存：light/full 分层缓存，描述回写缓存，30 分钟 TTL
- 前端分页加载（30 个/页） + 缓存命中指示 + 手动刷新按钮
- 多源并行抓取（`Promise.all`）

### v1.1.0 (2026-04-07)
- 自定义分类系统（用户创建分层分类 + 多标签归类）
- 6 种主题切换（简洁/蜡笔小新/暗色/海洋/森林/日落）
- 技能上传描述模板
- 社区浏览无需配置即可访问

### v1.0.0 (2026-04-06)
- 初始版本：MCP 工具集 + Dashboard + 社区共享 + 技能广场

---

## 🤝 贡献

欢迎提交 Pull Request！

---

## 📜 License

MIT
