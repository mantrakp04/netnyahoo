import { reloadExtension, type InstalledExtension } from "@netnyahoo/cef";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile, resolveWindowId } from "../../../store/model";
import { InstallDialogHost } from "../../extensions/ExtensionOverlays";
import {
  addFromWebStore,
  configure,
  loadUnpacked,
  refreshExtensions,
  removeExtension,
  setEnabled,
  setPinned,
  useExtensionList,
} from "../../extensions/state";
import { Button, Group, PopUp, Row, SectionHeader, TextField, Toggle } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";
import { SETTINGS_WINDOW_ID } from "../windows";

type SiteAccess = "allSites" | "specificSites" | "onClick";
const SITE_ACCESS: { value: SiteAccess; title: string }[] = [
  { value: "allSites", title: "On all sites" },
  { value: "specificSites", title: "On specific sites" },
  { value: "onClick", title: "On click" },
];
const siteAccessOf = (ext: InstalledExtension): SiteAccess =>
  ext.siteAccess === "ON_CLICK" ? "onClick" : ext.siteAccess === "ON_SPECIFIC_SITES" ? "specificSites" : "allSites";

/**
 * Settings › Extensions (Extensions › Manage Extensions…): the profile's
 * extensions with on/off switches, details (permissions, site access, pinning,
 * incognito), removal, and adding from the Chrome Web Store or a folder.
 */
export function ExtensionsPane() {
  const theme = useTheme();
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => useBrowser.getState().settings.defaultProfileId);
  const profile = engineProfile(profileId);
  const list = useExtensionList(profile);
  const [detail, setDetail] = useState<string | null>(null);
  const [link, setLink] = useState("");
  useEffect(() => {
    void refreshExtensions(profile);
  }, [profile]);

  const showInstall = () =>
    showSettingsSheet(<InstallDialogHost windowId={SETTINGS_WINDOW_ID} onClosed={closeSettingsSheet} />);
  const addLink = () => {
    if (!link.trim()) return;
    void addFromWebStore(SETTINGS_WINDOW_ID, link.trim(), profile);
    showInstall();
    setLink("");
  };

  const selected = detail ? list.find((x) => x.id === detail) : undefined;
  if (selected) return <ExtensionDetails ext={selected} profile={profile} onBack={() => setDetail(null)} />;

  return (
    <View>
      <SectionHeader
        title="Extensions"
        description="Add features to Netnyahoo with extensions from the Chrome Web Store. Each profile has its own."
        action={
          profiles.length > 1 ? (
            <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
          ) : undefined
        }
      />
      {list.length ? (
        <Group>
          {list.map((ext) => (
            <Row
              key={ext.id}
              icon={<Image source={{ uri: ext.icon }} style={{ width: 24, height: 24, opacity: ext.enabled ? 1 : 0.5 }} />}
              title={
                <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textPrimary }}>
                  {ext.name}
                  <Text style={{ color: theme.textTertiary }}>{`  ${ext.version}${ext.fromWebStore ? "" : " · Developer"}`}</Text>
                </Text>
              }
              description={ext.errors.length && !ext.enabled ? ext.errors[0] : ext.description}
              onPress={() => setDetail(ext.id)}
            >
              <Toggle value={ext.enabled} onChange={(on) => void setEnabled(profile, ext.id, on)} />
            </Row>
          ))}
        </Group>
      ) : (
        <Group>
          <Row title="No extensions yet" description="Extensions you add appear here and in the Extensions menu." />
        </Group>
      )}

      <SectionHeader title="Add extensions" />
      <Group>
        <Row title="Chrome Web Store" description="Browse the store; its Add to Netnyahoo button installs here.">
          <Button
            title="Open Web Store"
            onPress={() => {
              const windowId = resolveWindowId(useBrowser.getState());
              if (windowId) useBrowser.getState().newTab(windowId, { url: "https://chromewebstore.google.com/category/extensions" });
            }}
          />
        </Row>
        <Row title="Add from a link" description="Paste a Chrome Web Store link or extension ID.">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextField value={link} onChangeText={setLink} placeholder="chromewebstore.google.com/detail/…" onSubmit={addLink} style={{ width: 210 }} />
            <Button title="Add" disabled={!link.trim()} onPress={addLink} />
          </View>
        </Row>
        <Row title="Load unpacked extension" description="For developers: load an extension folder with a manifest.json.">
          <Button
            title="Choose Folder…"
            onPress={() => {
              void loadUnpacked(SETTINGS_WINDOW_ID, profile);
              showInstall();
            }}
          />
        </Row>
      </Group>
    </View>
  );
}

function ExtensionDetails({ ext, profile, onBack }: { ext: InstalledExtension; profile: string; onBack: () => void }) {
  const theme = useTheme();
  const openTab = (url: string) => {
    const windowId = resolveWindowId(useBrowser.getState());
    if (windowId) useBrowser.getState().newTab(windowId, { url });
  };
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button title="All Extensions" icon="chevron.left" kind="plain" onPress={onBack} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 }}>
        <Image source={{ uri: ext.icon }} style={{ width: 48, height: 48 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary }}>{ext.name}</Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
            {`Version ${ext.version}${ext.fromWebStore ? " · Chrome Web Store" : " · Unpacked"}`}
          </Text>
        </View>
        <Toggle value={ext.enabled} onChange={(on) => void setEnabled(profile, ext.id, on)} />
      </View>
      {ext.description ? <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 12, lineHeight: 18 }}>{ext.description}</Text> : null}

      <SectionHeader title="Permissions" />
      <Group>
        {ext.permissions.length ? (
          ext.permissions.map((p) => <Row key={p} title={p} />)
        ) : (
          <Row title="This extension requires no special permissions." />
        )}
        {ext.siteAccess ? (
          <Row title="Site access" description="Which sites the extension can read and change.">
            <PopUp value={siteAccessOf(ext)} options={SITE_ACCESS} onChange={(siteAccess) => void configure(profile, ext.id, { siteAccess })} />
          </Row>
        ) : null}
      </Group>

      <SectionHeader title="Settings" />
      <Group>
        <Row title="Pin to toolbar" description="Show its button next to the address.">
          <Toggle value={ext.pinned} onChange={(pinned) => void setPinned(profile, ext.id, pinned)} />
        </Row>
        <Row title="Allow in Incognito" description="Incognito can't stop extensions from recording your browsing.">
          <Toggle value={ext.incognito} onChange={(incognito) => void configure(profile, ext.id, { incognito })} />
        </Row>
        {ext.optionsUrl ? (
          <Row title="Extension options">
            <Button title="Open" onPress={() => openTab(ext.optionsUrl!)} />
          </Row>
        ) : null}
        {ext.webStoreUrl ? (
          <Row title="View in Chrome Web Store">
            <Button title="Open" onPress={() => openTab(ext.webStoreUrl!)} />
          </Row>
        ) : null}
        {!ext.fromWebStore ? (
          <Row title="Reload" description={ext.path ?? undefined}>
            <Button title="Reload" onPress={() => void reloadExtension(ext.id, profile).finally(() => refreshExtensions(profile))} />
          </Row>
        ) : null}
        {ext.errors.length ? <Row title="Errors" description={ext.errors.slice(0, 5).join("\n")} /> : null}
        <Row title={<Text style={{ fontSize: 13, color: theme.textTertiary }}>{`ID ${ext.id}`}</Text>} />
      </Group>

      <View style={{ alignItems: "flex-start", marginTop: 18 }}>
        <Button
          title="Remove Extension…"
          kind="destructive"
          disabled={!ext.mayModify}
          onPress={() => void removeExtension(profile, ext, SETTINGS_WINDOW_ID)}
        />
      </View>
    </View>
  );
}
