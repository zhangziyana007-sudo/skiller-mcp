import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { UserCategory, CategoryNode, SkillIndex } from "./types.js";
import { paths } from "./config.js";

const DATA_DIR = paths.dataDir;
const CATEGORIES_FILE = join(DATA_DIR, "user_categories.json");
const OVERRIDES_FILE = join(DATA_DIR, "overrides.json");
const SKILL_PROJECTS_FILE = join(DATA_DIR, "skill_projects.json");

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

// ===== Skill-Project Associations =====

interface SkillProjectsStore {
  [projectPath: string]: string[];
}

function loadSkillProjects(): SkillProjectsStore {
  if (!existsSync(SKILL_PROJECTS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SKILL_PROJECTS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSkillProjects(store: SkillProjectsStore): void {
  ensureDir();
  writeFileSync(SKILL_PROJECTS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function linkSkillToProject(skillName: string, projectPath: string): void {
  const store = loadSkillProjects();
  if (!store[projectPath]) store[projectPath] = [];
  if (!store[projectPath].includes(skillName)) {
    store[projectPath].push(skillName);
  }
  saveSkillProjects(store);
}

export function unlinkSkillFromProject(skillName: string, projectPath: string): void {
  const store = loadSkillProjects();
  if (!store[projectPath]) return;
  store[projectPath] = store[projectPath].filter((n) => n !== skillName);
  if (store[projectPath].length === 0) delete store[projectPath];
  saveSkillProjects(store);
}

export function getProjectSkills(projectPath: string): string[] {
  const store = loadSkillProjects();
  return store[projectPath] || [];
}

export function getSkillLinkedProjects(skillName: string): string[] {
  const store = loadSkillProjects();
  const projects: string[] = [];
  for (const [proj, skills] of Object.entries(store)) {
    if (skills.includes(skillName)) projects.push(proj);
  }
  return projects;
}

export function getAllSkillProjectLinks(): SkillProjectsStore {
  return loadSkillProjects();
}

// ===== Project Groups =====

const PROJECT_GROUPS_FILE = join(DATA_DIR, "project_groups.json");

interface ProjectGroup {
  id: string;
  name: string;
  icon: string;
  order: number;
}

interface ProjectGroupsStore {
  groups: ProjectGroup[];
  assignments: Record<string, string>; // projectPath -> groupId
  projectOrder: string[];
}

function loadProjectGroups(): ProjectGroupsStore {
  if (!existsSync(PROJECT_GROUPS_FILE)) return { groups: [], assignments: {}, projectOrder: [] };
  try {
    const data = JSON.parse(readFileSync(PROJECT_GROUPS_FILE, "utf-8"));
    return {
      groups: data.groups || [],
      assignments: data.assignments || {},
      projectOrder: data.projectOrder || [],
    };
  } catch {
    return { groups: [], assignments: {}, projectOrder: [] };
  }
}

function saveProjectGroups(store: ProjectGroupsStore): void {
  ensureDir();
  writeFileSync(PROJECT_GROUPS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function getProjectGroups(): ProjectGroupsStore {
  return loadProjectGroups();
}

export function addProjectGroup(name: string, icon: string): ProjectGroup {
  const store = loadProjectGroups();
  const id = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || `group-${Date.now()}`;
  const existing = store.groups.find((g) => g.id === id);
  if (existing) {
    existing.name = name;
    existing.icon = icon;
    saveProjectGroups(store);
    return existing;
  }
  const maxOrder = store.groups.reduce((m, g) => Math.max(m, g.order), -1);
  const group: ProjectGroup = { id, name, icon, order: maxOrder + 1 };
  store.groups.push(group);
  saveProjectGroups(store);
  return group;
}

export function removeProjectGroup(groupId: string): boolean {
  const store = loadProjectGroups();
  const before = store.groups.length;
  store.groups = store.groups.filter((g) => g.id !== groupId);
  if (store.groups.length === before) return false;
  for (const [proj, gid] of Object.entries(store.assignments)) {
    if (gid === groupId) delete store.assignments[proj];
  }
  saveProjectGroups(store);
  return true;
}

export function renameProjectGroup(groupId: string, newName: string, newIcon?: string): boolean {
  const store = loadProjectGroups();
  const group = store.groups.find((g) => g.id === groupId);
  if (!group) return false;
  group.name = newName;
  if (newIcon !== undefined) group.icon = newIcon;
  saveProjectGroups(store);
  return true;
}

export function assignProjectToGroup(projectPath: string, groupId: string | null): void {
  const store = loadProjectGroups();
  if (groupId) {
    store.assignments[projectPath] = groupId;
  } else {
    delete store.assignments[projectPath];
  }
  saveProjectGroups(store);
}

export function reorderProjects(projectOrder: string[]): void {
  const store = loadProjectGroups();
  store.projectOrder = projectOrder;
  saveProjectGroups(store);
}

export function addManagedProject(projectPath: string): boolean {
  const store = loadProjectGroups();
  if (store.projectOrder.includes(projectPath)) return false;
  store.projectOrder.push(projectPath);
  saveProjectGroups(store);
  return true;
}

export function removeManagedProject(projectPath: string): boolean {
  const store = loadProjectGroups();
  const idx = store.projectOrder.indexOf(projectPath);
  if (idx < 0) return false;
  store.projectOrder.splice(idx, 1);
  delete store.assignments[projectPath];
  saveProjectGroups(store);
  return true;
}

export function getManagedProjects(): string[] {
  const store = loadProjectGroups();
  return store.projectOrder;
}

export function reorderGroups(groupOrder: string[]): void {
  const store = loadProjectGroups();
  for (let i = 0; i < groupOrder.length; i++) {
    const g = store.groups.find((gr) => gr.id === groupOrder[i]);
    if (g) g.order = i;
  }
  store.groups.sort((a, b) => a.order - b.order);
  saveProjectGroups(store);
}

// ===== Install Registry =====
const INSTALL_REGISTRY_FILE = join(DATA_DIR, "install_registry.json");

export interface InstallRecord {
  skillName: string;
  sourceUrl: string;
  installedAt: string;
  installMode: string;
  targetPath: string;
  contentHash: string;
  projectPath?: string;
}

function loadInstallRegistry(): InstallRecord[] {
  ensureDir();
  if (!existsSync(INSTALL_REGISTRY_FILE)) return [];
  try { return JSON.parse(readFileSync(INSTALL_REGISTRY_FILE, "utf-8")); } catch { return []; }
}

function saveInstallRegistry(records: InstallRecord[]): void {
  ensureDir();
  writeFileSync(INSTALL_REGISTRY_FILE, JSON.stringify(records, null, 2), "utf-8");
}

export function simpleHash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function registerInstall(record: InstallRecord): void {
  const records = loadInstallRegistry();
  const idx = records.findIndex(
    (r) => r.skillName === record.skillName && r.targetPath === record.targetPath
  );
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  saveInstallRegistry(records);
}

export function getInstallRegistry(): InstallRecord[] {
  return loadInstallRegistry();
}

export function getInstallRecord(skillName: string, targetPath?: string): InstallRecord | undefined {
  const records = loadInstallRegistry();
  if (targetPath) return records.find((r) => r.skillName === skillName && r.targetPath === targetPath);
  return records.find((r) => r.skillName === skillName);
}
