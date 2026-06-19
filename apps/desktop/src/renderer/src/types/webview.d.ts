import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** Minimal subset of Electron's <webview> tag API that we use. */
export interface WebviewTag extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  openDevTools(): void;
}

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: DetailedHTMLProps<
          HTMLAttributes<HTMLElement> & {
            src?: string;
            partition?: string;
            allowpopups?: boolean | string;
            useragent?: string;
          },
          HTMLElement
        >;
      }
    }
  }
}
