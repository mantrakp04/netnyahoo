# Netnyahoo for Raycast

Search your open Netnyahoo tabs from Raycast and switch to one, like Dia's Raycast extension.

**Search Tabs** lists every window's tabs (sidebar order, front window first), with the page's
favicon, its host, a pin for pinned tabs, "Current" for the tab the front window shows and the
window number when more than one is open. Type to filter by title or URL.

| Action | Shortcut |
|---|---|
| Switch to Tab (selects it, brings its window forward, activates Netnyahoo) | ↵ |
| Copy URL | ⇧⌘C |
| Close Tab | ⌃X |
| Reload Tabs | ⌘R |

It talks to Netnyahoo through its AppleScript dictionary (`Netnyahoo.sdef` in the app), so
Netnyahoo has to be running. The first time, macOS asks whether Raycast may control Netnyahoo
(System Settings › Privacy & Security › Automation); allow it.

## Install (development)

Needs [Raycast](https://raycast.com) and Node 22 or newer.

```bash
cd extras/raycast-netnyahoo
npm install
npm run dev     # ray develop: adds the extension to Raycast and rebuilds on save
```

Stop `npm run dev` when you're done: the extension stays in Raycast. `npm run build` checks that it
compiles, `npm run lint` runs Raycast's linter, and `npm test` checks the AppleScript it sends
and how it reads the answer.

## How it works

`src/scripts.ts` builds the AppleScript (no Raycast imports, so it can be tested on its own):

- the list reads `id`, `title`, `URL`, `isPinned` and `isFocused` of every tab of each window,
  one Apple event per property and window, joined with ASCII separators;
- Switch runs `focus (tab id "…" of window id "…")`, then `activate`;
- Close runs `close (tab id "…" of window id "…")`.

The scripts address the app by bundle id (`com.netnyahoo.browser`). They were checked against a
running Netnyahoo with the app's DEV AppleScript runner (`nn.shell.devRunAppleScript`, the
same text with `tell current application`), which avoids macOS's Automation prompt.
