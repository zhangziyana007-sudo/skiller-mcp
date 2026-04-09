import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { UserCategory, CategoryNode, SkillIndex } from "./types.js";

const DATA_DIR = join(process.env.HOME || "~", ".cursor", "skiller", "data");
const CATEGORIES_FILE = join(DATA_DIR, "user_categories.json");
const OVERRIDES_FILE = join(DATA_DIR, "overrides.json");

interface CategoriesStore {
  categories: UserCategory[];
}

interface OverridesStore {
  [skillName: string]: { categories?: string[]; tags?: string[]; category?: string; displayName?: string; description?: string };
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadUserCategories(): UserCategory[] {
  if (!existsSync(CATEGORIES_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(CATEGORIES_FILE, "utf-8")) as CategoriesStore;
    return data.categories || [];
  } catch {
    return [];
  }
}

export function saveUserCategories(categories: UserCategory[]): void {
  ensureDir();
  writeFileSync(CATEGORIES_FILE, JSON.stringify({ categories }, null, 2), "utf-8");
}

export function addCategory(label: string, parentId: string | null, icon: string): UserCategory {
  const categories = loadUserCategories();
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || `cat-${Date.now()}`;

  const existing = categories.find((c) => c.id === id);
  if (existing) {
    existing.label = label;
    existing.icon = icon;
    if (parentId !== undefined) existing.parentId = parentId;
    saveUserCategories(categories);
    return existing;
  }

  const cat: UserCategory = { id, label, parentId, icon };
  categories.push(cat);
  saveUserCategories(categories);
  return cat;
}

export function removeCategory(categoryId: string): boolean {
  const categories = loadUserCategories();
  const childIds = getAllDescendantIds(categories, categoryId);
  const idsToRemove = new Set([categoryId, ...childIds]);

  const filtered = categories.filter((c) => !idsToRemove.has(c.id));
  if (filtered.length === categories.length) return false;

  saveUserCategories(filtered);

  const overrides = loadOverrides();
  let changed = false;
  for (const key of Object.keys(overrides)) {
    const entry = overrides[key];
    if (entry.categories) {
      const before = entry.categories.length;
      entry.categories = entry.categories.filter((c) => !idsToRemove.has(c));
      if (entry.categories.length !== before) changed = true;
    }
  }
  if (changed) saveOverrides(overrides);

  return true;
}

export function renameCategory(categoryId: string, newLabel: string, newIcon?: string): boolean {
  const categories = loadUserCategories();
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return false;
  cat.label = newLabel;
  if (newIcon !== undefined) cat.icon = newIcon;
  saveUserCategories(categories);
  return true;
}

export function tagSkill(skillName: string, categoryIds: string[]): void {
  const overrides = loadOverrides();
  if (!overrides[skillName]) overrides[skillName] = {};
  overrides[skillName].categories = categoryIds;
  saveOverrides(overrides);
}

export function untagSkill(skillName: string, categoryId: string): void {
  const overrides = loadOverrides();
  if (!overrides[skillName]?.categories) return;
  overrides[skillName].categories = overrides[skillName].categories!.filter((c) => c !== categoryId);
  saveOverrides(overrides);
}

export function getSkillCategories(skillName: string): string[] {
  const overrides = loadOverrides();
  const entry = overrides[skillName];
  if (!entry) return [];
  if (entry.categories) return entry.categories;
  if (entry.category) return [entry.category];
  return [];
}

export function getSkillOverride(skillName: string): { displayName?: string; description?: string } {
  const overrides = loadOverrides();
  const entry = overrides[skillName];
  if (!entry) return {};
  return { displayName: entry.displayName, description: entry.description };
}

export function setSkillOverride(skillName: string, displayName?: string, description?: string): void {
  const overrides = loadOverrides();
  if (!overrides[skillName]) overrides[skillName] = {};
  if (displayName !== undefined) overrides[skillName].displayName = displayName || undefined;
  if (description !== undefined) overrides[skillName].description = description || undefined;
  saveOverrides(overrides);
}

export function loadOverrides(): OverridesStore {
  if (!existsSync(OVERRIDES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OVERRIDES_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveOverrides(overrides: OverridesStore): void {
  ensureDir();
  writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), "utf-8");
}

function getAllDescendantIds(categories: UserCategory[], parentId: string): string[] {
  const result: string[] = [];
  const children = categories.filter((c) => c.parentId === parentId);
  for (const child of children) {
    result.push(child.id);
    result.push(...getAllDescendantIds(categories, child.id));
  }
  return result;
}

export function buildCategoryTree(index?: SkillIndex): CategoryNode[] {
  const categories = loadUserCategories();
  const roots = categories.filter((c) => !c.parentId);

  function buildNode(cat: UserCategory): CategoryNode {
    const children = categories
      .filter((c) => c.parentId === cat.id)
      .map(buildNode);

    const allIds = [cat.id, ...getAllDescendantIds(categories, cat.id)];
    const skillCount = index
      ? index.skills.filter((s) => s.categories.some((c) => allIds.includes(c))).length
      : 0;

    return {
      id: cat.id,
      label: cat.label,
      icon: cat.icon || "",
      children,
      skillCount,
    };
  }

  return roots.map(buildNode);
}

export function getUncategorizedCount(index: SkillIndex): number {
  return index.skills.filter((s) => s.categories.length === 0).length;
}

export function getCategoryLabel(categoryId: string): string {
  const categories = loadUserCategories();
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.label || categoryId;
}

export function getAllCategoryIds(categoryId: string): string[] {
  const categories = loadUserCategories();
  return [categoryId, ...getAllDescendantIds(categories, categoryId)];
}
