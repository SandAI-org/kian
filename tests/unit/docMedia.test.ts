import { describe, expect, it } from "vitest";
import {
  detectDocMediaKind,
  isDocPassthroughUrl,
  resolveDocLocalUrl,
} from "../../src/renderer/modules/docs/docMedia";

describe("docMedia", () => {
  it("detects media kinds from file extensions", () => {
    expect(detectDocMediaKind("poster.png")).toBe("image");
    expect(detectDocMediaKind("clip.mp4?download=1")).toBe("video");
    expect(detectDocMediaKind("voice.m4a#t=2")).toBe("audio");
    expect(detectDocMediaKind("note.md")).toBeNull();
  });

  it("passes document context to local preview urls", () => {
    expect(
      resolveDocLocalUrl("aix_coding.jpg", {
        projectId: "p-demo",
        documentPath: "公司趣事/2026-03-17-AiX制造核弹.md",
      }),
    ).toBe(
      "kian-local://local/aix_coding.jpg?projectId=p-demo&documentPath=%E5%85%AC%E5%8F%B8%E8%B6%A3%E4%BA%8B%2F2026-03-17-AiX%E5%88%B6%E9%80%A0%E6%A0%B8%E5%BC%B9.md",
    );
  });

  it("keeps workspace-root paths stable when document context exists", () => {
    expect(
      resolveDocLocalUrl("assets/generated/demo.mp4", {
        projectId: "p-demo",
        documentPath: "nested/notes/demo.md",
      }),
    ).toBe(
      "kian-local://local/assets%2Fgenerated%2Fdemo.mp4?projectId=p-demo&documentPath=nested%2Fnotes%2Fdemo.md",
    );
  });

  it("treats external and custom urls as passthrough", () => {
    expect(isDocPassthroughUrl("https://example.com/demo.png")).toBe(true);
    expect(resolveDocLocalUrl("https://example.com/demo.png")).toBe(
      "https://example.com/demo.png",
    );
    expect(resolveDocLocalUrl("kian-local://local/already-ready")).toBe(
      "kian-local://local/already-ready",
    );
  });

  it("rejects unsafe urls", () => {
    expect(resolveDocLocalUrl("javascript:alert(1)")).toBe("");
  });
});
