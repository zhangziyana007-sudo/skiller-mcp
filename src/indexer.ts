import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, readlinkSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import matter from "gray-matter";
import { SkillEntry, SkillIndex } from "./types.js";
import { getSkillCategories, buildCategoryTree } from "./categories.js";
import { paths, PLATFORM } from "./config.js";

const SKILLS_DIR = paths.skillsDir;
export const LOCAL_REPO_DIR = paths.localRepoDir;
const INDEX_PATH = paths.indexPath;

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

  const rootRulePath = join(projectPath, paths.projectRootRuleFile);
  if (existsSync(rootRulePath)) {
    try {
      const crContent = readFileSync(rootRulePath, "utf-8");
      const projectLabel = projectPath.split("/").slice(-2).join("/");
      skills.push({
        name: paths.projectRootRuleFile,
        description: `[项目规则: ${projectLabel}]`,
        categories: [],
        tags: ["project-root-rule", "project-rule"],
        path: rootRulePath,
        source: "project-rules",
        tokenEstimate: estimateTokens(crContent),
        projectName: projectPath,
        installMode: "project-root-rule",
      });
    } catch {}
  }

  const rulesDir = join(projectPath, paths.projectRulesDir);
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

          skills.push({
            name,
            description: description || `[项目: ${projectLabel}]`,
            categories: getSkillCategories(name) || [],
            tags: [...extractTags(name), "project-rule"],
            path: filePath,
            source: "project-rules",
            tokenEstimate: estimateTokens(content),
            projectName: projectPath,
            installMode: "project-rule",
          });
        } catch {}
      }
    } catch {}
  }

  const skillsDir = join(projectPath, paths.projectSkillsDir);
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
            installMode: "project-rule",
          });
        } catch {}
      }
    } catch {}
  }

  if (PLATFORM === "claude-code") {
    const commandsDir = join(projectPath, ".claude", "commands");
    if (existsSync(commandsDir)) {
      try {
        for (const file of readdirSync(commandsDir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith(".md")) continue;
          const filePath = join(commandsDir, file.name);
          try {
            const content = readFileSync(filePath, "utf-8");
            const { data: frontmatter } = matter(content);
            const name = (frontmatter.name as string) || file.name.replace(/\.md$/, "");
            const description = (frontmatter.description as string) || "";
            const projectLabel = projectPath.split("/").slice(-2).join("/");

            skills.push({
              name: `/${name}`,
              description: description || `[命令: ${projectLabel}]`,
              categories: getSkillCategories(name) || [],
              tags: [...extractTags(name), "command", "project-rule"],
              path: filePath,
              source: "project-rules",
              tokenEstimate: estimateTokens(content),
              projectName: projectPath,
              installMode: "project-rule",
            });
          } catch {}
        }
      } catch {}
    }

    const localMdPath = join(projectPath, "CLAUDE.local.md");
    if (existsSync(localMdPath)) {
      try {
        const localContent = readFileSync(localMdPath, "utf-8");
        const projectLabel = projectPath.split("/").slice(-2).join("/");
        skills.push({
          name: "CLAUDE.local.md",
          description: `[个人本地规则: ${projectLabel}]`,
          categories: [],
          tags: ["claude-local", "project-rule"],
          path: localMdPath,
          source: "project-rules",
          tokenEstimate: estimateTokens(localContent),
          projectName: projectPath,
          installMode: "project-root-rule",
        });
      } catch {}
    }
  }

  return skills;
}

function scanProjectRules(): SkillEntry[] {
  const skills: SkillEntry[] = [];

  if (PLATFORM === "claude-code") {
    const claudeProjectsDir = join(paths.ideRoot, "projects");
    if (existsSync(claudeProjectsDir)) {
      try {
        for (const d of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const projectPath = "/" + d.name.replace(/-/g, "/");
          if (existsSync(projectPath) && statSync(projectPath).isDirectory()) {
            skills.push(...scanSingleProject(projectPath));
          }
        }
      } catch {}
    }
  } else {
    const cursorProjectsDir = paths.projectsDir;
    if (!existsSync(cursorProjectsDir)) return skills;
    try {
      for (const d of readdirSync(cursorProjectsDir)) {
        const projectPath = "/" + d.replace(/-/g, "/");
        skills.push(...scanSingleProject(projectPath));
      }
    } catch {}
  }

  return skills;
}

export function buildIndex(includeProjectRules = false): SkillIndex {
  const allSkills: SkillEntry[] = [];

  allSkills.push(...scanDirectory(SKILLS_DIR, "custom"));
  for (const extra of paths.extraSkillDirs) {
    allSkills.push(...scanDirectory(extra.path, extra.source));
  }
  allSkills.push(...scanDirectory(LOCAL_REPO_DIR, "local-repo"));

  if (PLATFORM === "claude-code") {
    const globalCommandsDir = join(paths.ideRoot, "commands");
    if (existsSync(globalCommandsDir)) {
      try {
        for (const file of readdirSync(globalCommandsDir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith(".md")) continue;
          const filePath = join(globalCommandsDir, file.name);
          try {
            const content = readFileSync(filePath, "utf-8");
            const { data: frontmatter } = matter(content);
            const name = (frontmatter.name as string) || file.name.replace(/\.md$/, "");
            const description = (frontmatter.description as string) || "";
            allSkills.push({
              name: `/${name}`,
              description: description || `[全局命令]`,
              categories: getSkillCategories(name) || [],
              tags: [...extractTags(name), "command"],
              path: filePath,
              source: "custom",
              tokenEstimate: estimateTokens(content),
              installMode: "global-skill",
            });
          } catch {}
        }
      } catch {}
    }
  }

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
  const indexDir = dirname(INDEX_PATH);
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
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
const WATCHED_DIRS = [SKILLS_DIR, ...paths.extraSkillDirs.map((e) => e.path), LOCAL_REPO_DIR];

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
