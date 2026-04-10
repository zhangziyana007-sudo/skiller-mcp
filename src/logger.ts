import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { paths } from "./config.js";

const LOG_PATH = paths.logPath;
const MAX_LOG_ENTRIES = 200;

export interface UsageLogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
}

export function logUsage(tool: string, args: Record<string, unknown>, resultSummary: string): void {
  const entries = loadLog();
  entries.push({
    timestamp: new Date().toISOString(),
    tool,
    args,
    resultSummary,
  });

  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }

  try {
    const dir = dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } catch {
    // silently fail
  }
}

export function loadLog(): UsageLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  } catch {
    return [];
  }
}
