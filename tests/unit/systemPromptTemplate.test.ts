import { describe, expect, it } from "vitest";
import { renderDefaultSystemPromptTemplate } from "../../electron/main/services/systemPromptTemplate";

describe("renderDefaultSystemPromptTemplate", () => {
  const template = "# 你的运行环境\n\n{{RUNTIME_ENVIRONMENT}}\n";

  it("renders macOS runtime guidance", () => {
    expect(
      renderDefaultSystemPromptTemplate(template, { platform: "darwin" }),
    ).toContain("macOS：所以你可以通过 AppleScript 来操作 macOS 的系统。");
  });

  it("appends dynamic runtime environment details", () => {
    const rendered = renderDefaultSystemPromptTemplate(template, {
      platform: "darwin",
      runtimeEnvironment:
        "- 全局配置目录（<GlobalConfigDir>）：/tmp/.kian-dev\n- 全局工作区根目录（<GlobalWorkspaceRoot>）：/tmp/global\n- 当前 Agent 工作区根目录（<AgentWorkspaceRoot>）：/tmp/global/.kian/main-agent\n- 当前构建版本：dev build",
    });
    expect(rendered).toContain(
      "- 全局配置目录（<GlobalConfigDir>）：/tmp/.kian-dev",
    );
    expect(rendered).toContain(
      "- 全局工作区根目录（<GlobalWorkspaceRoot>）：/tmp/global",
    );
    expect(rendered).toContain(
      "- 当前 Agent 工作区根目录（<AgentWorkspaceRoot>）：/tmp/global/.kian/main-agent",
    );
    expect(rendered).toContain("- 当前构建版本：dev build");
  });

  it("renders Windows runtime guidance", () => {
    const rendered = renderDefaultSystemPromptTemplate(template, {
      platform: "win32",
    });
    expect(rendered).toContain("Windows：优先使用 PowerShell、cmd 和 Windows 原生命令");
    expect(rendered).toContain("只有在系统已安装并可用时，才假设 Bash/Git Bash 可以使用");
  });

  it("renders Linux runtime guidance", () => {
    expect(
      renderDefaultSystemPromptTemplate(template, { platform: "linux" }),
    ).toContain("Linux：你可以使用常见的 Linux shell 与命令行工具来操作系统。");
  });

  it("renders all session placeholders", () => {
    const rendered = renderDefaultSystemPromptTemplate(
      [
        "{{CONTEXT_SNAPSHOT}}",
        "{{PROJECT}}",
        "{{SOFTWARE_INFO}}",
        "{{IDENTITY}}",
        "{{SOUL}}",
        "{{USER}}",
      ].join("\n"),
      {
        contextSnapshot: "snapshot",
        project: "project",
        softwareInfo: "software",
        identity: "identity",
        soul: "soul",
        user: "user",
      },
    );

    expect(rendered).toBe("snapshot\nproject\nsoftware\nidentity\nsoul\nuser");
  });
});
