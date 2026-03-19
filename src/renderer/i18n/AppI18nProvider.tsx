import { api } from "@renderer/lib/api";
import {
  APP_LANGUAGES,
  DEFAULT_APP_LANGUAGE,
  type AppLanguage,
} from "@shared/i18n";
import {
  DEFAULT_APP_THEME_MODE,
  isAppThemeMode,
  type AppResolvedTheme,
  type AppThemeMode,
} from "@shared/theme";
import { setDefaultDateTimeLocale } from "@shared/utils/dateTime";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "antd/es/locale";
import enUS from "antd/locale/en_US";
import jaJP from "antd/locale/ja_JP";
import koKR from "antd/locale/ko_KR";
import zhCN from "antd/locale/zh_CN";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  resolveTranslationState,
  type TranslationState,
} from "./translationState";
import { translateUiText } from "./uiTranslations";

type AppI18nContextValue = {
  language: AppLanguage;
  antdLocale: Locale;
  themeMode: AppThemeMode;
  resolvedTheme: AppResolvedTheme;
};

type TextNodeTranslationState = TranslationState;
type AttributeTranslationState = Map<string, TranslationState>;

const ATTRIBUTES_TO_TRANSLATE = ["placeholder", "title", "aria-label", "alt"];
const BLOCKED_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE"]);
const BLOCKED_ATTRIBUTE_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE"]);
const BLOCKED_CLASS_NAMES = [
  "chat-markdown",
  "markdown-code-block",
  "markdown-mermaid-block",
  "i18n-no-translate",
];
const ANTD_LOCALES: Record<AppLanguage, Locale> = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "ko-KR": koKR,
  "ja-JP": jaJP,
};

const AppI18nContext = createContext<AppI18nContextValue>({
  language: DEFAULT_APP_LANGUAGE,
  antdLocale: ANTD_LOCALES[DEFAULT_APP_LANGUAGE],
  themeMode: DEFAULT_APP_THEME_MODE,
  resolvedTheme: "light",
});

const isTranslatableLanguage = (value: unknown): value is AppLanguage =>
  typeof value === "string" &&
  APP_LANGUAGES.includes(value as AppLanguage);

const getSystemResolvedTheme = (): AppResolvedTheme => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const hasBlockedClassName = (element: Element): boolean =>
  BLOCKED_CLASS_NAMES.some((className) => element.classList.contains(className));

const shouldSkipTextElement = (element: Element | null): boolean => {
  if (!element) return false;
  if (BLOCKED_TEXT_TAGS.has(element.tagName)) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  if (hasBlockedClassName(element)) return true;
  return shouldSkipTextElement(element.parentElement);
};

const shouldSkipAttributeElement = (element: Element | null): boolean => {
  if (!element) return false;
  if (BLOCKED_ATTRIBUTE_TAGS.has(element.tagName)) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  if (hasBlockedClassName(element)) return true;
  return shouldSkipAttributeElement(element.parentElement);
};

const translateDocumentText = (
  language: AppLanguage,
  textNodes: WeakMap<Text, TextNodeTranslationState>,
  attributeValues: WeakMap<Element, AttributeTranslationState>,
  root: ParentNode,
): void => {
  const applyToTextNode = (node: Text) => {
    if (shouldSkipTextElement(node.parentElement)) return;
    const currentText = node.textContent ?? "";
    const nextState = resolveTranslationState(
      language,
      currentText,
      textNodes.get(node),
    );
    textNodes.set(node, nextState);
    if (currentText !== nextState.translated) {
      node.textContent = nextState.translated;
    }
  };

  const applyToAttributes = (element: Element) => {
    if (shouldSkipAttributeElement(element)) return;
    const attributeStateMap =
      attributeValues.get(element) ?? new Map<string, { source: string; translated: string }>();
    for (const attribute of ATTRIBUTES_TO_TRANSLATE) {
      const currentValue = element.getAttribute(attribute);
      if (currentValue === null) continue;
      const nextState = resolveTranslationState(
        language,
        currentValue,
        attributeStateMap.get(attribute),
      );
      attributeStateMap.set(attribute, nextState);
      if (currentValue !== nextState.translated) {
        element.setAttribute(attribute, nextState.translated);
      }
    }
    if (attributeStateMap.size > 0) {
      attributeValues.set(element, attributeStateMap);
    }
  };

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let currentNode: Node | null = walker.currentNode;
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      applyToTextNode(currentNode as Text);
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      applyToAttributes(currentNode as Element);
    }
    currentNode = walker.nextNode();
  }
};

const UiTextTranslator = ({ language }: { language: AppLanguage }) => {
  const textNodesRef = useRef(new WeakMap<Text, TextNodeTranslationState>());
  const attributeValuesRef = useRef(new WeakMap<Element, AttributeTranslationState>());

  useEffect(() => {
    if (!document.body) return;

    translateDocumentText(
      language,
      textNodesRef.current,
      attributeValuesRef.current,
      document.body,
    );

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          translateDocumentText(
            language,
            textNodesRef.current,
            attributeValuesRef.current,
            mutation.target.parentElement ?? document.body,
          );
          continue;
        }

        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          translateDocumentText(
            language,
            textNodesRef.current,
            attributeValuesRef.current,
            mutation.target,
          );
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof Text) {
            translateDocumentText(
              language,
              textNodesRef.current,
              attributeValuesRef.current,
              node instanceof Text ? node.parentElement ?? document.body : node,
            );
          }
        });
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES_TO_TRANSLATE,
    });

    return () => {
      observer.disconnect();
    };
  }, [language]);

  return null;
};

export const AppI18nProvider = ({ children }: PropsWithChildren) => {
  const generalConfigQuery = useQuery({
    queryKey: ["settings", "general"],
    queryFn: api.settings.getGeneralConfig,
  });
  const [systemTheme, setSystemTheme] = useState<AppResolvedTheme>(
    getSystemResolvedTheme,
  );

  const language = isTranslatableLanguage(generalConfigQuery.data?.language)
    ? generalConfigQuery.data.language
    : DEFAULT_APP_LANGUAGE;
  const themeMode = isAppThemeMode(generalConfigQuery.data?.themeMode)
    ? generalConfigQuery.data.themeMode
    : DEFAULT_APP_THEME_MODE;
  const resolvedTheme =
    themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (event?: MediaQueryListEvent) => {
      setSystemTheme(event?.matches ?? mediaQuery.matches ? "dark" : "light");
    };

    handleThemeChange();
    mediaQuery.addEventListener("change", handleThemeChange);
    return () => mediaQuery.removeEventListener("change", handleThemeChange);
  }, []);

  useEffect(() => {
    setDefaultDateTimeLocale(language);
    document.documentElement.lang = language;
    document.title = translateUiText(language, "Kian - AI 短剧创作");
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.classList.toggle("theme-dark", resolvedTheme === "dark");
    document.documentElement.classList.toggle("theme-light", resolvedTheme === "light");
    document.body?.classList.toggle("theme-dark", resolvedTheme === "dark");
    document.body?.classList.toggle("theme-light", resolvedTheme === "light");
  }, [resolvedTheme, themeMode]);

  const value = useMemo<AppI18nContextValue>(
    () => ({
      language,
      antdLocale: ANTD_LOCALES[language],
      themeMode,
      resolvedTheme,
    }),
    [language, resolvedTheme, themeMode],
  );

  return (
    <AppI18nContext.Provider value={value}>
      <UiTextTranslator language={language} />
      {children}
    </AppI18nContext.Provider>
  );
};

export const useAppI18n = (): AppI18nContextValue => useContext(AppI18nContext);
