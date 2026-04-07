import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { getOrBuildIndex, buildIndex } from "./indexer.js";
import { searchSkills, listCategories, getSkillStats } from "./searcher.js";
import { logUsage } from "./logger.js";

const server = new McpServer({
  name: "skiller",
  version: "1.0.0",
});

let index = getOrBuildIndex();

server.tool(
  "list_categories",
  "浏览技能分类树。不传参数返回顶级分类，传 parentCategory 返回子分类。用于先了解有哪些技能类别。",
  { parentCategory: z.string().optional().describe("父分类 ID，如 'ai' 或 'development/frontend'") },
  async ({ parentCategory }) => {
    const cats = listCategories(index, parentCategory);
    logUsage("list_categories", { parentCategory }, `${cats.length} categories`);

    const formatted = cats
      .map((c) => {
        const childInfo = c.children.length > 0 ? ` (${c.children.length} 子分类)` : "";
        const iconPrefix = c.icon ? `${c.icon} ` : "";
        return `[${c.id}] ${iconPrefix}${c.label} (${c.skillCount} skills)${childInfo}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: parentCategory
            ? `分类 "${parentCategory}" 下的子分类:\n\n${formatted}`
            : `顶级分类:\n\n${formatted}\n\n提示: 使用 search_skills 搜索具体技能，或传入 parentCategory 查看子分类`,
        },
      ],
    };
  }
);

server.tool(
  "search_skills",
  "搜索技能。支持关键词搜索和分类过滤。返回匹配的技能摘要列表（不含完整内容，节省 token）。",
  {
    query: z.string().describe("搜索关键词，如 'react' 'rag' 'game' 'android debug'"),
    category: z.string().optional().describe("限定分类，如 'ai' 'development/frontend' 'creative/games'"),
    limit: z.number().optional().default(10).describe("返回结果数量上限"),
  },
  async ({ query, category, limit }) => {
    const results = searchSkills(index, query, category, limit);
    logUsage("search_skills", { query, category, limit }, `${results.length} results`);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `未找到匹配 "${query}"${category ? ` (分类: ${category})` : ""} 的技能。\n\n建议:\n- 尝试更通用的关键词\n- 使用 list_categories 浏览可用分类\n- 使用 scan_skills 重建索引`,
          },
        ],
      };
    }

    const formatted = results
      .map(
        (r, i) => {
          const catStr = r.categories.length > 0 ? r.categories.join(", ") : "未分类";
          return `${i + 1}. **${r.name}** [${catStr}]\n   ${r.description}\n   标签: ${r.tags.join(", ")} | 来源: ${r.source}`;
        }
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `找到 ${results.length} 个匹配技能:\n\n${formatted}\n\n提示: 使用 get_skill_detail(skillName) 加载完整技能内容`,
        },
      ],
    };
  }
);

server.tool(
  "get_skill_detail",
  "加载某个技能的完整 SKILL.md 内容。仅在确定要使用某个技能时调用，避免浪费 token。",
  {
    skillName: z.string().describe("技能名称，如 'brainstorming' 'android-build-push'"),
  },
  async ({ skillName }) => {
    const skill = index.skills.find(
      (s) => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
    );

    if (!skill) {
      return {
        content: [
          {
            type: "text" as const,
            text: `未找到技能 "${skillName}"。使用 search_skills 搜索可用技能。`,
          },
        ],
      };
    }

    try {
      const content = readFileSync(skill.path, "utf-8");
      logUsage("get_skill_detail", { skillName }, `loaded ${skill.name} (~${skill.tokenEstimate} tokens)`);
      return {
        content: [
          {
            type: "text" as const,
            text: `技能: ${skill.name}\n分类: ${skill.categories.length > 0 ? skill.categories.join(", ") : "未分类"}\n预估 Token: ~${skill.tokenEstimate}\n路径: ${skill.path}\n\n---\n\n${content}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `读取技能文件失败: ${skill.path}\n错误: ${err}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "scan_skills",
  "重新扫描所有 skills 目录并重建索引。当安装了新技能或修改了技能文件后调用。",
  {},
  async () => {
    const oldCount = index.totalSkills;
    index = buildIndex();
    const newCount = index.totalSkills;
    const diff = newCount - oldCount;
    logUsage("scan_skills", {}, `rebuilt: ${oldCount} → ${newCount}`);

    const stats = getSkillStats(index);
    const sourceLines = Object.entries(stats.bySource)
      .map(([source, count]) => `  ${source}: ${count}`)
      .join("\n");
    const categoryLines = Object.entries(stats.byCategory)
      .map(([cat, count]) => `  ${cat}: ${count}`)
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `索引重建完成!\n\n总技能数: ${newCount}${diff !== 0 ? ` (${diff > 0 ? "+" : ""}${diff})` : ""}\n\n按来源:\n${sourceLines}\n\n按分类:\n${categoryLines || "  (无用户分类)"}\n未分类: ${stats.uncategorizedCount}${stats.duplicateNames.length > 0 ? `\n\n重复技能: ${stats.duplicateNames.join(", ")}` : ""}`,
        },
      ],
    };
  }
);

server.tool(
  "skill_stats",
  "查看技能统计信息：总数、来源分布、分类分布、重复检测。快速了解当前技能库状态。",
  {},
  async () => {
    const stats = getSkillStats(index);
    logUsage("skill_stats", {}, `total: ${stats.total}`);

    const sourceLines = Object.entries(stats.bySource)
      .map(([source, count]) => `  ${source}: ${count}`)
      .join("\n");
    const categoryLines = Object.entries(stats.byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => `  ${cat}: ${count}`)
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Skiller 技能库统计\n${"=".repeat(30)}\n\n总技能数: ${stats.total}\n索引时间: ${index.generatedAt}\n\n按来源分布:\n${sourceLines}\n\n按分类分布:\n${categoryLines || "  (无用户分类)"}\n未分类: ${stats.uncategorizedCount}${stats.duplicateNames.length > 0 ? `\n\n⚠ 发现重复技能名: ${stats.duplicateNames.join(", ")}` : "\n\n✓ 无重复技能"}`,
        },
      ],
    };
  }
);

interface OnlineSkillResult {
  name: string;
  repo: string;
  description: string;
  installCmd: string;
}

async function searchOnlineSkills(
  query: string,
  limit: number
): Promise<OnlineSkillResult[]> {
  const results: OnlineSkillResult[] = [];

  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query + " skill SKILL.md")}&sort=stars&order=desc&per_page=${Math.min(limit, 10)}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Skiller/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.ok) {
      const data = await resp.json() as { items?: Array<{ full_name: string; description: string | null; stargazers_count: number }> };
      if (data.items) {
        for (const item of data.items.slice(0, limit)) {
          results.push({
            name: item.full_name,
            repo: `https://github.com/${item.full_name}`,
            description: item.description || "No description",
            installCmd: `npx skills add https://github.com/${item.full_name}`,
          });
        }
      }
    }
  } catch {
    // GitHub API failed, try fallback search
  }

  if (results.length === 0) {
    const knownRepos = [
      {
        name: "sickn33/antigravity-awesome-skills",
        description: "1,370+ agentic skills for Claude Code, Cursor, Codex CLI, Gemini CLI and more",
        stars: 31000,
      },
      {
        name: "VoltAgent/awesome-agent-skills",
        description: "1,060+ agent skills from official dev teams (Anthropic, Google, Vercel, Stripe...)",
        stars: 14400,
      },
      {
        name: "chrisboden/cursor-skills",
        description: "Cursor skills starter with Orchestrator + Skills MCP Server pattern",
        stars: 20,
      },
    ];

    const q = query.toLowerCase();
    for (const repo of knownRepos) {
      if (
        repo.name.toLowerCase().includes(q) ||
        repo.description.toLowerCase().includes(q) ||
        q.includes("skill") ||
        q.includes("agent")
      ) {
        results.push({
          name: repo.name,
          repo: `https://github.com/${repo.name}`,
          description: `${repo.description} (${repo.stars} stars)`,
          installCmd: `npx antigravity-awesome-skills --cursor`,
        });
      }
    }

    if (results.length === 0) {
      results.push({
        name: "sickn33/antigravity-awesome-skills",
        repo: "https://github.com/sickn33/antigravity-awesome-skills",
        description: `搜索 "${query}" — 尝试在 antigravity 的 1,370+ skills 中查找`,
        installCmd: `npx skills add https://github.com/sickn33/antigravity-awesome-skills --skill ${query.replace(/\s+/g, "-")}`,
      });
    }
  }

  return results;
}

async function fetchSkillContent(repo: string, skillName: string): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${repo}/main/skills/${skillName}/SKILL.md`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) return await resp.text();

    const url2 = `https://raw.githubusercontent.com/${repo}/HEAD/skills/${skillName}/SKILL.md`;
    const resp2 = await fetch(url2, { signal: AbortSignal.timeout(10000) });
    if (resp2.ok) return await resp2.text();
  } catch {
    // fetch failed
  }
  return null;
}

server.tool(
  "search_online",
  "在线搜索 GitHub 上的 AI Skills。当本地找不到需要的技能时使用。返回匹配的在线仓库和安装命令。",
  {
    query: z.string().describe("搜索关键词，如 'rag' 'game development' 'react patterns'"),
    limit: z.number().optional().default(5).describe("返回结果数量上限"),
  },
  async ({ query, limit }) => {
    const results = await searchOnlineSkills(query, limit);
    logUsage("search_online", { query, limit }, `${results.length} repos found`);

    if (results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `在线未找到匹配 "${query}" 的技能仓库。\n\n建议手动访问:\n- https://skills.sh/trending\n- https://antigravityskills.directory/\n- https://officialskills.sh/`,
        }],
      };
    }

    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.name}**\n   ${r.description}\n   安装: \`${r.installCmd}\`\n   仓库: ${r.repo}`
      )
      .join("\n\n");

    return {
      content: [{
        type: "text" as const,
        text: `在线找到 ${results.length} 个相关技能仓库:\n\n${formatted}\n\n提示: 使用 fetch_online_skill 获取某个在线技能的完整内容进行预览`,
      }],
    };
  }
);

server.tool(
  "fetch_online_skill",
  "从 GitHub 获取一个在线 Skill 的完整 SKILL.md 内容（不安装到本地）。用于预览后决定是否安装。",
  {
    skillName: z.string().describe("技能名称，如 'langgraph' 'prompt-engineer' 'game-development'"),
    repo: z.string().optional().default("sickn33/antigravity-awesome-skills").describe("GitHub 仓库，默认为 antigravity"),
  },
  async ({ skillName, repo }) => {
    const content = await fetchSkillContent(repo, skillName);
    logUsage("fetch_online_skill", { skillName, repo }, content ? "success" : "not found");

    if (!content) {
      return {
        content: [{
          type: "text" as const,
          text: `无法从 ${repo} 获取技能 "${skillName}" 的内容。\n\n可能原因:\n- 技能名称不正确\n- 网络问题\n- 仓库结构不同\n\n建议使用 search_online 搜索正确的技能名称`,
        }],
      };
    }

    const tokenEstimate = Math.ceil(content.length / 3.5);

    return {
      content: [{
        type: "text" as const,
        text: `在线技能: ${skillName}\n来源: ${repo}\n预估 Token: ~${tokenEstimate}\n\n---\n\n${content}`,
      }],
    };
  }
);

const COMMUNITY_SETUP_GUIDE = `
🏗️ 创建你自己的技能社区 — 3 步完成

═══════════════════════════════════════

📌 第 1 步：创建 GitHub 仓库

1. 打开 https://github.com/new
2. 仓库名：skill-community（或你喜欢的）
3. 选择 Public（公开）
4. ✅ 勾选 Add a README file
5. 点击 Create repository
6. 在仓库中创建 skills/ 目录：
   - Add file → Create new file → 输入 skills/.gitkeep → Commit

═══════════════════════════════════════

🔑 第 2 步：创建 GitHub Token

1. 打开 https://github.com/settings/tokens/new
2. Note 填 skiller
3. ✅ 勾选 repo 权限
4. 点击 Generate token
5. 复制 Token（形如 ghp_xxxxxxx，只显示一次！）

═══════════════════════════════════════

⚙️ 第 3 步：在 Skiller Dashboard 配置

1. 打开 http://localhost:3737
2. 点击 🌍社区 → ⚙️设置
3. 填写：
   - 社区仓库：你的用户名/skill-community
   - GitHub Token：刚才复制的 Token
   - 作者名称：你的昵称
4. 点击 💾 保存配置

═══════════════════════════════════════

📤 上传技能

社区页面 → 📤上传/投稿 → 点击技能旁边的「上传」按钮

═══════════════════════════════════════

📢 让别人使用

告诉别人你的仓库地址即可！他们在 Dashboard 的
社区 → 📡订阅源管理 中粘贴你的地址就能看到你的技能。

═══════════════════════════════════════

📝 编写好的 SKILL.md

在 SKILL.md 开头添加 frontmatter：

---
name: my-skill
description: 一句话描述
author: 你的名字
tags: [tag1, tag2]
---

# 技能标题

技能内容...

═══════════════════════════════════════

详细文档：https://github.com/zhangziyana007-sudo/skiller-mcp/blob/main/docs/create-your-community.md
`.trim();

const COMMUNITY_SUBSCRIBE_GUIDE = `
🌐 订阅别人的技能社区 — 3 秒完成

═══════════════════════════════════════

方法一：Dashboard 图形界面

1. 打开 http://localhost:3737
2. 点击 🌍社区 → 📡订阅源管理
3. 在输入框粘贴链接或仓库地址：
   - https://github.com/someone/skill-community ✅
   - someone/skill-community ✅
4. 点击「订阅」或按回车
5. 完成！回到「浏览技能」就能看到所有技能

═══════════════════════════════════════

方法二：推荐列表一键订阅

在「订阅源管理」页面有推荐的社区仓库，点击「一键订阅」即可。

═══════════════════════════════════════

安装技能

看到想要的技能？点击 ⬇️安装 按钮，自动下载到本地。
安装后在 Cursor 中对话就能使用了！

═══════════════════════════════════════

不需要 Token！浏览和安装公开仓库的技能不需要任何配置。
`.trim();

server.tool(
  "community_guide",
  "获取社区功能使用指南。创建自己的技能社区或订阅别人的技能库。",
  {
    topic: z.enum(["create", "subscribe", "both"]).optional().default("both")
      .describe("指南主题: create=创建社区, subscribe=订阅社区, both=全部"),
  },
  async ({ topic }) => {
    logUsage("community_guide", { topic }, "guide displayed");

    let text = "";
    if (topic === "create" || topic === "both") {
      text += COMMUNITY_SETUP_GUIDE;
    }
    if (topic === "both") {
      text += "\n\n\n";
    }
    if (topic === "subscribe" || topic === "both") {
      text += COMMUNITY_SUBSCRIBE_GUIDE;
    }

    return {
      content: [{
        type: "text" as const,
        text,
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
