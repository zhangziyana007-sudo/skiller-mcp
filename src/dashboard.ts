import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync, watch, statSync } from "fs";
import { join, extname, resolve } from "path";
import { getOrBuildIndex, buildIndex } from "./indexer.js";
import { searchSkills, getSkillStats } from "./searcher.js";
import { loadLog } from "./logger.js";
import { parseSkillTree } from "./skill-parser.js";
import { loadPlaza, searchPlaza, refreshPlaza, fetchSkillContent, getRegistries } from "./plaza.js";
import {
  loadConfig, saveConfig, addSource, removeSource,
  listCommunitySkills, listSourceSkills, uploadSkill,
  submitSkillViaIssue, listSubmissions,
  downloadCommunitySkill, clearAllCache,
} from "./community.js";
import {
  loadUserCategories, addCategory, removeCategory, renameCategory,
  tagSkill, buildCategoryTree, getUncategorizedCount,
} from "./categories.js";

const PORT = parseInt(process.env.SKILLER_PORT || "3737");
const STATIC_DIR = join(import.meta.dirname, "..", "dashboard");
const LOG_PATH = join(process.env.HOME || "~", ".cursor", "skiller", "data", "usage_log.json");

const sseClients = new Set<ServerResponse>();
let lastLogMtime = 0;

try {
  if (existsSync(LOG_PATH)) {
    lastLogMtime = statSync(LOG_PATH).mtimeMs;
  }
} catch {}

function broadcastSSE(data: unknown) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

function checkLogChanges() {
  try {
    if (!existsSync(LOG_PATH)) return;
    const mtime = statSync(LOG_PATH).mtimeMs;
    if (mtime > lastLogMtime) {
      lastLogMtime = mtime;
      const entries = loadLog();
      const latest = entries.length > 0 ? entries[entries.length - 1] : null;
      broadcastSSE({
        type: "log_update",
        latest,
        totalEntries: entries.length,
      });
    }
  } catch {}
}

try {
  const logDir = join(process.env.HOME || "~", ".cursor", "skiller", "data");
  if (existsSync(logDir)) {
    watch(logDir, { persistent: false }, (eventType, filename) => {
      if (filename === "usage_log.json") {
        setTimeout(checkLogChanges, 100);
      }
    });
  }
} catch {}

setInterval(checkLogChanges, 2000);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let index = getOrBuildIndex();

function countNodes(tree: { children?: unknown[] }[]): number {
  let count = 0;
  for (const node of tree) {
    count += 1;
    if (Array.isArray(node.children)) {
      count += countNodes(node.children as { children?: unknown[] }[]);
    }
  }
  return count;
}

function handleApi(path: string, params: URLSearchParams): unknown {
  switch (path) {
    case "/api/stats":
      return { ...getSkillStats(index), generatedAt: index.generatedAt };

    case "/api/skills":
      return index.skills;

    case "/api/categories":
      return buildCategoryTree(index);

    case "/api/categories/list":
      return loadUserCategories();

    case "/api/categories/add": {
      const label = params.get("label") || "";
      const parentId = params.get("parentId") || null;
      const icon = params.get("icon") || "";
      if (!label) return { error: "Missing label" };
      const cat = addCategory(label, parentId, icon);
      index = buildIndex();
      return { success: true, category: cat };
    }

    case "/api/categories/remove": {
      const id = params.get("id") || "";
      if (!id) return { error: "Missing id" };
      const ok = removeCategory(id);
      if (ok) index = buildIndex();
      return { success: ok };
    }

    case "/api/categories/rename": {
      const id = params.get("id") || "";
      const newLabel = params.get("label") || "";
      const newIcon = params.get("icon");
      if (!id || !newLabel) return { error: "Missing id or label" };
      const ok = renameCategory(id, newLabel, newIcon || undefined);
      if (ok) index = buildIndex();
      return { success: ok };
    }

    case "/api/categories/tag-skill": {
      const skill = params.get("skill") || "";
      const categories = (params.get("categories") || "").split(",").filter(Boolean);
      if (!skill) return { error: "Missing skill" };
      tagSkill(skill, categories);
      index = buildIndex();
      return { success: true };
    }

    case "/api/uncategorized":
      return index.skills.filter(s => s.categories.length === 0);

    case "/api/search": {
      const query = params.get("q") || "";
      const category = params.get("category") || undefined;
      const limit = parseInt(params.get("limit") || "20");
      return searchSkills(index, query, category, limit);
    }

    case "/api/skill": {
      const name = params.get("name") || "";
      const skill = index.skills.find(
        (s) => s.name === name || s.name.toLowerCase() === name.toLowerCase()
      );
      if (!skill) return { error: "Not found" };
      try {
        const content = readFileSync(skill.path, "utf-8");
        const result = parseSkillTree(content);
        return { ...skill, content, subSkills: result.tree, subSkillSource: result.source };
      } catch {
        return { ...skill, content: "Failed to read SKILL.md", subSkills: [], subSkillSource: 'auto' };
      }
    }

    case "/api/skill-tree": {
      const name = params.get("name") || "";
      const skill = index.skills.find(
        (s) => s.name === name || s.name.toLowerCase() === name.toLowerCase()
      );
      if (!skill) return { error: "Not found" };
      try {
        const content = readFileSync(skill.path, "utf-8");
        const result = parseSkillTree(content);
        return { name: skill.name, source: result.source, tree: result.tree };
      } catch {
        return { name: skill.name, source: 'auto', tree: [] };
      }
    }

    case "/api/all-trees": {
      return index.skills.map((skill) => {
        try {
          const content = readFileSync(skill.path, "utf-8");
          const result = parseSkillTree(content);
          const subCount = countNodes(result.tree);
          return {
            name: skill.name,
            categories: skill.categories,
            subSkillCount: subCount,
            subSkillSource: result.source,
            tree: result.tree,
          };
        } catch {
          return { name: skill.name, categories: skill.categories, subSkillCount: 0, subSkillSource: 'auto', tree: [] };
        }
      });
    }

    case "/api/log":
      return loadLog().reverse().slice(0, 50);

    case "/api/rescan":
      index = buildIndex();
      return { message: "Index rebuilt", total: index.totalSkills };

    default:
      return { error: "Unknown endpoint" };
  }
}

const localSkillNames = () => index.skills.map((s) => s.name);

async function handleAsyncApi(path: string, params: URLSearchParams): Promise<unknown> {
  switch (path) {
    case "/api/plaza":
      return loadPlaza(localSkillNames());

    case "/api/plaza/search": {
      const query = params.get("q") || "";
      return searchPlaza(query, localSkillNames());
    }

    case "/api/plaza/refresh":
      return refreshPlaza(localSkillNames());

    case "/api/plaza/preview": {
      const rawUrl = params.get("url") || "";
      if (!rawUrl) return { error: "Missing url param" };
      const content = await fetchSkillContent(rawUrl);
      return content ? { content } : { error: "Failed to fetch" };
    }

    case "/api/plaza/install": {
      const name = params.get("name") || "";
      const rawUrl = params.get("url") || "";
      if (!name || !rawUrl) return { error: "Missing name or url" };

      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      if (!safeName || safeName.startsWith(".")) return { error: "Invalid skill name" };

      const content = await fetchSkillContent(rawUrl);
      if (!content) return { error: "Failed to fetch skill content" };

      const { mkdirSync, writeFileSync } = await import("fs");
      const { join, resolve } = await import("path");
      const skillsBase = join(process.env.HOME || "~", ".cursor", "skills");
      const skillDir = join(skillsBase, safeName);

      if (!resolve(skillDir).startsWith(resolve(skillsBase))) {
        return { error: "Invalid path" };
      }

      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");

      index = buildIndex();

      return { success: true, name: safeName, path: skillDir, totalSkills: index.totalSkills };
    }

    case "/api/plaza/registries":
      return getRegistries();

    case "/api/community/config":
      return loadConfig();

    case "/api/community/save-config": {
      const repo = params.get("repo") || undefined;
      const branch = params.get("branch") || undefined;
      const skillsPath = params.get("skillsPath") || undefined;
      const githubToken = params.get("token") || undefined;
      const authorName = params.get("author") || undefined;
      return saveConfig({ repo, branch, skillsPath, githubToken, authorName });
    }

    case "/api/community/skills": {
      const config = loadConfig();
      const skills = await listCommunitySkills(config);
      const localNames = localSkillNames();
      return skills.map(s => ({
        ...s,
        installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
      }));
    }

    case "/api/community/upload": {
      const skillName = params.get("name") || "";
      if (!skillName) return { success: false, message: "Missing skill name" };

      const skill = index.skills.find(
        s => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (!skill) return { success: false, message: `本地未找到技能 "${skillName}"` };

      const { readFileSync: rfs } = await import("fs");
      const content = rfs(skill.path, "utf-8");
      const config = loadConfig();
      return uploadSkill(config, skillName, content);
    }

    case "/api/community/install": {
      const name = params.get("name") || "";
      const rawUrl = params.get("url") || "";
      if (!name || !rawUrl) return { error: "Missing name or url" };

      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      const content = await downloadCommunitySkill(rawUrl);
      if (!content) return { error: "Failed to fetch skill" };

      const { mkdirSync: mks, writeFileSync: wfs } = await import("fs");
      const { join: pjoin, resolve: pres } = await import("path");
      const base = pjoin(process.env.HOME || "~", ".cursor", "skills");
      const dir = pjoin(base, safeName);
      if (!pres(dir).startsWith(pres(base))) return { error: "Invalid path" };

      mks(dir, { recursive: true });
      wfs(pjoin(dir, "SKILL.md"), content, "utf-8");
      index = buildIndex();

      return { success: true, name: safeName, totalSkills: index.totalSkills };
    }

    case "/api/community/refresh": {
      clearAllCache();
      const config = loadConfig();
      const skills = await listCommunitySkills(config);
      return skills || [];
    }

    case "/api/community/sources": {
      const config = loadConfig();
      return config.sources;
    }

    case "/api/community/add-source": {
      const repo = params.get("repo") || "";
      const label = params.get("label") || repo;
      const branch = params.get("branch") || "main";
      const skillsPath = params.get("skillsPath") || "skills";
      const writable = params.get("writable") === "true";
      if (!repo) return { error: "Missing repo" };
      const config = addSource({ repo, branch, skillsPath, label, writable });
      return { success: true, sources: config.sources };
    }

    case "/api/community/remove-source": {
      const sourceId = params.get("id") || "";
      if (!sourceId) return { error: "Missing id" };
      const config = removeSource(sourceId);
      return { success: true, sources: config.sources };
    }

    case "/api/community/source-skills": {
      const sourceId = params.get("sourceId") || "";
      if (!sourceId) return { error: "Missing sourceId" };
      const config = loadConfig();
      const skills = await listSourceSkills(config, sourceId);
      const localNames = localSkillNames();
      return skills.map(s => ({
        ...s,
        installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
      }));
    }

    case "/api/community/submit": {
      const skillName = params.get("name") || "";
      const targetRepo = params.get("targetRepo") || "";
      if (!skillName) return { success: false, message: "Missing skill name" };

      const skill = index.skills.find(
        s => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (!skill) return { success: false, message: `本地未找到技能 "${skillName}"` };

      const { readFileSync: rfs } = await import("fs");
      const content = rfs(skill.path, "utf-8");
      const config = loadConfig();
      const repo = targetRepo || config.repo;
      return submitSkillViaIssue(config, repo, {
        skillName,
        author: config.authorName,
        description: skill.description || "",
        content,
      });
    }

    case "/api/community/submissions": {
      const targetRepo = params.get("repo") || undefined;
      const config = loadConfig();
      return listSubmissions(config, targetRepo);
    }

    default:
      return null;
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/sse") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify({ type: "connected", clients: sseClients.size + 1 })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url.pathname.startsWith("/api/plaza") || url.pathname.startsWith("/api/community")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    handleAsyncApi(url.pathname, url.searchParams)
      .then((result) => {
        if (result === null) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        } else {
          res.end(JSON.stringify(result));
        }
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const result = handleApi(url.pathname, url.searchParams);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = join(STATIC_DIR, filePath);

  if (!resolve(fullPath).startsWith(resolve(STATIC_DIR))) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (!existsSync(fullPath)) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  const ext = extname(fullPath);
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.end(readFileSync(fullPath));
});

server.listen(PORT, () => {
  console.log(`\n  Skiller Dashboard running at http://localhost:${PORT}\n`);
});
