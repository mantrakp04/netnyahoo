import { engineHost, type SearchEngine } from "@netnyahoo/core";
import { Symbol } from "@netnyahoo/shell";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { controllingSearchExtension, defaultSearchEngine, searchEngines } from "../../../store/settings";
import { setEnabled } from "../../extensions/state";
import { Favicon, IconButton } from "../../primitives";
import { Button, Group, Row, SectionHeader, Sheet, TextField, Toggle, useFormColors } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";
import { openSettings } from "../windows";

/**
 * Default search engine (built-ins, custom engines with Tab-to-search shortcuts, and the ones
 * extensions add). Like Chrome, an extension that made itself the default controls the choice
 * until it's disabled.
 */
export function SearchPane() {
  const settings = useBrowser((s) => s.settings);
  const colors = useFormColors();
  const engines = searchEngines(settings);
  const builtIn = engines.filter((e) => !e.custom && !e.extension);
  const custom = engines.filter((e) => e.custom);
  const fromExtensions = engines.filter((e) => e.extension);
  const selectedId = defaultSearchEngine(settings).id;
  const controlling = controllingSearchExtension(settings);
  const locked = !!controlling;

  return (
    <View>
      <SectionHeader title="Default search engine" description="Used by the command bar and the New Tab page." />
      <Group>
        {controlling && (
          <Row
            icon={<Symbol name="puzzlepiece.extension" size={13} color={colors.accent} style={{ width: 18, height: 18 }} />}
            title={`${controlling.extensionName || "An extension"} is controlling this setting`}
            description="To change your default search engine, disable the extension or manage its settings."
          >
            <Button title="Manage" onPress={() => openSettings("extensions")} />
            <Button title="Disable" onPress={() => void setEnabled(controlling.profile, controlling.extensionId, false)} />
          </Row>
        )}
        {builtIn.map((e) => (
          <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} />
        ))}
      </Group>

      <SectionHeader
        title="Other search engines"
        description="Type a shortcut and press Tab in the command bar to search a site directly."
        action={<Button title="Add…" icon="plus" onPress={() => showSettingsSheet(<EngineSheet />)} />}
      />
      <Group>
        {custom.length === 0 ? (
          <Row title="No custom search engines" description="Add one with a URL where %s stands for the search terms." />
        ) : (
          custom.map((e) => <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} editable={e.id !== "custom"} />)
        )}
      </Group>

      {fromExtensions.length > 0 && (
        <>
          <SectionHeader title="Extensions" description="Some extensions can add search engines to Netnyahoo." />
          <Group>
            {fromExtensions.map((e) => (
              <EngineRow key={e.id} engine={e} selected={selectedId === e.id} locked={locked} />
            ))}
          </Group>
        </>
      )}

      <SectionHeader title="Suggestions" />
      <Group>
        <Row title="Show search suggestions" description="Sends what you type to your search engine to suggest searches.">
          <Toggle value={settings.searchSuggestions} onChange={(v) => useBrowser.getState().updateSettings({ searchSuggestions: v })} />
        </Row>
      </Group>
    </View>
  );
}

function EngineRow({ engine, selected, locked, editable }: { engine: SearchEngine; selected: boolean; locked: boolean; editable?: boolean }) {
  const theme = useTheme();
  const colors = useFormColors();
  const description = engine.extension
    ? `${engine.keyword ? `${engine.keyword} · ` : ""}Added by ${engine.extension.name || "an extension"}`
    : engine.custom
      ? `${engine.keyword} · ${engine.url}`
      : engine.keyword;
  return (
    <Row icon={<Favicon url={`https://${engineHost(engine)}`} />} title={engine.name} description={description}>
      {editable && (
        <IconButton icon="pencil" size={11} box={24} radius={6} onPress={() => showSettingsSheet(<EngineSheet engine={engine} />)} tooltip="Edit" />
      )}
      {selected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 92, justifyContent: "flex-end" }}>
          <Symbol name="checkmark" size={11} weight="semibold" color={colors.accent} style={{ width: 14, height: 14 }} />
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>Default</Text>
        </View>
      ) : (
        <Button title="Make Default" disabled={locked} onPress={() => useBrowser.getState().setSearchEngine(engine.id)} style={{ minWidth: 92 }} />
      )}
    </Row>
  );
}

/** Add / edit a custom engine (name, shortcut, URL with %s). */
function EngineSheet({ engine }: { engine?: SearchEngine }) {
  const theme = useTheme();
  const [name, setName] = useState(engine?.name ?? "");
  const [keyword, setKeyword] = useState(engine?.keyword ?? "");
  const [url, setUrl] = useState(engine?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const s = useBrowser.getState();
    const input = { name, keyword, url };
    let result: string | null;
    if (engine) result = s.updateCustomEngine(engine.id, input);
    else {
      const added = s.addCustomEngine(input);
      result = "error" in added ? added.error : null;
    }
    if (result) return setError(result);
    closeSettingsSheet();
  };
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 11.5, marginBottom: 5, color: theme.textSecondary }}>{label}</Text>
      <TextField value={value} onChangeText={set} placeholder={placeholder} onSubmit={save} onEscape={closeSettingsSheet} />
    </View>
  );
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{engine ? "Edit Search Engine" : "Add Search Engine"}</Text>
      {field("Name", name, setName, "Wikipedia")}
      {field("Shortcut", keyword, setKeyword, "w")}
      {field("URL with %s in place of the query", url, setUrl, "https://en.wikipedia.org/w/index.php?search=%s")}
      {error && <Text style={{ fontSize: 12, marginTop: 10, color: "#FF453A" }}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
        {engine && (
          <Button
            title="Delete"
            kind="destructive"
            onPress={() => {
              useBrowser.getState().removeCustomEngine(engine.id);
              closeSettingsSheet();
            }}
          />
        )}
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={engine ? "Save" : "Add"} kind="primary" onPress={save} />
      </View>
    </Sheet>
  );
}
