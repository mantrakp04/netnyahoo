import { engineInfo, listComponents, WIDEVINE_COMPONENT_ID, type EngineComponent, type EngineInfo } from "@netnyahoo/cef";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { openInternalPage } from "../../pages/urls";
import { Button, Group, Row, SectionHeader, Toggle } from "../controls";

export function AdvancedPane() {
  const theme = useTheme();
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [widevine, setWidevine] = useState<EngineComponent | null | undefined>(undefined);
  useEffect(() => {
    void engineInfo().then(setInfo).catch(() => {});
    void listComponents()
      .then((list) => setWidevine(list.find((c) => c.id === WIDEVINE_COMPONENT_ID) ?? null))
      .catch(() => setWidevine(null));
  }, []);
  // The CDM only arrives through Chrome's component updater, whose Google host this build's
  // domain substitution replaced, so it can't be downloaded (and "Check for Update" never
  // finished). Say so instead of offering it; a version shows if one is ever installed.
  const widevineVersion = widevine && widevine.version !== "0.0.0.0" ? widevine.version : null;

  return (
    <View>
      <SectionHeader title="Browsing" />
      <Group>
        <Row title="Show full URL in the address bar" description="Instead of the site and page title.">
          <Toggle value={settings.showFullUrl} onChange={(v) => update({ showFullUrl: v })} />
        </Row>
        <Row title="Warn before moving tabs between profiles" description="Some site data doesn't come along.">
          <Toggle value={settings.warnBeforeMovingTabsToProfile} onChange={(v) => update({ warnBeforeMovingTabsToProfile: v })} />
        </Row>
        <Row title="Show the Import bookmarks button" description="On an empty bookmarks bar.">
          <Toggle value={!settings.hideBookmarksBarImport} onChange={(v) => update({ hideBookmarksBarImport: !v })} />
        </Row>
      </Group>

      <SectionHeader title="Performance" />
      <Group>
        <Row title="Battery Saver" description="On battery or in Low Power Mode, pause background tabs that keep the processor busy.">
          <Toggle value={settings.batterySaver} onChange={(v) => update({ batterySaver: v })} />
        </Row>
      </Group>

      <SectionHeader title="Data" />
      <Group>
        <Row title="History" description="Every page you visited, by day.">
          <Button title="Show History" onPress={() => openInternalPage("history")} />
        </Row>
        <Row title="Downloads" description="Files you downloaded, with where they're saved.">
          <Button title="Show Downloads" onPress={() => openInternalPage("downloads")} />
        </Row>
      </Group>

      <SectionHeader title="Web engine" />
      <Group>
        <Row title="Chromium" description={info ? `CEF ${info.cefVersion}` : undefined}>
          <Text selectable style={{ fontSize: 13, color: theme.textSecondary }}>
            {info?.chromiumVersion ?? "…"}
          </Text>
        </Row>
        <Row
          title="Widevine (protected video)"
          description={
            widevine === undefined
              ? "Checking…"
              : widevineVersion
                ? `Version ${widevineVersion}`
                : "Not available in this build: video that needs it, like Netflix or Disney+, won't play."
          }
        />
      </Group>
    </View>
  );
}
