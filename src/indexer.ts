import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, readlinkSync } from "fs";
import { join, resolve } from "path";
import matter from "gray-matter";
import { SkillEntry, SkillIndex } from "./types.js";
import { getSkillCategories, buildCategoryTree } from "./categories.js";

const SKILLS_DIR = join(process.env.HOME || "~", ".cursor", "skills");
const SUPERPOWERS_DIR = join(process.env.HOME || "~", ".cursor", "superpowers", "skills");
const SKILLS_CURSOR_DIR = join(process.env.HOME || "~", ".cursor", "skills-cursor");
export const LOCAL_REPO_DIR = join(process.env.HOME || "~", ".cursor", "skiller", "data", "repository");
const INDEX_PATH = join(process.env.HOME || "~", ".cursor", "skiller", "data", "skills_index.json");

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function extractTags(name: string): string[] {
  const tags: Set<string> = new Set();
  const words = name.split(/[-_\s]+/).filter((w) => w.length > 2);
  words.forEach((w) => tags.add(w.toLowerCase()));
  return Array.from(tags);
}

function resolveSymlink(dirPath: string): string {
  try {
    const stats = statSync(dirPath, { throwIfNoEntry: false });
    if (!stats) return dirPath;
    if (stats.isSymbolicLink()) {
      return resolve(join(dirPath, ".."), readlinkSync(dirPath));
    }
    return dirPath;
  } catch {
    return dirPath;
  }
}

function scanDirectory(
  baseDir: string,
  source: SkillEntry["source"]
): SkillEntry[] {
  const skills: SkillEntry[] = [];

  if (!existsSync(baseDir)) return skills;

  const entries = readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(baseDir, entry.name);

    let skillDir: string;
    if (entry.isSymbolicLink()) {
      const target = resolveSymlink(entryPath);
      if (!existsSync(target)) continue;
      skillDir = target;
    } else if (entry.isDirectory()) {
      skillDir = entryPath;
    } else {
      continue;
    }

    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, "utf-8");
      const { data: frontmatter } = matter(content);

      const name = (frontmatter.name as string) || entry.name;
      const description = (frontmatter.description as string) || "";

      const categories = getSkillCategories(name) || getSkillCategories(entry.name) || [];
      const tags = extractTags(name);

      if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
        for (const t of frontmatter.tags) {
          if (typeof t === "string" && !tags.includes(t.toLowerCase())) {
            tags.push(t.toLowerCase());
          }
        }
      }

      skills.push({
        name,
        description,
        categories,
        tags,
        path: skillMdPath,
        source,
        tokenEstimate: estimateTokens(content),
        installMode: "global-skill",
      });
    } catch (err) {
      console.error(`Failed to parse ${skillMdPath}: ${err}`);
    }
  }

  return skills;
}

export function scanSingleProject(projectPath: string): SkillEntry[] {
  const skills: SkillEntry[] = [];
  if (!existsSync(projectPath)) return skills;

  const cursorrrulesPath = join(projectPath, ".cursorrules");
  if (existsSync(cursorrrulesPath)) {
    try {
      const crContent = readFileSync(cursorrrulesPath, "utf-8");
      const projectLabel = projectPath.split("/").slice(-2).join("/");
      skills.push({
        name: ".cursorrules",
        description: `[项目规则: ${projectLabel}]`,
        categories: [],
        tags: ["cursorrules", "project-rule"],
        path: cursorrrulesPath,
        source: "project-rules",
        tokenEstimate: estimateTokens(crContent),
        projectName: projectPath,
        installMode: "cursorrules",
      });
    } catch {}
  }

  const rulesDir = join(projectPath, ".cursor", "rules");
  if (existsSync(rulesDir)) {
    try {
      for (const file of readdirSync(rulesDir, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (!file.name.endsWith(".mdc") && !file.name.endsWith(".md")) continue;

        const filePath = join(rulesDir, file.name);
        try {
          const content = readFileSync(filePath, "utf-8");
          const { data: frontmatter } = matter(content);
          const name = (frontmatter.name as string) || file.name.replace(/\.(mdc|md)$/, "");
          const description = (frontmatter.description as string) || "";
          const projectLabel = projectPath.split("/").slice(-2).join("/");

          const alwaysApply = frontmatter.alwaysApply === true || frontmatter.alwaysApply === "true";
          const globsRaw = frontmatter.globs;
          const globsVal = typeof globsRaw === "string" ? globsRaw.trim()
            : Array.isArray(globsRaw) ? globsRaw.join(", ").trim() : "";
          let ruleMode: "rule-always" | "rule-auto" | "rule-agent" | "rule-manual";
          if (alwaysApply) {
            ruleMode = "rule-always";
          } else if (globsVal) {
            ruleMode = "rule-auto";
          } else if (description) {
            ruleMode = "rule-agent";
          } else {
            ruleMode = "rule-manual";
          }
          skills.push({
            name,
            description: description || `[项目: ${projectLabel}]`,
            categories: getSkillCategories(name) || [],
            tags: [...extractTags(name), "project-rule"],
            path: filePath,
            source: "project-rules",
            tokenEstimate: estimateTokens(content),
            projectName: projectPath,
            installMode: ruleMode,
          });
        } catch {}
      }
    } catch {}
  }

  const skillsDir = join(projectPath, ".cursor", "skills");
  if (existsSync(skillsDir)) {
    try {
      for (const sd of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!sd.isDirectory()) continue;
        const skillMdPath = join(skillsDir, sd.name, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;
        try {
          const content = readFileSync(skillMdPath, "utf-8");
          const { data: frontmatter } = matter(content);
          const name = (frontmatter.name as string) || sd.name;
          const description = (frontmatter.description as string) || "";
          const projectLabel = projectPath.split("/").slice(-2).join("/");

          skills.push({
            name,
            description: description || `[项目技能: ${projectLabel}]`,
            categories: getSkillCategories(name) || [],
            tags: [...extractTags(name), "project-skill"],
            path: skillMdPath,
            source: "project-rules",
            tokenEstimate: estimateTokens(content),
            projectName: projectPath,
            installMode: "rule-agent",
          });
        } catch {}
      }
    } catch {}
  }

  return skills;
}

function scanProjectRules(): SkillEntry[] {
  const skills: SkillEntry[] = [];
  const cursorProjectsDir = join(process.env.HOME || "~", ".cursor", "projects");
  if (!existsSync(cursorProjectsDir)) return skills;
  try {
    for (const d of readdirSync(cursorProjectsDir)) {
      const projectPath = "/" + d.replace(/-/g, "/");
      skills.push(...scanSingleProject(projectPath));
    }
  } catch {}
  return skills;
}

export function buildIndex(includeProjectRules = false): SkillIndex {
  const allSkills: SkillEntry[] = [];

  allSkills.push(...scanDirectory(SKILLS_DIR, "custom"));
  allSkills.push(...scanDirectory(SUPERPOWERS_DIR, "superpowers"));
  allSkills.push(...scanDirectory(SKILLS_CURSOR_DIR, "skills-cursor"));
  allSkills.push(...scanDirectory(LOCAL_REPO_DIR, "local-repo"));
  if (includeProjectRules) {
    allSkills.push(...scanProjectRules());
  }

  const seen = new Set<string>();
  const dedupedSkills = allSkills.filter((s) => {
    const key = s.source === "project-rules"
      ? `${s.name}::project::${s.projectName || ""}`
      : `${s.name}::global`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tempIndex: SkillIndex = {
    version: 2,
    generatedAt: new Date().toISOString(),
    totalSkills: dedupedSkills.length,
    skills: dedupedSkills,
    categories: [],
  };

  tempIndex.categories = buildCategoryTree(tempIndex);

  const index: SkillIndex = { ...tempIndex };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
  saveMtimeCache();
  return index;
}

export function loadIndex(): SkillIndex | null {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
  } catch {
    return null;
  }
}

const MTIME_CACHE_PATH = INDEX_PATH.replace("skills_index.json", "index_mtime_cache.json");
const WATCHED_DIRS = [SKILLS_DIR, SUPERPOWERS_DIR, SKILLS_CURSOR_DIR, LOCAL_REPO_DIR];

function getDirFingerprint(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    const st = statSync(dir);
    let sum = st.mtimeMs;
    for (const e of readdirSync(dir)) {
      try { sum += statSync(join(dir, e)).mtimeMs; } catch {}
    }
    return Math.round(sum);
  } catch { return 0; }
}

function isIndexStale(): boolean {
  if (!existsSync(INDEX_PATH) || !existsSync(MTIME_CACHE_PATH)) return true;
  try {
    const cached: Record<string, number> = JSON.parse(readFileSync(MTIME_CACHE_PATH, "utf-8"));
    for (const dir of WATCHED_DIRS) {
      if (getDirFingerprint(dir) !== (cached[dir] || 0)) return true;
    }
    return false;
  } catch { return true; }
}

function saveMtimeCache(): void {
  const cache: Record<string, number> = {};
  for (const dir of WATCHED_DIRS) {
    cache[dir] = getDirFingerprint(dir);
  }
  try { writeFileSync(MTIME_CACHE_PATH, JSON.stringify(cache), "utf-8"); } catch {}
}

export function getOrBuildIndex(): SkillIndex {
  if (!isIndexStale()) {
    const existing = loadIndex();
    if (existing) return existing;
  }
  return buildIndex();
}
