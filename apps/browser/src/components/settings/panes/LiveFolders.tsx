import { copyText, focusWindow } from "@netnyahoo/shell";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../../../lib/theme";
import { deleteLiveFolder, refreshFolder, statusText } from "../../../live/engine";
import { connectGoogleDrive } from "../../../live/googleAuth";
import { isMocked } from "../../../live/net";
import { connectBitbucket, connectConfluence, connectGithub, connectNotion, disconnect, SOURCES, startGithubDeviceFlow, type DeviceFlow } from "../../../live/sources";
import { live, updateConfig, useLive } from "../../../live/store";
import type { LiveAccount, LiveSourceId } from "../../../live/types";
import { useBrowser } from "../../../store/browser";
import { Favicon } from "../../primitives";
import { Button, Group, Row, SectionHeader, Sheet, TextField } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

/**
 * Settings › Live Folders: connect the services live folders read from, and
 * manage the folders. Netnyahoo has no OAuth apps of its own, so each service
 * takes credentials the user creates (tokens, or their own OAuth client).
 * Secrets go to the keychain.
 */
const DESCRIPTIONS: Record<LiveSourceId, string> = {
  github: "Your open pull requests and the ones waiting for your review, with checks and conflicts.",
  bitbucket: "Your open pull requests on Bitbucket Cloud, with build status.",
  notion: "Pages recently edited in your workspace.",
  confluence: "Pages you created, edited or watch.",
  gdrive: "Documents recently changed in your Drive.",
};

export function LiveFoldersPane() {
  const folders = useLive(useShallow((s) => s.folderOrder.map((id) => s.folders[id]!).filter(Boolean)));
  const profiles = useBrowser((s) => s.profiles);
  useLive((s) => s.status);
  return (
    <View>
      <SectionHeader
        title="Live folders"
        description="Right-click empty space in the sidebar and choose New Live Folder to add one. Live folders refresh every few minutes; items open as tabs that stay in the folder."
      />
      {folders.length ? (
        <Group>
          {folders.map((f) => (
            <Row key={f.id} title={f.name} description={`${profiles[f.profileId]?.name ?? "Profile"} · ${f.sources.map((s) => SOURCES[s].name).join(", ")} · ${statusText(f.id)}`}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Button title="Refresh" onPress={() => void refreshFolder(f.id)} />
                <Button title="Delete" kind="destructive" onPress={() => deleteLiveFolder(f.id)} />
              </View>
            </Row>
          ))}
        </Group>
      ) : null}

      <SectionHeader title="Pull Requests" />
      <Group>
        <SourceRow id="github" />
        <SourceRow id="bitbucket" />
      </Group>

      <SectionHeader title="Documents" />
      <Group>
        <SourceRow id="notion" />
        <SourceRow id="confluence" />
        <SourceRow id="gdrive" />
      </Group>
      {isMocked ? <Text style={{ marginTop: 10, fontSize: 11, color: "#D29922" }}>Development build: services are served by NETNYAHOO_LIVE_MOCK.</Text> : null}
    </View>
  );
}

/** Bitbucket and Confluence logins are opaque account ids: show only the name there. */
function connectedAs(id: LiveSourceId, account: LiveAccount): string {
  if (!account.name || account.name === account.login) return account.login;
  return id === "github" || id === "gdrive" ? `${account.name} (${account.login})` : account.name;
}

function SourceRow({ id }: { id: LiveSourceId }) {
  const account = useLive((s) => s.accounts[id]);
  const source = SOURCES[id];
  return (
    <Row
      icon={<Favicon url={source.site} size={18} />}
      title={source.name}
      description={account ? `Connected as ${connectedAs(id, account)}` : DESCRIPTIONS[id]}
    >
      {account ? (
        <Button title="Disconnect" onPress={() => void disconnect(id)} />
      ) : (
        <Button title="Connect…" onPress={() => showSettingsSheet(<ConnectSheet id={id} />)} />
      )}
    </Row>
  );
}

/** The browser window to open sign-in pages in (Settings is its own window). */
function browserWindow(): string | null {
  const s = useBrowser.getState();
  return s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito) ?? s.windowOrder.find((id) => !s.windows[id]!.incognito) ?? null;
}

function openInBrowser(url: string) {
  const windowId = browserWindow();
  if (!windowId) return;
  useBrowser.getState().newTab(windowId, { url });
  void focusWindow(windowId);
}

function ConnectSheet({ id }: { id: LiveSourceId }) {
  const theme = useTheme();
  const source = SOURCES[id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      closeSettingsSheet();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  let body: ReactNode;
  switch (id) {
    case "github":
      body = <GithubConnect busy={busy} run={run} />;
      break;
    case "bitbucket":
      body = <BitbucketConnect busy={busy} run={run} />;
      break;
    case "notion":
      body = <NotionConnect busy={busy} run={run} />;
      break;
    case "confluence":
      body = <ConfluenceConnect busy={busy} run={run} />;
      break;
    case "gdrive":
      body = <GoogleConnect busy={busy} run={run} />;
      break;
  }
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Favicon url={source.site} size={22} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Connect {source.name}</Text>
      </View>
      {body}
      {error ? <Text style={{ marginTop: 10, fontSize: 12, color: "#E5534B" }}>{error}</Text> : null}
    </Sheet>
  );
}

type ConnectProps = { busy: boolean; run(task: () => Promise<void>): Promise<void> };

function Help({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 12, lineHeight: 17, color: theme.textSecondary, marginBottom: 10 }}>{children}</Text>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4, marginBottom: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{label}</Text>
      {children}
    </View>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>{children}</View>;
}

function GithubConnect({ busy, run }: ConnectProps) {
  const theme = useTheme();
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState(live().config.githubClientId);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  useEffect(() => () => flow?.cancel(), [flow]);

  const signIn = () =>
    run(async () => {
      updateConfig({ githubClientId: clientId.trim() });
      const f = await startGithubDeviceFlow(clientId.trim());
      setFlow(f);
      copyText(f.userCode);
      openInBrowser(f.verificationUri);
      await f.done;
    });

  if (flow) {
    return (
      <View>
        <Help>Enter this code on GitHub (it's on your clipboard), then approve Netnyahoo. This sheet closes when you're signed in.</Help>
        <Text selectable style={{ fontSize: 26, fontWeight: "600", letterSpacing: 3, fontFamily: "Menlo", color: theme.textPrimary, textAlign: "center", marginVertical: 8 }}>
          {flow.userCode}
        </Text>
        <Actions>
          <Button title="Cancel" onPress={() => (flow.cancel(), setFlow(null))} />
          <Button title="Open GitHub" kind="primary" onPress={() => openInBrowser(flow.verificationUri)} />
        </Actions>
      </View>
    );
  }
  return (
    <View>
      <Help>
        Paste a personal access token (classic: "repo" and "read:org" scopes; fine-grained: read access to pull requests, checks and metadata).
      </Help>
      <Field label="Personal access token">
        <TextField value={token} onChangeText={setToken} placeholder="ghp_…" secure onSubmit={() => token && void run(() => connectGithub(token))} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!token.trim() || busy} onPress={() => void run(() => connectGithub(token))} />
      </Actions>
      <View style={{ height: 1, backgroundColor: theme.divider, marginVertical: 14 }} />
      <Help>Or sign in with your own GitHub OAuth app (Settings › Developer settings › OAuth Apps, with Device Flow enabled).</Help>
      <Field label="OAuth app client ID">
        <TextField value={clientId} onChangeText={setClientId} placeholder="Iv1.…" />
      </Field>
      <Actions>
        <Button title="Sign In with GitHub…" disabled={!clientId.trim() || busy} onPress={() => void signIn()} />
      </Actions>
    </View>
  );
}

function BitbucketConnect({ busy, run }: ConnectProps) {
  const [user, setUser] = useState(live().config.bitbucketUser);
  const [token, setToken] = useState("");
  const go = () => void run(() => connectBitbucket(user, token));
  return (
    <View>
      <Help>Create an API token (bitbucket.org › Personal settings › API tokens, with read access to pull requests and repositories), then enter your Atlassian account email with it. Bitbucket can't search review requests across repositories, so the folder lists your own pull requests.</Help>
      <Field label="Email or username">
        <TextField value={user} onChangeText={setUser} placeholder="you@example.com" />
      </Field>
      <Field label="API token">
        <TextField value={token} onChangeText={setToken} secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!user.trim() || !token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function NotionConnect({ busy, run }: ConnectProps) {
  const [token, setToken] = useState("");
  const go = () => void run(() => connectNotion(token));
  return (
    <View>
      <Help>Create an internal integration at notion.so/my-integrations (read content; read user information for editor names), copy its secret, and share the pages or teamspaces you want with it (••• › Connections).</Help>
      <Field label="Internal integration secret">
        <TextField value={token} onChangeText={setToken} placeholder="ntn_…" secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function ConfluenceConnect({ busy, run }: ConnectProps) {
  const config = live().config;
  const [site, setSite] = useState(config.confluenceSite);
  const [email, setEmail] = useState(config.confluenceEmail);
  const [token, setToken] = useState("");
  const go = () => void run(() => connectConfluence(site, email, token));
  return (
    <View>
      <Help>Create an API token at id.atlassian.com › Security › API tokens, then enter your Confluence Cloud site and account email.</Help>
      <Field label="Site">
        <TextField value={site} onChangeText={setSite} placeholder="https://your-team.atlassian.net" />
      </Field>
      <Field label="Email">
        <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" />
      </Field>
      <Field label="API token">
        <TextField value={token} onChangeText={setToken} secure onSubmit={go} />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Checking…" : "Connect"} kind="primary" disabled={!site.trim() || !email.trim() || !token.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}

function GoogleConnect({ busy, run }: ConnectProps) {
  const [clientId, setClientId] = useState(live().config.googleClientId);
  const [secret, setSecret] = useState("");
  const go = () =>
    void run(async () => {
      const windowId = browserWindow();
      if (!windowId) throw new Error("Open a browser window first");
      void focusWindow(windowId);
      await connectGoogleDrive(windowId, clientId, secret);
    });
  return (
    <View>
      <Help>
        In Google Cloud Console, enable the Drive API and create an OAuth client of type "Desktop app" (add yourself as a test user). Netnyahoo opens Google's consent page in a tab and reads the result from its redirect; it asks only to see your files' names and dates.
      </Help>
      <Field label="Client ID">
        <TextField value={clientId} onChangeText={setClientId} placeholder="…apps.googleusercontent.com" />
      </Field>
      <Field label="Client secret">
        <TextField value={secret} onChangeText={setSecret} secure />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Waiting for Google…" : "Sign In with Google…"} kind="primary" disabled={!clientId.trim() || !secret.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}
