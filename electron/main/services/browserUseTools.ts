import { Type } from "@earendil-works/pi-ai";
import { browserUseService } from "./browserUseService";
import type { CustomToolDef } from "./customTools";
import { buildMediaMarkdown } from "./mediaMarkdown";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toJsonText = (value: unknown): string => JSON.stringify(value, null, 2);

const toReadMarkdown = (input: {
  title: string;
  url: string;
  text: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
}): string => {
  const lines: string[] = [];
  lines.push(`# ${input.title || "Untitled Page"}`);
  lines.push(`URL: ${input.url}`);
  lines.push("");

  if (input.headings.length > 0) {
    lines.push("## Headings");
    for (const heading of input.headings.slice(0, 30)) {
      const level = Math.max(1, Math.min(6, Number(heading.level) || 1));
      lines.push(`- h${level}: ${heading.text}`);
    }
    lines.push("");
  }

  lines.push("## Content");
  lines.push("");
  lines.push(input.text.slice(0, 20_000));
  lines.push("");

  if (input.links.length > 0) {
    lines.push("## Links");
    for (const link of input.links.slice(0, 30)) {
      const text = link.text?.trim() || "(no text)";
      lines.push(`- [${text}](${link.href})`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
};

export const createBrowserUseTools = (projectCwd: string): CustomToolDef[] => [
  {
    name: "BrowserOpen",
    label: "BrowserOpen",
    description:
      "Open or reuse a hidden background browser session and navigate to URL.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to open" }),
    }),
    async handler(input) {
      try {
        const url = input.url as string;
        const result = await browserUseService.open(url);
        return {
          text: [
            "background browser session opened, call BrowserClose when finished",
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserOpen failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserClick",
    label: "BrowserClick",
    description: "Click an element by CSS selector.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for target element" }),
    }),
    async handler(input) {
      try {
        const selector = input.selector as string;
        const result = await browserUseService.click(selector);
        return {
          text: [
            `clicked: ${selector}`,
            `tag: ${result.clickedTag || "(unknown)"}`,
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserClick failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserType",
    label: "BrowserType",
    description:
      "Type text into an input field by CSS selector. Optionally press Enter to submit.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for input element" }),
      text: Type.String({ description: "Text to type" }),
      pressEnter: Type.Optional(
        Type.Boolean({ description: "Whether to press Enter after typing" }),
      ),
    }),
    async handler(input) {
      try {
        const selector = input.selector as string;
        const text = input.text as string;
        const pressEnter = Boolean(input.pressEnter as boolean | undefined);
        const result = await browserUseService.type(selector, text, pressEnter);
        return {
          text: [
            `typed into: ${selector}`,
            `characters: ${result.typedLength}`,
            `press_enter: ${pressEnter}`,
            `submitted: ${result.submitted}`,
            `url: ${result.url}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserType failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserScreenshot",
    label: "BrowserScreenshot",
    description: "Take a screenshot of the current page.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const result = await browserUseService.screenshot(projectCwd);
        return {
          text: [
            `saved_path: ${result.savedPath}`,
            `size: ${result.width}x${result.height}`,
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
            buildMediaMarkdown("image", result.savedPath),
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserScreenshot failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserRead",
    label: "BrowserRead",
    description: "Read current page content and return markdown-style text.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const result = await browserUseService.read();
        return { text: toReadMarkdown(result) };
      } catch (error) {
        return {
          text: `BrowserRead failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserReadDom",
    label: "BrowserReadDom",
    description:
      "List interactive DOM elements (buttons/links/inputs) with CSS selector hints.",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({
          description:
            "Optional max number of elements to return. Default 120, max 400.",
        }),
      ),
    }),
    async handler(input) {
      try {
        const limit = input.limit as number | undefined;
        const result = await browserUseService.readDom(limit);
        return { text: toJsonText(result) };
      } catch (error) {
        return {
          text: `BrowserReadDom failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserBack",
    label: "BrowserBack",
    description: "Navigate browser back in history.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const result = await browserUseService.back();
        return {
          text: [
            `changed: ${result.changed}`,
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserBack failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserForward",
    label: "BrowserForward",
    description: "Navigate browser forward in history.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const result = await browserUseService.forward();
        return {
          text: [
            `changed: ${result.changed}`,
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserForward failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserReload",
    label: "BrowserReload",
    description: "Reload current page.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const result = await browserUseService.reload();
        return {
          text: [
            "reloaded",
            `url: ${result.url}`,
            `title: ${result.title || "(empty)"}`,
          ].join("\n"),
        };
      } catch (error) {
        return {
          text: `BrowserReload failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserEval",
    label: "BrowserEval",
    description: "Execute JavaScript in page context and return the result.",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript code" }),
    }),
    async handler(input) {
      try {
        const code = input.code as string;
        const result = await browserUseService.eval(code);
        return { text: result };
      } catch (error) {
        return {
          text: `BrowserEval failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
  {
    name: "BrowserClose",
    label: "BrowserClose",
    description: "Close the hidden background browser session.",
    parameters: Type.Object({}),
    async handler() {
      try {
        const closed = await browserUseService.close();
        return {
          text: closed
            ? "background browser session closed"
            : "background browser session not open",
        };
      } catch (error) {
        return {
          text: `BrowserClose failed: ${toErrorMessage(error)}`,
          isError: true,
        };
      }
    },
  },
];
