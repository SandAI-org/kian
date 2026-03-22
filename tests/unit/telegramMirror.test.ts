import { describe, expect, it } from "vitest";
import {
  extractTelegramFileAttachments,
  stripTelegramFileMarkdown,
} from "../../electron/main/services/chatChannel/telegramMirror";

describe("telegramMirror media extraction", () => {
  it("extracts local image and file attachments while ignoring remote urls", () => {
    const attachments = extractTelegramFileAttachments(
      [
        "图片：@[image](/tmp/demo.png)",
        "远程图片：@[image](https://cdn.example.com/demo.png)",
        "附件：@[file](/tmp/report.pdf)",
      ].join("\n"),
      { type: "main" },
    );

    expect(attachments).toEqual(["/tmp/demo.png", "/tmp/report.pdf"]);
  });

  it("keeps remote image attachments when explicitly enabled", () => {
    const attachments = extractTelegramFileAttachments(
      [
        "远程图片：@[image|960](https://cdn.example.com/demo.png)",
        "内联图片：@[image](data:image/png;base64,aGVsbG8=)",
      ].join("\n"),
      { type: "main" },
      { includeRemoteImages: true },
    );

    expect(attachments).toEqual([
      "https://cdn.example.com/demo.png",
      "data:image/png;base64,aGVsbG8=",
    ]);
  });

  it("strips all extended markdown attachment tokens from assistant text", () => {
    const stripped = stripTelegramFileMarkdown(
      [
        "结果如下：",
        "@[image|960](/tmp/demo.png)",
        "@[file](/tmp/report.pdf)",
        "@[attachment](/tmp/archive.zip)",
      ].join("\n"),
    );

    expect(stripped).toBe("结果如下：");
  });
});
