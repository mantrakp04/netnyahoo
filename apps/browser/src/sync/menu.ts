import type { MenuItem } from "@netnyahoo/shell";
import { useBrowser } from "../store/browser";
import { useSync, type RemoteTabs } from "./engine";

/**
 * Synced devices' tabs in the tab overflow menu, as Dia's: one other device is "Your
 * <device> Tabs"; several roll up into "Your Devices", a submenu each. Each lists that
 * device's recent tabs under "Recent Tabs".
 */
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

/** "Mantra’s MacBook Pro" → "MacBook Pro" (Dia's title names the kind of device). */
export const deviceKind = (name: string) => name.split(/[’']s /).slice(1).join("'s ").trim() || name;

/** Opens a synced tab picked from that menu in a new tab; false if `choice` isn't one. */
export function openSyncedTab(choice: string, windowId: string, profileId: string): boolean {
  const match = /^synced:(.+):(\d+)$/.exec(choice);
  if (!match) return false;
  const device = useSync.getState().remoteTabs[profileId]?.find((d) => d.deviceId === match[1]);
  const tab = device?.tabs[Number(match[2])];
  if (tab) useBrowser.getState().newTab(windowId, { url: tab.url });
  return true;
}
