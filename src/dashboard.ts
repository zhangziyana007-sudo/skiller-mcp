import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync, watch, statSync, rmSync, renameSync, readdirSync } from "fs";
import { join, extname, resolve, dirname, basename } from "path";
import { execSync } from "child_process";
import { getOrBuildIndex, buildIndex } from "./indexer.js";
import { searchSkills, getSkillStats } from "./searcher.js";
import { loadLog } from "./logger.js";
import { parseSkillTree } from "./skill-parser.js";
// plaza.ts removed — community-only mode
import {
  loadConfig, saveConfig, addSource, removeSource,
  listCommunitySkills, listSourceSkills, uploadSkill, uploadDescriptionFile, deleteSkill, listOwnSkills,
  submitSkillViaIssue, listSubmissions,
  downloadCommunitySkill, clearAllCache,
  fetchSkillsFromRepoLight, enrichSkillMetadata,
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

    case "/api/recent-projects": {
      const projects: string[] = [];
      const cursorProjectsDir = join(process.env.HOME || "~", ".cursor", "projects");
      if (existsSync(cursorProjectsDir)) {
        try {
          for (const d of readdirSync(cursorProjectsDir)) {
            const decoded = d.replace(/-/g, "/");
            if (existsSync(decoded) && statSync(decoded).isDirectory()) {
              projects.push(decoded);
            }
          }
        } catch {}
      }
      const homeDir = process.env.HOME || "~";
      for (const p of [join(homeDir, "SOFR"), join(homeDir, "projects"), join(homeDir, "workspace"), join(homeDir, "code")]) {
        if (existsSync(p) && !projects.includes(p)) projects.push(p);
      }
      return projects.slice(0, 20);
    }

    case "/api/skill/delete": {
      const delName = params.get("name") || "";
      if (!delName) return { success: false, message: "Missing skill name" };
      const delSkill = index.skills.find(
        (s) => s.name === delName || s.name.toLowerCase() === delName.toLowerCase()
      );
      if (!delSkill) return { success: false, message: `技能 "${delName}" 不存在` };
      const skillDir = dirname(delSkill.path);
      try {
        rmSync(skillDir, { recursive: true, force: true });
        index = buildIndex();
        return { success: true, message: `"${delName}" 已删除`, totalSkills: index.totalSkills };
      } catch (e) {
        return { success: false, message: `删除失败: ${String(e).slice(0, 200)}` };
      }
    }

    case "/api/skill/toggle": {
      const togName = params.get("name") || "";
      const togEnable = params.get("enable") === "1";
      if (!togName) return { success: false, message: "Missing skill name" };
      const togSkill = index.skills.find(
        (s) => s.name === togName || s.name.toLowerCase() === togName.toLowerCase()
      );
      if (!togSkill) return { success: false, message: `技能 "${togName}" 不存在` };
      const togDir = dirname(togSkill.path);
      const togParent = dirname(togDir);
      const togDirName = basename(togDir);

      if (!togEnable && !togDirName.startsWith(".")) {
        const newDir = join(togParent, "." + togDirName);
        if (!existsSync(newDir)) {
          renameSync(togDir, newDir);
          index = buildIndex();
          return { success: true, message: `"${togName}" 已禁用`, enabled: false };
        }
      } else if (togEnable && togDirName.startsWith(".")) {
        const newDir = join(togParent, togDirName.slice(1));
        if (!existsSync(newDir)) {
          renameSync(togDir, newDir);
          index = buildIndex();
          return { success: true, message: `"${togName}" 已启用`, enabled: true };
        }
      }
      return { success: true, message: "无需变更", enabled: !togDirName.startsWith(".") };
    }

    case "/api/skill/export": {
      const expName = params.get("name") || "";
      if (!expName) return { error: "Missing name" };
      const expSkill = index.skills.find(
        (s) => s.name === expName || s.name.toLowerCase() === expName.toLowerCase()
      );
      if (!expSkill) return { error: "Not found" };
      try {
        const content = readFileSync(expSkill.path, "utf-8");
        return { name: expSkill.name, source: expSkill.source, path: expSkill.path, content };
      } catch {
        return { error: "Failed to read" };
      }
    }

    case "/api/mcp/status": {
      const mcpPath = join(process.env.HOME || "~", ".cursor", "mcp.json");
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(readFileSync(mcpPath, "utf-8")); } catch {}
      const servers = (config as { mcpServers?: Record<string, { command?: string; args?: string[] }> }).mcpServers || {};

      const result: Array<{ name: string; command: string; args: string[]; running: boolean; pids: number[] }> = [];

      for (const [name, cfg] of Object.entries(servers)) {
        const cmd = cfg.command || "";
        const args = cfg.args || [];
        const searchStr = args.length > 0 ? args[args.length - 1] : cmd;

        let pids: number[] = [];
        try {
          const psOut = execSync("ps aux 2>/dev/null", { encoding: "utf-8", timeout: 3000 });
          pids = psOut.split("\n")
            .filter(line => line.includes(searchStr) && !line.includes("grep"))
            .map(line => parseInt(line.trim().split(/\s+/)[1]))
            .filter(p => !isNaN(p));
        } catch {}

        result.push({ name, command: cmd, args, running: pids.length > 0, pids });
      }
      return { path: mcpPath, servers: result };
    }

    case "/api/mcp/restart": {
      const srvName = params.get("name") || "";
      if (!srvName) return { error: "Missing server name" };

      const mcpPath2 = join(process.env.HOME || "~", ".cursor", "mcp.json");
      let mcpCfg: Record<string, unknown> = {};
      try { mcpCfg = JSON.parse(readFileSync(mcpPath2, "utf-8")); } catch {}
      const mcpServers = (mcpCfg as { mcpServers?: Record<string, { command?: string; args?: string[] }> }).mcpServers || {};
      const srv = mcpServers[srvName];
      if (!srv) return { error: `Server "${srvName}" not found in mcp.json` };

      const searchStr = (srv.args || []).length > 0 ? (srv.args || [])[srv.args!.length - 1] : (srv.command || "");

      try {
        execSync(`ps aux | grep '${searchStr}' | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null`, { timeout: 3000 });
      } catch {}

      return { success: true, message: `已终止 ${srvName} 的所有进程。Cursor 将自动重新启动它。` };
    }

    case "/api/mcp/config": {
      const mcpPath3 = join(process.env.HOME || "~", ".cursor", "mcp.json");
      try {
        const content = readFileSync(mcpPath3, "utf-8");
        return { path: mcpPath3, content };
      } catch {
        return { error: "无法读取 mcp.json" };
      }
    }

    default:
      return { error: "Unknown endpoint" };
  }
}

const localSkillNames = () => index.skills.map((s) => s.name);

async function handleAsyncApi(path: string, params: URLSearchParams): Promise<unknown> {
  switch (path) {
    case "/api/community/config": {
      const cfg = loadConfig();
      return {
        ...cfg,
        sources: cfg.sources.map(s => ({ ...s, token: s.token ? "••••" + s.token.slice(-4) : undefined })),
      };
    }

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
      const light = params.get("light") === "1";
      const pageStr = params.get("page");
      const pageSizeStr = params.get("pageSize");
      const page = pageStr ? parseInt(pageStr) : undefined;
      const pageSize = pageSizeStr ? parseInt(pageSizeStr) : 30;
      const skills = await listCommunitySkills(config, { light, page, pageSize });
      const localNames = localSkillNames();
      return skills.map(s => ({
        ...s,
        installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
      }));
    }

    case "/api/community/skills/enrich": {
      const config = loadConfig();
      const skills = await listCommunitySkills(config, { light: true });
      const start = parseInt(params.get("start") || "0");
      const count = parseInt(params.get("count") || "20");
      const enriched = await enrichSkillMetadata(skills, start, count);
      const localNames = localSkillNames();
      return enriched.map(s => ({
        ...s,
        installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
      }));
    }

    case "/api/community/upload": {
      const skillName = params.get("name") || "";
      const extraDesc = params.get("description") || "";
      if (!skillName) return { success: false, message: "Missing skill name" };

      const skill = index.skills.find(
        s => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (!skill) return { success: false, message: `本地未找到技能 "${skillName}"` };

      const { readFileSync: rfs } = await import("fs");
      const content = rfs(skill.path, "utf-8");
      const config = loadConfig();
      const result = await uploadSkill(config, skillName, content);

      if (result.success && extraDesc.trim()) {
        await uploadDescriptionFile(config, skillName, extraDesc.trim());
      }
      return result;
    }

    case "/api/community/delete": {
      const skillName = params.get("name") || "";
      const sourceId = params.get("sourceId") || undefined;
      if (!skillName) return { success: false, message: "Missing skill name" };
      const config = loadConfig();
      return deleteSkill(config, skillName, sourceId);
    }

    case "/api/community/own-skills": {
      const config = loadConfig();
      return listOwnSkills(config);
    }

    case "/api/community/install": {
      const name = params.get("name") || "";
      const rawUrl = params.get("url") || "";
      if (!name || !rawUrl) return { error: "Missing name or url" };

      const scope = params.get("scope") || "global";
      const projectPath = params.get("projectPath") || "";
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      const content = await downloadCommunitySkill(rawUrl);
      if (!content) return { error: "Failed to fetch skill" };

      const { mkdirSync: mks, writeFileSync: wfs, existsSync: exs } = await import("fs");
      const { join: pjoin, resolve: pres } = await import("path");

      let targetPath: string;
      if (scope === "project" && projectPath) {
        const projDir = pres(projectPath);
        if (!exs(projDir)) return { error: "项目路径不存在: " + projectPath };
        const rulesDir = pjoin(projDir, ".cursor", "rules");
        mks(rulesDir, { recursive: true });
        targetPath = pjoin(rulesDir, safeName + ".mdc");
        wfs(targetPath, content, "utf-8");
      } else {
        const base = pjoin(process.env.HOME || "~", ".cursor", "skills");
        const dir = pjoin(base, safeName);
        if (!pres(dir).startsWith(pres(base))) return { error: "Invalid path" };
        mks(dir, { recursive: true });
        targetPath = pjoin(dir, "SKILL.md");
        wfs(targetPath, content, "utf-8");
      }
      index = buildIndex();

      return { success: true, name: safeName, path: targetPath, scope, totalSkills: index.totalSkills };
    }

    case "/api/community/install-url": {
      const ghUrl = params.get("url") || "";
      if (!ghUrl) return { error: "Missing url" };

      const m = ghUrl.match(/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)/);
      if (!m) return { error: "无法解析 GitHub 链接，需格式: github.com/owner/repo/blob/branch/path" };
      const [, ghRepo, ghBranch, ghPath] = m;

      const skillName = params.get("name") || ghPath.split("/").filter(Boolean).slice(-1)[0]?.replace(/\.md$/i, "") || "unknown";
      const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-");

      let rawUrl: string;
      if (ghPath.endsWith(".md") || ghPath.endsWith(".MD")) {
        rawUrl = `https://raw.githubusercontent.com/${ghRepo}/${ghBranch}/${ghPath}`;
      } else {
        const tryPaths = [`${ghPath}/SKILL.md`, `${ghPath}/skill.md`, ghPath];
        rawUrl = `https://raw.githubusercontent.com/${ghRepo}/${ghBranch}/${tryPaths[0]}`;
        for (const tp of tryPaths) {
          try {
            const r = await fetch(`https://raw.githubusercontent.com/${ghRepo}/${ghBranch}/${tp}`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) { rawUrl = `https://raw.githubusercontent.com/${ghRepo}/${ghBranch}/${tp}`; break; }
          } catch {}
        }
      }

      const scope2 = params.get("scope") || "global";
      const projectPath2 = params.get("projectPath") || "";

      try {
        const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) return { error: `下载失败 (${resp.status})` };
        const content = await resp.text();
        if (!content.trim()) return { error: "内容为空" };

        const { mkdirSync: mk, writeFileSync: wf, existsSync: ex } = await import("fs");

        let targetPath: string;
        if (scope2 === "project" && projectPath2) {
          const projDir = resolve(projectPath2);
          if (!ex(projDir)) return { error: "项目路径不存在: " + projectPath2 };
          const rulesDir = join(projDir, ".cursor", "rules");
          mk(rulesDir, { recursive: true });
          targetPath = join(rulesDir, safeName + ".mdc");
          wf(targetPath, content, "utf-8");
        } else {
          const skillsBase = join(process.env.HOME || "~", ".cursor", "skills");
          const skillDir = join(skillsBase, safeName);
          if (!resolve(skillDir).startsWith(resolve(skillsBase))) return { error: "Invalid path" };
          mk(skillDir, { recursive: true });
          targetPath = join(skillDir, "SKILL.md");
          wf(targetPath, content, "utf-8");
        }
        index = buildIndex();

        return { success: true, name: safeName, path: targetPath, scope: scope2, totalSkills: index.totalSkills };
      } catch (e: unknown) {
        return { error: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/community/refresh": {
      clearAllCache();
      const config = loadConfig();
      const skills = await listCommunitySkills(config, { light: true });
      return skills || [];
    }

    case "/api/community/cache-status": {
      const cacheFile = join(process.env.HOME || "~", ".cursor", "skiller", "data", "community_cache.json");
      if (!existsSync(cacheFile)) return { cached: false };
      try {
        const raw = JSON.parse(readFileSync(cacheFile, "utf-8"));
        const keys = Object.keys(raw);
        const info: Record<string, { count: number; age: string; ageMs: number }> = {};
        for (const k of keys) {
          const entry = raw[k];
          if (entry?.updatedAt && Array.isArray(entry.skills)) {
            const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
            const ageMins = Math.round(ageMs / 60000);
            info[k] = { count: entry.skills.length, age: `${ageMins}分钟前`, ageMs };
          }
        }
        return { cached: true, entries: info };
      } catch { return { cached: false }; }
    }

    case "/api/community/sources": {
      const config = loadConfig();
      return config.sources.map(s => ({
        ...s,
        token: s.token ? "••••" + s.token.slice(-4) : undefined,
      }));
    }

    case "/api/community/add-source": {
      const repo = params.get("repo") || "";
      const label = params.get("label") || repo;
      const branch = params.get("branch") || "main";
      const skillsPath = params.get("skillsPath") || "skills";
      const writable = params.get("writable") === "true";
      const srcToken = params.get("token") || undefined;
      if (!repo) return { error: "Missing repo" };
      const config = addSource({ repo, branch, skillsPath, label, writable, token: srcToken });
      return { success: true, sources: config.sources.map(s => ({ ...s, token: s.token ? "••••" + s.token.slice(-4) : undefined })) };
    }

    case "/api/community/remove-source": {
      const sourceId = params.get("id") || "";
      if (!sourceId) return { error: "Missing id" };
      const config = removeSource(sourceId);
      return { success: true, sources: config.sources.map(s => ({ ...s, token: s.token ? "••••" + s.token.slice(-4) : undefined })) };
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

  if (url.pathname.startsWith("/api/community")) {
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
