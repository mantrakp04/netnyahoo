import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** Options for {@link WebviewTag.findInPage}. */
export interface FindInPageOptions {
  forward?: boolean;
  findNext?: boolean;
  matchCase?: boolean;
}

/** Payload of the webview's `found-in-page` event. */
export interface FoundInPageResult {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

/** Minimal subset of Electron's <webview> tag API that we use. */
export interface WebviewTag extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  openDevTools(): void;
  print(): Promise<void>;
  findInPage(text: string, options?: FindInPageOptions): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
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
