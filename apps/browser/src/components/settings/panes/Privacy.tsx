import {
  clearSiteData,
  getContentBlocker,
  getSiteSettings,
  getSiteSettingsOrigins,
  getZoomLevels,
  onContentBlockerChange,
  resetSiteSettings,
  setContentBlockerAllowed,
  setContentBlockerEnabled,
  setFilterListEnabled,
  setSiteSetting,
  setZoom,
  updateFilterLists,
  type ContentBlockerState,
  type FilterList,
  type FilterListCategory,
  type SiteSettings,
  type SiteSettingType,
  type SiteSettingValue,
} from "@netnyahoo/cef";
import { confirm } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile } from "../../../store/model";
import { Favicon } from "../../primitives";
import { Button, Checkbox, Group, PopUp, Row, SectionHeader, Sheet, Toggle } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

const CATEGORIES: { id: FilterListCategory; toggle: string; section: string }[] = [
  { id: "ads", toggle: "Block ads", section: "Ad blockers" },
  { id: "trackers", toggle: "Block trackers", section: "Trackers" },
  { id: "cookies", toggle: "Block cookie banners", section: "Cookie banners" },
  { id: "regional", toggle: "", section: "Regional blockers" },
];

function useContentBlocker() {
  const [state, setState] = useState<ContentBlockerState | null>(null);
  const refresh = () => void getContentBlocker().then(setState).catch(() => {});
  useEffect(() => {
    refresh();
    const sub = onContentBlockerChange(refresh);
    return () => sub.remove();
  }, []);
  return [state, refresh] as const;
}

const categoryOn = (s: ContentBlockerState, c: FilterListCategory) => s.enabled && s.lists.some((l) => l.category === c && l.enabled);

/** Turns a category's lists on (the bundled ones) or off, and the blocker with it. */
async function setCategory(s: ContentBlockerState, c: FilterListCategory, on: boolean) {
  const lists = s.lists.filter((l) => l.category === c);
  for (const l of on ? lists.filter((l) => l.bundled || l.enabled) : lists.filter((l) => l.enabled)) await setFilterListEnabled(l.id, on);
  const anyOn = CATEGORIES.some((x) => (x.id === c ? on : categoryOn(s, x.id)));
  if (anyOn !== s.enabled) await setContentBlockerEnabled(anyOn);
}

export function PrivacyPane() {
  const theme = useTheme();
  const [blocker, refresh] = useContentBlocker();

  const toggleCategory = async (c: FilterListCategory, on: boolean) => {
    if (!blocker) return;
    // Dia confirms before the ad blocker goes off.
    if (!on && c === "ads") {
      const { confirmed } = await confirm({
        title: "Turn Off Ad Blocker?",
        message: "Netnyahoo's Ad Blocker hides ads so pages load faster and feel cleaner.",
        confirmTitle: "Turn Off",
      });
      if (!confirmed) return;
    }
    await setCategory(blocker, c, on);
    refresh();
  };

  return (
    <View>
      <SectionHeader title="Content blocking" description="Built on EasyList and EasyPrivacy. Blocking happens on this Mac." />
      <Group>
        {CATEGORIES.filter((c) => c.toggle).map((c) => (
          <Row key={c.id} title={c.toggle}>
            <Toggle value={!!blocker && categoryOn(blocker, c.id)} disabled={!blocker} onChange={(v) => void toggleCategory(c.id, v)} />
          </Row>
        ))}
        <Row title="Advanced Settings" description="Block common components found across the web by using additional rules and filters.">
          <Button title="Advanced…" disabled={!blocker} onPress={() => showSettingsSheet(<FilterListsSheet />)} />
        </Row>
      </Group>

      {!!blocker?.allowedHosts.length && (
        <>
          <SectionHeader title="Sites without blocking" description="Turned off from a site's controls. Blocking applies to subdomains too." />
          <Group>
            {blocker.allowedHosts.map((host) => (
              <Row key={host} icon={<Favicon url={`https://${host}`} />} title={host}>
                <Button
                  title="Block Again"
                  onPress={() => void setContentBlockerAllowed(host, false).then(refresh)}
                />
              </Row>
            ))}
          </Group>
        </>
      )}

      <SitePermissions />
      <ZoomLevels />
      {blocker && (
        <Text style={{ marginTop: 14, fontSize: 11.5, color: theme.textTertiary }}>
          {`${(blocker.stats.networkFilters ?? 0).toLocaleString()} network and ${(blocker.stats.cosmeticFilters ?? 0).toLocaleString()} cosmetic rules loaded.`}
        </Text>
      )}
    </View>
  );
}

/** Dia's "Advanced Ad Block Settings" dialog: every list, by category. */
function FilterListsSheet() {
  const theme = useTheme();
  const [blocker, refresh] = useContentBlocker();
  const [updating, setUpdating] = useState<string | null>(null);
  const update = async () => {
    setUpdating("Updating…");
    const result = await updateFilterLists().catch(() => ({ updated: [], failed: ["all"] }));
    setUpdating(result.failed.length ? "Some lists couldn't be updated." : "Lists are up to date.");
    refresh();
  };
  const toggle = async (l: FilterList, on: boolean) => {
    await setFilterListEnabled(l.id, on);
    if (on && blocker && !blocker.enabled) await setContentBlockerEnabled(true);
    refresh();
  };
  return (
    <Sheet width={500} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Advanced Ad Block Settings</Text>
      <Text style={{ fontSize: 12, marginTop: 4, color: theme.textSecondary }}>Block common components found across the web by using additional rules and filters.</Text>
      <ScrollView style={{ maxHeight: 420, marginTop: 8 }}>
        {CATEGORIES.map((c) => {
          const lists = blocker?.lists.filter((l) => l.category === c.id) ?? [];
          if (!lists.length) return null;
          return (
            <View key={c.id}>
              <SectionHeader title={c.section} />
              <Group>
                {lists.map((l) => (
                  <Row
                    key={l.id}
                    title={<Checkbox value={l.enabled} onChange={(v) => void toggle(l, v)} label={l.title} />}
                    description={
                      l.enabled && l.rules
                        ? `${l.rules.toLocaleString()} rules${l.lastModified ? ` · updated ${l.lastModified}` : ""}`
                        : l.bundled
                          ? undefined
                          : "Downloaded when turned on"
                    }
                  />
                ))}
              </Group>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Button title="Update Lists" disabled={updating === "Updating…"} onPress={() => void update()} />
        <Text style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>{updating ?? ""}</Text>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </View>
    </Sheet>
  );
}

// MARK: Zoom levels

/** Sites with their own zoom (⌘+ / ⌘- remember it per site and profile). */
function ZoomLevels() {
  const profileId = useBrowser((s) => s.settings.defaultProfileId);
  const profiles = useProfiles();
  const [selected, setSelected] = useState(profileId);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const load = () => void getZoomLevels(engineProfile(selected)).then(setLevels).catch(() => {});
  useEffect(load, [selected]);
  const hosts = Object.keys(levels).sort();
  if (!hosts.length) return null;
  return (
    <>
      <SectionHeader
        title="Zoom levels"
        action={
          profiles.length > 1 ? <PopUp value={selected} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setSelected} /> : undefined
        }
      />
      <Group>
        {hosts.map((host) => (
          <Row key={host} icon={<Favicon url={`https://${host}`} />} title={host} description={`${Math.round(levels[host]! * 100)}%`}>
            <Button title="Reset" onPress={() => void setZoom(engineProfile(selected), host, 1).then(load)} />
          </Row>
        ))}
      </Group>
    </>
  );
}

// MARK: Site permissions

const SETTING_LABELS: [SiteSettingType, string][] = [
  ["popups", "Pop-ups and redirects"],
  ["camera", "Camera"],
  ["microphone", "Microphone"],
  ["location", "Location"],
  ["notifications", "Notifications"],
  ["sound", "Sound"],
  ["autoplay", "Autoplay"],
  ["javascript", "JavaScript"],
  ["images", "Images"],
  ["clipboard", "Clipboard"],
  ["automaticDownloads", "Automatic downloads"],
  ["cookies", "Cookies"],
  ["midi", "MIDI devices"],
  ["windowManagement", "Window management"],
  ["localFonts", "Fonts"],
  ["storageAccess", "Embedded content"],
  ["fileSystem", "File editing"],
];

const VALUE_OPTIONS: { value: SiteSettingValue; title: string }[] = [
  { value: "default", title: "Default" },
  { value: "allow", title: "Allow" },
  { value: "block", title: "Block" },
  { value: "ask", title: "Ask" },
];

function SitePermissions() {
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => useBrowser.getState().settings.defaultProfileId);
  const [origins, setOrigins] = useState<string[] | null>(null);
  const refresh = () => void getSiteSettingsOrigins(engineProfile(profileId)).then(setOrigins).catch(() => setOrigins([]));
  useEffect(refresh, [profileId]);

  return (
    <>
      <SectionHeader
        title="Site permissions"
        description="Pop-ups, camera, location and other permissions you've set for sites."
        action={
          profiles.length > 1 ? (
            <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
          ) : undefined
        }
      />
      <Group>
        {origins === null ? null : origins.length === 0 ? (
          <Row title="No sites yet" description="Sites appear here after you allow or block something for them." />
        ) : (
          origins.map((origin) => (
            <Row
              key={origin}
              icon={<Favicon url={origin} />}
              title={origin.replace(/^https?:\/\//, "")}
              onPress={() => showSettingsSheet(<SiteSheet profileId={profileId} origin={origin} onChanged={refresh} />)}
            />
          ))
        )}
      </Group>
    </>
  );
}

function SiteSheet({ profileId, origin, onChanged }: { profileId: string; origin: string; onChanged: () => void }) {
  const theme = useTheme();
  const profile = engineProfile(profileId);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [status, setStatus] = useState("");
  const load = () => void getSiteSettings(profile, origin).then(setSettings).catch(() => {});
  useEffect(load, []);
  const set = async (type: SiteSettingType, value: SiteSettingValue) => {
    await setSiteSetting(profile, origin, type, value);
    load();
    onChanged();
  };
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Favicon url={origin} size={20} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{origin.replace(/^https?:\/\//, "")}</Text>
      </View>
      <ScrollView style={{ maxHeight: 380, marginTop: 12 }}>
        <Group>
          {SETTING_LABELS.filter(([type]) => settings?.[type]).map(([type, label]) => (
            <Row key={type} title={label} description={settings![type].isDefault ? `Default (${settings![type].value})` : undefined}>
              <PopUp
                value={settings![type].isDefault ? "default" : settings![type].value}
                options={VALUE_OPTIONS}
                onChange={(v) => void set(type, v)}
                minWidth={100}
              />
            </Row>
          ))}
        </Group>
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
        <Button
          title="Reset Permissions"
          onPress={() =>
            void resetSiteSettings(profile, origin).then(() => {
              load();
              onChanged();
            })
          }
        />
        <Button
          title="Clear Site Data"
          onPress={() =>
            void clearSiteData(profile, origin).then((r) =>
              setStatus(r.cookies === false ? "Site data cleared." : `Cleared ${r.cookies} cookie${r.cookies === 1 ? "" : "s"} and site data.`),
            )
          }
        />
        <Text style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>{status}</Text>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </View>
    </Sheet>
  );
}
