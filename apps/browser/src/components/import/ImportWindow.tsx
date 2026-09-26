import type { BrowserProfile, BrowserSource, DiaAutomationStatus, DiaTabsResult, ImportKind, ImportResult, SpaceSummary } from "@netnyahoo/import";
import { closeWindow, confirm, Symbol, VisualEffect, WindowDragRegion } from "@netnyahoo/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, AppState, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useProfiles } from "../../store/hooks";
import { plural } from "../../store/model";
import type { ProfileColor } from "../../store/types";
import { useHover } from "../primitives";
import { Button, Checkbox, PopUp, useFormColors } from "../settings/controls";
import { IMPORT_WINDOW_ID } from "../settings/windows";
import { applyResult, applySafari, emptyCounts, importArcSpace, importBookmarks, importDiaProfile, profileColorFor, type ImportCounts } from "./apply";
import { importModule } from "./module";

const APP = "Netnyahoo";

type Step = "loading" | "choose" | "profiles" | "safari" | "access" | "unlock" | "dia" | "progress" | "done";
type Status = "pending" | "active" | "done" | "failed";

/** Category names, in the order the progress list shows them (Dia's "Import category … title"). */
const KINDS: { kind: ImportKind; title: string; icon: string }[] = [
  { kind: "bookmarks", title: "Bookmarks", icon: "bookmark" },
  { kind: "history", title: "History", icon: "clock" },
  { kind: "passwords", title: "Passwords", icon: "key" },
  { kind: "tabs", title: "Tabs", icon: "square.on.square" },
  { kind: "spaces", title: "Spaces", icon: "square.stack" },
  { kind: "pinnedTabs", title: "Pinned tabs", icon: "pin" },
  { kind: "favorites", title: "Favorites", icon: "star" },
];
const kindTitle = (k: ImportKind) => KINDS.find((x) => x.kind === k)?.title ?? k;

/** What Dia's AppleScript can't give, said wherever the Dia tab import is offered. */
const DIA_NOT_SHARED = "Custom tab names, colours, spaces and folders stay in Dia: its AppleScript doesn't share them.";

/** "Import from Another Browser…": pick a browser, its profiles / Arc spaces, unlock, import. */
export function ImportWindow() {
  const theme = useTheme();
  const api = importModule();
  const profiles = useProfiles();
  const [step, setStep] = useState<Step>("loading");
  const [browsers, setBrowsers] = useState<BrowserSource[]>([]);
  const [source, setSource] = useState<BrowserSource | null>(null);
  const [sourceProfiles, setSourceProfiles] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Set<ImportKind>>(new Set());
  const [target, setTarget] = useState(() => defaultTarget());
  const [status, setStatus] = useState<Partial<Record<ImportKind, Status>>>({});
  const [failures, setFailures] = useState<{ kind: ImportKind; profiles: string[] }[]>([]);
  const [counts, setCounts] = useState<ImportCounts>(emptyCounts());
  const [preparing, setPreparing] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // Safari: whether we have Full Disk Access to read ~/Library/Safari directly.
  const [fullDiskAccess, setFullDiskAccess] = useState(false);
  // Dia's tabs through AppleScript: Automation consent, then what Dia answered.
  const [diaStatus, setDiaStatus] = useState<DiaAutomationStatus | "checking" | "reading">("checking");
  const [dia, setDia] = useState<DiaTabsResult | null>(null);
  const [asking, setAsking] = useState(false);
  const diaLaunched = useRef(0);
  const abort = useRef<AbortController | null>(null);

  // While waiting on Full Disk Access, re-check whenever the app regains focus (the user just
  // came back from System Settings) so the Safari step advances on its own.
  useEffect(() => {
    if (!api || !((step === "safari" && !fullDiskAccess) || step === "access")) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void recheckAccess();
    });
    return () => sub.remove();
  }, [step, fullDiskAccess, api, source?.id]);

  /** After the user visits System Settings: Safari re-probes; a protected browser is listed again. */
  const recheckAccess = async () => {
    if (!api) return;
    if (step === "safari") return setFullDiskAccess(api.safariHasFullDiskAccess());
    const list = await api.listBrowsers().catch(() => null);
    if (!list) return;
    setBrowsers(list);
    const updated = list.find((b) => b.id === source?.id);
    if (updated && !updated.needsFullDiskAccess) {
      choose(updated);
      setStep("choose");
    }
  };

  // Dia tabs: wait for Dia to start, and re-check Automation when the user comes back from System Settings.
  useEffect(() => {
    if (!api || step !== "dia") return;
    const timer = diaStatus === "notRunning" ? setInterval(() => void refreshDia(), 1500) : null;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && (diaStatus === "denied" || diaStatus === "notRunning")) void refreshDia();
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [step, diaStatus, api]);

  useEffect(() => {
    if (!api) return setStep("choose");
    void api
      .listBrowsers()
      .then((list) => {
        setBrowsers(list);
        // Preselect one we can read right away (not Safari, not a browser behind Full Disk Access,
        // not Dia's AppleScript tabs, which ask macOS for consent).
        const first = list.find((b) => !b.needsFullDiskAccess && !b.requiresExport && b.family !== "automation") ?? list[0];
        if (first) choose(first);
        setStep("choose");
      })
      .catch(() => setStep("choose"));
    return () => {
      abort.current?.abort();
      api.forgetUnlockedKeys();
    };
  }, []);

  const choose = (b: BrowserSource) => {
    setSource(b);
    const defaults = b.profiles.filter((p) => p.isDefault);
    setSourceProfiles((defaults.length ? defaults : b.profiles.slice(0, 1)).map((p) => p.id));
    setSpaces(b.profiles.flatMap((p) => p.spaces ?? []).map((s) => s.id));
    const available: ImportKind[] = b.requiresExport
      ? ["bookmarks", "history", "passwords"]
      : b.family === "automation"
        ? ["tabs", "pinnedTabs"]
        : [...new Set(b.profiles.flatMap((p) => p.available))];
    // Cookies can't be set in the engine; spaces/pinned tabs/favourites are Arc's part of "Tabs".
    setKinds(new Set(available.filter((k) => k !== "cookies")));
    if (b.family === "safari" && api) setFullDiskAccess(api.safariHasFullDiskAccess());
    setDia(null);
    setError(null);
  };

  const allSpaces: (SpaceSummary & { profileId: string })[] = (source?.profiles ?? []).flatMap((p) => (p.spaces ?? []).map((s) => ({ ...s, profileId: p.id })));
  const isArc = source?.family === "arc";
  const isDiaTabs = source?.family === "automation";

  const next = () => {
    if (!source) return;
    setError(null);
    if (step === "choose" && isDiaTabs) {
      setDiaStatus("checking");
      setStep("dia");
      return void refreshDia();
    }
    if (step === "profiles" && isDiaTabs && dia) return void runDia(dia, sourceProfiles, kinds);
    if (step === "choose") {
      if (source.needsFullDiskAccess) return setStep("access");
      if (source.requiresExport) return setStep("safari");
      if (source.profiles.length > 1 || (isArc && allSpaces.length > 1)) return setStep("profiles");
    }
    if ((step === "choose" || step === "profiles") && kinds.has("passwords") && source.needsKeychain && api && !api.isBrowserUnlocked(source.id)) {
      return setStep("unlock");
    }
    void run(kinds);
  };

  const unlock = async () => {
    if (!api || !source) return;
    setUnlocking(true);
    try {
      await api.unlockBrowser(source.id);
      setUnlocking(false);
      void run(kinds);
    } catch {
      setUnlocking(false);
      setError("macOS didn't allow access to the saved passwords. Try again, or continue without them.");
    }
  };

  /** Where a source profile / Arc space goes: the chosen profile first, new profiles for the rest (asking on a name clash). */
  const destination = async (index: number, name: string, color?: string, emoji?: string): Promise<string> => {
    if (index === 0) return target;
    const s = useBrowser.getState();
    const clash = s.profileOrder.find((id) => s.profiles[id]!.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (clash) {
      const { confirmed } = await confirm({
        title: "Import as new profile?",
        message:
          "Import this data as a new profile to avoid data loss. If you replace a profile, your passwords, cookies, and payment info will be replaced, while your bookmarks and history will be combined.",
        confirmTitle: "Import as new profile",
        cancelTitle: "Replace this profile",
      });
      if (!confirmed) return clash;
    }
    return s.createProfile({ name, color: profileColorFor(color) as ProfileColor | undefined, icon: emoji ?? null });
  };

  const run = async (wanted: Set<ImportKind>) => {
    if (!api || !source) return;
    const selected = source.profiles.filter((p) => sourceProfiles.includes(p.id) || (isArc && p.spaces?.some((s) => spaces.includes(s.id))));
    const requested: ImportKind[] = [...wanted];
    if (isArc && requested.includes("tabs")) requested.push("spaces", "pinnedTabs");
    const order = KINDS.map((k) => k.kind).filter((k) => requested.includes(k));
    setStatus(Object.fromEntries(order.map((k) => [k, "pending"])));
    setPreparing(isArc ? Math.max(1, spaces.length) : selected.length);
    setStep("progress");
    abort.current = new AbortController();
    const total = emptyCounts();
    const failed = new Map<ImportKind, string[]>();
    const add = (c: ImportCounts) => (Object.keys(total) as (keyof ImportCounts)[]).forEach((k) => (total[k] += c[k]));
    let destinationIndex = 0;

    for (const profile of selected) {
      let result: ImportResult;
      try {
        result = await api.importData(source.id, profile.id, order, {
          spaceIds: isArc ? spaces : undefined,
          signal: abort.current.signal,
          onProgress: (p) => {
            if (p.phase === "start") setStatus((st) => ({ ...st, [p.kind]: "active" }));
            if (p.phase === "end") setStatus((st) => (st[p.kind] === "failed" ? st : { ...st, [p.kind]: "done" }));
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "cancelled") return;
        for (const k of order) failed.set(k, [...(failed.get(k) ?? []), profile.name]);
        continue;
      }
      for (const k of result.failed) failed.set(k, [...(failed.get(k) ?? []), profile.name]);

      if (isArc) {
        // Each Arc space becomes a profile; the Arc profile's own data goes with its first space.
        const profileSpaces = result.spaces;
        let first: string | null = null;
        for (const space of profileSpaces) {
          const name = space.name || "Space";
          const dest = await destination(destinationIndex++, name, space.color, space.emoji);
          first ??= dest;
          const r = importArcSpace(dest, space, name);
          add({ ...emptyCounts(), tabs: r.tabs, bookmarks: r.bookmarks });
        }
        const dest = first ?? (await destination(destinationIndex++, result.profile?.name ?? profile.name, result.profile?.color));
        add(await applyResult(dest, result, source.name));
      } else {
        const dest = await destination(destinationIndex++, result.profile?.name ?? profile.name, result.profile?.color ?? profile.color);
        add(await applyResult(dest, result, source.name));
      }
    }
    // A category with no progress events (nothing to read) still finishes.
    setStatus((st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, failed.has(k as ImportKind) ? "failed" : v === "failed" ? v : "done"])));
    setFailures([...failed].map(([kind, names]) => ({ kind, profiles: selected.length > 1 ? names : [] })));
    setCounts(total);
    api.forgetUnlockedKeys();
    setTimeout(() => setStep("done"), 700);
  };

  /** Where Dia stands (running? allowed?); reads its tabs as soon as it's allowed. Never prompts. */
  const refreshDia = async () => {
    if (!api) return;
    const status = await api.diaAutomationStatus().catch((): DiaAutomationStatus => "denied");
    setDiaStatus(status);
    if (status === "granted") await readDia();
  };

  /** The user read the explanation and chose Continue: now macOS may show its Automation prompt. */
  const allowDia = async () => {
    if (!api) return;
    setAsking(true);
    const status = await api.requestDiaAutomation().catch((): DiaAutomationStatus => "denied");
    setAsking(false);
    setDiaStatus(status);
    if (status === "granted") await readDia();
  };

  const openDia = async () => {
    if (!api) return;
    diaLaunched.current = Date.now();
    await api.openDia().catch(() => setError("Couldn't open Dia. Open it yourself, then click Check Again."));
    void refreshDia();
  };

  const readDia = async () => {
    if (!api) return;
    setError(null);
    setDiaStatus("reading");
    let result: DiaTabsResult;
    try {
      result = await api.readDiaTabs();
      // A Dia we just opened may still be restoring its windows.
      for (let i = 0; !result.windowCount && Date.now() - diaLaunched.current < 15_000 && i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        result = await api.readDiaTabs();
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      setDiaStatus(code === "notRunning" ? "notRunning" : code === "locked" ? "denied" : "granted");
      if (code !== "notRunning" && code !== "locked") setError(`${(e as Error).message}. Try again.`);
      return;
    }
    setDiaStatus("granted");
    takeDiaResult(result);
  };

  /** What Dia answered: its profiles go through the profile step (when there are several), then import. */
  const takeDiaResult = (result: DiaTabsResult) => {
    setDia(result);
    if (!result.profiles.length) {
      return setError(result.windowCount ? "Dia has no open or pinned web pages to import." : "Dia has no open windows. Open one, then try again.");
    }
    const profiles: BrowserProfile[] = result.profiles.map((p, i) => ({
      id: p.id,
      name: p.name,
      path: "",
      isDefault: i === 0,
      available: ["tabs", "pinnedTabs"],
    }));
    setSource((s) => (s ? { ...s, profiles } : s));
    const first = [profiles[0]!.id];
    setSourceProfiles(first);
    if (profiles.length > 1) setStep("profiles");
    else void runDia(result, first, kinds);
  };

  /** Each chosen Dia profile into a Netnyahoo profile: the first into the selected one, the rest new (or the same-named one). */
  const runDia = async (result: DiaTabsResult, ids: string[], wanted: Set<ImportKind>) => {
    const selected = result.profiles.filter((p) => ids.includes(p.id));
    const order = KINDS.map((k) => k.kind).filter((k) => (k === "tabs" || k === "pinnedTabs") && wanted.has(k));
    setStatus(Object.fromEntries(order.map((k) => [k, "active"])));
    setPreparing(selected.length);
    setStep("progress");
    const total = emptyCounts();
    for (const [i, p] of selected.entries()) {
      const dest = await destination(i, p.name);
      total.tabs += importDiaProfile(dest, p, { pinned: wanted.has("pinnedTabs"), open: wanted.has("tabs") });
    }
    setStatus(Object.fromEntries(order.map((k) => [k, "done"])));
    setFailures([]);
    setCounts(total);
    setTimeout(() => setStep("done"), 700);
  };

  const importSafari = async (path: string) => {
    if (!api) return;
    setError(null);
    setStatus({ bookmarks: "active", history: "active", passwords: "active" });
    setPreparing(1);
    setStep("progress");
    try {
      const data = await api.importSafariExport(path);
      const c = await applySafari(target, data);
      setStatus({ bookmarks: "done", history: "done", passwords: "done" });
      setCounts(c);
      setFailures([]);
      setTimeout(() => setStep("done"), 700);
    } catch (e) {
      setStep("safari");
      setError((e as { code?: string }).code === "unsupported" ? "Please select a folder or zip file." : "The selected file is invalid. Please try again.");
    }
  };

  const importSafariDirect = async () => {
    if (!api) return;
    setError(null);
    setStatus({ bookmarks: "active", history: "active", tabs: "active" });
    setPreparing(1);
    setStep("progress");
    abort.current = new AbortController();
    try {
      const data = await api.importSafariDirect({ signal: abort.current.signal });
      const c = await applySafari(target, data);
      setStatus({ bookmarks: "done", history: "done", tabs: "done" });
      setCounts(c);
      setFailures([]);
      setTimeout(() => setStep("done"), 700);
    } catch (e) {
      if ((e as { code?: string }).code === "cancelled") return;
      setStep("safari");
      setError(
        (e as { code?: string }).code === "locked"
          ? "Netnyahoo still doesn't have Full Disk Access. Grant it above, or use the export file below."
          : "Couldn't read Safari's data. Try the export file below.",
      );
      setFullDiskAccess(api.safariHasFullDiskAccess());
    }
  };

  const importHtml = async () => {
    if (!api) return;
    const path = await api.chooseImportFile("bookmarksHTML");
    if (!path) return;
    try {
      const root = await api.importBookmarksHTML(path);
      const n = importBookmarks(target, root, "HTML File");
      setCounts({ ...emptyCounts(), bookmarks: n });
      setFailures([]);
      setStatus({ bookmarks: "done" });
      setSource(null);
      setStep("done");
    } catch {
      setError("The selected file is invalid. Please try again.");
    }
  };

  const close = () => void closeWindow(IMPORT_WINDOW_ID);

  // DEV: lets lib/devHarness step through the flow (`globalThis.nnImport.select("dia")`, `.next()`,
  // `.back()`) for snapshots, since the utility window isn't reachable through accessibility.
  useEffect(() => {
    if (!__DEV__) return;
    const g = globalThis as { nnImport?: object };
    g.nnImport = {
      select: (id: string) => {
        const b = browsers.find((x) => x.id === id);
        if (b) choose(b);
        return !!b;
      },
      next,
      back: () => setStep("choose"),
      step,
      diaStatus,
      dia,
      // Drive the Dia tab steps without Apple Events (a status to render, or what Dia would answer).
      setDiaStatus,
      takeDiaResult,
      setSourceProfiles,
    };
    return () => void delete g.nnImport;
  });

  let body: ReactNode = null;
  let footer: ReactNode = null;
  const targetPicker =
    profiles.length > 1 ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>Import into</Text>
        <PopUp value={target} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setTarget} minWidth={130} />
      </View>
    ) : (
      <View />
    );

  if (step === "loading") {
    body = <ActivityIndicator style={{ marginTop: 80 }} />;
  } else if (step === "choose") {
    body = (
      <>
        <Title title="Import from Another Browser" subtitle="Import once and stay in your flow. Your tabs, passwords, bookmarks and history come with you." />
        {!api ? (
          <Note text={`Importing isn't available in this build of ${APP}.`} />
        ) : browsers.length === 0 ? (
          <Note text="No other browsers with data to import were found on this Mac." />
        ) : (
          <View style={{ gap: 6 }}>
            {browsers.map((b) => (
              <BrowserRow key={b.id} browser={b} selected={source?.id === b.id} onPress={() => choose(b)} />
            ))}
          </View>
        )}
        {source && !source.requiresExport && !source.needsFullDiskAccess && (
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, marginBottom: 8 }}>What to import</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              {(isDiaTabs
                ? KINDS.filter((k) => k.kind === "tabs" || k.kind === "pinnedTabs")
                : KINDS.filter((k) => source.profiles.some((p) => p.available.includes(k.kind)) && !["spaces", "pinnedTabs"].includes(k.kind))
              ).map((k) => (
                <Checkbox
                  key={k.kind}
                  label={k.kind === "tabs" && isArc ? "Spaces and tabs" : k.kind === "tabs" && isDiaTabs ? "Open tabs" : k.title}
                  value={kinds.has(k.kind)}
                  onChange={(v) =>
                    setKinds((prev) => {
                      const n = new Set(prev);
                      if (v) n.add(k.kind);
                      else n.delete(k.kind);
                      return n;
                    })
                  }
                />
              ))}
            </View>
            {isDiaTabs && (
              <Text style={{ fontSize: 12, lineHeight: 17, color: theme.textSecondary, marginTop: 10 }}>
                {`${APP} asks Dia for each profile's open and pinned tabs while Dia is running. ${DIA_NOT_SHARED}`}
              </Text>
            )}
          </View>
        )}
        {error && <ErrorText text={error} />}
      </>
    );
    footer = (
      <>
        {api ? <Button title="Bookmarks HTML File…" onPress={() => void importHtml()} /> : null}
        <View style={{ flex: 1 }} />
        {targetPicker}
        <Button title="Cancel" onPress={close} />
        <Button title="Continue" kind="primary" disabled={!source || (!source.requiresExport && !source.needsFullDiskAccess && kinds.size === 0)} onPress={next} />
      </>
    );
  } else if (step === "profiles" && source) {
    body = isArc ? (
      <>
        <Title title="Select spaces to import" subtitle={`We'll import your Arc spaces, tabs, and folders to ${APP}.`} />
        <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 10 }}>{`Customize which spaces to bring over to ${APP}. Each space becomes a profile.`}</Text>
        <View style={{ gap: 6 }}>
          {allSpaces.map((s) => (
            <SelectRow
              key={s.id}
              selected={spaces.includes(s.id)}
              onToggle={(v) => setSpaces((prev) => (v ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
              icon={<SpaceIcon space={s} />}
              title={s.name || "Space"}
              subtitle={`${plural(s.pinnedCount, "pinned tab")} · ${plural(s.tabCount, "tab")}`}
            />
          ))}
        </View>
      </>
    ) : (
      <>
        {isDiaTabs ? (
          <Title title="Choose Dia profiles" subtitle="Select the profiles whose tabs you want to bring over." />
        ) : (
          <Title title="Unlock your data for import" subtitle="Select the profiles you want to import." />
        )}
        <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 10 }}>{`Customize which profiles to bring over to ${APP}. The first goes into your selected profile; the others become new profiles.`}</Text>
        <View style={{ gap: 6 }}>
          {source.profiles.map((p) => (
            <SelectRow
              key={p.id}
              selected={sourceProfiles.includes(p.id)}
              onToggle={(v) => setSourceProfiles((prev) => (v ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
              icon={
                p.avatarPath ? (
                  <Image source={{ uri: `file://${p.avatarPath}` }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                ) : (
                  <Monogram name={p.name} color={p.color} />
                )
              }
              title={p.name}
              subtitle={isDiaTabs ? diaProfileSummary(dia, p.id) : (p.email ?? (p.isDefault ? "Default profile" : undefined))}
            />
          ))}
        </View>
      </>
    );
    footer = (
      <>
        <Button title="Back" onPress={() => setStep("choose")} />
        <View style={{ flex: 1 }} />
        {targetPicker}
        <Button title="Continue" kind="primary" disabled={isArc ? !spaces.length : !sourceProfiles.length} onPress={next} />
      </>
    );
  } else if (step === "unlock" && source) {
    const many = sourceProfiles.length > 1;
    body = (
      <>
        <Title title="Unlock your data for import" subtitle={`${APP} can securely import logins from your previous browser, so you don't have to enter all of your passwords again.`} />
        <View style={{ alignItems: "center", marginTop: 10, gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {source.iconPath ? <Image source={{ uri: `file://${source.iconPath}` }} style={{ width: 56, height: 56 }} /> : null}
            <Symbol name="arrow.right" size={16} color={theme.textTertiary} style={{ width: 20, height: 20 }} />
            <Symbol name="lock.fill" size={30} color={theme.icon} style={{ width: 56, height: 56 }} />
          </View>
          <Text style={{ fontSize: 13, lineHeight: 18, textAlign: "center", color: theme.textPrimary, maxWidth: 420 }}>
            {many
              ? `Some data is encrypted, so macOS will ask for your computer password once for each selected profile.`
              : `Some data is encrypted, so macOS will ask for your computer password to bring it securely into ${APP}.`}
          </Text>
        </View>
        {error && <ErrorText text={error} />}
      </>
    );
    footer = (
      <>
        <Button title="Back" onPress={() => setStep(source.profiles.length > 1 || isArc ? "profiles" : "choose")} />
        <View style={{ flex: 1 }} />
        <Button
          title="Skip Passwords"
          onPress={() => {
            const without = new Set(kinds);
            without.delete("passwords");
            setKinds(without);
            void run(without);
          }}
        />
        <Button title={unlocking ? "Waiting for password..." : "Continue"} kind="primary" disabled={unlocking} onPress={() => void unlock()} />
      </>
    );
  } else if (step === "safari") {
    body = fullDiskAccess ? (
      <>
        <Title title="Import from Safari" subtitle={`Netnyahoo can read Safari directly. Bring your bookmarks, history, Reading List and open tabs into ${APP}.`} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 }}>
          {source?.iconPath ? <Image source={{ uri: `file://${source.iconPath}` }} style={{ width: 40, height: 40 }} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Bookmarks, history, Reading List and tabs</Text>
            <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>Full Disk Access is granted.</Text>
          </View>
          <Button title="Import from Safari" kind="primary" onPress={() => void importSafariDirect()} />
        </View>
        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, marginBottom: 8 }}>
          Passwords and payment cards can't be read directly — import them from an export file:
        </Text>
        <FileDrop onFile={(path) => void importSafari(path)} onChoose={async () => (await api?.chooseImportFile("safariExport")) ?? null} />
        {error && <ErrorText text={error} />}
      </>
    ) : (
      <>
        <Title title="Give Netnyahoo access to Safari" subtitle={`To import Safari's bookmarks, history and tabs directly, ${APP} needs Full Disk Access.`} />
        <FullDiskAccessSteps onOpen={() => void api?.openFullDiskAccessSettings()} onRecheck={() => void recheckAccess()} />
        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, marginBottom: 8 }}>
          Or import everything (including passwords) from an export file:
        </Text>
        <View style={{ gap: 6, marginBottom: 12 }}>
          {["Open Safari", "File menu › Export Browsing Data to File", `Upload the .zip file to ${APP}`].map((t, i) => (
            <Text key={t} style={{ fontSize: 12, color: theme.textSecondary }}>{`${i + 1}. ${t}`}</Text>
          ))}
        </View>
        <FileDrop onFile={(path) => void importSafari(path)} onChoose={async () => (await api?.chooseImportFile("safariExport")) ?? null} />
        {error && <ErrorText text={error} />}
      </>
    );
    footer = (
      <>
        <Button title="Back" onPress={() => setStep("choose")} />
        <View style={{ flex: 1 }} />
        {targetPicker}
        <Button title="Cancel" onPress={close} />
      </>
    );
  } else if (step === "access" && source) {
    body = (
      <>
        <Title title={`Give ${APP} access to ${source.name}`} subtitle={`macOS protects ${source.name}'s data from other apps. To import your bookmarks, history, tabs and passwords, ${APP} needs Full Disk Access.`} />
        <FullDiskAccessSteps onOpen={() => void api?.openFullDiskAccessSettings()} onRecheck={() => void recheckAccess()} />
        {error && <ErrorText text={error} />}
      </>
    );
    footer = (
      <>
        <Button title="Back" onPress={() => setStep("choose")} />
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={close} />
      </>
    );
  } else if (step === "dia" && source) {
    const retry = <Button title="Check Again" onPress={() => void refreshDia()} />;
    if (diaStatus === "checking" || diaStatus === "reading") {
      body = <Title title="Reading Dia's tabs" subtitle="Asking Dia for its profiles, open tabs and pinned tabs..." spinner />;
    } else if (diaStatus === "notInstalled") {
      body = <Title title="Dia isn't installed" subtitle={`Install Dia and open it to import its tabs into ${APP}.`} />;
    } else if (diaStatus === "notRunning") {
      body = (
        <>
          <Title title="Open Dia to import its tabs" subtitle={`${APP} asks Dia for its tabs, so Dia has to be running. Open it and this continues on its own.`} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Button title="Open Dia" kind="primary" onPress={() => void openDia()} />
            {retry}
          </View>
        </>
      );
    } else if (diaStatus === "notDetermined") {
      body = (
        <>
          <Title title={`Allow ${APP} to read Dia's tabs`} subtitle="Dia shares its tabs through AppleScript, and macOS asks you before an app can use it." />
          <View style={{ alignItems: "center", marginTop: 10, gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              {source.iconPath ? <Image source={{ uri: `file://${source.iconPath}` }} style={{ width: 56, height: 56 }} /> : null}
              <Symbol name="arrow.right" size={16} color={theme.textTertiary} style={{ width: 20, height: 20 }} />
              <Symbol name="square.on.square" size={30} color={theme.icon} style={{ width: 56, height: 56 }} />
            </View>
            <Text style={{ fontSize: 13, lineHeight: 18, textAlign: "center", color: theme.textPrimary, maxWidth: 440 }}>
              {`When you continue, macOS asks whether “${APP}” may control “Dia”. Click Allow, and ${APP} asks Dia for its profiles, open tabs and pinned tabs. It only reads them: nothing in Dia changes.`}
            </Text>
            <Text style={{ fontSize: 12, lineHeight: 17, textAlign: "center", color: theme.textSecondary, maxWidth: 440 }}>{DIA_NOT_SHARED}</Text>
          </View>
        </>
      );
    } else if (diaStatus === "denied") {
      body = (
        <>
          <Title title={`${APP} can't read Dia's tabs`} subtitle={`macOS doesn't allow ${APP} to control Dia. You can allow it in System Settings › Privacy & Security › Automation.`} />
          <SettingsSteps
            steps={["Click “Open Automation Settings” below", `Under ${APP}, turn on Dia`, "Come back here: we'll continue automatically"]}
            openTitle="Open Automation Settings"
            onOpen={() => void api?.openAutomationSettings()}
            onRecheck={() => void refreshDia()}
          />
        </>
      );
    } else {
      // Allowed, but Dia had nothing to give or didn't answer.
      body = (
        <>
          <Title title="Import tabs from Dia" subtitle={DIA_NOT_SHARED} />
          <Button title="Try Again" onPress={() => void readDia()} />
        </>
      );
    }
    if (error) body = (
      <>
        {body}
        <ErrorText text={error} />
      </>
    );
    footer = (
      <>
        <Button title="Back" onPress={() => setStep("choose")} />
        <View style={{ flex: 1 }} />
        {targetPicker}
        <Button title="Cancel" onPress={close} />
        {diaStatus === "notDetermined" && (
          <Button title={asking ? "Waiting for macOS..." : "Continue"} kind="primary" disabled={asking} onPress={() => void allowDia()} />
        )}
      </>
    );
  } else if (step === "progress") {
    body = (
      <>
        <Title
          title={`Importing from ${isDiaTabs ? "Dia" : (source?.name ?? "file")}`}
          subtitle={preparing > 1 ? `Preparing ${preparing} profiles` : "Preparing your profile"}
          spinner
        />
        <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 12 }}>Hold on while we fetch your data...</Text>
        <View style={{ gap: 6 }}>
          {KINDS.filter((k) => status[k.kind]).map((k, i) => (
            <CategoryRow key={k.kind} title={k.title} icon={k.icon} status={status[k.kind]!} index={i} />
          ))}
        </View>
      </>
    );
    footer = (
      <>
        <View style={{ flex: 1 }} />
        <Button
          title="Cancel"
          onPress={() => {
            abort.current?.abort();
            close();
          }}
        />
      </>
    );
  } else if (step === "done") {
    const summary = [
      counts.bookmarks && plural(counts.bookmarks, "bookmark"),
      counts.history && plural(counts.history, "history item"),
      counts.passwords && plural(counts.passwords, "password"),
      counts.tabs && plural(counts.tabs, "tab"),
    ].filter(Boolean) as string[];
    body = failures.length ? (
      <>
        <Title title={summary.length ? "Partially imported" : "Import failed"} subtitle="Only some of your data imported. Please try again!" />
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary, marginBottom: 6 }}>Some import steps failed:</Text>
        {failures.map((f) => (
          <Text key={f.kind} style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 3 }}>
            {f.profiles.length ? `${kindTitle(f.kind)} import failed for profiles ${f.profiles.join(", ")}` : `${kindTitle(f.kind)} import failed`}
          </Text>
        ))}
        {summary.length > 0 && <Text style={{ fontSize: 12, marginTop: 12, color: theme.textSecondary }}>{`Imported ${summary.join(", ")}.`}</Text>}
        <Text style={{ fontSize: 12, marginTop: 12, color: theme.textTertiary }}>You can retry the import later from the app menu.</Text>
      </>
    ) : (
      <View style={{ alignItems: "center", marginTop: 40, gap: 12 }}>
        <SuccessMark />
        <Text style={{ fontSize: 20, fontWeight: "600", color: theme.textPrimary }}>You're all set</Text>
        <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center" }}>
          {summary.length ? `Imported ${summary.join(", ")}.` : "There was nothing new to import."}
        </Text>
      </View>
    );
    footer = (
      <>
        <View style={{ flex: 1 }} />
        {failures.length > 0 && <Button title="Try Again" onPress={() => setStep("choose")} />}
        <Button title={failures.length ? "Continue" : "Finish importing"} kind="primary" onPress={close} />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F4F4F4" }}>
      <VisualEffect material="windowBackground" blendingMode="behindWindow" style={StyleSheet.absoluteFill} />
      <WindowDragRegion style={{ position: "absolute", left: 0, right: 0, top: 0, height: 40 }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 32, paddingTop: 46, paddingBottom: 20 }}>
        {body}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 20,
          height: 56,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: theme.divider,
        }}
      >
        {footer}
      </View>
    </View>
  );
}

function defaultTarget(): string {
  const s = useBrowser.getState();
  const w = s.windows[s.ui.focusedWindowId ?? ""];
  return w && !w.incognito ? w.profileId : s.settings.defaultProfileId;
}

function Title({ title, subtitle, spinner }: { title: string; subtitle?: string; spinner?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 22, fontWeight: "700", color: theme.textPrimary }}>{title}</Text>
      {subtitle ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
          {spinner && <ActivityIndicator size="small" />}
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: theme.textSecondary }}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Note({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 20, textAlign: "center" }}>{text}</Text>;
}

function ErrorText({ text }: { text: string }) {
  return <Text style={{ fontSize: 12, marginTop: 12, color: "#FF9F0A" }}>{text}</Text>;
}

/** A browser in the picker: radio, app icon, name, and how many profiles / spaces it has. */
function BrowserRow({ browser, selected, onPress }: { browser: BrowserSource; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const spaces = browser.profiles.reduce((n, p) => n + (p.spaces?.length ?? 0), 0);
  const detail = browser.needsFullDiskAccess
    ? "Needs Full Disk Access"
    : browser.family === "automation"
    ? "Asks Dia while it's open"
    : browser.requiresExport
    ? "Direct or from an exported .zip"
    : browser.family === "arc" && spaces
      ? plural(spaces, "space")
      : browser.profiles.length > 1
        ? plural(browser.profiles.length, "profile")
        : "";
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View
          style={{
            height: 52,
            borderRadius: 10,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: selected ? `${colors.accent}26` : hovered ? colors.selected : colors.group,
            borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
            borderColor: selected ? colors.accent : colors.groupBorder,
          }}
        >
          <Radio on={selected} />
          {browser.iconPath ? (
            <Image source={{ uri: `file://${browser.iconPath}` }} style={{ width: 32, height: 32 }} />
          ) : (
            <Symbol name="globe" size={22} color={theme.icon} style={{ width: 32, height: 32 }} />
          )}
          <Text style={{ flex: 1, fontSize: 14, fontWeight: "500", color: theme.textPrimary }}>{browser.name}</Text>
          {detail ? <Text style={{ fontSize: 12, color: theme.textSecondary }}>{detail}</Text> : null}
          {browser.needsKeychain && <Symbol name="lock" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />}
        </View>
      </Pressable>
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  const colors = useFormColors();
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.accent : colors.control,
        borderWidth: on ? 0 : 1,
        borderColor: colors.controlBorder,
      }}
    >
      {on && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" }} />}
    </View>
  );
}

function SelectRow({ selected, onToggle, icon, title, subtitle }: { selected: boolean; onToggle: (v: boolean) => void; icon: ReactNode; title: string; subtitle?: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  return (
    <Pressable onPress={() => onToggle(!selected)}>
      <View
        style={{
          minHeight: 48,
          borderRadius: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: colors.group,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.groupBorder,
        }}
      >
        <Checkbox value={selected} onChange={onToggle} />
        {icon}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13.5, color: theme.textPrimary }}>{title}</Text>
          {subtitle ? <Text style={{ fontSize: 11.5, marginTop: 1, color: theme.textSecondary }}>{subtitle}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function Monogram({ name, color }: { name: string; color?: string }) {
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color ?? "#8E8E93", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

function SpaceIcon({ space }: { space: SpaceSummary }) {
  return (
    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: space.color ?? "#8E8E93", alignItems: "center", justifyContent: "center" }}>
      {space.emoji ? <Text style={{ fontSize: 15 }}>{space.emoji}</Text> : <Symbol name="square.stack" size={12} color="#FFFFFF" style={{ width: 16, height: 16 }} />}
    </View>
  );
}

/** A category in the progress list: slides in, spins while active, checks off when done. */
function CategoryRow({ title, icon, status, index }: { title: string; icon: string; status: Status; index: number }) {
  const theme = useTheme();
  const colors = useFormColors();
  const appear = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 260, delay: index * 70, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  useEffect(() => {
    if (status === "done" || status === "failed") Animated.spring(check, { toValue: 1, friction: 5, tension: 160, useNativeDriver: false }).start();
  }, [status]);
  const active = status === "active";
  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        height: 44,
        borderRadius: 10,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: active ? `${colors.accent}1F` : colors.group,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: active ? `${colors.accent}66` : colors.groupBorder,
      }}
    >
      <Symbol name={icon} size={13} color={status === "pending" ? theme.textTertiary : theme.icon} style={{ width: 20, height: 20 }} />
      <Text style={{ flex: 1, fontSize: 13, color: status === "pending" ? theme.textSecondary : theme.textPrimary }}>{title}</Text>
      {active ? (
        <ActivityIndicator size="small" />
      ) : status === "pending" ? null : (
        <Animated.View style={{ transform: [{ scale: check }] }}>
          <Symbol
            name={status === "done" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
            size={15}
            color={status === "done" ? "#30D158" : "#FF9F0A"}
            style={{ width: 20, height: 20 }}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

function SuccessMark() {
  const scale = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: false }).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Symbol name="checkmark.circle.fill" size={46} color="#30D158" style={{ width: 60, height: 60 }} />
    </Animated.View>
  );
}

/** "Pinned: 3 · Open: 5" for a Dia profile in the profile list. */
function diaProfileSummary(dia: DiaTabsResult | null, id: string): string | undefined {
  const p = dia?.profiles.find((x) => x.id === id);
  return p ? `${plural(p.pinned.length, "pinned tab")} · ${plural(p.tabs.length, "open tab")}` : undefined;
}

/** The Full Disk Access instructions, with the System Settings link and a manual re-check. */
function FullDiskAccessSteps({ onOpen, onRecheck }: { onOpen: () => void; onRecheck: () => void }) {
  return (
    <SettingsSteps
      steps={["Click “Open Full Disk Access Settings” below", `Turn on ${APP} in the list`, "Come back here: we'll continue automatically"]}
      openTitle="Open Full Disk Access Settings"
      onOpen={onOpen}
      onRecheck={onRecheck}
    />
  );
}

/** Numbered steps to grant something in System Settings, its link, and a manual re-check. */
function SettingsSteps({ steps, openTitle, onOpen, onRecheck }: { steps: string[]; openTitle: string; onOpen: () => void; onRecheck: () => void }) {
  const theme = useTheme();
  return (
    <>
      <View style={{ gap: 10, marginBottom: 16 }}>
        {steps.map((t, i) => (
          <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.rowHover, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>{i + 1}</Text>
            </View>
            <Text style={{ fontSize: 13, color: theme.textPrimary }}>{t}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <Button title={openTitle} kind="primary" onPress={onOpen} />
        <Button title="Check Again" onPress={onRecheck} />
      </View>
    </>
  );
}

/** Dia's "Choose .zip file or drag it here" drop area. */
function FileDrop({ onFile, onChoose }: { onFile: (path: string) => void; onChoose: () => Promise<string | null> }) {
  const theme = useTheme();
  const colors = useFormColors();
  const [over, setOver] = useState(false);
  return (
    <View
      draggedTypes={["fileUrl"]}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const uri = e.nativeEvent.dataTransfer?.files?.[0]?.uri;
        if (uri) onFile(decodeURIComponent(uri.replace(/^file:\/\//, "")));
      }}
      style={{
        height: 130,
        borderRadius: 12,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: over ? colors.accent : theme.dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)",
        backgroundColor: over ? `${colors.accent}1A` : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      <Symbol name="doc.zipper" size={24} color={theme.textSecondary} style={{ width: 32, height: 32 }} />
      <Text style={{ fontSize: 13, color: theme.textSecondary }}>Choose .zip file or drag it here</Text>
      <Button
        title="Choose .zip file"
        onPress={() =>
          void onChoose().then((path) => {
            if (path) onFile(path);
          })
        }
      />
    </View>
  );
}
