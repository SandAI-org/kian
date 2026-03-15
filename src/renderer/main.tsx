import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
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
  const { antdLocale } = useAppI18n();

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: "#2f6ff7",
          borderRadius: 4,
          colorBgContainer: "#edf3ff",
          colorText: "#101828",
          colorBorder: "#d7e1f1",
          controlHeight: 40,
          fontSize: 15,
          fontFamily: "Manrope, 'PingFang SC', 'Segoe UI', sans-serif",
        },
        components: {
          Layout: {
            bodyBg: "transparent",
            headerBg: "transparent",
          },
          Menu: {
            itemBg: "transparent",
            itemColor: "#475569",
            itemSelectedBg: "#dce9ff",
            itemSelectedColor: "#1d4ed8",
          },
          Tabs: {
            itemColor: "#64748b",
            itemActiveColor: "#1d4ed8",
            itemSelectedColor: "#1d4ed8",
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
