import { showMenu, Symbol } from "@netnyahoo/shell";
import { SyncNative, type FolderInfo } from "@netnyahoo/sync";
import { useEffect, useState, type ReactNode } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { enterRecoveryPhrase, stopSync } from "../../../sync/engine";
import { Button, Checkbox, Sheet, useFormColors } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

/**
 * Sync's dialogs, with Dia's wording where Dia has the same dialog (its strings, from its
 * binary): Save Your Recovery Kit, Connect with Recovery Phrase, Connect Another Device, Stop
 * Syncing This Device?, Delete Sync Data?. Dia keeps the data on its servers; here it's the
 * sync folder, so the copy says so.
 */

const WORDS = 24;

function Title({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{children}</Text>;
}

function Body({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return <Text style={[{ fontSize: 12.5, lineHeight: 17, marginTop: 6, color: theme.textSecondary }, style]}>{children}</Text>;
}

function Buttons({ children, left }: { children: ReactNode; left?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 }}>
      {left}
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}

// MARK: Save Your Recovery Kit

export function showRecoveryKit() {
  showSettingsSheet(<RecoveryKitSheet />);
}

function RecoveryKitSheet() {
  const theme = useTheme();
  const colors = useFormColors();
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => void SyncNative?.recoveryKitPreview(168).then(setPreview), []);
  const save = async (format: "pdf" | "text") => {
    const path = await SyncNative?.saveRecoveryKit(format);
    if (path) setSaved(path);
  };
  const more = async () => {
    const choice = await showMenu([
      { id: "copy", title: "Copy", symbol: "doc.on.doc" },
      { id: "share", title: "Share…", symbol: "square.and.arrow.up" },
      { separator: true },
      { id: "text", title: "Save as Text…", symbol: "doc.plaintext" },
    ]);
    if (choice === "copy") await SyncNative?.copyRecoveryKit();
    else if (choice === "share") await SyncNative?.shareRecoveryKit();
    else if (choice === "text") await save("text");
  };
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", gap: 18 }}>
        <View style={{ flex: 1 }}>
          <Title>Save Your Recovery Kit</Title>
          <Body>Your Recovery Kit contains all you need to recover your data should you lose access to this device.</Body>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              marginTop: 14,
              padding: 10,
              borderRadius: 8,
              backgroundColor: theme.dark ? "rgba(255,159,10,0.12)" : "rgba(255,149,0,0.1)",
            }}
          >
            <Symbol name="exclamationmark.triangle.fill" size={12} color="#FF9500" style={{ width: 16, height: 16 }} />
            <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: theme.textPrimary }}>
              Save a copy of your Recovery Kit to{" "}
              <Text style={{ textDecorationLine: "underline" }}>another</Text> device or to the cloud. You’ll need it if you lose access to this device.
            </Text>
          </View>
          {saved ? <Body style={{ marginTop: 10 }}>Saved to {saved.replace(/^\/Users\/[^/]+/, "~")}.</Body> : null}
        </View>
        <View
          accessibilityLabel="Recovery kit preview"
          style={{ width: 168, height: 217, borderRadius: 4, overflow: "hidden", borderWidth: 1, borderColor: colors.groupBorder, backgroundColor: "#FFFFFF" }}
        >
          {preview ? <Image source={{ uri: preview }} style={{ width: 168, height: 217 }} /> : null}
        </View>
      </View>
      <Buttons left={<Button title="Other Options" onPress={() => void more()} />}>
        <Button title="Close" onPress={closeSettingsSheet} />
        <Button title="Save…" kind="primary" onPress={() => void save("pdf")} />
      </Buttons>
    </Sheet>
  );
}

// MARK: Connect with Recovery Phrase

export function showPhraseEntry(folder: FolderInfo | null, onChooseFolder?: () => void) {
  showSettingsSheet(<PhraseSheet folder={folder} onChooseFolder={onChooseFolder} />);
}

const phraseError = (r: Awaited<ReturnType<typeof enterRecoveryPhrase>>): string | null => {
  if ("ok" in r) return null;
  switch (r.error) {
    case "wordCount":
      return "Recovery phrase must be exactly 24 words.";
    case "unknownWord":
      return `“${r.word}” is not a valid recovery phrase word.`;
    case "checksum":
      return "This recovery phrase is not valid. Please check for typos.";
    case "mismatch":
      return "This recovery phrase doesn’t match the synced data in this folder. Check the phrase, or choose the folder your other devices sync to.";
    case "noData":
      return "There’s no synced data in this folder yet. Choose the folder your other devices sync to, or wait for it to finish downloading.";
    case "keychain":
      return "Couldn’t save the sync key in your Keychain.";
    case "unavailable":
      return "Sync isn’t available in this build.";
  }
};

function PhraseSheet({ folder, onChooseFolder }: { folder: FolderInfo | null; onChooseFolder?: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = text.toLowerCase().split(/[^a-z]+/).filter(Boolean).length;
  const submit = async () => {
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    const result = await enterRecoveryPhrase(folder.path, text);
    setBusy(false);
    const message = phraseError(result);
    if (message) setError(message);
    else closeSettingsSheet();
  };
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <Title>Connect with Recovery Phrase</Title>
      <Body>Enter your 24-word recovery phrase to sync with another device.</Body>
      <View
        style={{
          marginTop: 12,
          height: 96,
          borderRadius: 7,
          padding: 8,
          backgroundColor: colors.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: error ? colors.destructive : colors.fieldBorder,
        }}
      >
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          multiline
          autoFocus
          placeholder="Enter your 24-word recovery phrase"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.selection}
          enableFocusRing={false}
          autoCorrect={false}
          spellCheck={false}
          style={{ flex: 1, fontSize: 13, lineHeight: 18, color: theme.textPrimary, fontFamily: "Menlo" }}
        />
      </View>
      <View style={{ flexDirection: "row", marginTop: 6 }}>
        <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 15, color: error ? colors.destructive : theme.textSecondary }}>{error ?? ""}</Text>
        <Text style={{ fontSize: 11.5, color: count > WORDS ? colors.destructive : theme.textTertiary, fontVariant: ["tabular-nums"] }}>
          {count > WORDS ? "too many words" : `${count}/${WORDS} words`}
        </Text>
      </View>
      {folder ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
          <Symbol name="folder" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: theme.textSecondary }}>
            {folderLabel(folder)}
          </Text>
          {onChooseFolder ? <Button title="Change…" kind="plain" onPress={onChooseFolder} /> : null}
        </View>
      ) : null}
      <Buttons>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Connecting…" : "Connect"} kind="primary" disabled={busy || count !== WORDS || !folder} onPress={() => void submit()} />
      </Buttons>
    </Sheet>
  );
}

// MARK: Connect Another Device

export function showConnectDevice() {
  showSettingsSheet(<ConnectDeviceSheet />);
}

function ConnectDeviceSheet() {
  const theme = useTheme();
  const colors = useFormColors();
  const [qr, setQr] = useState<string | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  useEffect(() => void SyncNative?.qrCode().then(setQr), []);
  return (
    <Sheet width={480} onClose={closeSettingsSheet}>
      <Title>Connect Another Device</Title>
      <Body>
        On your other Mac, open Netnyahoo › Settings › Sync and choose the same sync folder. Then click Enter Recovery Phrase and enter the 24 words
        of your recovery phrase.
      </Body>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 }}>
        <View style={{ width: 132, height: 132, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
          {qr ? <Image source={{ uri: qr }} style={{ width: 120, height: 120 }} /> : null}
        </View>
        <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: theme.textSecondary }}>
          Or scan this code with your iPhone’s camera to copy the words, then paste them on your other Mac with Universal Clipboard.
        </Text>
      </View>
      {words ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 14, padding: 10, borderRadius: 8, backgroundColor: colors.group }}>
          {words.map((w, i) => (
            <Text key={i} style={{ width: "25%", paddingVertical: 3, fontSize: 12.5, color: theme.textPrimary, fontFamily: "Menlo" }}>
              <Text style={{ color: theme.textTertiary }}>{`${i + 1}`.padStart(2, " ")} </Text>
              {w}
            </Text>
          ))}
        </View>
      ) : null}
      <Buttons
        left={
          <>
            <Button title={words ? "Hide Words" : "Show Words"} onPress={() => (words ? setWords(null) : void SyncNative?.recoveryWords().then(setWords))} />
            <Button title="Copy Words" onPress={() => void SyncNative?.copyRecoveryPhrase()} />
          </>
        }
      >
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </Buttons>
    </Sheet>
  );
}

// MARK: Stop Syncing

export function showStopSync() {
  showSettingsSheet(<StopSheet />);
}

function StopSheet() {
  return (
    <Sheet width={420} onClose={closeSettingsSheet}>
      <Title>Stop Syncing This Device?</Title>
      <Body>
        Syncing will stop on this device. To re-enable sync, you’ll need another device that is currently syncing, or the recovery phrase from your
        Recovery Kit. Everything on this Mac stays as it is.
      </Body>
      <Buttons left={<Button title="Save Recovery Kit" onPress={() => showSettingsSheet(<RecoveryKitSheet />)} />}>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Stop Syncing" kind="destructive" onPress={() => showSettingsSheet(<DeleteDataSheet />)} />
      </Buttons>
    </Sheet>
  );
}

function DeleteDataSheet() {
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const finish = async (deleteData: boolean) => {
    setBusy(true);
    await stopSync({ deleteData });
    closeSettingsSheet();
  };
  return (
    <Sheet width={420} onClose={() => void finish(false)}>
      <Title>Delete Sync Data?</Title>
      <Body>
        Would you also like to permanently delete your synced data from the sync folder? This will stop syncing on all your other devices too. To sync
        again, you’ll need to set up each device from scratch. Your data on each Mac stays.
      </Body>
      <View style={{ marginTop: 12 }}>
        <Checkbox value={understood} onChange={setUnderstood} label="I understand this cannot be undone" />
      </View>
      <Buttons>
        <Button title="Keep Sync Data" disabled={busy} onPress={() => void finish(false)} />
        <Button title="Delete My Sync Data" kind="destructive" disabled={!understood || busy} onPress={() => void finish(true)} />
      </Buttons>
    </Sheet>
  );
}

// MARK: Helpers

/** "iCloud Drive › Netnyahoo Sync", or the path from ~. */
export function folderLabel(folder: Pick<FolderInfo, "path" | "inICloud">): string {
  if (folder.inICloud) {
    const rest = folder.path.split("com~apple~CloudDocs")[1]?.split("/").filter(Boolean) ?? [];
    return ["iCloud Drive", ...rest].join(" › ");
  }
  return folder.path.replace(/^\/Users\/[^/]+/, "~");
}
