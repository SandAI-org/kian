import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "vite";
import { expect, it } from "vitest";

it("starts both OAuth browser flows from a bundled main-process service", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kian-oauth-bundle-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      ssr: { noExternal: true },
      plugins: [{
        name: "isolated-electron-boundaries",
        enforce: "pre",
        resolveId(id) {
          if (id === "electron" || id === "./workspacePaths" || id === "./logger") {
            return `\0test:${id}`;
          }
        },
        load(id) {
          if (id === "\0test:electron") return "export const shell = { openExternal: async (url) => { globalThis.openedUrls.push(url); } };";
          if (id === "\0test:./workspacePaths") return `export const GLOBAL_CONFIG_DIR = ${JSON.stringify(temp)};`;
          if (id === "\0test:./logger") return "export const logger = { info() {}, warn() {} };";
        },
      }],
      build: {
        ssr: true,
        target: "node22",
        minify: false,
        outDir: path.join(temp, "bundle"),
        rollupOptions: { output: { format: "cjs", entryFileNames: "auth.cjs" } },
        lib: {
          entry: path.resolve("electron/main/services/authStorageService.ts"),
          formats: ["cjs"],
          fileName: () => "auth.cjs",
        },
      },
    });
    const bundlePath = path.join(temp, "bundle", "auth.cjs");
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", `
      const assert = require("node:assert/strict");
      globalThis.openedUrls = [];
      globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
      const service = require(${JSON.stringify(bundlePath)});
      (async () => {
        for (const [provider, hostname] of [["openai-codex", "auth.openai.com"], ["anthropic", "claude.ai"]]) {
          const login = await service.startOAuthLogin(provider);
          assert.equal(new URL(login.authUrl).hostname, hostname);
          assert.equal(globalThis.openedUrls.at(-1), login.authUrl);
          const completion = service.waitOAuthLogin(login.loginId);
          service.cancelOAuthLogin(login.loginId);
          await assert.rejects(completion);
        }
        console.log("OAuth browser entry points passed");
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], {
      cwd: temp,
      env: { ...process.env, HOME: temp, PI_OFFLINE: "1" },
      timeout: 20_000,
    });
    expect(stdout).toContain("OAuth browser entry points passed");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30_000);
