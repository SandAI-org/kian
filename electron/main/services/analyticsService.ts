import { createRequire } from "node:module";
import type { ChatScope } from "@shared/types";

type AnalyticsProps = Record<string, string | number | boolean>;
type AptabaseMain = Pick<
  typeof import("@aptabase/electron/main"),
  "initialize" | "trackEvent"
>;

const require = createRequire(import.meta.url);
let aptabaseMain: AptabaseMain | null | undefined;

const getAptabaseMain = (): AptabaseMain | null => {
  if (aptabaseMain !== undefined) {
    return aptabaseMain;
  }

  try {
    aptabaseMain = require("@aptabase/electron/main") as AptabaseMain;
  } catch {
    aptabaseMain = null;
  }
  return aptabaseMain;
};

export const initializeAnalytics = (appKey: string): void => {
  const aptabase = getAptabaseMain();
  if (!aptabase) return;
  void aptabase.initialize(appKey).catch(() => {});
};

export const trackAnalyticsEvent = (
  eventName: string,
  props?: AnalyticsProps,
): void => {
  const aptabase = getAptabaseMain();
  if (!aptabase) return;
  void aptabase.trackEvent(eventName, props).catch(() => {});
};

export const getChatScopeAnalyticsProps = (
  scope: ChatScope,
): AnalyticsProps => ({
  scope_type: scope.type,
});
