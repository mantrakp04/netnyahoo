import type { MenuItem } from "@netnyahoo/shell";
import { useBrowser } from "../store/browser";
import { useSync, type RemoteTabs } from "./engine";

export function syncedDevicesMenuItem(profileId: string): MenuItem | null {
  const devices = useSync.getState().remoteTabs[profileId] ?? [];
  if (!devices.length) return null;
  const tabs = (d: RemoteTabs): MenuItem[] => [
    { id: "synced-header", title: "Recent Tabs", enabled: false },
    ...d.tabs.map((t, i) => ({ id: `synced:${d.deviceId}:${i}`, title: t.title || t.url })),
  ];
  if (devices.length === 1) {
    const d = devices[0]!;
    return { id: "synced", title: `Your ${deviceKind(d.name)} Tabs`, symbol: "macbook.and.iphone", children: tabs(d) };
  }
  return {
    id: "synced",
    title: "Your Devices",
    symbol: "macbook.and.iphone",
    children: devices.map((d) => ({ id: `device:${d.deviceId}`, title: d.name, symbol: "laptopcomputer", children: tabs(d) })),
  };
}

export const deviceKind = (name: string) => name.split(/[’']s /).slice(1).join("'s ").trim() || name;

export function openSyncedTab(choice: string, windowId: string, profileId: string): boolean {
  const match = /^synced:(.+):(\d+)$/.exec(choice);
  if (!match) return false;
  const device = useSync.getState().remoteTabs[profileId]?.find((d) => d.deviceId === match[1]);
  const tab = device?.tabs[Number(match[2])];
  if (tab) useBrowser.getState().newTab(windowId, { url: tab.url });
  return true;
}
