import { showMenu, Symbol } from "@netnyahoo/shell";
import { SyncNative, type FolderInfo } from "@netnyahoo/sync";
import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import {
  addRemoteProfile,
  chooseSyncFolder,
  DATA_TYPES,
  folderInfo,
  setProfileSynced,
  setTypeSynced,
  syncNow,
  turnOnSync,
  useSync,
  type SyncStatus,
} from "../../../sync/engine";
import { ProfileBadge } from "../../profiles/icons";
import { Button, Group, Row, SectionHeader, Toggle, useFormColors } from "../controls";
import { folderLabel, showConnectDevice, showPhraseEntry, showRecoveryKit, showStopSync } from "./SyncSheets";

/**
 * Settings › Sync (Dia keeps it as the Sync section of Settings › Account; there's no account
 * here). Off: turn it on, or enter the phrase of another device, and pick the folder. On: the
 * status line in Dia's words, Connect Another Device…, Advanced… (Recovery Kit, Stop Syncing…),
 * which profiles and what data sync, and the devices.
 */
export function SyncPane() {
  const theme = useTheme();
  const enabled = useSync((s) => s.enabled);
  const status = useSync((s) => s.status);
  const folder = useSync((s) => s.folder);
  const [info, setInfo] = useState<FolderInfo | null>(null);
  useEffect(() => {
    let live = true;
    void folderInfo(folder).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [folder, enabled, status]);

  if (status === "unavailable") {
    return <Text style={{ marginTop: 20, fontSize: 12.5, color: theme.textSecondary }}>Sync isn’t available in this build.</Text>;
  }
  return (
    <View>
      <Text style={{ marginTop: 20, fontSize: 12.5, lineHeight: 17, color: theme.textSecondary }}>
        Sync your profiles, bookmarks, history, open tabs, pinned tabs, groups, passwords and settings across your Macs. It all goes through a folder
        you choose, like one in iCloud Drive, and it’s end-to-end encrypted: only your devices can read it.
      </Text>
      {enabled ? <SyncOn info={info} /> : <SyncOff info={info} />}
    </View>
  );
}

function SyncIcon({ on }: { on: boolean }) {
  const colors = useFormColors();
  const theme = useTheme();
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: on ? colors.accent : colors.control, borderWidth: on ? 0 : 1, borderColor: colors.controlBorder }}>
      <Symbol name="arrow.triangle.2.circlepath" size={13} weight="semibold" color={on ? "#FFFFFF" : theme.icon} style={{ width: 28, height: 28 }} />
    </View>
  );
}

// MARK: Off

function SyncOff({ info }: { info: FolderInfo | null }) {
  const theme = useTheme();
  const colors = useFormColors();
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const noICloud = !!info && info.path === info.defaultPath && !info.iCloudAvailable;
  const hasData = !!info?.hasSyncData;

  const turnOn = async () => {
    if (!info) return;
    setBusy(true);
    setFailure(null);
    const result = await turnOnSync(info.path);
    setBusy(false);
    if ("error" in result) setFailure(result.error);
    else showRecoveryKit();
  };
  const enterPhrase = () => showPhraseEntry(info, () => void chooseSyncFolder().then(() => folderInfo().then((i) => showPhraseEntry(i))));
  const otherOptions = async () => {
    const choice = await showMenu([
      { id: "new", title: "Set Up Without Another Device", enabled: !noICloud },
      { id: "phrase", title: "Enter Recovery Phrase" },
    ]);
    if (choice === "new") void turnOn();
    else if (choice === "phrase") enterPhrase();
  };

  return (
    <>
      <Group style={{ marginTop: 18 }}>
        <Row
          icon={<SyncIcon on={false} />}
          title="Sync"
          description={
            status === "reset" && error
              ? error
              : hasData
                ? "This folder has synced data already. To sync with your other devices, enter the recovery phrase from one of them."
                : "Off"
          }
        >
          {hasData ? (
            <>
              <Button title="Other Options" onPress={() => void otherOptions()} />
              <Button title="Enter Recovery Phrase…" kind="primary" onPress={enterPhrase} />
            </>
          ) : (
            <>
              <Button title="Enter Recovery Phrase…" onPress={enterPhrase} disabled={noICloud} />
              <Button title={busy ? "Turning On…" : "Turn On Sync"} kind="primary" disabled={busy || noICloud || !info} onPress={() => void turnOn()} />
            </>
          )}
        </Row>
        <Row title="Sync folder" description={info ? folderLabel(info) : " "}>
          <Button title="Choose…" onPress={() => void chooseSyncFolder()} />
        </Row>
        {noICloud ? (
          <Row
            icon={<Symbol name="exclamationmark.icloud" size={14} color="#FF9500" style={{ width: 28, height: 20 }} />}
            title="iCloud Drive is off on this Mac"
            description="Turn on iCloud Drive in System Settings, or choose another folder that syncs between your Macs, like one in Dropbox, on a NAS or on a USB drive."
          >
            <Button title="Open iCloud Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preferences.AppleIDPrefPane")} />
          </Row>
        ) : null}
      </Group>
      {failure ? <Text style={{ marginTop: 8, fontSize: 12, color: colors.destructive }}>{failure}</Text> : null}
      <Text style={{ marginTop: 12, fontSize: 11.5, lineHeight: 15, color: theme.textTertiary }}>
        No server and no account: your Macs meet in the sync folder. Your recovery phrase never leaves your devices, and without it the folder is
        unreadable, file names included.
      </Text>
    </>
  );
}

// MARK: On

function statusLine(status: SyncStatus, lastSyncedAt: number | null, pending: number): string {
  const since = lastSyncedAt ? ago(lastSyncedAt) : null;
  const line = (() => {
    switch (status) {
      case "starting":
        return "starting up";
      case "updating":
        return "updating";
      case "offline":
        return "offline";
      case "stalled":
      case "locked":
        return since ? `not syncing · last synced ${since}` : "not syncing";
      default:
        return since && since !== "just now" ? `updated ${since}` : "updated just now";
    }
  })();
  return pending ? `${line} · waiting for ${pending === 1 ? "1 file" : `${pending} files`} to download` : line;
}

function SyncOn({ info }: { info: FolderInfo | null }) {
  const theme = useTheme();
  const colors = useFormColors();
  const status = useSync((s) => s.status);
  const lastSyncedAt = useSync((s) => s.lastSyncedAt);
  const pending = useSync((s) => s.pending);
  const error = useSync((s) => s.error);
  const types = useSync((s) => s.types);
  const links = useSync((s) => s.profiles);
  const devices = useSync((s) => s.devices);
  const remoteProfiles = useSync((s) => s.remoteProfiles);
  const profiles = useProfiles();
  const allProfiles = useBrowser((s) => s.profiles);
  // Re-render each minute so "last synced 3 minutes ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const advanced = async () => {
    const choice = await showMenu([
      { id: "kit", title: "Save Recovery Kit…", symbol: "arrow.down.doc" },
      { id: "copy", title: "Copy Recovery Code", symbol: "doc.on.doc" },
      { separator: true },
      { id: "now", title: "Sync Now", symbol: "arrow.triangle.2.circlepath" },
      { id: "reveal", title: "Show Sync Folder in Finder", symbol: "folder", enabled: !!info?.exists },
      { separator: true },
      { id: "stop", title: "Stop Syncing…", symbol: "xmark.circle" },
    ]);
    if (choice === "kit") showRecoveryKit();
    else if (choice === "copy") await SyncNative?.copyRecoveryPhrase();
    else if (choice === "now") await syncNow();
    else if (choice === "reveal" && info) await SyncNative?.revealFolder(info.path);
    else if (choice === "stop") showStopSync();
  };

  const locked = status === "locked";
  return (
    <>
      <Group style={{ marginTop: 18 }}>
        <Row icon={<SyncIcon on={!locked} />} title="Sync" description={statusLine(status, lastSyncedAt, pending)}>
          {locked ? (
            <Button title="Enter Recovery Phrase…" kind="primary" onPress={() => showPhraseEntry(info)} />
          ) : (
            <Button title="Connect Another Device…" onPress={showConnectDevice} />
          )}
          <Button title="Advanced…" onPress={() => void advanced()} />
        </Row>
        <Row title="Sync folder" description={info ? folderLabel(info) : " "} />
      </Group>
      {error && status !== "updated" ? (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, paddingHorizontal: 2 }}>
          <Symbol name="exclamationmark.circle.fill" size={11} color={colors.destructive} style={{ width: 14, height: 15 }} />
          <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 15, color: theme.textSecondary }}>{error}</Text>
        </View>
      ) : null}

      <SectionHeader title="Profiles" description="Choose which profiles sync on this Mac. Each syncs on its own." />
      <Group>
        {profiles.map((p) => {
          const link = links[p.id];
          const owner = p.dataId ? allProfiles[p.dataId] : undefined;
          return (
            <Row
              key={p.id}
              icon={<ProfileBadge profile={p} size={24} />}
              title={p.name}
              description={owner ? `Shares data with ${owner.name}: its tabs sync here, its data syncs with ${owner.name}.` : undefined}
            >
              <Toggle value={!!link?.enabled} disabled={!link} onChange={(on) => setProfileSynced(p.id, on)} />
            </Row>
          );
        })}
        {remoteProfiles.map((p) => (
          <Row key={p.syncId} icon={<ProfileBadge profile={{ name: p.name, color: p.color, icon: p.icon }} size={24} />} title={p.name} description="On your other devices">
            <Button title="Add to This Mac" onPress={() => addRemoteProfile(p.syncId)} />
          </Row>
        ))}
      </Group>

      <SectionHeader title="What Syncs" />
      <Group>
        {DATA_TYPES.map((t) => (
          <Row key={t.id} title={t.title} description={t.description}>
            <Toggle value={types[t.id]} onChange={(on) => setTypeSynced(t.id, on)} />
          </Row>
        ))}
      </Group>

      <SectionHeader title="Devices" />
      <Group>
        {devices.length ? (
          devices.map((d) => (
            <Row
              key={d.id}
              icon={<Symbol name="laptopcomputer" size={15} color={theme.icon} style={{ width: 24, height: 20 }} />}
              title={d.current ? `${d.name} (This Mac)` : d.name}
              description={d.current ? statusLine(status, lastSyncedAt, 0) : d.lastSeen ? `last synced ${ago(d.lastSeen)}` : "hasn’t synced yet"}
            />
          ))
        ) : (
          <Row title="Just this Mac so far" description="Other devices show here once they sync." />
        )}
      </Group>
    </>
  );
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "12 days ago". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
