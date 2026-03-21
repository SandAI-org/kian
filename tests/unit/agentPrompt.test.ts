import { describe, expect, it } from "vitest";
import {
  buildSessionSystemPrompt,
  type SessionContextFile,
} from "../../electron/main/services/agentPrompt";

describe("buildSessionSystemPrompt", () => {
  it("renders session content into the default system prompt template", () => {
    const contextFiles: SessionContextFile[] = [
      {
        fileName: "SOUL.md",
        title: "Agent 行为准则（灵魂）",
        content: "全局规则 B",
      },
      {
        fileName: "IDENTITY.md",
        title: "Agent 身份定义",
        content: "全局规则 C",
      },
    ];

    const result = buildSessionSystemPrompt(
      [
        "# 基础系统提示",
        "",
        "## 运行环境",
        "{{RUNTIME_ENVIRONMENT}}",
        "",
        "## 概要信息",
        "{{CONTEXT_SNAPSHOT}}",
        "",
        "## 软件信息",
        "{{SOFTWARE_INFO}}",
        "",
        "## 身份",
        "{{IDENTITY}}",
        "",
        "## 准则",
        "{{SOUL}}",
        "",
        "## 用户",
        "{{USER}}",
      ].join("\n"),
      {
        contextFiles,
        runtimeEnvironmentSection:
          "- 全局配置目录（<GlobalConfigDir>）：/tmp/.kian-dev\n- 全局工作区根目录（<GlobalWorkspaceRoot>）：/tmp/global\n- 当前 Agent 工作区根目录（<AgentWorkspaceRoot>）：/tmp/global/.kian/main-agent\n- 当前构建版本：dev build",
        contextSnapshotSection: "当前模块：docs",
        softwareInfoSection: "作者：磊",
      },
    );

    expect(result).toContain("## 运行环境");
    expect(result).toContain("- 全局配置目录（<GlobalConfigDir>）：/tmp/.kian-dev");
    expect(result).toContain("- 全局工作区根目录（<GlobalWorkspaceRoot>）：/tmp/global");
    expect(result).toContain("- 当前构建版本：dev build");
    expect(result).toContain("## 概要信息\n当前模块：docs");
    expect(result).toContain("## 软件信息\n作者：磊");
    expect(result).toContain("## 身份\n全局规则 C");
    expect(result).toContain("## 准则\n全局规则 B");
    expect(result).toContain("## 用户\n未提供");
  });

  it("fills missing placeholders with defaults", () => {
    expect(
      buildSessionSystemPrompt("{{PROJECT}}\n{{IDENTITY}}"),
    ).toBe("未提供\n未提供");
  });
});
