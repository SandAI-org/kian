import { EditOutlined, ReadOutlined } from "@ant-design/icons";
import { MarkdownPreBlock } from "@renderer/components/MarkdownPreBlock";
import { RevealableImage } from "@renderer/components/RevealableImage";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import { openUrl } from "@renderer/lib/openUrl";
import {
  detectMarkdownMediaKindFromSource,
  rewriteBareRemoteMediaUrlsInMarkdown,
} from "@shared/utils/markdownMedia";
import {
  isDocPassthroughUrl,
  resolveDocLocalUrl,
} from "@renderer/modules/docs/docMedia";
import Editor, { type OnMount } from "@monaco-editor/react";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { Button, Typography } from "antd";
import type { editor } from "monaco-editor";
import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const parseSizeFromAlt = (
  alt: string,
): { cleanAlt: string; width?: number; height?: number } => {
  const m = alt.match(/\|(\d+)(?:x(\d+))?\s*$/);
  if (!m) return { cleanAlt: alt };
  return {
    cleanAlt: alt.slice(0, m.index).trim() || "image",
    width: parseInt(m[1], 10),
    height: m[2] ? parseInt(m[2], 10) : undefined,
  };
};

const sizeStyle = (w?: number, h?: number): React.CSSProperties | undefined =>
  w ? { width: w, maxWidth: "100%", height: h ?? "auto" } : undefined;

const extractTextFromReactNode = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractTextFromReactNode(item)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromReactNode(node.props.children ?? "");
  }
  return "";
};

const EXTENDED_MEDIA_RE =
  /@\[(image|video|audio)(?:\|([^\]]*))?\]\(([^)\n]+)\)/gi;

const preprocessExtendedMedia = (content: string): string =>
  rewriteBareRemoteMediaUrlsInMarkdown(
    content,
    (kind, path) => `@[${kind}](${path})`,
  ).replace(
    EXTENDED_MEDIA_RE,
    (_full, kind: string, size: string | undefined, path: string) => {
      const sizeSuffix = size ? `|${size}` : "";
      return `![${kind}${sizeSuffix}](${path.trim()})`;
    },
  );

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".mdx", "mdx"],
  [".txt", "plaintext"],
  [".text", "plaintext"],
  [".log", "log"],
  [".json", "json"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".toml", "toml"],
  [".ini", "ini"],
  [".xml", "xml"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".scss", "scss"],
  [".sass", "sass"],
  [".less", "less"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "typescript"],
  [".vue", "vue"],
  [".svelte", "svelte"],
  [".astro", "html"],
  [".py", "python"],
  [".rb", "ruby"],
  [".php", "php"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".swift", "swift"],
  [".c", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".cxx", "cpp"],
  [".h", "cpp"],
  [".hh", "cpp"],
  [".hpp", "cpp"],
  [".hxx", "cpp"],
  [".cs", "csharp"],
  [".m", "objective-c"],
  [".mm", "objective-cpp"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"],
  [".fish", "shell"],
  [".ps1", "powershell"],
  [".bat", "bat"],
  [".cmd", "bat"],
  [".sql", "sql"],
  [".graphql", "graphql"],
  [".gql", "graphql"],
  [".proto", "protobuf"],
]);
const LANGUAGE_BY_BASENAME = new Map<string, string>([
  ["Dockerfile", "dockerfile"],
  ["Makefile", "makefile"],
  [".gitignore", "ignore"],
  [".gitattributes", "ini"],
  [".editorconfig", "ini"],
  [".npmrc", "ini"],
  [".yarnrc", "yaml"],
  [".prettierrc", "json"],
  [".eslintrc", "json"],
  [".stylelintrc", "json"],
  [".env", "shell"],
]);

const isMarkdownDocument = (filePath: string): boolean => {
  const trimmed = filePath.trim();
  if (!trimmed) return false;
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const baseName = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  const extension = baseName.includes(".")
    ? baseName.slice(baseName.lastIndexOf(".")).toLowerCase()
    : "";
  return MARKDOWN_EXTENSIONS.has(extension);
};

const inferDocumentLanguage = (filePath: string): string => {
  const trimmed = filePath.trim();
  if (!trimmed) return "plaintext";
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const baseName = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  if (LANGUAGE_BY_BASENAME.has(baseName)) {
    return LANGUAGE_BY_BASENAME.get(baseName) ?? "plaintext";
  }
  if (baseName.startsWith(".env.")) {
    return "shell";
  }
  const extension = baseName.includes(".")
    ? baseName.slice(baseName.lastIndexOf(".")).toLowerCase()
    : "";
  return LANGUAGE_BY_EXTENSION.get(extension) ?? "plaintext";
};

interface MarkdownEditorProps {
  projectId: string;
  documentPath: string;
  title: string;
  statusText?: string;
  value: string;
  onChange: (next: string) => void;
}

export const MarkdownEditor = ({
  projectId,
  documentPath,
  title,
  statusText,
  value,
  onChange,
}: MarkdownEditorProps) => {
  const { resolvedTheme } = useAppI18n();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [readMode, setReadMode] = useState(true);
  const markdownPreviewEnabled = useMemo(() => isMarkdownDocument(title), [title]);
  const editorLanguage = useMemo(() => inferDocumentLanguage(title), [title]);
  const showingMarkdownPreview = markdownPreviewEnabled && readMode;

  const handleMount = useCallback<OnMount>((instance) => {
    editorRef.current = instance;
  }, []);

  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      fontSize: 14,
      lineHeight: 24,
      fontFamily: "'JetBrains Mono', 'IBM Plex Mono', Menlo, monospace",
      lineNumbers: markdownPreviewEnabled ? "off" : "on",
      wordWrap: markdownPreviewEnabled ? "on" : "off",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: markdownPreviewEnabled ? "none" : "line",
      quickSuggestions: !markdownPreviewEnabled,
      readOnly: false,
      unicodeHighlight: {
        ambiguousCharacters: false,
        nonBasicASCII: false,
      },
      padding: { top: 14, bottom: 18 },
    }),
    [markdownPreviewEnabled],
  );

  useEffect(() => {
    const handler = (): void => {
      editorRef.current?.layout();
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#dbe5f5] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="min-w-0">
          <Typography.Text
            className="!mb-0 !font-semibold !text-slate-900"
            ellipsis
          >
            {title}
          </Typography.Text>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          {statusText ? (
            <Typography.Text className="!text-xs !text-slate-500">
              {statusText}
            </Typography.Text>
          ) : null}
          {markdownPreviewEnabled ? (
            <Button
              type="text"
              size="small"
              shape="circle"
              icon={readMode ? <EditOutlined /> : <ReadOutlined />}
              title={readMode ? "编辑模式" : "阅读模式"}
              aria-label={readMode ? "编辑模式" : "阅读模式"}
              onClick={() => setReadMode((prev) => !prev)}
            />
          ) : null}
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {showingMarkdownPreview ? (
          <ScrollArea className="h-full">
            <div className="px-3 py-2">
              {value.trim() ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mb-3 mt-1 text-2xl font-semibold text-slate-900">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mb-2 mt-4 text-xl font-semibold text-slate-900">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mb-2 mt-3 text-lg font-semibold text-slate-900">
                        {children}
                      </h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="mb-2 mt-3 text-base font-semibold text-slate-900">
                        {children}
                      </h4>
                    ),
                    h5: ({ children }) => (
                      <h5 className="mb-1.5 mt-2 text-sm font-semibold text-slate-900">
                        {children}
                      </h5>
                    ),
                    h6: ({ children }) => (
                      <h6 className="mb-1.5 mt-2 text-sm font-medium text-slate-500">
                        {children}
                      </h6>
                    ),
                    p: ({ children }) => (
                      <p className="mb-3 leading-7 text-slate-700">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="mb-3 list-disc pl-5 text-slate-700">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-3 list-decimal pl-5 text-slate-700">
                        {children}
                      </ol>
                    ),
                    li: ({ children, node }) => {
                      const hasCheckbox =
                        node?.children?.[0]?.type === "element" &&
                        (node.children[0] as any).tagName === "input";
                      return (
                        <li
                          className={`mb-1 text-slate-700${hasCheckbox ? " list-none -ml-5" : ""}`}
                        >
                          {children}
                        </li>
                      );
                    },
                    input: ({ checked, type }) => {
                      if (type !== "checkbox") return null;
                      return (
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="mr-2 h-3.5 w-3.5 translate-y-[1px] accent-blue-600"
                        />
                      );
                    },
                    blockquote: ({ children }) => (
                      <blockquote className="my-3 border-l-[3px] border-slate-300 bg-slate-50 py-1 pl-4 pr-3 text-slate-600 [&>p]:mb-1">
                        {children}
                      </blockquote>
                    ),
                    hr: () => (
                      <hr className="my-4 border-0 border-t border-slate-200" />
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-slate-900">
                        {children}
                      </strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic text-slate-700">{children}</em>
                    ),
                    del: ({ children }) => (
                      <del className="text-slate-400 line-through">
                        {children}
                      </del>
                    ),
                    table: ({ children }) => (
                      <table className="mb-3 table w-full table-fixed border-collapse border border-slate-300 text-left text-sm text-slate-700">
                        {children}
                      </table>
                    ),
                    th: ({ children }) => (
                      <th className="break-words border border-slate-300 bg-slate-100 px-3 py-2 font-semibold text-slate-900">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="break-words border border-slate-300 px-3 py-2 align-top">
                        {children}
                      </td>
                    ),
                    code: ({ children, className }) => {
                      const source = extractTextFromReactNode(children);
                      const isBlock =
                        Boolean(className?.includes("language-")) ||
                        source.includes("\n");
                      if (isBlock) {
                        return (
                          <code className={className}>{children}</code>
                        );
                      }
                      return (
                        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-800">
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => (
                      <MarkdownPreBlock variant="editor">
                        {children}
                      </MarkdownPreBlock>
                    ),
                    img: ({ src, alt }) => {
                      const raw = String(src ?? "");
                      if (!raw) return null;
                      const resolved = resolveDocLocalUrl(raw, {
                        projectId,
                        documentPath,
                      });
                      if (!resolved) return null;
                      const { cleanAlt, width, height } = parseSizeFromAlt(
                        String(alt ?? ""),
                      );
                      const altKind = cleanAlt.toLowerCase();
                      const kind =
                        altKind === "video" || altKind === "audio"
                          ? altKind
                          : (detectMarkdownMediaKindFromSource(raw) ?? "image");
                      if (kind === "video") {
                        return (
                          <video
                            controls
                            preload="metadata"
                            className="chat-markdown__media chat-markdown__media--video"
                            style={sizeStyle(width, height)}
                            src={resolved}
                          />
                        );
                      }
                      if (kind === "audio") {
                        return (
                          <audio
                            controls
                            preload="metadata"
                            className="chat-markdown__audio"
                            src={resolved}
                          />
                        );
                      }
                      return (
                        <RevealableImage
                          src={resolved}
                          alt={cleanAlt || "image"}
                          filePath={isDocPassthroughUrl(raw) ? undefined : raw}
                          projectId={projectId}
                          documentPath={documentPath}
                          className="chat-markdown__media chat-markdown__media--image"
                          imageClassName="chat-markdown__media-image"
                          style={sizeStyle(width, height)}
                        />
                      );
                    },
                    a: ({ children, href }) => {
                      const raw = String(href ?? "");
                      if (!raw.trim()) {
                        return <span>{children}</span>;
                      }
                      if (isDocPassthroughUrl(raw)) {
                        return (
                          <a
                            href={raw}
                            className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                            onClick={(event) => {
                              event.preventDefault();
                              void openUrl(raw);
                            }}
                          >
                            {children}
                          </a>
                        );
                      }
                      const resolved = resolveDocLocalUrl(raw, {
                        projectId,
                        documentPath,
                      });
                      if (!resolved) return <span>{children}</span>;
                      return (
                        <a
                          href={resolved}
                          className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                          onClick={(event) => {
                            event.preventDefault();
                            void api.file.open(raw, projectId, documentPath);
                          }}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {preprocessExtendedMedia(value)}
                </ReactMarkdown>
              ) : (
                <Typography.Text className="!text-sm !text-slate-400">
                  暂无内容
                </Typography.Text>
              )}
            </div>
          </ScrollArea>
        ) : (
          <Editor
            height="100%"
            language={editorLanguage}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
            value={value}
            onMount={handleMount}
            onChange={(next) => onChange(next ?? "")}
            options={options}
          />
        )}
      </div>
    </div>
  );
};
