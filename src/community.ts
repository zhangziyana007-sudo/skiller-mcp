import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(process.env.HOME || "~", ".cursor", "skiller", "data");
const CONFIG_FILE = join(CONFIG_DIR, "community_config.json");
const COMMUNITY_CACHE_FILE = join(CONFIG_DIR, "community_cache.json");
const COMMUNITY_CACHE_TTL = 1800 * 1000;

export interface CommunitySource {
  id: string;
  repo: string;
  branch: string;
  skillsPath: string;
  label: string;
  writable: boolean;
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

async function fetchSkillsFromRepo(
  repo: string,
  branch: string,
  skillsPath: string,
  token: string,
  sourceId: string,
  sourceLabel: string
): Promise<CommunitySkill[]> {
  const url = `https://api.github.com/repos/${repo}/contents/${skillsPath}?ref=${branch}`;

  try {
    const resp = await fetch(url, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return [];

    const items = (await resp.json()) as Array<{
      name: string;
      type: string;
      html_url: string;
      sha: string;
      size: number;
    }>;

    const skills: CommunitySkill[] = [];

    for (const item of items) {
      if (item.type !== "dir") continue;

      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${skillsPath}/${item.name}/SKILL.md`;

      let description = "";
      let author = "";

      try {
        const mdResp = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
        if (mdResp.ok) {
          const content = await mdResp.text();
          const descMatch = content.match(/description:\s*["']?(.+?)["']?\s*$/m);
          if (descMatch) description = descMatch[1].trim();
          const authorMatch = content.match(/author:\s*["']?(.+?)["']?\s*$/m);
          if (authorMatch) author = authorMatch[1].trim();
          if (!description) {
            const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
            if (firstLine) description = firstLine.trim().slice(0, 120);
          }
        }
      } catch {}

      skills.push({
        name: item.name,
        description: description || `${item.name} community skill`,
        author: author || "unknown",
        htmlUrl: item.html_url,
        rawUrl,
        sha: item.sha,
        size: item.size,
        updatedAt: "",
        sourceId,
        sourceLabel,
      });
    }

    return skills;
  } catch {
    return [];
  }
}

export async function listCommunitySkills(config: CommunityConfig): Promise<CommunitySkill[]> {
  if (!config.repo && config.sources.length === 0) return [];

  const cached = loadCommunityCache("all");
  if (cached) return cached.skills;

  const allSkills: CommunitySkill[] = [];

  if (config.repo) {
    const skills = await fetchSkillsFromRepo(
      config.repo,
      config.branch,
      config.skillsPath,
      config.githubToken,
      "primary",
      "我的社区"
    );
    allSkills.push(...skills);
  }

  for (const source of config.sources) {
    if (source.repo === config.repo) continue;
    const skills = await fetchSkillsFromRepo(
      source.repo,
      source.branch,
      source.skillsPath,
      config.githubToken,
      source.id,
      source.label
    );
    allSkills.push(...skills);
  }

  saveCommunityCache("all", { updatedAt: new Date().toISOString(), skills: allSkills });
  return allSkills;
}

export async function listSourceSkills(
  config: CommunityConfig,
  sourceId: string
): Promise<CommunitySkill[]> {
  const source = config.sources.find((s) => s.id === sourceId);
  if (!source) {
    if (sourceId === "primary" && config.repo) {
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

  const skills = await fetchSkillsFromRepo(
    source.repo,
    source.branch,
    source.skillsPath,
    config.githubToken,
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

function loadCommunityCache(sourceId: string): CommunityCache | null {
  if (!existsSync(COMMUNITY_CACHE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(COMMUNITY_CACHE_FILE, "utf-8"));
    const multi = raw as MultiCache;
    const data = multi[sourceId];
    if (!data || !data.updatedAt || !Array.isArray(data.skills)) return null;
    if (Date.now() - new Date(data.updatedAt).getTime() > COMMUNITY_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
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
