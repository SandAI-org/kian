import { BrowserView, BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DOM_ELEMENTS = 400;
const BROWSER_USE_PARTITION = "kian-browser-use";

type BrowserSession = {
  window: BrowserWindow;
  view: BrowserView;
};

export type BrowserPageInfo = {
  url: string;
  title: string;
};

export type BrowserScreenshotResult = BrowserPageInfo & {
  savedPath: string;
  width: number;
  height: number;
};

export type BrowserDomElement = {
  selector: string;
  tag: string;
  type: string;
  text: string;
  id: string;
  name: string;
  href: string;
  placeholder: string;
  role: string;
  ariaLabel: string;
  disabled: boolean;
};

export type BrowserReadResult = BrowserPageInfo & {
  text: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
};

const normalizeUrl = (input: string): string => {
  const value = input.trim();
  if (!value) {
    throw new Error("url is required");
  }

  try {
    return new URL(value).toString();
  } catch {
    return new URL(`https://${value}`).toString();
  }
};

const createError = (message: string): never => {
  throw new Error(message);
};

const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "bigint") {
          return currentValue.toString();
        }
        if (currentValue && typeof currentValue === "object") {
          if (seen.has(currentValue)) {
            return "[circular]";
          }
          seen.add(currentValue);
        }
        return currentValue;
      },
      2,
    );
  } catch {
    return String(value);
  }
};

const waitForLoad = async (
  session: BrowserSession,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  const webContents = session.view.webContents;
  if (!webContents.isLoadingMainFrame() && !webContents.isWaitingForResponse()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      webContents.removeListener("did-stop-loading", onStop);
      webContents.removeListener("did-fail-load", onFail);
      clearTimeout(timer);
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onStop = (): void => finish();

    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || errorCode === -3) {
        finish();
        return;
      }
      fail(new Error(`navigation failed (${errorCode}): ${errorDescription}`));
    };

    const timer = setTimeout(() => finish(), timeoutMs);

    webContents.once("did-stop-loading", onStop);
    webContents.once("did-fail-load", onFail);
  });
};

class BrowserUseService {
  private session: BrowserSession | null = null;

  private clearSession(): void {
    this.session = null;
  }

  private ensureSession(): BrowserSession {
    if (!this.session) {
      throw new Error("Browser is not open. Call BrowserOpen first.");
    }
    const session = this.session;
    if (session.window.isDestroyed() || session.view.webContents.isDestroyed()) {
      this.clearSession();
      createError("Browser window was closed. Call BrowserOpen again.");
    }
    return session;
  }

  private getOrCreateSession(): { session: BrowserSession; created: boolean } {
    if (this.session) {
      if (
        this.session.window.isDestroyed() ||
        this.session.view.webContents.isDestroyed()
      ) {
        this.clearSession();
      } else {
        return { session: this.session, created: false };
      }
    }

    const window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: "Browser Use",
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: BROWSER_USE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const view = new BrowserView({
      webPreferences: {
        partition: BROWSER_USE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    window.setBrowserView(view);
    view.setAutoResize({ width: true, height: true });

    const resize = (): void => {
      const bounds = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    };
    resize();
    window.on("resize", resize);
    window.on("closed", () => {
      this.clearSession();
    });

    this.session = { window, view };
    return { session: this.session, created: true };
  }

  private getPageInfo(session: BrowserSession): BrowserPageInfo {
    const webContents = session.view.webContents;
    return {
      url: webContents.getURL() || "",
      title: webContents.getTitle() || "",
    };
  }

  async open(rawUrl: string): Promise<BrowserPageInfo> {
    const { session } = this.getOrCreateSession();
    const url = normalizeUrl(rawUrl);
    await session.view.webContents.loadURL(url);
    await waitForLoad(session);
    return this.getPageInfo(session);
  }

  async click(selector: string): Promise<BrowserPageInfo & { clickedTag: string }> {
    const session = this.ensureSession();
    const payload = JSON.stringify({ selector });
    const result = (await session.view.webContents.executeJavaScript(
      `
      (() => {
        const { selector } = ${payload};
        const target = document.querySelector(selector);
        if (!target) {
          return { ok: false, error: 'Selector not found: ' + selector };
        }
        if (!(target instanceof Element)) {
          return { ok: false, error: 'Target is not an Element: ' + selector };
        }
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        if (target instanceof HTMLElement) {
          target.focus({ preventScroll: true });
          target.click();
        } else {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
        return { ok: true, tag: target.tagName.toLowerCase() };
      })();
      `,
      true,
    )) as { ok: boolean; error?: string; tag?: string };

    if (!result.ok) {
      createError(result.error ?? "click failed");
    }
    await waitForLoad(session, 8_000);
    return {
      ...this.getPageInfo(session),
      clickedTag: result.tag ?? "",
    };
  }

  async type(
    selector: string,
    text: string,
    pressEnter: boolean,
  ): Promise<BrowserPageInfo & { typedLength: number; submitted: boolean }> {
    const session = this.ensureSession();
    const payload = JSON.stringify({ selector, text, pressEnter });
    const result = (await session.view.webContents.executeJavaScript(
      `
      (() => {
        const { selector, text, pressEnter } = ${payload};
        const target = document.querySelector(selector);
        if (!target) {
          return { ok: false, error: 'Selector not found: ' + selector };
        }
        if (!(target instanceof HTMLElement)) {
          return { ok: false, error: 'Target is not editable: ' + selector };
        }

        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        target.focus({ preventScroll: true });

        const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
        const isEditable = isInput || target.isContentEditable;
        if (!isEditable) {
          return { ok: false, error: 'Element is not an input/textarea/contenteditable: ' + selector };
        }

        if (isInput) {
          const proto = Object.getPrototypeOf(target);
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) {
            descriptor.set.call(target, text);
          } else {
            target.value = text;
          }
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          target.textContent = text;
          target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        }

        let submitted = false;
        if (pressEnter) {
          const keydown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
          const keypress = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
          const keyup = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
          target.dispatchEvent(keydown);
          target.dispatchEvent(keypress);
          target.dispatchEvent(keyup);

          const form = (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
            ? target.form ?? target.closest('form')
            : target.closest('form');
          if (form && form instanceof HTMLFormElement) {
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit();
            } else {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
            submitted = true;
          }
        }

        return { ok: true, submitted };
      })();
      `,
      true,
    )) as { ok: boolean; error?: string; submitted?: boolean };

    if (!result.ok) {
      createError(result.error ?? "type failed");
    }
    await waitForLoad(session, 8_000);
    return {
      ...this.getPageInfo(session),
      typedLength: text.length,
      submitted: Boolean(result.submitted),
    };
  }

  async screenshot(projectCwd: string): Promise<BrowserScreenshotResult> {
    const session = this.ensureSession();
    const image = await session.view.webContents.capturePage();
    const png = image.toPNG();

    const outputDir = path.resolve(projectCwd, ".tmp", "browser-use");
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const savedPath = path.resolve(outputDir, filename);
    await fs.writeFile(savedPath, png);

    const pageInfo = this.getPageInfo(session);
    return {
      ...pageInfo,
      savedPath,
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }

  async read(): Promise<BrowserReadResult> {
    const session = this.ensureSession();
    const result = (await session.view.webContents.executeJavaScript(
      `
      (() => {
        const normalize = (value) =>
          String(value ?? '')
            .replace(/\\r\\n/g, '\\n')
            .replace(/[ \\t]+\\n/g, '\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
        const root = document.querySelector('main,article,[role="main"]') ?? document.body;
        const headings = Array.from(root.querySelectorAll('h1,h2,h3'))
          .slice(0, 40)
          .map((el) => ({
            level: Number(el.tagName.replace('H', '')) || 0,
            text: normalize(el.textContent).slice(0, 240),
          }))
          .filter((item) => item.text.length > 0);
        const links = Array.from(root.querySelectorAll('a[href]'))
          .slice(0, 40)
          .map((el) => ({
            text: normalize(el.textContent).slice(0, 180),
            href: el.href ?? '',
          }))
          .filter((item) => item.href.length > 0);
        return {
          title: document.title ?? '',
          url: location.href ?? '',
          text: normalize(root?.innerText ?? document.body?.innerText ?? ''),
          headings,
          links,
        };
      })();
      `,
      true,
    )) as BrowserReadResult;

    return {
      url: result.url ?? session.view.webContents.getURL(),
      title: result.title ?? session.view.webContents.getTitle(),
      text: result.text ?? "",
      headings: Array.isArray(result.headings) ? result.headings : [],
      links: Array.isArray(result.links) ? result.links : [],
    };
  }

  async readDom(limit?: number): Promise<BrowserPageInfo & { elements: BrowserDomElement[] }> {
    const session = this.ensureSession();
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 120, MAX_DOM_ELEMENTS));

    const payload = JSON.stringify({ normalizedLimit });
    const result = (await session.view.webContents.executeJavaScript(
      `
      (() => {
        const { normalizedLimit } = ${payload};
        const cssEscape = (value) => {
          if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(value));
          }
          return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
        };
        const quoteAttr = (value) =>
          String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
        const isVisible = (element) => {
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const buildSelector = (element) => {
          const tag = element.tagName.toLowerCase();
          if (element.id) return '#' + cssEscape(element.id);

          const testId = element.getAttribute('data-testid');
          if (testId) return tag + '[data-testid="' + quoteAttr(testId) + '"]';

          const name = element.getAttribute('name');
          if (name) return tag + '[name="' + quoteAttr(name) + '"]';

          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) return tag + '[aria-label="' + quoteAttr(ariaLabel) + '"]';

          const classes = Array.from(element.classList).filter(Boolean).slice(0, 3);
          if (classes.length > 0) {
            return tag + classes.map((item) => '.' + cssEscape(item)).join('');
          }

          const parent = element.parentElement;
          if (!parent) return tag;
          const siblings = Array.from(parent.children).filter((item) => item.tagName === element.tagName);
          const index = siblings.indexOf(element) + 1;
          return tag + ':nth-of-type(' + index + ')';
        };

        const candidates = Array.from(
          document.querySelectorAll(
            'a,button,input,select,textarea,summary,[role="button"],[role="link"],[role="textbox"],[onclick],[tabindex]'
          )
        );
        const elements = [];
        const seen = new Set();
        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement)) continue;
          if (!isVisible(candidate)) continue;

          const selector = buildSelector(candidate);
          if (!selector || seen.has(selector)) continue;
          seen.add(selector);

          elements.push({
            selector,
            tag: candidate.tagName.toLowerCase(),
            type: candidate.getAttribute('type') ?? '',
            text: (candidate.innerText || candidate.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
            id: candidate.id ?? '',
            name: candidate.getAttribute('name') ?? '',
            href: candidate instanceof HTMLAnchorElement ? candidate.href : '',
            placeholder: candidate.getAttribute('placeholder') ?? '',
            role: candidate.getAttribute('role') ?? '',
            ariaLabel: candidate.getAttribute('aria-label') ?? '',
            disabled:
              candidate instanceof HTMLInputElement ||
              candidate instanceof HTMLButtonElement ||
              candidate instanceof HTMLSelectElement ||
              candidate instanceof HTMLTextAreaElement
                ? candidate.disabled
                : false,
          });

          if (elements.length >= normalizedLimit) break;
        }

        return {
          title: document.title ?? '',
          url: location.href ?? '',
          elements,
        };
      })();
      `,
      true,
    )) as BrowserPageInfo & { elements: BrowserDomElement[] };

    return {
      url: result.url ?? session.view.webContents.getURL(),
      title: result.title ?? session.view.webContents.getTitle(),
      elements: Array.isArray(result.elements) ? result.elements : [],
    };
  }

  async back(): Promise<BrowserPageInfo & { changed: boolean }> {
    const session = this.ensureSession();
    const webContents = session.view.webContents;
    const changed = webContents.navigationHistory.canGoBack();
    if (changed) {
      webContents.navigationHistory.goBack();
      await waitForLoad(session);
    }
    return { ...this.getPageInfo(session), changed };
  }

  async forward(): Promise<BrowserPageInfo & { changed: boolean }> {
    const session = this.ensureSession();
    const webContents = session.view.webContents;
    const changed = webContents.navigationHistory.canGoForward();
    if (changed) {
      webContents.navigationHistory.goForward();
      await waitForLoad(session);
    }
    return { ...this.getPageInfo(session), changed };
  }

  async reload(): Promise<BrowserPageInfo> {
    const session = this.ensureSession();
    session.view.webContents.reload();
    await waitForLoad(session);
    return this.getPageInfo(session);
  }

  async eval(code: string): Promise<string> {
    const session = this.ensureSession();
    const value = await session.view.webContents.executeJavaScript(code, true);
    if (typeof value === "string") {
      return value;
    }
    if (value === undefined) {
      return "undefined";
    }
    if (value === null) {
      return "null";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return safeJsonStringify(value);
  }

  async close(): Promise<boolean> {
    if (!this.session) {
      return false;
    }
    const { window } = this.session;
    this.clearSession();
    if (!window.isDestroyed()) {
      window.close();
      return true;
    }
    return false;
  }
}

export const browserUseService = new BrowserUseService();
