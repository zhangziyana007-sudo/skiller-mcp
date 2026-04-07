import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.env.HOME || "~", ".cursor", "skiller", "data");
const CACHE_FILE = join(CACHE_DIR, "plaza_cache.json");
const CACHE_TTL = 3600 * 1000;

export interface OnlineSkill {
  name: string;
  description: string;
  repo: string;
  repoLabel: string;
  htmlUrl: string;
  rawUrl: string;
  category: string;
  tags: string[];
  installed: boolean;
}

export interface PlazaRegistry {
  id: string;
  label: string;
  repo: string;
  skillsPath: string;
  description: string;
  stars: number;
}

const REGISTRIES: PlazaRegistry[] = [
  {
    id: "anthropic",
    label: "Anthropic Official",
    repo: "anthropics/skills",
    skillsPath: "skills",
    description: "Anthropic 官方技能库 — 前端设计、文档生成、MCP 构建等",
    stars: 5000,
  },
  {
    id: "superpowers",
    label: "Superpowers Skills",
    repo: "NickHeap2/cursor-superpowers-skills",
    skillsPath: "skills",
    description: "Superpowers 技能集 — 头脑风暴、调试、TDD、代码审查流程",
    stars: 800,
  },
];

interface PlazaCache {
  updatedAt: string;
  registries: { id: string; skills: OnlineSkill[] }[];
}

function loadCache(): PlazaCache | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as PlazaCache;
    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (age > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(cache: PlazaCache) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function guessCategory(name: string, desc: string): string {
  const text = `${name} ${desc}`.toLowerCase();
  if (/\b(doc|pdf|pptx|xlsx|word|excel|document|spreadsheet)\b/.test(text)) return "productivity";
  if (/\b(api|claude-api|sdk|backend|server|database)\b/.test(text)) return "development";
  if (/\b(mcp|agent|llm|rag|prompt|ai)\b/.test(text)) return "ai";
  if (/\b(debug|test|testing|review|plan|brainstorm|workflow|skill-creator)\b/.test(text)) return "workflow";
  if (/\b(security|audit|pentest)\b/.test(text)) return "security";
  if (/\b(docker|k8s|deploy|ci|cd|internal-comms)\b/.test(text)) return "devops";
  if (/\b(android|ios|mobile|flutter)\b/.test(text)) return "mobile";
  if (/\b(git|branch|merge|commit)\b/.test(text)) return "workflow";
  if (/\b(game|animation|video|gif|slack-gif)\b/.test(text)) return "creative";
  if (/\b(frontend|design|css|ui|theme|visual|art|canvas|brand|web-artifact)\b/.test(text)) return "creative";
  return "misc";
}

function guessTags(name: string, desc: string): string[] {
  const tags: string[] = [];
  const text = `${name} ${desc}`.toLowerCase();
  const keywords = [
    "react", "vue", "css", "html", "api", "debug", "test", "git", "docker",
    "ai", "llm", "mcp", "rag", "pdf", "excel", "pptx", "design", "slack",
    "web", "mobile", "security", "deploy", "agent", "prompt", "code-review",
  ];
  for (const kw of keywords) {
    if (text.includes(kw)) tags.push(kw);
  }
  const nameParts = name.split(/[-_]/).filter(p => p.length > 2);
  for (const p of nameParts.slice(0, 3)) {
    if (!tags.includes(p)) tags.push(p);
  }
  return tags.slice(0, 6);
}

async function fetchSkillListFromRepo(registry: PlazaRegistry): Promise<OnlineSkill[]> {
  const url = `https://api.github.com/repos/${registry.repo}/contents/${registry.skillsPath}`;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Skiller/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];

    const items = (await resp.json()) as Array<{ name: string; type: string; html_url: string }>;
    const skills: OnlineSkill[] = [];

    for (const item of items) {
      if (item.type !== "dir") continue;

      const rawUrl = `https://raw.githubusercontent.com/${registry.repo}/main/${registry.skillsPath}/${item.name}/SKILL.md`;
      let description = "";

      try {
        const mdResp = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
        if (mdResp.ok) {
          const content = await mdResp.text();
          const descMatch = content.match(/description:\s*["']?(.+?)["']?\s*$/m);
          if (descMatch) {
            description = descMatch[1].trim();
          } else {
            const firstParagraph = content
              .split('\n')
              .filter(l => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('---'))
              .slice(0, 2)
              .join(' ')
              .slice(0, 200);
            description = firstParagraph || `${item.name} skill`;
          }
        }
      } catch {}

      skills.push({
        name: item.name,
        description: description || `${item.name} skill from ${registry.label}`,
        repo: registry.repo,
        repoLabel: registry.label,
        htmlUrl: item.html_url,
        rawUrl,
        category: guessCategory(item.name, description),
        tags: guessTags(item.name, description),
        installed: false,
      });
    }

    return skills;
  } catch {
    return [];
  }
}

async function fetchFromGitHubSearch(query: string): Promise<OnlineSkill[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query + " SKILL.md cursor")}&sort=stars&order=desc&per_page=20`;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Skiller/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];

    const data = (await resp.json()) as {
      items?: Array<{
        full_name: string;
        description: string | null;
        html_url: string;
        stargazers_count: number;
        topics?: string[];
      }>;
    };

    if (!data.items) return [];

    return data.items.map((item) => ({
      name: item.full_name.split("/").pop() || item.full_name,
      description: item.description || "No description",
      repo: item.full_name,
      repoLabel: `GitHub (${item.stargazers_count} stars)`,
      htmlUrl: item.html_url,
      rawUrl: `https://raw.githubusercontent.com/${item.full_name}/main/SKILL.md`,
      category: guessCategory(item.full_name, item.description || ""),
      tags: (item.topics || []).slice(0, 4),
      installed: false,
    }));
  } catch {
    return [];
  }
}

export async function loadPlaza(localSkillNames: string[]): Promise<OnlineSkill[]> {
  const cached = loadCache();
  if (cached) {
    const allSkills = cached.registries.flatMap((r) => r.skills);
    return markInstalled(allSkills, localSkillNames);
  }

  const registryResults: { id: string; skills: OnlineSkill[] }[] = [];

  for (const reg of REGISTRIES) {
    const skills = await fetchSkillListFromRepo(reg);
    registryResults.push({ id: reg.id, skills });
  }

  const cache: PlazaCache = {
    updatedAt: new Date().toISOString(),
    registries: registryResults,
  };
  saveCache(cache);

  const allSkills = registryResults.flatMap((r) => r.skills);
  return markInstalled(allSkills, localSkillNames);
}

export async function searchPlaza(
  query: string,
  localSkillNames: string[]
): Promise<OnlineSkill[]> {
  const cached = loadCache();
  let allSkills = cached ? cached.registries.flatMap((r) => r.skills) : [];

  const q = query.toLowerCase();
  let filtered = allSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)) ||
      s.category.toLowerCase().includes(q)
  );

  if (filtered.length < 3) {
    const githubResults = await fetchFromGitHubSearch(query);
    const existingNames = new Set(allSkills.map((s) => s.name));
    for (const r of githubResults) {
      if (!existingNames.has(r.name)) {
        filtered.push(r);
      }
    }
  }

  return markInstalled(filtered, localSkillNames);
}

export async function refreshPlaza(localSkillNames: string[]): Promise<OnlineSkill[]> {
  if (existsSync(CACHE_FILE)) {
    try {
      const fs = await import("fs");
      fs.unlinkSync(CACHE_FILE);
    } catch {}
  }
  return loadPlaza(localSkillNames);
}

export async function fetchSkillContent(rawUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) return await resp.text();
  } catch {}
  return null;
}

export function getRegistries(): PlazaRegistry[] {
  return REGISTRIES;
}

function markInstalled(skills: OnlineSkill[], localNames: string[]): OnlineSkill[] {
  const nameSet = new Set(localNames.map((n) => n.toLowerCase()));
  return skills.map((s) => ({
    ...s,
    installed: nameSet.has(s.name.toLowerCase()),
  }));
}
