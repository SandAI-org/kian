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
  useState,
  type PropsWithChildren,
} from "react";
import { translateUiText } from "./uiTranslations";

type AppI18nContextValue = {
  language: AppLanguage;
  antdLocale: Locale;
  themeMode: AppThemeMode;
  resolvedTheme: AppResolvedTheme;
  t: (value: string) => string;
};

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
  t: (value) => value,
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
      t: (text) => translateUiText(language, text),
    }),
    [language, resolvedTheme, themeMode],
  );

  return (
    <AppI18nContext.Provider value={value}>
      {children}
    </AppI18nContext.Provider>
  );
};

export const useAppI18n = (): AppI18nContextValue => useContext(AppI18nContext);
