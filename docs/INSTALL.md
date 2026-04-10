# Skiller MCP — 安装与配置指南

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| **Node.js** | 20+ | 推荐 LTS 版本 |
| **npm** | 9+ | 随 Node.js 安装 |
| **Claude Code** | 最新版 | 需支持 MCP Server |
| **Git** | 2.25+ | 用于克隆和版本更新 |

---

## 一、安装

### 方式 A：从 GitHub 克隆（推荐）

```bash
git clone https://github.com/zhangziyana007-sudo/skiller-mcp.git ~/.claude/skiller
cd ~/.claude/skiller
npm install
```

### 方式 B：手动下载

1. 访问 https://github.com/zhangziyana007-sudo/skiller-mcp
2. 下载 ZIP 并解压到 `~/.claude/skiller/`
3. 进入目录执行 `npm install`

---

## 二、配置 MCP Server

### 方式 A：CLI 命令（推荐）

```bash
claude mcp add skiller -- npx tsx ~/.claude/skiller/src/index.ts
```

### 方式 B：手动编辑配置文件

编辑 `~/.claude.json`，在 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "skiller": {
      "command": "npx",
      "args": ["tsx", "~/.claude/skiller/src/index.ts"]
    }
  }
}
```

> 如果 `~/.claude.json` 中已有其他 MCP Server，在 `mcpServers` 对象中追加 `"skiller"` 即可。

### 项目级配置（可选）

如果只想在特定项目中启用 Skiller，可在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "skiller": {
      "command": "npx",
      "args": ["tsx", "~/.claude/skiller/src/index.ts"]
    }
  }
}
```

### 验证 MCP 连接

1. 重启 Claude Code
2. 在对话中尝试使用 `search_skills` 工具
3. 如果工具列表中出现 `list_categories`、`search_skills` 等工具，说明连接成功

---

## 三、启动 Dashboard

```bash
cd ~/.claude/skiller
npm run dashboard
```

默认地址：**http://localhost:3737**

### 自定义端口

通过环境变量设置：

```bash
SKILLER_PORT=8080 npm run dashboard
```

### 后台运行

```bash
nohup npm run dashboard > /dev/null 2>&1 &
```

或使用 `pm2`：

```bash
pm2 start "npx tsx src/dashboard.ts" --name skiller-dashboard
```

---

## 四、社区功能配置（可选）

社区功能允许你浏览、下载、上传 GitHub 上的 AI 技能。

### 4.1 订阅外部社区

1. 打开 Dashboard → 社区 → 订阅源管理
2. 输入 GitHub 仓库地址（格式：`owner/repo`）
3. 点击添加

公开仓库无需 Token。私有仓库需要配置 GitHub Token。

### 4.2 配置自己的社区仓库

如果你想上传和管理自己的技能社区：

1. 在 GitHub 创建一个公开仓库（如 `your-name/skill-community`）
2. 打开 Dashboard → 社区 → 我的 GitHub 社区
3. 填入仓库名和 GitHub Personal Access Token

#### 生成 GitHub Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 勾选 `repo` 权限（公开仓库只需 `public_repo`）
4. 复制 Token 粘贴到 Dashboard 配置中

> Token 存储在本地 `data/community_config.json`，不会上传到远程。

---

## 五、项目管理配置

### 添加项目

1. Dashboard 首页 → 点击「手动添加」
2. 输入项目的绝对路径
3. 或点击「扫描项目」自动发现本地项目（从 `~/.claude.json` 和常用目录）

### 项目分组

- 点击「新建分组」创建分类
- 拖拽项目卡片到分组中
- 分组支持重命名和删除

### 安装技能到项目

1. 点击项目卡片进入详情
2. 从「本地仓库」列表中选择技能
3. 选择安装模式：

| 模式 | 文件位置 | 适用场景 |
|------|---------|---------|
| **全局 Skill** | `~/.claude/skills/` | 通用技能，所有项目共享 |
| **常驻 Rule** | 项目 `CLAUDE.md` | 每次对话都注入 |
| **按需 Rule** | `.claude/rules/*.md` | 项目特定，Agent 按需加载 |

---

## 六、数据目录说明

所有运行时数据存储在 `~/.claude/skiller/data/`：

```
data/
├── repository/           # 社区下载的技能文件
├── skills_index.json     # 技能索引缓存
├── community_cache.json  # 社区技能列表缓存（30分钟过期）
├── community_config.json # 社区仓库配置 + Token
├── overrides.json        # 用户自定义技能名称/描述
├── user_categories.json  # 自定义分类
├── project_groups.json   # 项目分组配置
├── install_registry.json # 安装记录（来源/时间/哈希）
└── usage_log.json        # MCP 工具调用日志
```

> `data/` 目录已加入 `.gitignore`，不会被提交到仓库。

---

## 七、更新

### 在 Dashboard 中更新

Dashboard 右上角版本徽章会自动检测更新，点击后可一键 pull + 重新编译。

### 手动更新

```bash
cd ~/.claude/skiller
git pull
npm install
```

---

## 八、平台兼容性

Skiller 默认适配 Claude Code，但通过环境变量 `SKILLER_PLATFORM=cursor` 可切换为 Cursor IDE 模式：

```bash
SKILLER_PLATFORM=cursor npx tsx ~/.cursor/skiller/src/index.ts
```

---

## 九、故障排查

### MCP Server 无法连接

1. 确认 `~/.claude.json` 路径和格式正确
2. 确认 `npx tsx` 可正常运行：`npx tsx --version`
3. 重启 Claude Code
4. 检查 MCP Server 列表：`claude mcp list`

### Dashboard 无法访问

1. 检查端口是否被占用：`lsof -i :3737`
2. 检查防火墙设置
3. 尝试换端口：`SKILLER_PORT=8080 npm run dashboard`

### 社区功能报错

1. 检查 GitHub Token 是否过期
2. 确认仓库名格式为 `owner/repo`
3. 打开 Dashboard → 社区 → 查看错误提示

### 索引不更新

手动触发重建：
- Dashboard 顶栏点击「重新扫描」
- 或在对话中使用 `scan_skills` 工具
