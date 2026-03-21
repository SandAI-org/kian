const RUNTIME_ENVIRONMENT_PLACEHOLDER = "{{RUNTIME_ENVIRONMENT}}";
const CONTEXT_SNAPSHOT_PLACEHOLDER = "{{CONTEXT_SNAPSHOT}}";
const PROJECT_PLACEHOLDER = "{{PROJECT}}";
const SOFTWARE_INFO_PLACEHOLDER = "{{SOFTWARE_INFO}}";
const IDENTITY_PLACEHOLDER = "{{IDENTITY}}";
const SOUL_PLACEHOLDER = "{{SOUL}}";
const USER_PLACEHOLDER = "{{USER}}";

export type DefaultSystemPromptTemplateInput = {
  platform?: NodeJS.Platform;
  runtimeEnvironment?: string;
  contextSnapshot?: string;
  project?: string;
  softwareInfo?: string;
  identity?: string;
  soul?: string;
  user?: string;
};

const getPlatformRuntimeEnvironmentPrompt = (
  platform: NodeJS.Platform,
): string => {
  if (platform === "darwin") {
    return "- macOS：所以你可以通过 AppleScript 来操作 macOS 的系统。";
  }

  if (platform === "win32") {
    return "- Windows：优先使用 PowerShell、cmd 和 Windows 原生命令；只有在系统已安装并可用时，才假设 Bash/Git Bash 可以使用。";
  }

  if (platform === "linux") {
    return "- Linux：你可以使用常见的 Linux shell 与命令行工具来操作系统。";
  }

  return `- 当前运行平台是 ${platform}：根据当前平台选择可用的系统命令与工具，不要默认假设 macOS 特性可用。`;
};

const getRuntimeEnvironmentPrompt = (
  platform: NodeJS.Platform,
  runtimeEnvironment: string | undefined,
): string =>
  [getPlatformRuntimeEnvironmentPrompt(platform), runtimeEnvironment?.trim()]
    .filter((value): value is string => Boolean(value))
    .join("\n");

const fillPlaceholder = (
  template: string,
  placeholder: string,
  value: string | undefined,
): string => template.replaceAll(placeholder, value?.trim() || "未提供");

export const renderDefaultSystemPromptTemplate = (
  template: string,
  input: DefaultSystemPromptTemplateInput = {},
): string => {
  const platform = input.platform ?? process.platform;
  const replacements: Array<[string, string | undefined]> = [
    [
      RUNTIME_ENVIRONMENT_PLACEHOLDER,
      getRuntimeEnvironmentPrompt(platform, input.runtimeEnvironment),
    ],
    [CONTEXT_SNAPSHOT_PLACEHOLDER, input.contextSnapshot],
    [PROJECT_PLACEHOLDER, input.project],
    [SOFTWARE_INFO_PLACEHOLDER, input.softwareInfo],
    [IDENTITY_PLACEHOLDER, input.identity],
    [SOUL_PLACEHOLDER, input.soul],
    [USER_PLACEHOLDER, input.user],
  ];

  return replacements.reduce(
    (result, [placeholder, value]) =>
      fillPlaceholder(result, placeholder, value),
    template,
  );
};
