import { join } from "path";

export type Platform = "cursor" | "claude-code";

export const PLATFORM: Platform =
  (process.env.SKILLER_PLATFORM as Platform) || "claude-code";

const HOME = process.env.HOME || "~";

interface PlatformPaths {
  /** Root directory for the IDE (e.g. ~/.cursor or ~/.claude) */
  ideRoot: string;
  /** Global skills directory */
  skillsDir: string;
  /** Additional global skill directories to scan */
  extraSkillDirs: { path: string; source: "superpowers" | "skills-cursor" }[];
  /** Skiller data directory (index, cache, config, etc.) */
  dataDir: string;
  /** Local repository for community-downloaded skills */
  localRepoDir: string;
  /** Skills index JSON path */
  indexPath: string;
  /** Usage log path */
  logPath: string;
  /** MCP config file path */
  mcpConfigPath: string;
  /** IDE config dir for project scanning (e.g. ~/.config/Cursor) */
  ideConfigDir: string;
  /** Projects tracking directory */
  projectsDir: string;
  /** Project-level rules directory name (relative to project root) */
  projectRulesDir: string;
  /** Project-level root rule file name */
  projectRootRuleFile: string;
  /** Project-level skills directory name (relative to project root) */
  projectSkillsDir: string;
  /** IDE brand name for UI display */
  brandName: string;
}

const CURSOR_PATHS: PlatformPaths = {
  ideRoot: join(HOME, ".cursor"),
  skillsDir: join(HOME, ".cursor", "skills"),
  extraSkillDirs: [
    { path: join(HOME, ".cursor", "superpowers", "skills"), source: "superpowers" },
    { path: join(HOME, ".cursor", "skills-cursor"), source: "skills-cursor" },
  ],
  dataDir: join(HOME, ".cursor", "skiller", "data"),
  localRepoDir: join(HOME, ".cursor", "skiller", "data", "repository"),
  indexPath: join(HOME, ".cursor", "skiller", "data", "skills_index.json"),
  logPath: join(HOME, ".cursor", "skiller", "data", "usage_log.json"),
  mcpConfigPath: join(HOME, ".cursor", "mcp.json"),
  ideConfigDir: join(HOME, ".config", "Cursor"),
  projectsDir: join(HOME, ".cursor", "projects"),
  projectRulesDir: join(".cursor", "rules"),
  projectRootRuleFile: ".cursorrules",
  projectSkillsDir: join(".cursor", "skills"),
  brandName: "Cursor",
};

const CLAUDE_CODE_PATHS: PlatformPaths = {
  ideRoot: join(HOME, ".claude"),
  skillsDir: join(HOME, ".claude", "skills"),
  extraSkillDirs: [],
  dataDir: join(HOME, ".claude", "skiller", "data"),
  localRepoDir: join(HOME, ".claude", "skiller", "data", "repository"),
  indexPath: join(HOME, ".claude", "skiller", "data", "skills_index.json"),
  logPath: join(HOME, ".claude", "skiller", "data", "usage_log.json"),
  mcpConfigPath: join(HOME, ".claude.json"),
  ideConfigDir: "",
  projectsDir: join(HOME, ".claude", "projects"),
  projectRulesDir: join(".claude", "rules"),
  projectRootRuleFile: "CLAUDE.md",
  projectSkillsDir: join(".claude", "skills"),
  brandName: "Claude Code",
};

export const paths: PlatformPaths =
  PLATFORM === "claude-code" ? CLAUDE_CODE_PATHS : CURSOR_PATHS;
