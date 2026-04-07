# 🏗️ 创建你自己的技能社区

> 3 分钟拥有一个属于你/你的团队的技能共享社区

---

## 为什么要创建自己的社区？

- **团队协作**：团队成员共享调试技能、代码规范、工作流
- **知识沉淀**：把常用的 Prompt 和工具打包成可复用的技能
- **开源分享**：让全世界的 Cursor 用户都能用到你的技能

---

## 快速搭建（3 步完成）

### 第 1 步：创建 GitHub 仓库

1. 打开 https://github.com/new

2. 填写信息：

   | 字段 | 填写 |
   |------|------|
   | Repository name | `skill-community`（或你喜欢的名字） |
   | Description | `My Cursor AI Skills Community` |
   | Visibility | **Public**（选公开，别人才能看到） |
   | Initialize | ✅ 勾选 Add a README file |

3. 点击 **Create repository**

4. 创建 skills 目录：
   - 点击 **Add file** → **Create new file**
   - 文件名输入：`skills/.gitkeep`
   - 点击 **Commit new file**

> 🎉 仓库创建完成！你的仓库地址是 `你的用户名/skill-community`

---

### 第 2 步：创建 GitHub Token

1. 打开 https://github.com/settings/tokens/new

2. 填写：

   | 字段 | 填写 |
   |------|------|
   | Note | `skiller` |
   | Expiration | 90 days（或你喜欢的时间） |
   | Scopes | ✅ 勾选 `repo` |

3. 点击 **Generate token**

4. **立即复制 Token**（形如 `ghp_xxxxxxx`，页面关闭后就看不到了！）

> ⚠️ Token 相当于密码，不要分享给别人

---

### 第 3 步：在 Skiller Dashboard 中配置

1. 打开 Skiller Dashboard：http://localhost:3737

2. 点击顶部的 **🌍 社区**

3. 点击 **⚙️ 设置** 标签

4. 填写：

   | 字段 | 填写 |
   |------|------|
   | 社区仓库 | `你的用户名/skill-community` |
   | 分支 | `main` |
   | 技能目录 | `skills` |
   | GitHub Token | 刚才复制的 Token |
   | 作者名称 | 你的昵称 |

5. 点击 **💾 保存配置**

> 🎉 配置完成！现在可以上传技能了

---

## 上传技能到你的社区

1. 社区页面 → **📤 上传/投稿** 标签

2. 在「直接上传」区域，找到你想分享的技能

3. 点击 **📤 上传**

4. 等待按钮变成 **✓ 已上传**

> 技能会自动推送到你的 GitHub 仓库的 `skills/技能名/SKILL.md`

---

## 让别人使用你的社区

### 你需要做的

把你的仓库地址告诉别人。可以这样说：

> 💬 "在 Skiller Dashboard 的社区页面，添加订阅源：`你的用户名/skill-community`，就能看到我分享的技能了"

或者直接发 GitHub 链接：

> 💬 "订阅我的技能库：https://github.com/你的用户名/skill-community"

### 别人需要做的

1. 打开 Skiller Dashboard → 🌍 社区 → 📡 订阅源管理
2. 在输入框粘贴你的仓库地址
3. 点击「订阅」
4. 回到「浏览技能」标签就能看到你的所有技能了！

---

## 进阶：让仓库更专业

### 编写好的 SKILL.md

在技能的 SKILL.md 开头添加 frontmatter，让搜索和展示更友好：

```markdown
---
name: my-awesome-skill
description: 这个技能可以帮你自动化部署流程
author: 你的名字
tags: [deploy, automation, ci]
sub_skills:
  - title: 自动构建
    description: 自动化 build 流程
  - title: 部署检查
    description: 部署前的安全检查
---

# My Awesome Skill

这是技能的正文内容...
```

### 关键 frontmatter 字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 技能名称 | `auto-deploy` |
| `description` | 一句话描述 | `自动化部署流程` |
| `author` | 作者名 | `zizaya` |
| `tags` | 标签数组 | `[deploy, ci, automation]` |
| `sub_skills` | 子技能列表 | 见上方示例 |

### 仓库结构建议

```
your-skill-community/
├── README.md              # 社区介绍
├── skills/
│   ├── skill-name-1/
│   │   └── SKILL.md
│   ├── skill-name-2/
│   │   └── SKILL.md
│   └── skill-name-3/
│       └── SKILL.md
└── .github/
    └── ISSUE_TEMPLATE/    # 可选：投稿模板
        └── skill-submission.md
```

### 添加 Issue 投稿模板（可选）

在仓库中创建 `.github/ISSUE_TEMPLATE/skill-submission.md`：

```markdown
---
name: 技能投稿
about: 提交一个新技能到社区
title: "[Skill Submit] 技能名 by 你的名字"
labels: skill-submission
---

## 技能信息

**技能名称**:
**作者**:
**描述**:

## SKILL.md 内容

```markdown
# 你的技能内容

粘贴在这里...
```
```

这样别人通过 Issue 投稿时，会有标准化的模板引导。

---

## 管理你的社区

### 审核投稿

1. 在 GitHub 仓库的 Issues 页面查看 `skill-submission` 标签的 Issue
2. 审核内容，如果通过：
   - 复制 SKILL.md 内容
   - 在仓库中创建 `skills/技能名/SKILL.md`
   - 给 Issue 添加 `approved` 标签并关闭
3. 如果不通过：
   - 给 Issue 添加 `rejected` 标签并说明原因

### 设置仓库 Topics

在 GitHub 仓库页面 → 右侧 About → 添加 Topics：

- `cursor-skills`
- `ai-agent`
- `mcp`
- `skiller`

这样别人在 GitHub 上搜索时更容易发现你的社区。

---

## 常见问题

### Q: 仓库一定要公开吗？
**A:** 如果你想让所有人看到，是的。如果只想团队内部用，可以设为 Private，但需要给团队成员的 Token 设置 repo 权限。

### Q: 我可以创建多个社区仓库吗？
**A:** 可以！比如一个给团队内部用，一个开源分享。在 Dashboard 设置中切换即可。

### Q: 别人需要 Token 才能看到我的技能吗？
**A:** 如果仓库是 Public（公开），不需要 Token 就能浏览和安装。只有上传才需要 Token。

### Q: 怎么把社区做大？
**A:**
1. 多上传高质量的技能
2. 在 GitHub 添加好的 README 和 Topics
3. 在技术社群分享你的仓库地址
4. 鼓励用户通过 Issue 投稿

---

*开始创建你的社区吧！有问题请到 [skiller-mcp](https://github.com/zhangziyana007-sudo/skiller-mcp/issues) 提 Issue。*
