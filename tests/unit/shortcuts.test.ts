import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUT_CONFIG,
  keyboardShortcutToElectronAccelerator,
} from "../../src/shared/utils/shortcuts";

describe("keyboardShortcutToElectronAccelerator", () => {
  it("maps the default quick launcher shortcut to CommandOrControl", () => {
    expect(
      keyboardShortcutToElectronAccelerator(
        DEFAULT_SHORTCUT_CONFIG.quickLauncher,
        "darwin",
        { preferCommandOrControl: true },
      ),
    ).toBe("CommandOrControl+Shift+K");
  });

  it("maps punctuation and arrow keys", () => {
    expect(
      keyboardShortcutToElectronAccelerator(
        {
          code: "Comma",
          key: ",",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "darwin",
      ),
    ).toBe("Command+,");

    expect(
      keyboardShortcutToElectronAccelerator(
        {
          code: "ArrowUp",
          key: "ArrowUp",
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        },
        "win32",
      ),
    ).toBe("Control+Shift+Up");
  });

  it("returns null for unsupported keys", () => {
    expect(
      keyboardShortcutToElectronAccelerator(
        {
          code: "CapsLock",
          key: "CapsLock",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "darwin",
      ),
    ).toBeNull();
  });
});
