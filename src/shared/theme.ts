export const APP_THEME_MODES = ["system", "light", "dark"] as const;

export type AppThemeMode = (typeof APP_THEME_MODES)[number];
export type AppResolvedTheme = Exclude<AppThemeMode, "system">;

export const DEFAULT_APP_THEME_MODE: AppThemeMode = "system";

export const isAppThemeMode = (value: unknown): value is AppThemeMode =>
  typeof value === "string" &&
  APP_THEME_MODES.includes(value as AppThemeMode);
