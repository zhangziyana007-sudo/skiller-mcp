# Changelog

## v2.0.0 — 本地仓库管理重构 (2026-04-09)

### 重大变更
- **「我的本地 Skill 仓库」** — 全新双栏布局取代旧版技能浏览 + 上传/投稿分离设计
  - 左栏：搜索、状态/分类过滤、统计条、技能列表
  - 右栏：详情信息、分类管理、描述编辑、操作按钮组、子技能树/原始内容
- **侧边栏简化** — 移除分类导航树，改为 5 个清晰入口（本地仓库、社区、分类管理、MCP 管理、使用日志）
- **社区 tab 精简** — 移除「上传/投稿」tab，上传功能统一到本地仓库管理

### 新功能
- **DESCRIPTION.md 分离存储** — 上传时用户描述独立存为 DESCRIPTION.md，不再追加到 SKILL.md
- **社区卡片优先显示自定义描述** — 浏览社区技能时优先读取 DESCRIPTION.md，回退到 SKILL.md frontmatter
- **点击查看全文** — 社区技能卡片只显示描述摘要，点击名称或「查看全文」按钮加载 SKILL.md 完整内容
- **认证支持** — 订阅私有仓库获取 DESCRIPTION.md 时带 token 认证

### 移除
- `renderSkills`、`renderSkillCard`、`showSkillDetail` 本地技能旧 UI
- `renderCommunityUpload` 及相关辅助函数
- `renderCategoryNav`、`showCategory` 侧边栏分类导航

## v1.8.0 — 社区功能增强 (2026-04-08)

- 社区仓库配置、订阅源管理、GitHub Token 授权
- 技能上传/下架/Issue 投稿
- 链接安装、缓存机制
- MCP 管理面板
- 多主题支持（默认/简约/暗色/海洋/森林/日落）

## v1.0.0 — 初始版本

- MCP Server 基础框架
- 技能搜索、分类、详情查看
- Dashboard Web UI
