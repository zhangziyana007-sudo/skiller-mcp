export interface SkillEntry {
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  path: string;
  source: "custom" | "superpowers" | "skills-cursor" | "project-rules" | "local-repo";
  tokenEstimate: number;
  projectName?: string;
  installMode?: "global-skill" | "cursorrules" | "rule-always" | "rule-auto" | "rule-agent" | "rule-manual";
}

export interface UserCategory {
  id: string;
  label: string;
  parentId: string | null;
  icon: string;
}

export interface CategoryNode {
  id: string;
  label: string;
  icon: string;
  children: CategoryNode[];
  skillCount: number;
}

export interface SkillIndex {
  version: number;
  generatedAt: string;
  totalSkills: number;
  skills: SkillEntry[];
  categories: CategoryNode[];
}

export interface SearchResult {
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  source: string;
  relevance: number;
}
