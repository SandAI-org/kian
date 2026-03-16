import type { KeyboardShortcutDTO, ShortcutConfigDTO } from "@shared/types";

const normalizeShortcutString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeShortcutFlag = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export const DEFAULT_SEND_MESSAGE_SHORTCUT: KeyboardShortcutDTO = {
  code: "Enter",
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export const DEFAULT_INSERT_NEWLINE_SHORTCUT: KeyboardShortcutDTO = {
  code: "Enter",
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
};

export const DEFAULT_FOCUS_MAIN_AGENT_INPUT_SHORTCUT: KeyboardShortcutDTO = {
  code: "KeyH",
  key: "h",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export const DEFAULT_OPEN_SETTINGS_PAGE_SHORTCUT: KeyboardShortcutDTO = {
  code: "Comma",
  key: ",",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export const DEFAULT_NEW_CHAT_SESSION_SHORTCUT: KeyboardShortcutDTO = {
  code: "KeyN",
  key: "n",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export const DEFAULT_QUICK_LAUNCHER_SHORTCUT: KeyboardShortcutDTO = {
  code: "KeyK",
  key: "k",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
};

export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfigDTO = {
  sendMessage: DEFAULT_SEND_MESSAGE_SHORTCUT,
  insertNewline: DEFAULT_INSERT_NEWLINE_SHORTCUT,
  focusMainAgentInput: DEFAULT_FOCUS_MAIN_AGENT_INPUT_SHORTCUT,
  openSettingsPage: DEFAULT_OPEN_SETTINGS_PAGE_SHORTCUT,
  newChatSession: DEFAULT_NEW_CHAT_SESSION_SHORTCUT,
  quickLauncher: DEFAULT_QUICK_LAUNCHER_SHORTCUT,
};

export const normalizeKeyboardShortcut = (
  value: unknown,
  fallback: KeyboardShortcutDTO,
): KeyboardShortcutDTO => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  const raw = value as Partial<KeyboardShortcutDTO>;
  return {
    code: normalizeShortcutString(raw.code, fallback.code),
    key: normalizeShortcutString(raw.key, fallback.key),
    metaKey: normalizeShortcutFlag(raw.metaKey, fallback.metaKey),
    ctrlKey: normalizeShortcutFlag(raw.ctrlKey, fallback.ctrlKey),
    altKey: normalizeShortcutFlag(raw.altKey, fallback.altKey),
    shiftKey: normalizeShortcutFlag(raw.shiftKey, fallback.shiftKey),
  };
};

export const normalizeShortcutConfig = (value: unknown): ShortcutConfigDTO => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      sendMessage: { ...DEFAULT_SEND_MESSAGE_SHORTCUT },
      insertNewline: { ...DEFAULT_INSERT_NEWLINE_SHORTCUT },
      focusMainAgentInput: { ...DEFAULT_FOCUS_MAIN_AGENT_INPUT_SHORTCUT },
      openSettingsPage: { ...DEFAULT_OPEN_SETTINGS_PAGE_SHORTCUT },
      newChatSession: { ...DEFAULT_NEW_CHAT_SESSION_SHORTCUT },
      quickLauncher: { ...DEFAULT_QUICK_LAUNCHER_SHORTCUT },
    };
  }

  const raw = value as Partial<ShortcutConfigDTO>;
  return {
    sendMessage: normalizeKeyboardShortcut(
      raw.sendMessage,
      DEFAULT_SEND_MESSAGE_SHORTCUT,
    ),
    insertNewline: normalizeKeyboardShortcut(
      raw.insertNewline,
      DEFAULT_INSERT_NEWLINE_SHORTCUT,
    ),
    focusMainAgentInput: normalizeKeyboardShortcut(
      raw.focusMainAgentInput,
      DEFAULT_FOCUS_MAIN_AGENT_INPUT_SHORTCUT,
    ),
    openSettingsPage: normalizeKeyboardShortcut(
      raw.openSettingsPage,
      DEFAULT_OPEN_SETTINGS_PAGE_SHORTCUT,
    ),
    newChatSession: normalizeKeyboardShortcut(
      raw.newChatSession,
      DEFAULT_NEW_CHAT_SESSION_SHORTCUT,
    ),
    quickLauncher: normalizeKeyboardShortcut(
      raw.quickLauncher,
      DEFAULT_QUICK_LAUNCHER_SHORTCUT,
    ),
  };
};

export const keyboardShortcutToSignature = (
  shortcut: KeyboardShortcutDTO,
): string =>
  [
    shortcut.code,
    shortcut.key,
    shortcut.metaKey ? "1" : "0",
    shortcut.ctrlKey ? "1" : "0",
    shortcut.altKey ? "1" : "0",
    shortcut.shiftKey ? "1" : "0",
  ].join(":");

export const shortcutConfigToSignature = (
  config: ShortcutConfigDTO,
): string =>
  [
    keyboardShortcutToSignature(config.sendMessage),
    keyboardShortcutToSignature(config.insertNewline),
    keyboardShortcutToSignature(config.focusMainAgentInput),
    keyboardShortcutToSignature(config.openSettingsPage),
    keyboardShortcutToSignature(config.newChatSession),
    keyboardShortcutToSignature(config.quickLauncher),
  ].join("|");

const ACCELERATOR_KEY_MAP: Record<string, string> = {
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Esc",
  Space: "Space",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
};

const getAcceleratorKey = (shortcut: KeyboardShortcutDTO): string | null => {
  if (ACCELERATOR_KEY_MAP[shortcut.code]) {
    return ACCELERATOR_KEY_MAP[shortcut.code];
  }
  if (/^Key[A-Z]$/.test(shortcut.code)) {
    return shortcut.code.slice(3);
  }
  if (/^Digit[0-9]$/.test(shortcut.code)) {
    return shortcut.code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(shortcut.code)) {
    return `num${shortcut.code.slice(6)}`;
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(shortcut.code)) {
    return shortcut.code;
  }
  return null;
};

export const keyboardShortcutToElectronAccelerator = (
  shortcut: KeyboardShortcutDTO,
  platform: string,
  options?: { preferCommandOrControl?: boolean },
): string | null => {
  const key = getAcceleratorKey(shortcut);
  if (!key) {
    return null;
  }

  const parts: string[] = [];

  if (shortcut.metaKey) {
    if (options?.preferCommandOrControl && !shortcut.ctrlKey) {
      parts.push("CommandOrControl");
    } else {
      parts.push(platform === "darwin" ? "Command" : "Super");
    }
  }
  if (shortcut.ctrlKey) {
    parts.push("Control");
  }
  if (shortcut.altKey) {
    parts.push("Alt");
  }
  if (shortcut.shiftKey) {
    parts.push("Shift");
  }

  parts.push(key);
  return parts.join("+");
};
