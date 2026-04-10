import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync, watch, statSync, rmSync, renameSync, readdirSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { join, extname, resolve, dirname, basename } from "path";
import { execSync } from "child_process";
import { getOrBuildIndex, buildIndex, LOCAL_REPO_DIR, scanSingleProject } from "./indexer.js";
import matter from "gray-matter";
import { searchSkills, getSkillStats } from "./searcher.js";
import { loadLog } from "./logger.js";
import { parseSkillTree } from "./skill-parser.js";
import {
  loadConfig, saveConfig, addSource, removeSource,
  listCommunitySkills, listSourceSkills, uploadSkill, uploadDescriptionFile, deleteSkill, listOwnSkills,
  submitSkillViaIssue, listSubmissions,
  downloadCommunitySkill, clearAllCache,
  fetchSkillsFromRepoLight, enrichSkillMetadata, extractMetadata,
  loadCachedSkills, isCacheStale,
} from "./community.js";
import {
  loadUserCategories, addCategory, removeCategory, renameCategory,
  tagSkill, buildCategoryTree, getUncategorizedCount,
  getSkillOverride, setSkillOverride, loadOverrides,
  linkSkillToProject, unlinkSkillFromProject, getProjectSkills,
  getSkillLinkedProjects, getAllSkillProjectLinks,
  getProjectGroups, addProjectGroup, removeProjectGroup,
  renameProjectGroup, assignProjectToGroup, reorderProjects, reorderGroups,
  addManagedProject, removeManagedProject, getManagedProjects,
  registerInstall, getInstallRegistry, getInstallRecord, simpleHash,
} from "./categories.js";
import { paths, PLATFORM } from "./config.js";

const PORT = parseInt(process.env.SKILLER_PORT || "3737");
const STATIC_DIR = join(import.meta.dirname, "..", "dashboard");
const CORS_ORIGIN = `http://localhost:${PORT}`;
const LOG_PATH = paths.logPath;

const sseClients = new Set<ServerResponse>();
let lastLogMtime = 0;
const repoCatCache: Record<string, { data: any; ts: number }> = {};

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
  const logDir = paths.dataDir;
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

    case "/api/skills": {
      const allOverrides = loadOverrides();
      return index.skills.map(s => {
        const ov = allOverrides[s.name];
        return ov ? { ...s, displayName: ov.displayName, customDescription: ov.description } : s;
      });
    }

    case "/api/local-repo": {
      const allOv = loadOverrides();
      return index.skills
        .filter(s => s.source === "local-repo")
        .map(s => {
          const ov = allOv[s.name];
          return ov ? { ...s, displayName: ov.displayName, customDescription: ov.description } : s;
        });
    }

    case "/api/project-skills": {
      const projPath = params.get("projectPath") || "";
      if (!projPath) return [];
      const projSkills = scanSingleProject(projPath);
      const allOvP = loadOverrides();
      return projSkills.map(s => {
        const ov = allOvP[s.name];
        return ov ? { ...s, displayName: ov.displayName, customDescription: ov.description } : s;
      });
    }

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

    case "/api/skill-projects":
      return getAllSkillProjectLinks();

    case "/api/skill-projects/link": {
      const spSkill = params.get("skill") || "";
      const spProject = params.get("project") || "";
      if (!spSkill || !spProject) return { success: false, message: "Missing skill or project" };
      linkSkillToProject(spSkill, spProject);
      return { success: true };
    }

    case "/api/skill-projects/unlink": {
      const spuSkill = params.get("skill") || "";
      const spuProject = params.get("project") || "";
      if (!spuSkill || !spuProject) return { success: false, message: "Missing skill or project" };
      unlinkSkillFromProject(spuSkill, spuProject);
      return { success: true };
    }

    case "/api/skill-projects/by-project": {
      const spbProject = params.get("project") || "";
      if (!spbProject) return [];
      return getProjectSkills(spbProject);
    }

    case "/api/skill-projects/by-skill": {
      const spbsSkill = params.get("skill") || "";
      if (!spbsSkill) return [];
      return getSkillLinkedProjects(spbsSkill);
    }

    case "/api/project-groups":
      return getProjectGroups();

    case "/api/project-groups/add": {
      const pgName = params.get("name") || "";
      const pgIcon = params.get("icon") || "📁";
      if (!pgName) return { success: false, message: "Missing name" };
      const pg = addProjectGroup(pgName, pgIcon);
      return { success: true, group: pg };
    }

    case "/api/project-groups/remove": {
      const pgrId = params.get("id") || "";
      if (!pgrId) return { success: false, message: "Missing id" };
      return { success: removeProjectGroup(pgrId) };
    }

    case "/api/project-groups/rename": {
      const pgrnId = params.get("id") || "";
      const pgrnName = params.get("name") || "";
      const pgrnIcon = params.has("icon") ? (params.get("icon") || "") : undefined;
      if (!pgrnId || !pgrnName) return { success: false, message: "Missing id or name" };
      return { success: renameProjectGroup(pgrnId, pgrnName, pgrnIcon) };
    }

    case "/api/project-groups/assign": {
      const pgaProject = params.get("project") || "";
      const pgaGroup = params.get("group") || null;
      if (!pgaProject) return { success: false, message: "Missing project" };
      assignProjectToGroup(pgaProject, pgaGroup);
      return { success: true };
    }

    case "/api/project-groups/reorder-projects": {
      const prOrder = (params.get("order") || "").split("|||").filter(Boolean);
      if (prOrder.length === 0) return { success: false, message: "Missing order" };
      reorderProjects(prOrder);
      return { success: true };
    }

    case "/api/project-groups/reorder-groups": {
      const grOrder = (params.get("order") || "").split(",").filter(Boolean);
      if (grOrder.length === 0) return { success: false, message: "Missing order" };
      reorderGroups(grOrder);
      return { success: true };
    }

    case "/api/managed-projects":
      return { projects: getManagedProjects() };

    case "/api/managed-projects/add": {
      const mpPath = params.get("path") || "";
      if (!mpPath) return { success: false, message: "Missing path" };
      const mpAdded = addManagedProject(mpPath);
      return { success: true, added: mpAdded, projects: getManagedProjects() };
    }

    case "/api/managed-projects/remove": {
      const mrPath = params.get("path") || "";
      if (!mrPath) return { success: false, message: "Missing path" };
      const mrRemoved = removeManagedProject(mrPath);
      return { success: true, removed: mrRemoved, projects: getManagedProjects() };
    }

    case "/api/export-config": {
      const managedProjects = getManagedProjects();
      const projectGroups = getProjectGroups();
      const installedSkillsByProject = managedProjects.map((projectPath) => {
        const installed = index.skills.filter(
          (s) => s.source === "project-rules" && s.projectName === projectPath
        );
        return {
          projectPath,
          skills: installed.map((s) => {
            const norm = s.path.replace(/\\/g, "/");
            if (norm.includes("/skills/") && norm.endsWith("SKILL.md")) {
              return { name: s.name, mode: "skill-folder" as const };
            }
            if (norm.endsWith(".mdc") || (norm.includes("/rules/") && norm.endsWith(".md"))) {
              let alwaysApply: boolean | undefined;
              try {
                const c = readFileSync(s.path, "utf-8");
                const { data } = matter(c);
                if (typeof data.alwaysApply === "boolean") alwaysApply = data.alwaysApply;
              } catch {}
              return {
                name: s.name,
                mode: "rule" as const,
                ...(alwaysApply !== undefined ? { alwaysApply } : {}),
              };
            }
            return { name: s.name, mode: "unknown" as const };
          }),
        };
      });
      return {
        exportedAt: new Date().toISOString(),
        managedProjects,
        projectGroups,
        installedSkillsByProject,
      };
    }

    case "/api/managed-projects/scan": {
      const scannedProjects: string[] = [];

      if (PLATFORM === "claude-code") {
        const claudeProjectsDir = join(paths.ideRoot, "projects");
        if (existsSync(claudeProjectsDir)) {
          try {
            for (const d of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
              if (!d.isDirectory()) continue;
              const projectPath = "/" + d.name.replace(/-/g, "/");
              if (existsSync(projectPath) && statSync(projectPath).isDirectory() && !scannedProjects.includes(projectPath)) {
                scannedProjects.push(projectPath);
              }
            }
          } catch {}
        }
        const homeDir = process.env.HOME || "~";
        for (const candidate of [join(homeDir, "projects"), join(homeDir, "workspace"), join(homeDir, "code"), join(homeDir, "src")]) {
          if (existsSync(candidate) && statSync(candidate).isDirectory()) {
            try {
              for (const d of readdirSync(candidate, { withFileTypes: true })) {
                if (!d.isDirectory()) continue;
                const fullPath = join(candidate, d.name);
                const hasClaudeMd = existsSync(join(fullPath, "CLAUDE.md"));
                const hasMcpJson = existsSync(join(fullPath, ".mcp.json"));
                const hasGit = existsSync(join(fullPath, ".git"));
                if ((hasClaudeMd || hasMcpJson || hasGit) && !scannedProjects.includes(fullPath)) {
                  scannedProjects.push(fullPath);
                }
              }
            } catch {}
          }
        }
      } else {
        try {
          const vscdbPath = join(paths.ideConfigDir, "User", "globalStorage", "state.vscdb");
          if (existsSync(vscdbPath)) {
            const raw = execSync(
              `sqlite3 "${vscdbPath}" "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'"`,
              { encoding: "utf-8", timeout: 5000 }
            ).trim();
            if (raw) {
              const data = JSON.parse(raw);
              for (const e of (data.entries || [])) {
                const uri = e.folderUri || "";
                const p = decodeURIComponent(uri.replace("file://", ""));
                if (p && existsSync(p) && statSync(p).isDirectory() && !scannedProjects.includes(p)) {
                  scannedProjects.push(p);
                }
              }
            }
          }
        } catch {}
        try {
          const cursorStorage = join(paths.ideConfigDir, "User", "globalStorage", "storage.json");
          if (existsSync(cursorStorage)) {
            const raw = JSON.parse(readFileSync(cursorStorage, "utf-8"));
            const entries = raw.openedPathsList?.entries || [];
            for (const e of entries) {
              const p = (e.folderUri || "").replace("file://", "");
              if (p && existsSync(p) && statSync(p).isDirectory() && !scannedProjects.includes(p)) {
                scannedProjects.push(p);
              }
            }
          }
        } catch {}
      }

      const managed = getManagedProjects();
      return {
        scanned: scannedProjects,
        managed,
        newProjects: scannedProjects.filter((p) => !managed.includes(p)),
      };
    }

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
      const override = getSkillOverride(skill.name);
      try {
        const content = readFileSync(skill.path, "utf-8");
        const result = parseSkillTree(content);
        return { ...skill, content, subSkills: result.tree, subSkillSource: result.source, displayName: override.displayName, customDescription: override.description };
      } catch {
        return { ...skill, content: "Failed to read SKILL.md", subSkills: [], subSkillSource: 'auto', displayName: override.displayName, customDescription: override.description };
      }
    }

    case "/api/skill/set-override": {
      const soName = params.get("name") || "";
      if (!soName) return { success: false, message: "Missing name" };
      const soDisplayName = params.has("displayName") ? (params.get("displayName") || "") : undefined;
      const soDescription = params.has("description") ? (params.get("description") || "") : undefined;
      setSkillOverride(soName, soDisplayName, soDescription);
      index = buildIndex();
      return { success: true };
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
      const homeDir = process.env.HOME || "~";

      if (PLATFORM === "claude-code") {
        const claudeProjectsDir = join(paths.ideRoot, "projects");
        if (existsSync(claudeProjectsDir)) {
          try {
            for (const d of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
              if (!d.isDirectory()) continue;
              const projectPath = "/" + d.name.replace(/-/g, "/");
              if (existsSync(projectPath) && statSync(projectPath).isDirectory() && !projects.includes(projectPath)) {
                projects.push(projectPath);
              }
            }
          } catch {}
        }
      } else {
        const cursorProjectsDir = paths.projectsDir;
        if (existsSync(cursorProjectsDir)) {
          try {
            for (const d of readdirSync(cursorProjectsDir)) {
              const decoded = "/" + d.replace(/-/g, "/");
              if (existsSync(decoded) && statSync(decoded).isDirectory()) {
                projects.push(decoded);
              }
            }
          } catch {}
        }
      }

      for (const p of [join(homeDir, "projects"), join(homeDir, "workspace"), join(homeDir, "code"), join(homeDir, "src")]) {
        if (existsSync(p) && !projects.includes(p)) projects.push(p);
      }
      return projects.slice(0, 20);
    }

    case "/api/skill/delete": {
      const delName = params.get("name") || "";
      const delProjectPath = params.get("projectPath") || "";
      if (!delName) return { success: false, message: "Missing skill name" };
      const delSkill = index.skills.find((s) => {
        const nameMatch = s.name === delName || s.name.toLowerCase() === delName.toLowerCase();
        if (!nameMatch) return false;
        if (delProjectPath) return s.source === "project-rules" && s.projectName === delProjectPath;
        return true;
      });
      if (!delSkill) return { success: false, message: `技能 "${delName}" 不存在` };
      try {
        if (delSkill.source === "project-rules") {
          if (delSkill.path.endsWith("SKILL.md")) {
            rmSync(dirname(delSkill.path), { recursive: true, force: true });
          } else {
            unlinkSync(delSkill.path);
          }
        } else {
          const skillDir = dirname(delSkill.path);
          rmSync(skillDir, { recursive: true, force: true });
        }
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

    case "/api/skill/copy-to-project": {
      const cpName = params.get("name") || "";
      const cpProject = params.get("projectPath") || "";
      const cpMode = normalizeMode(params.get("mode") || "global-skill");
      const cpGlobs = params.get("globs") || "";
      const cpDesc = params.get("description") || "";
      const cpWriteMode = (params.get("writeMode") || "append") as "append" | "replace";
      if (!cpName || !cpProject) return { success: false, message: "Missing name or projectPath" };
      const cpSkill = index.skills.find(
        (s) => s.name === cpName || s.name.toLowerCase() === cpName.toLowerCase()
      );
      if (!cpSkill) return { success: false, message: `技能 "${cpName}" 不存在` };
      try {
        const content = readFileSync(cpSkill.path, "utf-8");
        const safeName = cpName.replace(/[^a-zA-Z0-9_-]/g, "-");
        let cpResult: { targetPath: string; modeLabel: string } | { error: string };

        if (cpMode === "global-skill") {
          const disableModelInvocation = params.get("disableModelInvocation") === "1";
          cpResult = installToGlobalSkill(safeName, content, { disableModelInvocation });
        } else if (cpMode === "cursorrules" || cpMode === "project-root-rule") {
          const projDir = resolve(cpProject);
          if (!existsSync(projDir)) return { success: false, message: "项目路径不存在: " + cpProject };
          const tp = writeToProjectRootRule(cpProject, safeName, content, cpWriteMode);
          const mLabel = MODE_LABELS["project-root-rule"] || MODE_LABELS["cursorrules"] || cpMode;
          cpResult = { targetPath: tp, modeLabel: mLabel };
        } else {
          cpResult = installToProjectRule(safeName, content, cpProject, cpMode as RuleMode, {
            globs: cpGlobs,
            description: cpDesc || cpSkill.description,
          });
        }

        if ("error" in cpResult) return { success: false, message: cpResult.error };

        index = buildIndex();
        return { success: true, message: `已以 ${cpResult.modeLabel} 模式添加`, path: cpResult.targetPath, mode: cpMode, totalSkills: index.totalSkills };
      } catch (e) {
        return { success: false, message: `复制失败: ${String(e).slice(0, 200)}` };
      }
    }

    case "/api/skill/promote-to-global": {
      const prName = params.get("name") || "";
      const prDelete = params.get("deleteOriginal") === "1";
      if (!prName) return { success: false, message: "Missing name" };
      const prSkill = index.skills.find(
        (s) => s.name === prName && s.source === "project-rules"
      );
      if (!prSkill) return { success: false, message: `项目级技能 "${prName}" 不存在` };
      try {
        const content = readFileSync(prSkill.path, "utf-8");
        const safeName = prName.replace(/[^a-zA-Z0-9_-]/g, "-");
        const globalDir = join(paths.skillsDir, safeName);
        mkdirSync(globalDir, { recursive: true });
        const targetPath = join(globalDir, "SKILL.md");
        writeFileSync(targetPath, content, "utf-8");
        if (prDelete) {
          try { unlinkSync(prSkill.path); } catch {}
        }
        index = buildIndex();
        return { success: true, message: `已提升为全局技能`, path: targetPath, totalSkills: index.totalSkills };
      } catch (e) {
        return { success: false, message: `提升失败: ${String(e).slice(0, 200)}` };
      }
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
      const mcpPath = paths.mcpConfigPath;
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
      return { platform: PLATFORM, path: mcpPath, servers: result };
    }

    case "/api/mcp/restart": {
      const srvName = params.get("name") || "";
      if (!srvName) return { error: "Missing server name" };

      if (PLATFORM === "claude-code") {
        try {
          execSync(`claude mcp remove "${srvName}" 2>/dev/null; sleep 0.5`, { timeout: 5000 });
        } catch {}
        const mcpPath2 = paths.mcpConfigPath;
        let mcpCfg: Record<string, unknown> = {};
        try { mcpCfg = JSON.parse(readFileSync(mcpPath2, "utf-8")); } catch {}
        const mcpServers = (mcpCfg as { mcpServers?: Record<string, { command?: string; args?: string[] }> }).mcpServers || {};
        const srv = mcpServers[srvName];
        if (srv) {
          const cmd = srv.command || "npx";
          const args = (srv.args || []).join(" ");
          try {
            execSync(`claude mcp add "${srvName}" ${cmd} ${args}`, { timeout: 5000 });
          } catch {}
          return { success: true, message: `已通过 claude mcp 重新添加 ${srvName}。下次 Claude Code 会话将使用最新配置。` };
        }
        return { success: true, message: `已移除 ${srvName}。请通过 claude mcp add 重新配置，或在下次会话中使用 /mcp 检查状态。` };
      }

      const mcpPath2 = paths.mcpConfigPath;
      let mcpCfg: Record<string, unknown> = {};
      try { mcpCfg = JSON.parse(readFileSync(mcpPath2, "utf-8")); } catch {}
      const mcpServers = (mcpCfg as { mcpServers?: Record<string, { command?: string; args?: string[] }> }).mcpServers || {};
      const srv = mcpServers[srvName];
      if (!srv) return { error: `Server "${srvName}" not found in config` };

      const searchStr = (srv.args || []).length > 0 ? (srv.args || [])[srv.args!.length - 1] : (srv.command || "");

      try {
        execSync(`ps aux | grep '${searchStr}' | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null`, { timeout: 3000 });
      } catch {}

      return { success: true, message: `已终止 ${srvName} 的所有进程。${paths.brandName} 将自动重新启动它。` };
    }

    case "/api/mcp/config": {
      const mcpPath3 = paths.mcpConfigPath;
      try {
        const content = readFileSync(mcpPath3, "utf-8");
        return { platform: PLATFORM, path: mcpPath3, content };
      } catch {
        return { error: `无法读取 ${mcpPath3}` };
      }
    }

    case "/api/version": {
      const skillerRoot = join(import.meta.dirname, "..");
      try {
        const pkgJson = JSON.parse(readFileSync(join(skillerRoot, "package.json"), "utf-8"));
        let commitHash = "";
        let commitDate = "";
        try {
          commitHash = execSync("git rev-parse --short HEAD", { cwd: skillerRoot, encoding: "utf-8" }).trim();
          commitDate = execSync("git log -1 --format=%ci", { cwd: skillerRoot, encoding: "utf-8" }).trim();
        } catch {}
        return { version: pkgJson.version, commit: commitHash, commitDate, name: pkgJson.name };
      } catch {
        return { version: "unknown", commit: "", commitDate: "" };
      }
    }

    case "/api/check-update": {
      const skillerRoot2 = join(import.meta.dirname, "..");
      try {
        const localCommit = execSync("git rev-parse HEAD", { cwd: skillerRoot2, encoding: "utf-8" }).trim();
        let fetchOk = false;
        try {
          execSync("git fetch origin --quiet 2>&1", { cwd: skillerRoot2, encoding: "utf-8", timeout: 15000 });
          fetchOk = true;
        } catch (fetchErr: any) {
          const msg = fetchErr.message || "";
          if (msg.includes("TLS") || msg.includes("gnutls") || msg.includes("SSL") || msg.includes("无法访问") || msg.includes("Could not resolve")) {
            return { hasUpdate: false, networkError: true, errorMsg: "无法连接 GitHub（网络/代理问题），请检查网络配置或设置代理后重试。", localCommit: localCommit.substring(0, 7) };
          }
          throw fetchErr;
        }
        const remoteCommit = execSync("git rev-parse origin/main", { cwd: skillerRoot2, encoding: "utf-8" }).trim();
        const behind = parseInt(execSync(`git rev-list --count HEAD..origin/main`, { cwd: skillerRoot2, encoding: "utf-8" }).trim()) || 0;
        let remoteLog = "";
        if (behind > 0) {
          remoteLog = execSync(`git log --oneline HEAD..origin/main`, { cwd: skillerRoot2, encoding: "utf-8" }).trim();
        }
        let releaseInfo = null;
        try {
          const pkgJson2 = JSON.parse(readFileSync(join(skillerRoot2, "package.json"), "utf-8"));
          const repoUrl = pkgJson2.repository?.url || "";
          const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
          if (match) {
            const repoSlug = match[1];
            const releaseData = execSync(
              `curl -sf --max-time 8 -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${repoSlug}/releases/latest"`,
              { cwd: skillerRoot2, encoding: "utf-8", timeout: 10000 }
            );
            const rel = JSON.parse(releaseData);
            if (rel.tag_name) {
              releaseInfo = { tag: rel.tag_name, name: rel.name || rel.tag_name, body: (rel.body || "").substring(0, 500), publishedAt: rel.published_at };
            }
          }
        } catch {}
        return { hasUpdate: behind > 0, behind, localCommit: localCommit.substring(0, 7), remoteCommit: remoteCommit.substring(0, 7), changelog: remoteLog, release: releaseInfo };
      } catch (e: any) {
        return { error: "检查更新失败: " + (e.message || "unknown").substring(0, 200), hasUpdate: false };
      }
    }

    default:
      return { error: "Unknown endpoint" };
  }
}

const localSkillNames = () => index.skills.map((s) => s.name);

function maskToken(token?: string): string | undefined {
  if (!token) return undefined;
  return "••••" + token.slice(-4);
}

async function rollbackCreated(repo: string, branch: string, headers: Record<string, string>, paths: string[]) {
  for (const p of paths) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${p}?ref=${branch}`, {
        headers, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as { sha: string };
      await fetch(`https://api.github.com/repos/${repo}/contents/${p}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `rollback rename: delete ${p}`, sha: d.sha, branch }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { /* best-effort rollback */ }
  }
}

function maskConfig<T extends { githubToken?: string; sources: Array<{ token?: string }> }>(cfg: T) {
  return {
    ...cfg,
    githubToken: maskToken(cfg.githubToken),
    sources: cfg.sources.map(s => ({ ...s, token: maskToken(s.token) })),
  };
}

type RuleMode = "rule-always" | "rule-auto" | "rule-agent" | "rule-manual" | "project-root-rule" | "project-rule";

const MODE_LABELS: Record<string, string> = PLATFORM === "claude-code" ? {
  "global-skill": "全局 Skill (~/.claude/skills/)",
  "project-root-rule": `项目常驻规则 (${paths.projectRootRuleFile})`,
  "project-rule": `项目按需规则 (${paths.projectRulesDir}/)`,
  "local-repo": "本地仓库",
} : {
  "global-skill": "全局 Skill",
  "cursorrules": "项目级规则 (.cursorrules)",
  "rule-always": "Always Rule（始终生效）",
  "rule-auto": "Auto Rule（文件匹配）",
  "rule-agent": "Agent Rule（按需加载）",
  "rule-manual": "Manual Rule（手动引用）",
};

function normalizeMode(raw: string): string {
  if (raw === "global" || raw === "global-skill") return "global-skill";
  if (raw === "local-repo") return "local-repo";

  if (PLATFORM === "claude-code") {
    if (raw === "project-root-rule" || raw === "cursorrules" || raw === "rule-always") return "project-root-rule";
    if (raw === "project-rule" || raw === "rule-agent" || raw === "rule-auto" || raw === "rule-manual") return "project-rule";
    if (raw === "project-skill" || raw === "project" || raw === "rule-smart") return "project-rule";
    if (raw in MODE_LABELS) return raw;
    return "global-skill";
  }

  if (raw === "rule-smart") return "rule-agent";
  if (raw === "project-skill" || raw === "project") return "rule-agent";
  if (raw in MODE_LABELS) return raw;
  return "global-skill";
}

function buildMdcContent(rawContent: string, mode: RuleMode, options?: { globs?: string; description?: string }): string {
  const { data: fm, content: body } = matter(rawContent);
  let description = options?.description || (fm.description as string) || "";
  let globs = options?.globs || "";
  let alwaysApply = false;

  switch (mode) {
    case "rule-always":
      alwaysApply = true;
      break;
    case "rule-auto":
      alwaysApply = false;
      break;
    case "rule-agent":
      alwaysApply = false;
      globs = "";
      if (!description) description = (fm.name as string) || "";
      break;
    case "rule-manual":
      alwaysApply = false;
      globs = "";
      description = "";
      break;
  }

  return `---\ndescription: ${description}\nglobs: ${globs}\nalwaysApply: ${alwaysApply}\n---\n${body.trim()}\n`;
}

function writeToProjectRootRule(projectPath: string, skillName: string, rawContent: string, writeMode: "append" | "replace"): string {
  const projDir = resolve(projectPath);
  const targetPath = join(projDir, paths.projectRootRuleFile);
  const { content: body } = matter(rawContent);
  const cleanBody = body.trim();

  if (writeMode === "replace") {
    writeFileSync(targetPath, cleanBody + "\n", "utf-8");
  } else {
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : "";
    const separator = `\n\n# ===== ${skillName} =====\n\n`;
    writeFileSync(targetPath, existing.trimEnd() + separator + cleanBody + "\n", "utf-8");
  }
  return targetPath;
}

function installToGlobalSkill(safeName: string, content: string, options?: { disableModelInvocation?: boolean }): { targetPath: string; modeLabel: string } | { error: string } {
  const base = paths.skillsDir;
  const dir = join(base, safeName);
  if (!resolve(dir).startsWith(resolve(base))) return { error: "Invalid path" };
  mkdirSync(dir, { recursive: true });
  const targetPath = join(dir, "SKILL.md");

  if (PLATFORM === "claude-code" && options?.disableModelInvocation) {
    const { data: fm, content: body } = matter(content);
    const newFm = { ...fm, "disable-model-invocation": true };
    const fmStr = Object.entries(newFm).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`).join("\n");
    writeFileSync(targetPath, `---\n${fmStr}\n---\n\n${body.trim()}\n`, "utf-8");
  } else {
    writeFileSync(targetPath, content, "utf-8");
  }
  return { targetPath, modeLabel: MODE_LABELS["global-skill"] };
}

function installToProjectRule(safeName: string, content: string, projectPath: string, mode: RuleMode, options?: { globs?: string; description?: string }): { targetPath: string; modeLabel: string } | { error: string } {
  const projDir = resolve(projectPath);
  if (!existsSync(projDir)) return { error: "项目路径不存在: " + projectPath };

  if (PLATFORM === "claude-code") {
    if (mode === "project-root-rule") {
      const targetPath = join(projDir, paths.projectRootRuleFile);
      const { content: body } = matter(content);
      const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : "";
      const separator = `\n\n# ===== ${safeName} =====\n\n`;
      writeFileSync(targetPath, existing.trimEnd() + separator + body.trim() + "\n", "utf-8");
      return { targetPath, modeLabel: MODE_LABELS["project-root-rule"] };
    }
    const rulesDir = join(projDir, paths.projectRulesDir);
    mkdirSync(rulesDir, { recursive: true });
    const targetPath = join(rulesDir, safeName + ".md");
    const { data: fm, content: body } = matter(content);
    const claudePaths = options?.globs ? options.globs.split(",").map((g: string) => g.trim()).filter(Boolean) : [];
    let ruleContent = "";
    if (claudePaths.length > 0) {
      ruleContent = `---\npaths:\n${claudePaths.map((p: string) => `  - "${p}"`).join("\n")}\n---\n\n${body.trim()}\n`;
    } else {
      ruleContent = body.trim() + "\n";
    }
    writeFileSync(targetPath, ruleContent, "utf-8");
    return { targetPath, modeLabel: MODE_LABELS["project-rule"] || MODE_LABELS[mode] || mode };
  }

  const rulesDir = join(projDir, paths.projectRulesDir);
  mkdirSync(rulesDir, { recursive: true });
  const targetPath = join(rulesDir, safeName + ".mdc");
  writeFileSync(targetPath, buildMdcContent(content, mode, options), "utf-8");
  return { targetPath, modeLabel: MODE_LABELS[mode] || mode };
}

function installToLocalRepo(safeName: string, content: string): { targetPath: string; modeLabel: string } | { error: string } {
  const dir = join(LOCAL_REPO_DIR, safeName);
  mkdirSync(dir, { recursive: true });
  const targetPath = join(dir, "SKILL.md");
  writeFileSync(targetPath, content, "utf-8");
  return { targetPath, modeLabel: "本地仓库" };
}

const ALLOWED_HOSTS = [
  "raw.githubusercontent.com",
  "github.com",
  "gist.githubusercontent.com",
  "gitee.com",
  "raw.gitee.com",
];

function isAllowedUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return true;
    const ip = u.hostname;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|localhost|::1|\[::1\])/.test(ip)) return false;
    return true;
  } catch {
    return false;
  }
}

async function handleAsyncApi(path: string, params: URLSearchParams): Promise<unknown> {
  switch (path) {
    case "/api/community/config": {
      return maskConfig(loadConfig());
    }

    case "/api/community/save-config": {
      const repo = params.get("repo") || undefined;
      const branch = params.get("branch") || undefined;
      const skillsPath = params.get("skillsPath") || undefined;
      const githubToken = params.get("token") || undefined;
      const authorName = params.get("author") || undefined;
      return maskConfig(saveConfig({ repo, branch, skillsPath, githubToken, authorName }));
    }

    case "/api/community/skills": {
      const config = loadConfig();
      const light = params.get("light") === "1";
      const pageStr = params.get("page");
      const pageSizeStr = params.get("pageSize");
      const page = pageStr ? parseInt(pageStr) : undefined;
      const pageSize = pageSizeStr ? parseInt(pageSizeStr) : 30;
      const rawResult = await listCommunitySkills(config, { light, page, pageSize });
      const skills = Array.isArray(rawResult) ? rawResult : rawResult.skills;
      const errors = Array.isArray(rawResult) ? undefined : rawResult._errors;
      const localNames = localSkillNames();
      const mapped = skills.map(s => ({
        ...s,
        installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
      }));
      return errors ? { skills: mapped, _errors: errors } : mapped;
    }

    case "/api/community/skills/enrich": {
      const config = loadConfig();
      const rawEnrich = await listCommunitySkills(config, { light: true });
      const skillsForEnrich = Array.isArray(rawEnrich) ? rawEnrich : rawEnrich.skills;
      const start = parseInt(params.get("start") || "0");
      const count = parseInt(params.get("count") || "20");
      const enriched = await enrichSkillMetadata(skillsForEnrich, start, count);
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
        const descResult = await uploadDescriptionFile(config, skillName, extraDesc.trim());
        if (!descResult.success) {
          return { ...result, descWarning: "技能已上传，但描述文件保存失败: " + (descResult.error || "未知错误") };
        }
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
      if (!isAllowedUrl(rawUrl)) return { error: "URL 不在允许的域名列表中（仅支持 GitHub / Gitee）" };

      const installMode = normalizeMode(params.get("mode") || params.get("scope") || "global-skill");
      const projectPath = params.get("projectPath") || "";
      const globs = params.get("globs") || "";
      const customDesc = params.get("description") || "";
      const writeMode = (params.get("writeMode") || "append") as "append" | "replace";
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      const content = await downloadCommunitySkill(rawUrl);
      if (!content) return { error: "Failed to fetch skill" };

      let instResult: { targetPath: string; modeLabel: string } | { error: string };

      if (installMode === "local-repo") {
        instResult = installToLocalRepo(safeName, content);
      } else if (installMode === "global-skill") {
        instResult = installToGlobalSkill(safeName, content);
      } else if (installMode === "cursorrules" || installMode === "project-root-rule") {
        if (!projectPath) return { error: "项目规则模式需要指定项目路径" };
        const projDir = resolve(projectPath);
        if (!existsSync(projDir)) return { error: "项目路径不存在: " + projectPath };
        const tp = writeToProjectRootRule(projectPath, safeName, content, writeMode);
        const mLabel = MODE_LABELS["project-root-rule"] || MODE_LABELS["cursorrules"] || installMode;
        instResult = { targetPath: tp, modeLabel: mLabel };
      } else {
        if (!projectPath) return { error: "项目规则模式需要指定项目路径" };
        instResult = installToProjectRule(safeName, content, projectPath, installMode as RuleMode, { globs, description: customDesc });
      }

      if ("error" in instResult) return instResult;

      registerInstall({
        skillName: name,
        sourceUrl: rawUrl,
        installedAt: new Date().toISOString(),
        installMode,
        targetPath: instResult.targetPath,
        contentHash: simpleHash(content),
        ...(projectPath ? { projectPath } : {}),
      });
      index = buildIndex();

      return { success: true, name: safeName, path: instResult.targetPath, mode: installMode, modeLabel: instResult.modeLabel, totalSkills: index.totalSkills };
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

      const installMode2 = normalizeMode(params.get("mode") || params.get("scope") || "global-skill");
      const projectPath2 = params.get("projectPath") || "";
      const globs2 = params.get("globs") || "";
      const customDesc2 = params.get("description") || "";
      const writeMode2 = (params.get("writeMode") || "append") as "append" | "replace";

      try {
        const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) return { error: `下载失败 (${resp.status})` };
        const content = await resp.text();
        if (!content.trim()) return { error: "内容为空" };

        let instResult2: { targetPath: string; modeLabel: string } | { error: string };

        if (installMode2 === "local-repo") {
          instResult2 = installToLocalRepo(safeName, content);
        } else if (installMode2 === "global-skill") {
          instResult2 = installToGlobalSkill(safeName, content);
        } else if (installMode2 === "cursorrules" || installMode2 === "project-root-rule") {
          if (!projectPath2) return { error: "项目规则模式需要指定项目路径" };
          const projDir = resolve(projectPath2);
          if (!existsSync(projDir)) return { error: "项目路径不存在: " + projectPath2 };
          const tp = writeToProjectRootRule(projectPath2, safeName, content, writeMode2);
          const mLabel = MODE_LABELS["project-root-rule"] || MODE_LABELS["cursorrules"] || installMode2;
          instResult2 = { targetPath: tp, modeLabel: mLabel };
        } else {
          if (!projectPath2) return { error: "项目规则模式需要指定项目路径" };
          instResult2 = installToProjectRule(safeName, content, projectPath2, installMode2 as RuleMode, { globs: globs2, description: customDesc2 });
        }

        if ("error" in instResult2) return instResult2;

        registerInstall({
          skillName: skillName,
          sourceUrl: rawUrl,
          installedAt: new Date().toISOString(),
          installMode: installMode2,
          targetPath: instResult2.targetPath,
          contentHash: simpleHash(content),
          ...(projectPath2 ? { projectPath: projectPath2 } : {}),
        });
        index = buildIndex();

        return { success: true, name: safeName, path: instResult2.targetPath, mode: installMode2, modeLabel: instResult2.modeLabel, totalSkills: index.totalSkills };
      } catch (e: unknown) {
        return { error: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/skill/check-updates": {
      const registry = getInstallRegistry();
      if (registry.length === 0) return { updates: [], checked: 0 };
      const updates: { skillName: string; sourceUrl: string; hasUpdate: boolean; installedAt: string; targetPath: string }[] = [];
      const checkName = params.get("name");
      const toCheck = checkName ? registry.filter((r) => r.skillName === checkName) : registry;
      for (const rec of toCheck) {
        try {
          const resp = await fetch(rec.sourceUrl, { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) { updates.push({ ...rec, hasUpdate: false }); continue; }
          const newContent = await resp.text();
          const newHash = simpleHash(newContent);
          updates.push({
            skillName: rec.skillName,
            sourceUrl: rec.sourceUrl,
            hasUpdate: newHash !== rec.contentHash,
            installedAt: rec.installedAt,
            targetPath: rec.targetPath,
          });
        } catch {
          updates.push({ skillName: rec.skillName, sourceUrl: rec.sourceUrl, hasUpdate: false, installedAt: rec.installedAt, targetPath: rec.targetPath });
        }
      }
      return { updates, checked: toCheck.length };
    }

    case "/api/skill/install-registry": {
      return getInstallRegistry();
    }

    case "/api/community/fetch-content": {
      const fetchUrl = params.get("url") || "";
      if (!fetchUrl) return { error: "Missing url" };
      if (!isAllowedUrl(fetchUrl)) return { error: "URL not allowed" };
      const cfg = loadConfig();
      let fetchToken = cfg.githubToken || "";
      const fetchSourceId = params.get("sourceId");
      if (fetchSourceId) {
        const src = cfg.sources.find((s) => s.id === fetchSourceId);
        if (src?.token) fetchToken = src.token;
      }
      try {
        const headers: Record<string, string> = {};
        if (fetchToken && (fetchUrl.includes("github") || fetchUrl.includes("githubusercontent"))) {
          headers["Authorization"] = `token ${fetchToken}`;
        }
        const resp = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(10000) });
        if (!resp.ok) return { error: `HTTP ${resp.status}`, content: "" };
        const text = await resp.text();
        return { content: text };
      } catch (e) {
        return { error: String(e).slice(0, 200), content: "" };
      }
    }

    case "/api/community/refresh": {
      clearAllCache();
      const config = loadConfig();
      const rawRefresh = await listCommunitySkills(config, { light: true });
      return Array.isArray(rawRefresh) ? rawRefresh : rawRefresh.skills;
    }

    case "/api/community/cache-status": {
      const cacheFile = join(paths.dataDir, "community_cache.json");
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
      clearAllCache();
      const masked = maskConfig(config);
      return { success: true, sources: masked.sources, githubToken: masked.githubToken };
    }

    case "/api/community/remove-source": {
      const sourceId = params.get("id") || "";
      if (!sourceId) return { error: "Missing id" };
      const config = removeSource(sourceId);
      clearAllCache();
      const masked = maskConfig(config);
      return { success: true, sources: masked.sources, githubToken: masked.githubToken };
    }

    case "/api/community/source-skills": {
      const sourceId = params.get("sourceId") || "";
      const forceRefresh = params.get("force") === "1";
      if (!sourceId) return { error: "Missing sourceId" };

      if (!forceRefresh) {
        const cached = loadCachedSkills(sourceId);
        if (cached && cached.skills.length > 0) {
          const localNames = localSkillNames();
          return {
            skills: cached.skills.map(s => ({
              ...s,
              installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
            })),
            stale: cached.stale,
            updatedAt: cached.updatedAt,
          };
        }
      }

      const config = loadConfig();
      const skills = await listSourceSkills(config, sourceId);
      const localNames = localSkillNames();
      return {
        skills: skills.map(s => ({
          ...s,
          installed: localNames.some(n => n.toLowerCase() === s.name.toLowerCase()),
        })),
        stale: false,
        updatedAt: new Date().toISOString(),
      };
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

    case "/api/community/repo-categories": {
      const rcSourceId = params.get("sourceId") || "";
      const rcForce = params.get("force") === "1";
      if (!rcSourceId) return { error: "Missing sourceId" };

      if (!rcForce && repoCatCache[rcSourceId] && Date.now() - repoCatCache[rcSourceId].ts < 3600000) {
        return repoCatCache[rcSourceId].data;
      }

      const rcConfig = loadConfig();
      const rcSource = rcConfig.sources.find(s => s.id === rcSourceId);
      if (!rcSource) return { error: "Source not found" };
      const rcToken = rcSource.token || rcConfig.githubToken || "";
      const rcUrl = `https://api.github.com/repos/${rcSource.repo}/contents/${rcSource.skillsPath}/categories.json?ref=${rcSource.branch}`;
      const rcHeaders: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Skiller-Community/1.0",
      };
      if (rcToken) rcHeaders.Authorization = `Bearer ${rcToken}`;
      try {
        const rcResp = await fetch(rcUrl, { headers: rcHeaders, signal: AbortSignal.timeout(10000) });
        if (!rcResp.ok) return { categories: [], skillCategories: {}, sha: null };
        const rcData = await rcResp.json() as { content: string; sha: string };
        const decoded = Buffer.from(rcData.content, "base64").toString("utf-8");
        const parsed = JSON.parse(decoded);
        const result = { ...parsed, sha: rcData.sha };
        repoCatCache[rcSourceId] = { data: result, ts: Date.now() };
        return result;
      } catch {
        if (repoCatCache[rcSourceId]) return repoCatCache[rcSourceId].data;
        return { categories: [], skillCategories: {}, sha: null };
      }
    }

    case "/api/community/rename-skill": {
      const rnSourceId = params.get("sourceId") || "";
      const rnOldName = params.get("oldName") || "";
      const rnNewName = params.get("newName") || "";
      if (!rnSourceId || !rnOldName || !rnNewName) return { success: false, message: "Missing parameters" };
      if (rnOldName === rnNewName) return { success: false, message: "名称相同" };
      const rnConfig = loadConfig();
      const rnSource = rnConfig.sources.find(s => s.id === rnSourceId);
      if (!rnSource) return { success: false, message: "Source not found" };
      if (!rnSource.writable) return { success: false, message: "仓库不可写" };
      const rnToken = rnSource.token || rnConfig.githubToken;
      if (!rnToken) return { success: false, message: "没有 Token" };

      const rnHeaders: Record<string, string> = {
        Authorization: `Bearer ${rnToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Skiller-Community/1.0",
      };

      try {
        const treeUrl = `https://api.github.com/repos/${rnSource.repo}/git/trees/${rnSource.branch}?recursive=1`;
        const treeResp = await fetch(treeUrl, { headers: rnHeaders, signal: AbortSignal.timeout(15000) });
        if (!treeResp.ok) return { success: false, message: `获取仓库文件树失败 (${treeResp.status})` };
        const treeData = await treeResp.json() as { tree: Array<{ path: string; type: string; sha: string }> };

        const oldPrefix = `${rnSource.skillsPath}/${rnOldName}/`;
        const oldFiles = treeData.tree.filter(t => t.type === "blob" && t.path.startsWith(oldPrefix));
        if (oldFiles.length === 0) return { success: false, message: `找不到 ${rnOldName} 的文件` };

        const createdPaths: string[] = [];
        for (const file of oldFiles) {
          const fileResp = await fetch(`https://api.github.com/repos/${rnSource.repo}/contents/${file.path}?ref=${rnSource.branch}`, {
            headers: rnHeaders, signal: AbortSignal.timeout(8000),
          });
          if (!fileResp.ok) {
            await rollbackCreated(rnSource.repo, rnSource.branch, rnHeaders, createdPaths);
            return { success: false, message: `读取文件 ${file.path} 失败` };
          }
          const fileData = await fileResp.json() as { content: string; sha: string };

          const relativePath = file.path.slice(oldPrefix.length);
          const newPath = `${rnSource.skillsPath}/${rnNewName}/${relativePath}`;

          const createResp = await fetch(`https://api.github.com/repos/${rnSource.repo}/contents/${newPath}`, {
            method: "PUT",
            headers: { ...rnHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `rename: ${rnOldName} -> ${rnNewName} (${relativePath})`,
              content: fileData.content,
              branch: rnSource.branch,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!createResp.ok) {
            await rollbackCreated(rnSource.repo, rnSource.branch, rnHeaders, createdPaths);
            const errText = await createResp.text();
            return { success: false, message: `创建新文件失败（已回滚）: ${errText.slice(0, 200)}` };
          }
          createdPaths.push(newPath);
        }

        let deleteFailures = 0;
        for (const file of oldFiles) {
          try {
            const delResp = await fetch(`https://api.github.com/repos/${rnSource.repo}/contents/${file.path}?ref=${rnSource.branch}`, {
              headers: rnHeaders, signal: AbortSignal.timeout(8000),
            });
            if (delResp.ok) {
              const delData = await delResp.json() as { sha: string };
              const dr = await fetch(`https://api.github.com/repos/${rnSource.repo}/contents/${file.path}`, {
                method: "DELETE",
                headers: { ...rnHeaders, "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: `rename: delete old ${rnOldName}/${file.path.slice(oldPrefix.length)}`,
                  sha: delData.sha,
                  branch: rnSource.branch,
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (!dr.ok) deleteFailures++;
            }
          } catch { deleteFailures++; }
        }

        clearAllCache();
        const warn = deleteFailures > 0 ? `（${deleteFailures} 个旧文件未能删除，需手动清理）` : "";
        return { success: true, message: `已将 ${rnOldName} 重命名为 ${rnNewName}${warn}` };
      } catch (e) {
        return { success: false, message: `操作失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/community/upload-description": {
      const udSourceId = params.get("sourceId") || "";
      const udName = params.get("name") || "";
      const udDesc = params.get("description") || "";
      if (!udSourceId || !udName) return { success: false, message: "Missing sourceId or name" };
      if (!udDesc.trim()) return { success: false, message: "描述不能为空" };
      const udConfig = loadConfig();
      const udSource = udConfig.sources.find(s => s.id === udSourceId);
      if (!udSource) return { success: false, message: "Source not found" };
      if (!udSource.writable) return { success: false, message: "仓库不可写" };
      const udToken = udSource.token || udConfig.githubToken;
      if (!udToken) return { success: false, message: "没有 Token" };

      const udPath = `${udSource.skillsPath}/${udName}/DESCRIPTION.md`;
      const udUrl = `https://api.github.com/repos/${udSource.repo}/contents/${udPath}`;
      const udHeaders: Record<string, string> = {
        Authorization: `Bearer ${udToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Skiller-Community/1.0",
      };

      let udSha: string | undefined;
      try {
        const checkResp = await fetch(`${udUrl}?ref=${udSource.branch}`, { headers: udHeaders, signal: AbortSignal.timeout(8000) });
        if (checkResp.ok) {
          const data = await checkResp.json() as { sha: string };
          udSha = data.sha;
        }
      } catch {}

      const udBody: Record<string, string> = {
        message: `desc: update ${udName} description`,
        content: Buffer.from(udDesc).toString("base64"),
        branch: udSource.branch,
      };
      if (udSha) udBody.sha = udSha;

      try {
        const udResp = await fetch(udUrl, {
          method: "PUT",
          headers: { ...udHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(udBody),
          signal: AbortSignal.timeout(15000),
        });
        if (!udResp.ok) {
          const errText = await udResp.text();
          return { success: false, message: `GitHub API 错误 (${udResp.status}): ${errText.slice(0, 200)}` };
        }
        clearAllCache();
        return { success: true, message: `已保存 ${udName} 的描述` };
      } catch (e) {
        return { success: false, message: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/community/save-repo-categories": {
      const scSourceId = params.get("sourceId") || "";
      if (!scSourceId) return { success: false, message: "Missing sourceId" };
      const scConfig = loadConfig();
      const scSource = scConfig.sources.find(s => s.id === scSourceId);
      if (!scSource) return { success: false, message: "Source not found" };
      if (!scSource.writable) return { success: false, message: "仓库不可写" };
      const scToken = scSource.token || scConfig.githubToken;
      if (!scToken) return { success: false, message: "没有 Token" };

      const categoriesJson = params.get("data") || "{}";
      const scSha = params.get("sha") || undefined;

      const scUrl = `https://api.github.com/repos/${scSource.repo}/contents/${scSource.skillsPath}/categories.json`;
      const scHeaders: Record<string, string> = {
        Authorization: `Bearer ${scToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Skiller-Community/1.0",
        "Content-Type": "application/json",
      };

      const scBody: Record<string, string> = {
        message: "Update categories",
        content: Buffer.from(categoriesJson).toString("base64"),
        branch: scSource.branch,
      };
      if (scSha) scBody.sha = scSha;

      try {
        const scResp = await fetch(scUrl, {
          method: "PUT",
          headers: scHeaders,
          body: JSON.stringify(scBody),
          signal: AbortSignal.timeout(15000),
        });
        if (!scResp.ok) {
          const errText = await scResp.text();
          return { success: false, message: `GitHub API 错误 (${scResp.status}): ${errText.slice(0, 200)}` };
        }
        const result = await scResp.json() as { content: { sha: string } };
        try {
          const newCatData = JSON.parse(categoriesJson);
          repoCatCache[scSourceId] = { data: { ...newCatData, sha: result.content.sha }, ts: Date.now() };
        } catch {}
        return { success: true, sha: result.content.sha };
      } catch (e) {
        return { success: false, message: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/community/import-url": {
      const ghUrl = params.get("url") || "";
      const targetSourceId = params.get("sourceId") || "";
      if (!ghUrl) return { success: false, message: "Missing url" };
      if (!targetSourceId) return { success: false, message: "Missing target sourceId" };

      const config = loadConfig();
      const targetSource = config.sources.find(s => s.id === targetSourceId);
      if (!targetSource) return { success: false, message: `仓库 "${targetSourceId}" 不存在` };
      if (!targetSource.writable) return { success: false, message: "目标仓库不可写" };
      const token = targetSource.token || config.githubToken;
      if (!token) return { success: false, message: "目标仓库没有配置 token" };

      const m2 = ghUrl.match(/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)/);
      if (!m2) return { success: false, message: "无法解析 GitHub 链接" };
      const [, srcRepo, srcBranch, srcPath] = m2;

      let rawContent = "";
      const tryPaths = srcPath.endsWith(".md") || srcPath.endsWith(".MD")
        ? [srcPath]
        : [`${srcPath}/SKILL.md`, `${srcPath}/skill.md`, srcPath];
      for (const tp of tryPaths) {
        try {
          const r = await fetch(`https://raw.githubusercontent.com/${srcRepo}/${srcBranch}/${tp}`, { signal: AbortSignal.timeout(10000) });
          if (r.ok) { rawContent = await r.text(); break; }
        } catch {}
      }
      if (!rawContent.trim()) return { success: false, message: "下载失败或内容为空" };

      const customName = params.get("name") || "";
      const skillName = customName || srcPath.split("/").filter(Boolean).slice(-1)[0]?.replace(/\.md$/i, "") || "unknown";
      const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-");

      const originalAuthor = srcRepo.split("/")[0] || "unknown";
      const authorLine = `original_author: ${originalAuthor}`;
      const sourceRefLine = `source_repo: ${srcRepo}`;
      if (rawContent.startsWith("---")) {
        const endIdx = rawContent.indexOf("---", 3);
        if (endIdx > 0) {
          const front = rawContent.slice(0, endIdx);
          if (!front.includes("original_author")) {
            rawContent = front + authorLine + "\n" + sourceRefLine + "\n" + rawContent.slice(endIdx);
          }
        }
      } else {
        rawContent = "---\n" + authorLine + "\n" + sourceRefLine + "\n---\n\n" + rawContent;
      }

      const uploadPath = `${targetSource.skillsPath}/${safeName}/SKILL.md`;
      const apiUrl = `https://api.github.com/repos/${targetSource.repo}/contents/${uploadPath}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Skiller-Community/1.0",
      };

      let sha: string | undefined;
      try {
        const check = await fetch(`${apiUrl}?ref=${targetSource.branch}`, { headers, signal: AbortSignal.timeout(8000) });
        if (check.ok) {
          const existing = await check.json() as { sha: string };
          sha = existing.sha;
        }
      } catch {}

      const body: Record<string, string> = {
        message: `Import ${safeName} from ${srcRepo} (original author: ${originalAuthor})`,
        content: Buffer.from(rawContent).toString("base64"),
        branch: targetSource.branch,
      };
      if (sha) body.sha = sha;

      try {
        const resp = await fetch(apiUrl, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return { success: false, message: `GitHub API 错误 (${resp.status}): ${errText.slice(0, 200)}` };
        }
        const putResult = await resp.json() as { content?: { sha?: string; html_url?: string } };
        clearAllCache();

        const importedMeta = extractMetadata(rawContent);
        const skill = {
          name: safeName,
          description: importedMeta.description || `${safeName} skill`,
          author: originalAuthor,
          htmlUrl: `https://github.com/${targetSource.repo}/tree/${targetSource.branch}/${targetSource.skillsPath}/${safeName}`,
          rawUrl: `https://raw.githubusercontent.com/${targetSource.repo}/${targetSource.branch}/${targetSource.skillsPath}/${safeName}/SKILL.md`,
          sha: putResult.content?.sha || "",
          size: 0,
          updatedAt: new Date().toISOString(),
          sourceId: targetSourceId,
          sourceLabel: targetSource.label || targetSource.repo,
        };

        return { success: true, message: `已导入 ${safeName} (原作者: ${originalAuthor})`, name: safeName, originalAuthor, skill };
      } catch (e) {
        return { success: false, message: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "/api/do-update": {
      const skillerRoot3 = join(import.meta.dirname, "..");
      try {
        const pullResult = execSync("git pull origin main 2>&1", { cwd: skillerRoot3, encoding: "utf-8", timeout: 30000 });
        let installResult = "";
        try {
          installResult = execSync("npm install 2>&1", { cwd: skillerRoot3, encoding: "utf-8", timeout: 60000 });
        } catch {}
        let buildResult = "";
        try {
          buildResult = execSync("npx tsc 2>&1", { cwd: skillerRoot3, encoding: "utf-8", timeout: 30000 });
        } catch (e: any) {
          buildResult = e.stdout || e.message || "编译失败";
        }
        const newCommit = execSync("git rev-parse --short HEAD", { cwd: skillerRoot3, encoding: "utf-8" }).trim();
        const pkgJson3 = JSON.parse(readFileSync(join(skillerRoot3, "package.json"), "utf-8"));
        return { success: true, pullResult: pullResult.substring(0, 500), buildResult: buildResult.substring(0, 500), newVersion: pkgJson3.version, newCommit, needRestart: true };
      } catch (e: any) {
        return { success: false, message: "更新失败: " + (e.message || "unknown").substring(0, 300) };
      }
    }

    default:
      return null;
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const origin = req.headers.origin || "";
  const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : `http://localhost:${PORT}`;

  if (url.pathname === "/api/sse") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": allowedOrigin,
    });
    res.write(`data: ${JSON.stringify({ type: "connected", clients: sseClients.size + 1 })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/community")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const bodyParams = JSON.parse(body || "{}");
          const merged = new URLSearchParams(url.searchParams);
          for (const [k, v] of Object.entries(bodyParams)) {
            if (typeof v === "string") merged.set(k, v);
            else if (v !== undefined && v !== null) merged.set(k, String(v));
          }
          handleAsyncApi(url.pathname, merged)
            .then((result) => res.end(JSON.stringify(result ?? { error: "Not found" })))
            .catch((err) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(err) })); });
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
        }
      });
    } else {
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
    }
    return;
  }

  if (url.pathname === "/api/skill/create-in-project") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const name = (payload.name || "").trim();
        const projectPath = (payload.projectPath || "").trim();
        const content = (payload.content || "").trim();
        if (!name || !projectPath) {
          res.end(JSON.stringify({ success: false, message: "Missing name or projectPath" }));
          return;
        }
        const projDir = resolve(projectPath);
        if (!existsSync(projDir)) {
          res.end(JSON.stringify({ success: false, message: "项目路径不存在: " + projectPath }));
          return;
        }
        const safeName = name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "-");
        const rulesDir = join(projDir, paths.projectRulesDir);
        mkdirSync(rulesDir, { recursive: true });
        const fileExt = PLATFORM === "claude-code" ? ".md" : ".mdc";
        const targetPath = join(rulesDir, safeName + fileExt);
        const finalContent = PLATFORM === "claude-code"
          ? (content || `# ${name}\n\n在此编写技能内容...\n`)
          : (content || `---\ndescription: ${name}\nglobs: \nalwaysApply: false\n---\n\n# ${name}\n\n在此编写技能内容...\n`);
        writeFileSync(targetPath, finalContent, "utf-8");
        index = buildIndex();
        res.end(JSON.stringify({ success: true, name: safeName, path: targetPath, totalSkills: index.totalSkills }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: String(e).slice(0, 300) }));
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
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

  setTimeout(() => {
    const config = loadConfig();
    if (config.repo || config.sources.length > 0) {
      console.log("  [Cache] Pre-warming community skills cache...");
      listCommunitySkills(config, { light: true }).then(result => {
        const arr = Array.isArray(result) ? result : result.skills;
        console.log(`  [Cache] Warmed: ${arr.length} skills ready`);
      }).catch(() => {});
    }
  }, 2000);
});
