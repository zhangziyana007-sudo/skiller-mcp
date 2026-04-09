import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(process.env.HOME || "~", ".cursor", "skiller", "data");
const CONFIG_FILE = join(CONFIG_DIR, "community_config.json");
const COMMUNITY_CACHE_FILE = join(CONFIG_DIR, "community_cache.json");
const COMMUNITY_CACHE_TTL = 14400 * 1000; // 4 hours

export interface CommunitySource {
  id: string;
  repo: string;
  branch: string;
  skillsPath: string;
  label: string;
  writable: boolean;
  token?: string;
}

export interface CommunityConfig {
  repo: string;
  branch: string;
  skillsPath: string;
  githubToken: string;
  authorName: string;
  sources: CommunitySource[];
}

export interface CommunitySkill {
  name: string;
  description: string;
  author: string;
  htmlUrl: string;
  rawUrl: string;
  sha: string;
  size: number;
  updatedAt: string;
  sourceId?: string;
  sourceLabel?: string;
}

export interface SkillSubmission {
  title: string;
  skillName: string;
  author: string;
  description: string;
  content: string;
  status: "open" | "approved" | "rejected";
  issueUrl?: string;
  issueNumber?: number;
}

interface CommunityCache {
  updatedAt: string;
  skills: CommunitySkill[];
  sourceId?: string;
}

interface MultiCache {
  [sourceId: string]: CommunityCache;
}

const DEFAULT_CONFIG: CommunityConfig = {
  repo: "",
  branch: "main",
  skillsPath: "skills",
  githubToken: "",
  authorName: "",
  sources: [],
};

export function loadConfig(): CommunityConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG, sources: [] };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    const config = { ...DEFAULT_CONFIG, ...raw };
    if (!Array.isArray(config.sources)) config.sources = [];

    if (config.repo && !config.sources.find((s: CommunitySource) => s.repo === config.repo)) {
      config.sources.unshift({
        id: "primary",
        repo: config.repo,
        branch: config.branch || "main",
        skillsPath: config.skillsPath || "skills",
        label: "我的社区",
        writable: true,
      });
    }
    return config;
  } catch {
    return { ...DEFAULT_CONFIG, sources: [] };
  }
}

export function saveConfig(config: Partial<CommunityConfig>): CommunityConfig {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...config };
  if (config.sources) merged.sources = config.sources;
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function addSource(source: Omit<CommunitySource, "id">): CommunityConfig {
  const config = loadConfig();
  const id = source.repo.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  if (config.sources.find((s) => s.id === id)) {
    const idx = config.sources.findIndex((s) => s.id === id);
    config.sources[idx] = { ...source, id };
  } else {
    config.sources.push({ ...source, id });
  }
  return saveConfig({ sources: config.sources });
}

export function removeSource(sourceId: string): CommunityConfig {
  const config = loadConfig();
  config.sources = config.sources.filter((s) => s.id !== sourceId);
  return saveConfig({ sources: config.sources });
}

function githubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Skiller-Community/1.0",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

export function extractMetadata(content: string): { description: string; author: string } {
  let description = "";
  let author = "";
  const descMatch = content.match(/description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch) description = descMatch[1].trim();
  const authorMatch = content.match(/author:\s*["']?(.+?)["']?\s*$/m);
  if (authorMatch) author = authorMatch[1].trim();
  if (!description) {
    const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
    if (firstLine) description = firstLine.trim().slice(0, 120);
  }
  return { description, author };
}

async function fetchSkillsFromRepo(
  repo: string,
  branch: string,
  skillsPath: string,
  token: string,
  sourceId: string,
  sourceLabel: string
): Promise<CommunitySkill[]> {
  const skillDirs = await listSkillDirs(repo, branch, skillsPath, token);
  if (skillDirs.length === 0) return [];

  const isRootPath = skillsPath === "." || skillsPath === "" || skillsPath === "/";
  const pathPfx = isRootPath ? "" : skillsPath + "/";
  const CONCURRENCY = 10;
  const tasks = skillDirs.map((dir) => async (): Promise<CommunitySkill> => {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${pathPfx}${dir.name}/SKILL.md`;
    const descUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${pathPfx}${dir.name}/DESCRIPTION.md`;
    const rawHeaders: Record<string, string> = {};
    if (token) rawHeaders["Authorization"] = `token ${token}`;
    let description = "";
    let author = "";

    try {
      const descResp = await fetch(descUrl, { headers: rawHeaders, signal: AbortSignal.timeout(4000) });
      if (descResp.ok) {
        description = (await descResp.text()).trim();
      }
    } catch {}

    if (!description) {
      try {
        const resp = await fetch(rawUrl, { headers: rawHeaders, signal: AbortSignal.timeout(6000) });
        if (resp.ok) {
          const text = await resp.text();
          const meta = extractMetadata(text);
          description = meta.description;
          author = meta.author;
        }
      } catch {}
    }

    return {
      name: dir.name,
      description: description || `${dir.name} skill`,
      author: author || "unknown",
      htmlUrl: `https://github.com/${repo}/tree/${branch}/${pathPfx}${dir.name}`,
      rawUrl,
      sha: dir.sha,
      size: 0,
      updatedAt: "",
      sourceId,
      sourceLabel,
    };
  });

  return parallelLimit(tasks, CONCURRENCY);
}

async function listSkillDirs(
  repo: string,
  branch: string,
  skillsPath: string,
  token: string
): Promise<Array<{ name: string; sha: string }>> {
  try {
    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
    const resp = await fetch(treeUrl, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as {
        tree: Array<{ path: string; type: string; sha: string }>;
        truncated?: boolean;
      };

      const isRoot = skillsPath === "." || skillsPath === "" || skillsPath === "/";
      const prefix = isRoot ? "" : skillsPath.replace(/\/$/, "") + "/";
      const skillMdPaths = data.tree.filter(
        (t) => t.type === "blob" && (isRoot || t.path.startsWith(prefix)) && t.path.endsWith("/SKILL.md")
      );

      return skillMdPaths.map((t) => {
        const relative = isRoot ? t.path : t.path.slice(prefix.length);
        const dirName = relative.split("/")[0];
        return { name: dirName, sha: t.sha };
      });
    }
  } catch {}

  try {
    const contentsPath = (skillsPath === "." || skillsPath === "" || skillsPath === "/") ? "" : skillsPath;
    const contentsUrl = `https://api.github.com/repos/${repo}/contents/${contentsPath}?ref=${branch}`;
    const resp = await fetch(contentsUrl, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const items = (await resp.json()) as Array<{ name: string; type: string; sha: string }>;
      return items.filter((i) => i.type === "dir").map((i) => ({ name: i.name, sha: i.sha }));
    }
  } catch {}

  return [];
}

async function fetchSkillsFromRepoLight(
  repo: string,
  branch: string,
  skillsPath: string,
  token: string,
  sourceId: string,
  sourceLabel: string
): Promise<CommunitySkill[]> {
  const dirs = await listSkillDirs(repo, branch, skillsPath, token);
  const isRoot = skillsPath === "." || skillsPath === "" || skillsPath === "/";
  const pathPrefix = isRoot ? "" : skillsPath + "/";
  return dirs.map((dir) => ({
    name: dir.name,
    description: "",
    author: "unknown",
    htmlUrl: `https://github.com/${repo}/tree/${branch}/${pathPrefix}${dir.name}`,
    rawUrl: `https://raw.githubusercontent.com/${repo}/${branch}/${pathPrefix}${dir.name}/SKILL.md`,
    sha: dir.sha,
    size: 0,
    updatedAt: "",
    sourceId,
    sourceLabel,
  }));
}

async function enrichSkillMetadata(
  skills: CommunitySkill[],
  startIdx: number,
  count: number
): Promise<CommunitySkill[]> {
  const batch = skills.slice(startIdx, startIdx + count);
  const needEnrich = batch.filter((s) => !s.description);
  if (needEnrich.length === 0) return batch;

  const tasks = needEnrich.map((skill) => async (): Promise<void> => {
    const descUrl = skill.rawUrl.replace(/SKILL\.md$/, "DESCRIPTION.md");
    try {
      const descResp = await fetch(descUrl, { signal: AbortSignal.timeout(4000) });
      if (descResp.ok) {
        skill.description = (await descResp.text()).trim();
        return;
      }
    } catch {}
    try {
      const resp = await fetch(skill.rawUrl, { signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const text = await resp.text();
        const meta = extractMetadata(text);
        skill.description = meta.description || `${skill.name} skill`;
        skill.author = meta.author || "unknown";
      }
    } catch {}
  });
  await parallelLimit(tasks, 10);

  updateCacheDescriptions(skills);
  return batch;
}

function updateCacheDescriptions(skills: CommunitySkill[]) {
  for (const key of ["all-light", "all"]) {
    const cached = loadCommunityCache(key);
    if (!cached) continue;
    let changed = false;
    for (const s of skills) {
      if (!s.description) continue;
      const entry = cached.skills.find((c) => c.name === s.name && c.sourceId === s.sourceId);
      if (entry && !entry.description) {
        entry.description = s.description;
        entry.author = s.author;
        changed = true;
      }
    }
    if (changed) saveCommunityCache(key, cached);
  }
}

export { fetchSkillsFromRepoLight, enrichSkillMetadata };

function paginate(skills: CommunitySkill[], page?: number, pageSize?: number): CommunitySkill[] {
  if (page === undefined) return skills;
  const size = pageSize ?? 30;
  return skills.slice(page * size, (page + 1) * size);
}

interface SourceEntry {
  repo: string; branch: string; skillsPath: string; id: string; label: string; token: string;
}

function collectSources(config: CommunityConfig): SourceEntry[] {
  const list: SourceEntry[] = [];
  if (config.repo) {
    list.push({ repo: config.repo, branch: config.branch, skillsPath: config.skillsPath, id: "primary", label: "我的社区", token: config.githubToken });
  }
  for (const source of config.sources) {
    if (source.repo === config.repo) continue;
    list.push({
      repo: source.repo, branch: source.branch, skillsPath: source.skillsPath,
      id: source.id, label: source.label,
      token: source.token || config.githubToken,
    });
  }
  return list;
}

export async function listCommunitySkills(
  config: CommunityConfig,
  options?: { light?: boolean; page?: number; pageSize?: number; forceRefresh?: boolean }
): Promise<CommunitySkill[]> {
  if (!config.repo && config.sources.length === 0) return [];

  const light = options?.light ?? false;
  const page = options?.page;
  const pageSize = options?.pageSize ?? 30;
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh) {
    const fullCache = loadCommunityCache("all");
    if (fullCache) return paginate(fullCache.skills, page, pageSize);

    const lightCache = loadCommunityCache("all-light");
    if (light && lightCache) return paginate(lightCache.skills, page, pageSize);

    const staleFullCache = loadCommunityCache("all", true);
    if (staleFullCache && staleFullCache.skills.length > 0) return paginate(staleFullCache.skills, page, pageSize);

    const staleLightCache = loadCommunityCache("all-light", true);
    if (light && staleLightCache && staleLightCache.skills.length > 0) return paginate(staleLightCache.skills, page, pageSize);
  }

  const sources = collectSources(config);
  const fetchFn = light ? fetchSkillsFromRepoLight : fetchSkillsFromRepo;
  const PER_SOURCE_TIMEOUT = 20000;

  const sourceResults = await Promise.allSettled(
    sources.map((s) => {
      const fetchPromise = fetchFn(s.repo, s.branch, s.skillsPath, s.token, s.id, s.label);
      const timeoutPromise = new Promise<CommunitySkill[]>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout fetching ${s.repo}`)), PER_SOURCE_TIMEOUT)
      );
      return Promise.race([fetchPromise, timeoutPromise]);
    })
  );

  const allSkills = sourceResults
    .filter((r): r is PromiseFulfilledResult<CommunitySkill[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
  const cacheKey = light ? "all-light" : "all";
  saveCommunityCache(cacheKey, { updatedAt: new Date().toISOString(), skills: allSkills });

  return paginate(allSkills, page, pageSize);
}

export async function listSourceSkills(
  config: CommunityConfig,
  sourceId: string
): Promise<CommunitySkill[]> {
  const source = config.sources.find((s) => s.id === sourceId);
  if (!source) {
    if (sourceId === "primary" && config.repo) {
      const primaryCache = loadCommunityCache("primary", true);
      if (primaryCache && primaryCache.skills.length > 0) return primaryCache.skills;
      return fetchSkillsFromRepo(
        config.repo,
        config.branch,
        config.skillsPath,
        config.githubToken,
        "primary",
        "我的社区"
      );
    }
    return [];
  }

  const cached = loadCommunityCache(sourceId);
  if (cached) return cached.skills;

  const staleCached = loadCommunityCache(sourceId, true);
  if (staleCached && staleCached.skills.length > 0) return staleCached.skills;

  const skills = await fetchSkillsFromRepo(
    source.repo,
    source.branch,
    source.skillsPath,
    source.token || config.githubToken,
    source.id,
    source.label
  );

  saveCommunityCache(sourceId, { updatedAt: new Date().toISOString(), skills });
  return skills;
}

export async function uploadSkill(
  config: CommunityConfig,
  skillName: string,
  content: string
): Promise<{ success: boolean; message: string; htmlUrl?: string }> {
  if (!config.repo || !config.githubToken) {
    return { success: false, message: "请先配置社区仓库和 GitHub Token" };
  }

  const path = `${config.skillsPath}/${skillName}/SKILL.md`;
  const url = `https://api.github.com/repos/${config.repo}/contents/${path}`;

  let existingSha: string | undefined;
  try {
    const checkResp = await fetch(`${url}?ref=${config.branch}`, {
      headers: githubHeaders(config.githubToken),
      signal: AbortSignal.timeout(10000),
    });
    if (checkResp.ok) {
      const data = (await checkResp.json()) as { sha: string };
      existingSha = data.sha;
    }
  } catch {}

  const body: Record<string, string> = {
    message: `${existingSha ? "update" : "add"}: ${skillName} skill${config.authorName ? ` by ${config.authorName}` : ""}`,
    content: Buffer.from(content).toString("base64"),
    branch: config.branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  try {
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        ...githubHeaders(config.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok || resp.status === 201) {
      const data = (await resp.json()) as { content?: { html_url?: string } };
      clearAllCache();
      return {
        success: true,
        message: `${skillName} 已${existingSha ? "更新" : "上传"}到社区`,
        htmlUrl: data.content?.html_url,
      };
    }

    const err = await resp.text();
    return { success: false, message: `GitHub API 错误 (${resp.status}): ${err.slice(0, 200)}` };
  } catch (e) {
    return { success: false, message: `网络错误: ${String(e).slice(0, 200)}` };
  }
}

export async function uploadDescriptionFile(
  config: CommunityConfig,
  skillName: string,
  description: string
): Promise<void> {
  if (!config.repo || !config.githubToken) return;

  const path = `${config.skillsPath}/${skillName}/DESCRIPTION.md`;
  const url = `https://api.github.com/repos/${config.repo}/contents/${path}`;

  let existingSha: string | undefined;
  try {
    const checkResp = await fetch(`${url}?ref=${config.branch}`, {
      headers: githubHeaders(config.githubToken),
      signal: AbortSignal.timeout(8000),
    });
    if (checkResp.ok) {
      const data = (await checkResp.json()) as { sha: string };
      existingSha = data.sha;
    }
  } catch {}

  const body: Record<string, string> = {
    message: `desc: ${skillName} description`,
    content: Buffer.from(description).toString("base64"),
    branch: config.branch,
  };
  if (existingSha) body.sha = existingSha;

  try {
    await fetch(url, {
      method: "PUT",
      headers: { ...githubHeaders(config.githubToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {}
}

export async function deleteSkill(
  config: CommunityConfig,
  skillName: string,
  sourceId?: string
): Promise<{ success: boolean; message: string }> {
  let repo = config.repo;
  let branch = config.branch;
  let skillsPath = config.skillsPath;

  if (sourceId && sourceId !== "primary") {
    const source = config.sources.find((s) => s.id === sourceId);
    if (!source || !source.writable) {
      return { success: false, message: "该源不可写或不存在" };
    }
    repo = source.repo;
    branch = source.branch;
    skillsPath = source.skillsPath;
  }

  if (!repo || !config.githubToken) {
    return { success: false, message: "请先配置社区仓库和 GitHub Token" };
  }

  const path = `${skillsPath}/${skillName}/SKILL.md`;
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;

  try {
    const checkResp = await fetch(`${url}?ref=${branch}`, {
      headers: githubHeaders(config.githubToken),
      signal: AbortSignal.timeout(10000),
    });
    if (!checkResp.ok) {
      return { success: false, message: `技能 "${skillName}" 在仓库中不存在` };
    }
    const fileData = (await checkResp.json()) as { sha: string };

    const resp = await fetch(url, {
      method: "DELETE",
      headers: {
        ...githubHeaders(config.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `remove: ${skillName} skill${config.authorName ? ` by ${config.authorName}` : ""}`,
        sha: fileData.sha,
        branch,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      clearAllCache();
      return { success: true, message: `"${skillName}" 已从社区下架` };
    }

    const err = await resp.text();
    return { success: false, message: `GitHub API 错误 (${resp.status}): ${err.slice(0, 200)}` };
  } catch (e) {
    return { success: false, message: `网络错误: ${String(e).slice(0, 200)}` };
  }
}

export async function listOwnSkills(config: CommunityConfig): Promise<string[]> {
  if (!config.repo) return [];
  const dirs = await listSkillDirs(config.repo, config.branch, config.skillsPath, config.githubToken);
  return dirs.map((d) => d.name);
}

export async function submitSkillViaIssue(
  config: CommunityConfig,
  targetRepo: string,
  submission: { skillName: string; author: string; description: string; content: string }
): Promise<{ success: boolean; message: string; issueUrl?: string }> {
  if (!config.githubToken) {
    return { success: false, message: "需要 GitHub Token 才能提交技能" };
  }

  const issueBody = `## 🎯 技能投稿: ${submission.skillName}

**作者**: ${submission.author || config.authorName || "anonymous"}
**描述**: ${submission.description}

### SKILL.md 内容

\`\`\`markdown
${submission.content}
\`\`\`

---
_通过 Skiller Dashboard 自动提交_
`;

  try {
    const resp = await fetch(`https://api.github.com/repos/${targetRepo}/issues`, {
      method: "POST",
      headers: {
        ...githubHeaders(config.githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `[Skill Submit] ${submission.skillName} by ${submission.author || config.authorName || "anonymous"}`,
        body: issueBody,
        labels: ["skill-submission"],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok || resp.status === 201) {
      const data = (await resp.json()) as { html_url: string; number: number };
      return {
        success: true,
        message: `技能 "${submission.skillName}" 已提交到 ${targetRepo}，等待审核`,
        issueUrl: data.html_url,
      };
    }

    const err = await resp.text();
    return { success: false, message: `提交失败 (${resp.status}): ${err.slice(0, 200)}` };
  } catch (e) {
    return { success: false, message: `网络错误: ${String(e).slice(0, 200)}` };
  }
}

export async function listSubmissions(
  config: CommunityConfig,
  targetRepo?: string
): Promise<SkillSubmission[]> {
  const repo = targetRepo || config.repo;
  if (!repo) return [];

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/issues?labels=skill-submission&state=all&per_page=30`,
      {
        headers: githubHeaders(config.githubToken),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!resp.ok) return [];

    const issues = (await resp.json()) as Array<{
      title: string;
      body: string;
      html_url: string;
      number: number;
      state: string;
      labels: Array<{ name: string }>;
    }>;

    return issues.map((issue) => {
      const nameMatch = issue.title.match(/\[Skill Submit\]\s*(.+?)\s*by\s*/);
      const authorMatch = issue.title.match(/by\s+(.+)$/);
      const descMatch = issue.body?.match(/\*\*描述\*\*:\s*(.+)/);
      const contentMatch = issue.body?.match(/```markdown\n([\s\S]*?)```/);
      const isApproved = issue.labels.some((l) => l.name === "approved");
      const isRejected = issue.labels.some((l) => l.name === "rejected");

      return {
        title: issue.title,
        skillName: nameMatch?.[1]?.trim() || "unknown",
        author: authorMatch?.[1]?.trim() || "unknown",
        description: descMatch?.[1]?.trim() || "",
        content: contentMatch?.[1]?.trim() || "",
        status: isApproved ? "approved" : isRejected ? "rejected" : "open",
        issueUrl: issue.html_url,
        issueNumber: issue.number,
      } as SkillSubmission;
    });
  } catch {
    return [];
  }
}

export async function downloadCommunitySkill(rawUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) return await resp.text();
  } catch {}
  return null;
}

function loadCommunityCache(sourceId: string, ignoreExpiry = false): CommunityCache | null {
  if (!existsSync(COMMUNITY_CACHE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(COMMUNITY_CACHE_FILE, "utf-8"));
    const multi = raw as MultiCache;
    const data = multi[sourceId];
    if (!data || !data.updatedAt || !Array.isArray(data.skills)) return null;
    if (!ignoreExpiry && Date.now() - new Date(data.updatedAt).getTime() > COMMUNITY_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function isCacheStale(sourceId: string): boolean {
  if (!existsSync(COMMUNITY_CACHE_FILE)) return true;
  try {
    const raw = JSON.parse(readFileSync(COMMUNITY_CACHE_FILE, "utf-8"));
    const multi = raw as MultiCache;
    const data = multi[sourceId];
    if (!data || !data.updatedAt) return true;
    return Date.now() - new Date(data.updatedAt).getTime() > COMMUNITY_CACHE_TTL;
  } catch {
    return true;
  }
}

export function loadCachedSkills(sourceId: string): { skills: CommunitySkill[]; updatedAt: string; stale: boolean } | null {
  const cached = loadCommunityCache(sourceId, true);
  if (!cached) return null;
  const stale = Date.now() - new Date(cached.updatedAt).getTime() > COMMUNITY_CACHE_TTL;
  return { skills: cached.skills, updatedAt: cached.updatedAt, stale };
}

function saveCommunityCache(sourceId: string, cache: CommunityCache) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  let multi: MultiCache = {};
  try {
    if (existsSync(COMMUNITY_CACHE_FILE)) {
      multi = JSON.parse(readFileSync(COMMUNITY_CACHE_FILE, "utf-8"));
    }
  } catch {}
  multi[sourceId] = cache;
  writeFileSync(COMMUNITY_CACHE_FILE, JSON.stringify(multi, null, 2), "utf-8");
}

function clearAllCache() {
  try {
    if (existsSync(COMMUNITY_CACHE_FILE)) unlinkSync(COMMUNITY_CACHE_FILE);
  } catch {}
}

export { clearAllCache };
