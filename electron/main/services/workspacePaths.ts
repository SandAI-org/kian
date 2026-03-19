import { app } from "electron";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR_NAME = app?.isPackaged ? ".kian" : ".kian-dev";
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "KianWorkspace");
export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), CONFIG_DIR_NAME);
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");

const readWorkspaceRootFromConfig = (): string => {
  try {
    const raw = readFileSync(GLOBAL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { workspaceRoot?: string };
    if (
      typeof parsed.workspaceRoot === "string" &&
      parsed.workspaceRoot.trim()
    ) {
      const resolved = parsed.workspaceRoot.replace(/^~/, os.homedir());
      return path.resolve(resolved);
    }
  } catch {
    // config file doesn't exist yet or is invalid — use default
  }
  return DEFAULT_WORKSPACE_ROOT;
};

export const WORKSPACE_ROOT = readWorkspaceRootFromConfig();
export const INTERNAL_ROOT = path.join(WORKSPACE_ROOT, ".kian");
