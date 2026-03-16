import type { KeyboardShortcutDTO } from "@shared/types";

export const MAIN_AGENT_INPUT_FOCUS_EVENT = "kian:focus-main-agent-input";
export const QUICK_LAUNCHER_NEW_SESSION_EVENT =
  "kian:quick-launcher-new-session";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const CODE_LABELS: Record<string, string> = {
  Enter: "Enter",
  Escape: "Esc",
  Space: "Space",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

const getShortcutKeyLabel = (shortcut: KeyboardShortcutDTO): string => {
  if (CODE_LABELS[shortcut.code]) {
    return CODE_LABELS[shortcut.code];
  }
  if (/^Key[A-Z]$/.test(shortcut.code)) {
    return shortcut.code.slice(3);
  }
  if (/^Digit[0-9]$/.test(shortcut.code)) {
    return shortcut.code.slice(5);
  }

  const normalizedKey = shortcut.key.trim();
  if (normalizedKey.length === 1) {
    return normalizedKey.toUpperCase();
  }
  if (normalizedKey === " ") {
    return "Space";
  }
  return normalizedKey || shortcut.code;
};

export const formatKeyboardShortcut = (
  shortcut: KeyboardShortcutDTO,
): string => {
  const useMacLabels = isMacPlatform();
  const parts: string[] = [];

  if (shortcut.metaKey) {
    parts.push(useMacLabels ? "CMD" : "Meta");
  }
  if (shortcut.ctrlKey) {
    parts.push("Ctrl");
  }
  if (shortcut.altKey) {
    parts.push(useMacLabels ? "Option" : "Alt");
  }
  if (shortcut.shiftKey) {
    parts.push("Shift");
  }

  parts.push(getShortcutKeyLabel(shortcut));
  return parts.join(" + ");
};

export const matchesKeyboardShortcut = (
  event: Pick<
    KeyboardEvent,
    "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  shortcut: KeyboardShortcutDTO,
): boolean =>
  event.code === shortcut.code &&
  Boolean(event.metaKey) === shortcut.metaKey &&
  Boolean(event.ctrlKey) === shortcut.ctrlKey &&
  Boolean(event.altKey) === shortcut.altKey &&
  Boolean(event.shiftKey) === shortcut.shiftKey;

export const keyboardShortcutFromEvent = (
  event: Pick<
    KeyboardEvent,
    "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
): KeyboardShortcutDTO | null => {
  if (!event.code || MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  return {
    code: event.code,
    key: event.key,
    metaKey: Boolean(event.metaKey),
    ctrlKey: Boolean(event.ctrlKey),
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
  };
};
