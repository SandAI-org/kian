import {
  CaretDownFilled,
  CaretRightFilled,
  CheckOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import { isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";

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

const extractCodeClassName = (node: ReactNode): string | undefined => {
  if (Array.isArray(node)) {
    for (const item of node) {
      const className = extractCodeClassName(item);
      if (className) return className;
    }
    return undefined;
  }
  if (isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    if (
      typeof node.props.className === "string" &&
      node.props.className.includes("language-")
    ) {
      return node.props.className;
    }
    return extractCodeClassName(node.props.children ?? "");
  }
  return undefined;
};

const getCodeLanguageLabel = (className?: string): string => {
  const match = className?.match(/language-([a-z0-9#+._-]+)/i);
  return match?.[1]?.toUpperCase() ?? "TEXT";
};

const normalizeCodeSource = (node: ReactNode): string =>
  extractTextFromReactNode(node).replace(/\n$/, "");

interface MarkdownCodeBlockProps {
  children: ReactNode;
  variant: "editor" | "chat";
}

export const MarkdownCodeBlock = ({
  children,
  variant,
}: MarkdownCodeBlockProps) => {
  const { t } = useAppI18n();
  const source = useMemo(() => normalizeCodeSource(children), [children]);
  const languageLabel = useMemo(
    () => getCodeLanguageLabel(extractCodeClassName(children)),
    [children],
  );
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setExpanded(true);
  }, [source]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const collapsed = !expanded;
  const canCopy = source.trim().length > 0;
  const preNode = (
    <pre className="markdown-code-block__pre is-nowrap">
      {children}
    </pre>
  );

  const handleCopy = async (): Promise<void> => {
    if (!canCopy) return;
    try {
      const copiedByApi = await api.clipboard.writeText(source);
      if (!copiedByApi && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(source);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`markdown-code-block markdown-code-block--${variant} ${collapsed ? "is-collapsed" : "is-expanded"} mb-3 rounded-md`}
    >
      <div className="markdown-code-block__header">
        <button
          type="button"
          className="markdown-code-block__header-main"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <span className="markdown-code-block__collapse" aria-hidden="true">
            {expanded ? <CaretDownFilled /> : <CaretRightFilled />}
          </span>
          <span className="markdown-code-block__title">{t("代码块")}</span>
        </button>
        {!collapsed ? (
          <div className="markdown-code-block__actions">
            <span className="markdown-code-block__language">{languageLabel}</span>
            <span className="markdown-code-block__divider" aria-hidden="true" />
            <button
              type="button"
              className="markdown-code-block__action"
              onClick={() => void handleCopy()}
              disabled={!canCopy}
            >
              {copied ? <CheckOutlined /> : <CopyOutlined />}
              <span>{t(copied ? "已复制" : "复制")}</span>
            </button>
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="markdown-code-block__body">
          <ScrollArea className="markdown-code-block__scroll markdown-code-scroll">
            {preNode}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
};
