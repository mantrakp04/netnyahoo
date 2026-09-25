import {
  deletePassword,
  getNeverSavePasswordOrigins,
  getPassword,
  getPasswordAutofill,
  listPasswords,
  savePassword,
  setNeverSavePasswords,
  setPasswordAutofill,
  unlockPasswords,
  updatePassword,
  type SavedPassword,
} from "@netnyahoo/cef";
import { authenticate, confirm, copyText, Symbol } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile, plural } from "../../../store/model";
import { importModule } from "../../import/module";
import { hostLabel, matchesQuery } from "../../pages/PageLayout";
import { Favicon, IconButton } from "../../primitives";
import { Button, Group, PopUp, Row, SearchField, SectionHeader, Sheet, TextField, Toggle } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

/**
 * Unlocked for this many ms after Touch ID / the password, like Safari's Passwords. It's
 * Chrome's own check (revealing needs it anyway), which lasts as long for that profile.
 */
const UNLOCK_MS = 5 * 60_000;
const unlockedUntil = new Map<string, number>();
const isUnlocked = (profile: string) => Date.now() < (unlockedUntil.get(profile) ?? 0);

export function PasswordsPane() {
  const theme = useTheme();
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => useBrowser.getState().settings.defaultProfileId);
  const [, setUnlockedAt] = useState(0);
  const [list, setList] = useState<SavedPassword[] | null>(null);
  const [never, setNever] = useState<string[]>([]);
  const [autofill, setAutofill] = useState(true);
  const [query, setQuery] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const profile = engineProfile(profileId);
  const unlocked = isUnlocked(profile);

  const load = () => {
    void listPasswords(profile).then(setList).catch(() => setList([]));
    void getNeverSavePasswordOrigins(profile).then(setNever).catch(() => {});
  };
  useEffect(() => {
    if (unlocked) load();
  }, [unlocked, profileId]);
  useEffect(() => void getPasswordAutofill(profile).then(setAutofill).catch(() => {}), [profile]);

  const unlock = async () => {
    // One prompt: Chrome's own (older app builds: ours, then Chrome's on reveal).
    const chrome = await unlockPasswords(profile);
    if (!(chrome ?? (await authenticate("show your saved passwords")))) return;
    unlockedUntil.set(profile, Date.now() + UNLOCK_MS);
    setUnlockedAt(Date.now());
  };

  const importCsv = async () => {
    const mod = importModule();
    if (!mod) return setImportStatus("Importing isn't available in this build.");
    const path = await mod.chooseImportFile("passwordsCSV");
    if (!path) return;
    try {
      const creds = await mod.importPasswordsCSV(path);
      let saved = 0;
      for (const c of creds) if (c.url && c.password && (await savePassword(profile, originOf(c.url), c.username, c.password))) saved++;
      setImportStatus(`Imported ${plural(saved, "password")}.`);
      load();
    } catch (e) {
      setImportStatus(`Couldn't import that file: ${(e as Error).message}`);
    }
  };

  const shown = (list ?? []).filter((p) => matchesQuery(query, p.origin, p.username));

  return (
    <View>
      <SectionHeader
        title="Passwords"
        description="Saved on this Mac, separately for each profile, and encrypted with a key in your Keychain."
        action={
          profiles.length > 1 ? (
            <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
          ) : undefined
        }
      />
      <Group>
        <Row title="Offer to save and fill passwords" description="Offers to save a login after you sign in, and suggests saved ones when you click a login field.">
          <Toggle value={autofill} onChange={(v) => void setPasswordAutofill(v, profile).then(() => setAutofill(v))} />
        </Row>
        <Row title="Import passwords" description={importStatus || "From a CSV exported by Chrome, Safari, Firefox, 1Password, Bitwarden…"}>
          <Button title="Import CSV…" onPress={() => void importCsv()} />
        </Row>
      </Group>

      {!unlocked ? (
        <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
          <Symbol name="lock.fill" size={26} color={theme.textTertiary} style={{ width: 36, height: 36 }} />
          <Text style={{ fontSize: 14, fontWeight: "500", color: theme.textPrimary }}>Passwords are locked</Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>Unlock with Touch ID or your login password to see them.</Text>
          <Button title="Unlock" kind="primary" onPress={() => void unlock()} style={{ marginTop: 6 }} />
        </View>
      ) : (
        <>
          <SectionHeader title={list ? plural(list.length, "Saved Password") : "Saved Passwords"} action={<SearchField value={query} onChangeText={setQuery} placeholder="Search" width={200} />} />
          <Group>
            {list && shown.length === 0 ? (
              <Row title={query ? "No passwords match" : "No saved passwords"} />
            ) : (
              shown.map((p) => (
                <Row
                  key={`${p.origin}|${p.username}`}
                  icon={<Favicon url={p.origin} />}
                  title={hostLabel(p.origin)}
                  description={p.username || "(no username)"}
                  onPress={() => showSettingsSheet(<PasswordSheet profile={profile} saved={p} onChanged={load} />)}
                />
              ))
            )}
          </Group>
          {never.length > 0 && (
            <>
              <SectionHeader title="Never saved" description="Sites where you chose “Never on This Site”." />
              <Group>
                {never.map((origin) => (
                  <Row key={origin} icon={<Favicon url={origin} />} title={hostLabel(origin)}>
                    <Button title="Remove" onPress={() => void setNeverSavePasswords(profile, origin, false).then(load)} />
                  </Row>
                ))}
              </Group>
            </>
          )}
        </>
      )}
    </View>
  );
}

function originOf(url: string) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1]! : url;
}

/** One saved login: reveal / copy / edit / delete. */
function PasswordSheet({ profile, saved, onChanged }: { profile: string; saved: SavedPassword; onChanged: () => void }) {
  const theme = useTheme();
  const [username, setUsername] = useState(saved.username);
  const [password, setPassword] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => void getPassword(profile, saved.origin, saved.username).then(setPassword), []);

  const save = async () => {
    await updatePassword(profile, saved.origin, saved.username, {
      username: username !== saved.username ? username : undefined,
      password: password ?? undefined,
    });
    onChanged();
    closeSettingsSheet();
  };
  const remove = async () => {
    const { confirmed } = await confirm({
      title: `Delete the password for ${hostLabel(saved.origin)}?`,
      message: "You won't be able to sign in with it automatically any more.",
      confirmTitle: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await deletePassword(profile, saved.origin, saved.username);
    onChanged();
    closeSettingsSheet();
  };

  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Favicon url={saved.origin} size={22} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{hostLabel(saved.origin)}</Text>
      </View>
      <View style={{ marginTop: 14 }}>
        <Group>
          <Row title="Website" description={saved.origin} />
          <Row title="Username">
            {editing ? (
              <TextField value={username} onChangeText={setUsername} style={{ width: 220 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text selectable style={{ fontSize: 13, color: theme.textPrimary }}>
                  {saved.username}
                </Text>
                <IconButton icon="doc.on.doc" size={11} box={24} radius={6} onPress={() => copyText(saved.username)} tooltip="Copy Username" />
              </View>
            )}
          </Row>
          <Row title="Password">
            {editing ? (
              <TextField value={password ?? ""} onChangeText={setPassword} secure={!revealed} style={{ width: 220 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text selectable style={{ fontSize: 13, color: theme.textPrimary, fontFamily: revealed ? "Menlo" : undefined }}>
                  {password === null ? "…" : revealed ? password : "•".repeat(Math.min(password.length, 12))}
                </Text>
                <IconButton icon={revealed ? "eye.slash" : "eye"} size={11} box={24} radius={6} onPress={() => setRevealed(!revealed)} tooltip={revealed ? "Hide" : "Show"} />
                <IconButton icon="doc.on.doc" size={11} box={24} radius={6} onPress={() => password && copyText(password)} tooltip="Copy Password" />
              </View>
            )}
          </Row>
        </Group>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
        <Button title="Delete" kind="destructive" onPress={() => void remove()} />
        <View style={{ flex: 1 }} />
        {editing ? (
          <>
            <Button title="Cancel" onPress={() => setEditing(false)} />
            <Button title="Save" kind="primary" disabled={!password} onPress={() => void save()} />
          </>
        ) : (
          <>
            <Button title="Edit" onPress={() => setEditing(true)} />
            <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
          </>
        )}
      </View>
    </Sheet>
  );
}
