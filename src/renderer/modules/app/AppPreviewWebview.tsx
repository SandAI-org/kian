import { useEffect, useRef } from "react";

const APP_PREVIEW_PARTITION = "kian-app-preview";

const applyPreviewIframeStyles = (frame: HTMLIFrameElement): void => {
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.minHeight = "100%";
  frame.style.flex = "1 1 100%";
  frame.style.border = "0";
};

interface AppPreviewWebviewProps {
  previewUrl: string;
  className?: string;
}

export const AppPreviewWebview = ({
  previewUrl,
  className = "relative h-full w-full overflow-hidden",
}: AppPreviewWebviewProps) => {
  const previewHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;

    host.replaceChildren();

    if (!previewUrl) return;

    const webview = document.createElement("webview");
    webview.setAttribute("src", previewUrl);
    webview.setAttribute("partition", APP_PREVIEW_PARTITION);
    webview.setAttribute("allowpopups", "true");
    webview.className = "block";
    webview.style.position = "absolute";
    webview.style.inset = "0";
    webview.style.display = "block";
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";

    const syncInternalIframeLayout = () => {
      const internalFrame = webview.shadowRoot?.querySelector("iframe");
      if (!(internalFrame instanceof HTMLIFrameElement)) return;
      applyPreviewIframeStyles(internalFrame);
    };

    webview.addEventListener("dom-ready", syncInternalIframeLayout);
    host.appendChild(webview);
    const frameId = requestAnimationFrame(syncInternalIframeLayout);

    return () => {
      webview.removeEventListener("dom-ready", syncInternalIframeLayout);
      cancelAnimationFrame(frameId);
      if (webview.parentElement === host) {
        host.removeChild(webview);
      }
    };
  }, [previewUrl]);

  return <div ref={previewHostRef} className={className} />;
};
