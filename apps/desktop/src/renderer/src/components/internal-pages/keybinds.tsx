import {
  ArrowLeftRight,
  FileText,
  Keyboard,
  PanelLeft,
  Rows3,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { InternalPageFrame } from "./frame";

interface ShortcutGroup {
  title: string;
  icon: ReactNode;
  shortcuts: Shortcut[];
}

interface Shortcut {
  action: string;
  keys: string[][];
  detail?: string;
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Tabs",
    icon: <Rows3 className="size-4" />,
    shortcuts: [
      { action: "New tab", keys: [["mod", "T"]] },
      { action: "Close tab", keys: [["mod", "W"]] },
      { action: "Reopen closed tab", keys: [["shift", "mod", "T"]] },
      {
        action: "Select tab",
        keys: [["mod", "1"], ["mod", "2"], ["mod", "..."], ["mod", "8"]],
        detail: "Jump to tabs 1 through 8",
      },
      { action: "Select last tab", keys: [["mod", "9"]] },
      {
        action: "Next tab",
        keys: [["shift", "mod", "]"], ["ctrl", "tab"]],
        detail: "On macOS, also Cmd Opt Right",
      },
      {
        action: "Previous tab",
        keys: [["shift", "mod", "["], ["ctrl", "shift", "tab"]],
        detail: "On macOS, also Cmd Opt Left",
      },
    ],
  },
  {
    title: "Navigation",
    icon: <ArrowLeftRight className="size-4" />,
    shortcuts: [
      { action: "Back", keys: [["mod", "["], ["mod", "left"]] },
      { action: "Forward", keys: [["mod", "]"], ["mod", "right"]] },
      { action: "Reload", keys: [["mod", "R"]] },
      { action: "Force reload", keys: [["shift", "mod", "R"]] },
      { action: "Stop loading", keys: [["esc"]] },
    ],
  },
  {
    title: "Page",
    icon: <FileText className="size-4" />,
    shortcuts: [
      { action: "Find in page", keys: [["mod", "F"]] },
      { action: "Find next", keys: [["mod", "G"]] },
      { action: "Find previous", keys: [["shift", "mod", "G"]] },
      { action: "Print", keys: [["mod", "P"]] },
      { action: "Save page", keys: [["mod", "S"]] },
      { action: "Open file", keys: [["mod", "O"]] },
      { action: "View source", keys: [["alt", "mod", "U"]] },
    ],
  },
  {
    title: "Address Bar",
    icon: <Search className="size-4" />,
    shortcuts: [
      { action: "Focus address bar", keys: [["mod", "L"]] },
      { action: "Open result", keys: [["return"]] },
      { action: "Open result in new tab", keys: [["shift", "return"]] },
    ],
  },
  {
    title: "Chrome",
    icon: <PanelLeft className="size-4" />,
    shortcuts: [
      { action: "Toggle sidebar", keys: [["mod", "B"]] },
      { action: "Show keybinds", keys: [["mod", "/"]] },
    ],
  },
];

export function KeybindsInternalPage() {
  const modKey = getModKeyLabel();

  return (
    <InternalPageFrame icon={<Keyboard className="size-5" />} title="Keybinds">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5">
        <section className="grid gap-3 sm:grid-cols-2">
          {shortcutGroups.map((group) => (
            <div
              key={group.title}
              className="bg-background/70 overflow-hidden rounded-lg border shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_4%,transparent)]"
            >
              <div className="flex h-11 items-center gap-2 border-b px-3.5">
                <span className="text-muted-foreground">{group.icon}</span>
                <h2 className="text-sm font-semibold">{group.title}</h2>
              </div>
              <ul className="divide-border/70 divide-y">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.action}
                    className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {shortcut.action}
                      </div>
                      {shortcut.detail && (
                        <div className="text-muted-foreground truncate text-xs">
                          {shortcut.detail}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {shortcut.keys.map((keys) => (
                        <ShortcutChord
                          key={keys.join("+")}
                          keys={keys}
                          modKey={modKey}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </InternalPageFrame>
  );
}

function ShortcutChord({ keys, modKey }: { keys: string[]; modKey: string }) {
  return (
    <span className="flex items-center gap-1" aria-label={formatKeys(keys, modKey)}>
      {keys.map((key) => (
        <KeyCap key={key}>{getKeyLabel(key, modKey)}</KeyCap>
      ))}
    </span>
  );
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[0.68rem] font-semibold shadow-[inset_0_1px_0_color-mix(in_oklch,var(--background)_82%,transparent),0_1px_1px_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
      {children}
    </kbd>
  );
}

function getKeyLabel(key: string, modKey: string) {
  switch (key) {
    case "mod":
      return modKey;
    case "shift":
      return "Shift";
    case "alt":
      return isMac() ? "Opt" : "Alt";
    case "ctrl":
      return "Ctrl";
    case "tab":
      return "Tab";
    case "esc":
      return "Esc";
    case "left":
      return "Left";
    case "right":
      return "Right";
    case "return":
      return "Return";
    default:
      return key;
  }
}

function formatKeys(keys: string[], modKey: string) {
  return keys.map((key) => getKeyLabel(key, modKey)).join(" ");
}

function getModKeyLabel() {
  return isMac() ? "Cmd" : "Ctrl";
}

function isMac() {
  return /mac|iphone|ipad|ipod/i.test(window.navigator.platform);
}
