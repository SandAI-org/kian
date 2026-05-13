import { describe, expect, it } from "vitest";
import { buildContextSnapshotSection } from "../../electron/main/services/contextSnapshotFormatter";

describe("buildContextSnapshotSection", () => {
  it("renders the core module summary with fixed labels", () => {
    const result = buildContextSnapshotSection({
      projectId: "p-2026-03-11-1",
      projectName: "Kian 应用",
      module: "docs",
      projectCwd: "/Users/lei/KianWorkspaceTest/p-2026-03-11-1",
      contextSnapshot: {
        docs: {
          activeDocId: "代码块渲染测试.md",
          activeDocTitle: "代码块渲染测试.md",
          docCount: 1,
        },
        creation: {
          sceneCount: 0,
          shotCount: 0,
          updatedAt: "",
        },
        assets: {
          assetCount: 0,
          keyword: "",
          tags: [],
        },
        app: {
          appDir: "/Users/lei/KianWorkspaceTest/p-2026-03-11-1/app",
          appType: "react",
          appName: "Kian 应用",
          initialized: true,
          dependenciesInstalled: false,
          hasBuild: false,
          builtAt: null,
        },
      },
    });

    expect(result).toContain("# 核心功能模块摘要");
    expect(result).toContain("- Agent 名称：Kian 应用");
    expect(result).toContain("- Agent ID：p-2026-03-11-1");
    expect(result).toContain("- 当前模块：docs");
    expect(result).not.toContain("- Agent 工作区目录：");
    expect(result).toContain("## 文档模块（docs）");
    expect(result).toContain(
      "- 模块描述：管理用户的文字知识，包括笔记、日记、资料等，也可以通过文档模块获取当前 Agent 更多的信息。",
    );
    expect(result).toContain(
      "- 文档存放目录：/Users/lei/KianWorkspaceTest/p-2026-03-11-1/docs",
    );
    expect(result).toContain("- 当前文档ID：代码块渲染测试.md");
    expect(result).toContain("- 当前文档标题：代码块渲染测试.md");
    expect(result).not.toContain("## 创作模块（creation）");
    expect(result).not.toContain("- 更新时间：");
    expect(result).not.toContain("(空字符串)");
    expect(result).toContain("## 素材模块（assets）");
    expect(result).toContain(
      "- 素材存放目录：/Users/lei/KianWorkspaceTest/p-2026-03-11-1/assets",
    );
    expect(result).toContain("- 标签：[]");
    expect(result).toContain("## 应用模块（app）");
    expect(result).toContain(
      "- 模块描述：参考 app-creator 技能使用 React 前端技术栈开发前端应用、小游戏、小工具等。",
    );
    expect(result).toContain(
      "- 应用目录：/Users/lei/KianWorkspaceTest/p-2026-03-11-1/app",
    );
    expect(result).toContain("- 构建时间：null");
  });

  it("supports rendering only the docs module summary", () => {
    const result = buildContextSnapshotSection({
      projectId: "main-agent",
      projectName: "主 Agent",
      module: "main",
      projectCwd: "/Users/lei/KianWorkspaceTest/.kian/main-agent",
      contextSnapshot: {
        docs: {
          activeDocId: "USER.md",
          activeDocTitle: "USER.md",
          docCount: 3,
        },
        creation: {
          sceneCount: 9,
        },
      },
      moduleKeys: ["docs"],
      includeAgentSummary: false,
      includeSummaryHeading: false,
    });

    expect(result).toContain("## 文档模块（docs）");
    expect(result).toContain("- 当前文档ID：USER.md");
    expect(result).not.toContain("# 核心功能模块摘要");
    expect(result).not.toContain("- Agent 名称：主 Agent");
    expect(result).not.toContain("- Agent ID：main-agent");
    expect(result).not.toContain("- 当前模块：main");
    expect(result).not.toContain("## 创作模块（creation）");
    expect(result).not.toContain("## 素材模块（assets）");
    expect(result).not.toContain("## 应用模块（app）");
    expect(result).not.toContain("## 其他上下文字段");
    expect(result).not.toContain("- creation：{}");
    expect(result).not.toContain("- assets：{}");
    expect(result).not.toContain("- app：{}");
  });
});
