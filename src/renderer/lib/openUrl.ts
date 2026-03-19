import { message } from "antd";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { DEFAULT_APP_LANGUAGE, isAppLanguage } from "@shared/i18n";
import { api } from "./api";

export const openUrl = async (url: string): Promise<void> => {
  try {
    await api.window.openUrl(url);
  } catch (error) {
    const language = isAppLanguage(document.documentElement.lang)
      ? document.documentElement.lang
      : DEFAULT_APP_LANGUAGE;
    message.error(
      error instanceof Error
        ? error.message
        : translateUiText(language, "打开链接失败"),
    );
  }
};
