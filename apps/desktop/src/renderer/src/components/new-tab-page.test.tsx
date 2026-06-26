import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { NewTabPage } from "./new-tab-page";

const browser = vi.hoisted(() => ({
  navigate: vi.fn(),
  openTab: vi.fn(),
  newTabDrafts: {} as Record<string, string>,
  setNewTabDraft: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));

vi.mock("@/assets/logo-ai.png", () => ({
  default: "logo-ai.png",
}));

vi.mock("@/components/webgl-glow", () => ({
  WebglGlow: () => null,
}));

vi.mock("@/hooks/use-browser", () => ({
  useBrowser: () => browser,
}));

vi.mock("@/lib/trpc", () => ({
  useTRPC: () => ({
    bookmarks: {
      list: {
        queryOptions: () => ({}),
      },
    },
    history: {
      list: {
        queryOptions: () => ({}),
      },
    },
  }),
}));

describe("NewTabPage", () => {
  afterEach(() => {
    cleanup();
    browser.navigate.mockReset();
    browser.openTab.mockReset();
    browser.setNewTabDraft.mockReset();
    browser.newTabDrafts = {};
  });

  it("keeps the search input focused when the intro reveal finishes", async () => {
    browser.newTabDrafts = { "tab-1": "" };

    const { rerender } = render(
      <NewTabPage tabId="tab-1" reveal={true} onRevealComplete={vi.fn()} />,
    );

    const input = screen.getByLabelText("Search or enter a URL");
    await waitFor(() => expect(document.activeElement).toBe(input));

    rerender(
      <NewTabPage tabId="tab-1" reveal={false} onRevealComplete={vi.fn()} />,
    );

    const inputAfterReveal = screen.getByLabelText("Search or enter a URL");
    expect(inputAfterReveal).toBe(input);
    expect(document.activeElement).toBe(inputAfterReveal);
  });
});
