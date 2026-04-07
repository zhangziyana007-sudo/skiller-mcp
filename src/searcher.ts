import { SkillEntry, SkillIndex, CategoryNode, SearchResult } from "./types.js";
import { buildCategoryTree, getUncategorizedCount, getAllCategoryIds, loadUserCategories } from "./categories.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[-_\s,./]+/)
    .filter((w) => w.length > 1);
}

function computeRelevance(
  skill: SkillEntry,
  queryTokens: string[],
  categoryFilter?: string
): number {
  let score = 0;
  const nameTokens = tokenize(skill.name);
  const descTokens = tokenize(skill.description);

  for (const qt of queryTokens) {
    if (skill.name.toLowerCase() === qt) score += 100;
    if (nameTokens.includes(qt)) score += 50;
    if (skill.tags.includes(qt)) score += 30;
    if (descTokens.includes(qt)) score += 10;
    if (skill.description.toLowerCase().includes(qt)) score += 5;
  }

  if (categoryFilter && skill.categories.includes(categoryFilter)) {
    score += 20;
  }

  return score;
}

export function searchSkills(
  index: SkillIndex,
  query: string,
  category?: string,
  limit: number = 10
): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 && !category) return [];

  let candidates = index.skills;

  if (category) {
    if (category === "uncategorized") {
      candidates = candidates.filter((s) => s.categories.length === 0);
    } else {
      const allIds = getAllCategoryIds(category);
      candidates = candidates.filter((s) =>
        s.categories.some((c) => allIds.includes(c))
      );
    }
  }

  const scored = candidates
    .map((skill) => ({
      skill,
      relevance: queryTokens.length > 0
        ? computeRelevance(skill, queryTokens, category)
        : 1,
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);

  return scored.map(({ skill, relevance }) => ({
    name: skill.name,
    description: skill.description,
    categories: skill.categories,
    tags: skill.tags.slice(0, 5),
    source: skill.source,
    relevance,
  }));
}

export function listCategories(
  index: SkillIndex,
  parentId?: string
): CategoryNode[] {
  const tree = buildCategoryTree(index);

  if (!parentId) return tree;

  function findCategory(
    nodes: CategoryNode[],
    id: string
  ): CategoryNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children.length > 0) {
        const found = findCategory(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  const parent = findCategory(tree, parentId);
  return parent?.children || [];
}

export function getSkillStats(index: SkillIndex): {
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  uncategorizedCount: number;
  duplicateNames: string[];
} {
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const nameCounts: Record<string, number> = {};
  let uncategorizedCount = 0;

  const userCategories = loadUserCategories();
  const labelMap = new Map(userCategories.map((c) => [c.id, c.label]));

  for (const skill of index.skills) {
    bySource[skill.source] = (bySource[skill.source] || 0) + 1;

    if (skill.categories.length === 0) {
      uncategorizedCount++;
    } else {
      for (const catId of skill.categories) {
        const label = labelMap.get(catId) || catId;
        byCategory[label] = (byCategory[label] || 0) + 1;
      }
    }

    nameCounts[skill.name] = (nameCounts[skill.name] || 0) + 1;
  }

  const duplicateNames = Object.entries(nameCounts)
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  return {
    total: index.totalSkills,
    bySource,
    byCategory,
    uncategorizedCount,
    duplicateNames,
  };
}
