import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, readlinkSync } from "fs";
import { join, resolve } from "path";
import matter from "gray-matter";
import { SkillEntry, SkillIndex } from "./types.js";
import { getSkillCategories, buildCategoryTree } from "./categories.js";

const SKILLS_DIR = join(process.env.HOME || "~", ".cursor", "skills");
const SUPERPOWERS_DIR = join(process.env.HOME || "~", ".cursor", "superpowers", "skills");
const SKILLS_CURSOR_DIR = join(process.env.HOME || "~", ".cursor", "skills-cursor");
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
      });
    } catch (err) {
      console.error(`Failed to parse ${skillMdPath}: ${err}`);
    }
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
      const rulesDir = join(projectPath, ".cursor", "rules");
      if (!existsSync(rulesDir)) continue;

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
            const projectName = projectPath.split("/").slice(-2).join("/");

            skills.push({
              name,
              description: description || `[项目: ${projectName}]`,
              categories: getSkillCategories(name) || [],
              tags: [...extractTags(name), "project-rule"],
              path: filePath,
              source: "project-rules",
              tokenEstimate: estimateTokens(content),
            });
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return skills;
}

export function buildIndex(): SkillIndex {
  const allSkills: SkillEntry[] = [];

  allSkills.push(...scanDirectory(SKILLS_DIR, "custom"));
  allSkills.push(...scanDirectory(SUPERPOWERS_DIR, "superpowers"));
  allSkills.push(...scanDirectory(SKILLS_CURSOR_DIR, "skills-cursor"));
  allSkills.push(...scanProjectRules());

  const seen = new Set<string>();
  const dedupedSkills = allSkills.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
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

export function getOrBuildIndex(): SkillIndex {
  const existing = loadIndex();
  if (existing) return existing;
  return buildIndex();
}
