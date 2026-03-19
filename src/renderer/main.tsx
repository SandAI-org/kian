import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "simplebar-react/dist/simplebar.min.css";
import { AppRouter } from "./app/AppRouter";
import { AppI18nProvider, useAppI18n } from "./i18n/AppI18nProvider";
import { initializeChatQueryBridge } from "./modules/chat/chatQueryCache";
import "./styles/globals.css";

// Monaco Editor worker setup for production builds
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

initializeChatQueryBridge(queryClient);

const AppShell = () => {
  const { antdLocale, resolvedTheme } = useAppI18n();
  const isDark = resolvedTheme === "dark";

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#2f6ff7",
          borderRadius: 4,
          colorBgBase: isDark ? "#0b1220" : "#ffffff",
          colorBgContainer: isDark ? "#111b2e" : "#edf3ff",
          colorBgElevated: isDark ? "#111b2e" : "#ffffff",
          colorText: isDark ? "#e2e8f0" : "#101828",
          colorTextSecondary: isDark ? "#94a3b8" : "#475569",
          colorBorder: isDark ? "#273449" : "#d7e1f1",
          colorSplit: isDark ? "#273449" : "#d7e1f1",
          controlHeight: 40,
          fontSize: 15,
          fontFamily: "Manrope, 'PingFang SC', 'Segoe UI', sans-serif",
        },
        components: {
          Layout: {
            bodyBg: "transparent",
            headerBg: "transparent",
            siderBg: "transparent",
          },
          Menu: {
            itemBg: "transparent",
            itemColor: isDark ? "#8ea0b8" : "#475569",
            itemHoverBg: isDark ? "#111b2e" : "#edf3ff",
            itemHoverColor: isDark ? "#e2e8f0" : "#0f172a",
            itemSelectedBg: isDark ? "#172554" : "#dce9ff",
            itemSelectedColor: isDark ? "#93c5fd" : "#1d4ed8",
          },
          Tabs: {
            itemColor: isDark ? "#94a3b8" : "#64748b",
            itemActiveColor: isDark ? "#93c5fd" : "#1d4ed8",
            itemSelectedColor: isDark ? "#93c5fd" : "#1d4ed8",
            inkBarColor: "#2f6ff7",
          },
          Button: {
            borderRadius: 4,
            controlHeight: 40,
            paddingInline: 18,
            fontWeight: 600,
          },
          Input: {
            borderRadius: 4,
            controlHeight: 40,
          },
          Select: {
            optionSelectedBg: isDark ? "#172554" : "#dce9ff",
          },
          Tooltip: {
            colorBgSpotlight: isDark ? "#0f172a" : "#0f172a",
          },
          Card: {
            borderRadiusLG: 4,
          },
        },
      }}
    >
      <AntdApp component={false}>
        <HashRouter>
          <AppRouter />
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppI18nProvider>
        <AppShell />
      </AppI18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
