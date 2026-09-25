import {
  addToDock,
  fileExists,
  fileIcon,
  isDefaultBrowser,
  isInDock,
  launchAtLoginStatus,
  setAsDefaultBrowser,
  setLaunchAtLogin,
  Symbol,
} from "@netnyahoo/shell";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { PROFILE_COLORS, themeFor, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { Favicon, useHover } from "../primitives";
import { openImport } from "../settings/windows";
import { PERSONALIZE_COPY, TabLayoutPicker, ThemeColorPicker } from "./personalize";
import { PINNABLE_SITES, pinSites, preselectedSites } from "./sites";
import { finishOnboarding, recordDefaultBrowserTrial, useOnboarding } from "./state";
import { CheckMark, CheckRow, PrimaryButton, Reveal, SecondaryButton, StepProgress, StepTitle, useOnboardingColors } from "./ui";

const ICON = require("../../../assets/app-icon.png");

/** A step's card: content and actions on the left, an illustration on the right. */
function StepLayout({ children, actions, preview }: { children: ReactNode; actions: ReactNode; preview: ReactNode }) {
  const colors = useOnboardingColors();
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: 460, paddingHorizontal: 40, paddingTop: 34, paddingBottom: 32, justifyContent: "space-between" }}>
        <View style={{ gap: 20 }}>
          <Reveal>
            <StepProgress />
          </Reveal>
          {children}
        </View>
        <Reveal delay={240} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {actions}
        </Reveal>
      </View>
      <View
        style={{
          flex: 1,
          margin: 12,
          marginLeft: 0,
          borderRadius: 14,
          backgroundColor: colors.preview,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.previewBorder,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Reveal delay={120} style={{ alignItems: "center", justifyContent: "center" }}>
          {preview}
        </Reveal>
      </View>
    </View>
  );
}

// MARK: Default browser, Dock, login item

type SystemState = { isDefault: boolean; inDock: boolean; loginEnabled: boolean };

export function DefaultBrowserStep() {
  const next = useOnboarding((s) => s.next);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [setDefault, setSetDefault] = useState(true);
  const [trial, setTrial] = useState(false);
  const [dock, setDock] = useState(true);
  // Off unless it already is: opening at login is a bigger ask than the others.
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([isDefaultBrowser(), isInDock(), launchAtLoginStatus()]).then(([isDefault, inDock, login]) => {
      setSystem({ isDefault, inDock, loginEnabled: login === "enabled" });
      if (login === "enabled") setLogin(true);
    });
  }, []);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    try {
      // macOS asks the user to confirm the default browser itself.
      if (setDefault && !system.isDefault && (await setAsDefaultBrowser()) && trial) recordDefaultBrowserTrial();
      if (login !== system.loginEnabled) await setLaunchAtLogin(login).catch(() => {});
      // Last: the Dock restarts to show the new tile.
      if (dock && !system.inDock) await addToDock();
    } finally {
      setBusy(false);
      next();
    }
  };

  const defaultOn = system?.isDefault || setDefault;
  return (
    <StepLayout
      actions={<PrimaryButton title={busy ? "Setting Up…" : "Continue"} onPress={() => void apply()} disabled={!system || busy} />}
      preview={<SystemPreview isDefault={!!defaultOn} dock={!!(system?.inDock || dock)} login={login} />}
    >
      <Reveal delay={60}>
        <StepTitle title="Fast, secure, and packed with all your browser essentials" subtitle="Netnyahoo works best as your default browser." />
      </Reveal>
      <Reveal delay={140} style={{ gap: 6 }}>
        <CheckRow
          icon="globe"
          title="Set Netnyahoo as default browser"
          subtitle={system?.isDefault ? "Netnyahoo is already your default browser" : "Open links and web pages in Netnyahoo by default"}
          value={defaultOn}
          disabled={!system || system.isDefault}
          onChange={setSetDefault}
        />
        {!system?.isDefault && setDefault ? (
          <CheckRow
            icon="calendar"
            title="Try Netnyahoo as your default for seven days"
            subtitle="We'll check in to make sure you love it."
            value={trial}
            onChange={setTrial}
          />
        ) : null}
        {system && !system.inDock ? (
          <CheckRow icon="dock.rectangle" title="Add Netnyahoo to Dock" subtitle="Quick access to Netnyahoo whenever you need it" value={dock} onChange={setDock} />
        ) : null}
        <CheckRow icon="power" title="Open Netnyahoo at login" subtitle="Automatically open Netnyahoo when you sign in" value={login} onChange={setLogin} />
      </Reveal>
    </StepLayout>
  );
}

function SystemPreview({ isDefault, dock, login }: { isDefault: boolean; dock: boolean; login: boolean }) {
  const colors = useOnboardingColors();
  const chip = (on: boolean, icon: string, label: string) => (
    <View
      key={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: 17,
        backgroundColor: colors.row,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        opacity: on ? 1 : 0.45,
      }}
    >
      <Symbol name={icon} size={13} color={colors.title} style={{ width: 16, height: 16 }} />
      <Text style={{ fontSize: 12, fontWeight: "500", color: colors.title }}>{label}</Text>
      <CheckMark on={on} size={16} />
    </View>
  );
  return (
    <View style={{ alignItems: "center", gap: 28 }}>
      <Image source={ICON} style={{ width: 132, height: 132 }} />
      <View style={{ gap: 8, alignItems: "center" }}>
        {chip(isDefault, "globe", "Default browser")}
        {chip(dock, "dock.rectangle", "In your Dock")}
        {chip(login, "power", "Opens at login")}
      </View>
    </View>
  );
}

// MARK: Personalization

export function PersonalizeStep() {
  const next = useOnboarding((s) => s.next);
  const windowId = useOnboarding((s) => s.windowId) ?? "";
  const colors = useOnboardingColors();
  return (
    <StepLayout actions={<PrimaryButton title="Continue" onPress={next} />} preview={<WindowPreview windowId={windowId} />}>
      <Reveal delay={60}>
        <StepTitle title={PERSONALIZE_COPY.title} subtitle={PERSONALIZE_COPY.subtitle} />
      </Reveal>
      <Reveal delay={140} style={{ gap: 18 }}>
        <ThemeColorPicker windowId={windowId} size={32} />
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 12.5, color: colors.subtitle }}>{PERSONALIZE_COPY.layouts}</Text>
          <TabLayoutPicker windowId={windowId} />
        </View>
      </Reveal>
    </StepLayout>
  );
}

/** A small window in the picked colour and layout. */
function WindowPreview({ windowId }: { windowId: string }) {
  const colors = useOnboardingColors();
  const dark = useTheme().dark;
  const color = useBrowser((s) => s.profiles[s.windows[windowId]?.profileId ?? ""]?.color ?? "plum");
  const layout = useBrowser((s) => s.windows[windowId]?.tabLayout ?? s.settings.tabLayout);
  const theme = themeFor(`${color}:${dark ? "dark" : "light"}`);
  const swatch = PROFILE_COLORS[color]?.swatch ?? PROFILE_COLORS.plum.swatch;
  const line = { height: 6, borderRadius: 3, backgroundColor: colors.progressTrack };
  return (
    <View
      style={{
        width: 280,
        height: 184,
        borderRadius: 12,
        padding: 7,
        gap: 6,
        backgroundColor: theme.windowTint[0],
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        flexDirection: layout === "sidebar" ? "row" : "column",
      }}
    >
      {layout === "sidebar" ? (
        <View style={{ width: 70, gap: 6, paddingTop: 4 }}>
          <View style={{ flexDirection: "row", gap: 4, marginBottom: 6 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <View key={c} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c }} />
            ))}
          </View>
          <View style={[line, { width: "90%", height: 16, borderRadius: 5, backgroundColor: theme.card }]} />
          {[0.8, 0.6, 0.7].map((w, i) => (
            <View key={i} style={[line, { width: `${w * 100}%` }]} />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 18 }}>
          <View style={{ flexDirection: "row", gap: 4, marginRight: 6 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <View key={c} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: c }} />
            ))}
          </View>
          <View style={[line, { width: 56, height: 14, borderRadius: 5, backgroundColor: theme.card }]} />
          {[0, 1].map((i) => (
            <View key={i} style={[line, { width: 44 }]} />
          ))}
        </View>
      )}
      <View style={{ flex: 1, borderRadius: 7, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: "62%", height: 22, borderRadius: 7, backgroundColor: colors.card, borderWidth: 1, borderColor: `${swatch}99` }} />
      </View>
    </View>
  );
}

// MARK: Import

/** Browsers the import flow understands, if installed (icons are the apps' own). */
const BROWSERS = [
  { name: "Chrome", path: "/Applications/Google Chrome.app" },
  { name: "Safari", path: "/Applications/Safari.app" },
  { name: "Arc", path: "/Applications/Arc.app" },
  { name: "Firefox", path: "/Applications/Firefox.app" },
  { name: "Edge", path: "/Applications/Microsoft Edge.app" },
  { name: "Brave", path: "/Applications/Brave Browser.app" },
  { name: "Opera", path: "/Applications/Opera.app" },
  { name: "Vivaldi", path: "/Applications/Vivaldi.app" },
];

export function ImportStep() {
  const next = useOnboarding((s) => s.next);
  const colors = useOnboardingColors();
  const [opened, setOpened] = useState(false);
  const [icons, setIcons] = useState<{ name: string; uri: string }[]>([]);

  useEffect(() => {
    // Safari lives in /System/Cryptexes on recent macOS, but /Applications/Safari.app still resolves.
    const installed = BROWSERS.filter((b) => fileExists(b.path)).slice(0, 6);
    void Promise.all(installed.map(async (b) => ({ name: b.name, uri: (await fileIcon(b.path, 56)) ?? "" }))).then((list) =>
      setIcons(list.filter((i) => i.uri)),
    );
  }, []);

  const importNow = () => {
    openImport();
    setOpened(true);
  };

  return (
    <StepLayout
      actions={
        opened ? (
          <PrimaryButton title="Continue" onPress={next} />
        ) : (
          <>
            <PrimaryButton title="Import…" onPress={importNow} />
            <SecondaryButton title="Skip" onPress={next} />
          </>
        )
      }
      preview={
        <View style={{ alignItems: "center", gap: 22 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, maxWidth: 300 }}>
            {icons.map((i) => (
              <View key={i.name} style={{ alignItems: "center", gap: 6, width: 72 }}>
                <Image source={{ uri: i.uri }} style={{ width: 56, height: 56 }} />
                <Text style={{ fontSize: 11, color: colors.subtitle }}>{i.name}</Text>
              </View>
            ))}
          </View>
          <Symbol name="arrow.down" size={18} weight="medium" color={colors.steps} style={{ width: 24, height: 24 }} />
          <Image source={ICON} style={{ width: 72, height: 72 }} />
        </View>
      }
    >
      <Reveal delay={60}>
        <StepTitle
          title="Bring your browsing with you"
          subtitle={
            opened
              ? "Finish up in the import window, then continue here. You can import more any time from the Netnyahoo menu."
              : "Import bookmarks, history, passwords and tabs from the browser you use now. It all stays on this Mac."
          }
        />
      </Reveal>
    </StepLayout>
  );
}

// MARK: Pinned tabs

export function PinnedTabsStep() {
  const next = useOnboarding((s) => s.next);
  const windowId = useOnboarding((s) => s.windowId);
  const history = useBrowser((s) => s.history[s.windows[windowId ?? ""]?.profileId ?? ""]);
  const initial = useMemo(() => preselectedSites(history ?? []), []);
  const [selected, setSelected] = useState<string[]>(initial);

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const pinSelected = () => {
    if (windowId) pinSites(windowId, selected);
    next();
  };

  return (
    <StepLayout
      actions={
        <>
          <PrimaryButton title={selected.length ? `Pin ${selected.length} ${selected.length === 1 ? "Tab" : "Tabs"}` : "Continue"} onPress={pinSelected} />
          {selected.length ? <SecondaryButton title="Skip" onPress={next} /> : null}
        </>
      }
      preview={<PinnedPreview selected={selected} />}
    >
      <Reveal delay={60}>
        <StepTitle title="Keep your favorite apps handy" subtitle="Pin important apps so they're always available when you open Netnyahoo." />
      </Reveal>
      <Reveal delay={140} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PINNABLE_SITES.map((site) => (
          <SiteTile key={site.id} title={site.title} url={site.url} selected={selected.includes(site.id)} onPress={() => toggle(site.id)} />
        ))}
      </Reveal>
    </StepLayout>
  );
}

function SiteTile({ title, url, selected, onPress }: { title: string; url: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            style={{
              width: 80,
              height: 70,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              backgroundColor: selected || hovered ? colors.button : colors.row,
              borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            <View style={{ opacity: selected || hovered ? 1 : 0.7 }}>
              <Favicon url={url} size={22} />
            </View>
            <Text style={{ fontSize: 11, fontWeight: "500", color: selected ? colors.title : colors.subtitle }}>{title}</Text>
            {selected ? (
              <View style={{ position: "absolute", top: 5, right: 5 }}>
                <CheckMark on size={14} />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** A miniature sidebar: the chosen sites as pinned tabs above a couple of tab rows. */
function PinnedPreview({ selected }: { selected: string[] }) {
  const colors = useOnboardingColors();
  const sites = PINNABLE_SITES.filter((s) => selected.includes(s.id));
  const slots = Math.max(6, Math.ceil(sites.length / 3) * 3);
  return (
    <View style={{ width: 236, padding: 14, borderRadius: 14, backgroundColor: colors.row, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rowBorder, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <View key={c} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: c }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Array.from({ length: slots }, (_, i) => {
          const site = sites[i];
          return (
            <View
              key={site?.id ?? `empty-${i}`}
              style={{
                width: 64,
                height: 40,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: site ? colors.button : "transparent",
                borderWidth: site ? 0 : 1,
                borderStyle: "dashed",
                borderColor: colors.rowBorder,
              }}
            >
              {site ? <Favicon url={site.url} size={18} /> : null}
            </View>
          );
        })}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      {[0.7, 0.5, 0.6].map((w, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 22 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors.progressTrack }} />
          <View style={{ height: 6, borderRadius: 3, width: `${w * 100}%`, backgroundColor: colors.progressTrack }} />
        </View>
      ))}
    </View>
  );
}

// MARK: Welcome

export function OutroStep() {
  const colors = useOnboardingColors();
  return (
    <StepLayout
      actions={
        <>
          <PrimaryButton title="Get Started" icon="arrow.right" onPress={() => finishOnboarding()} />
          <SecondaryButton title="Take the Tour" onPress={() => finishOnboarding({ tour: true })} />
        </>
      }
      preview={<Postcard />}
    >
      <Reveal delay={60}>
        <StepTitle title={"Welcome to your new\nhome on the internet"} subtitle="Everything you set up is saved. Change any of it later in Settings." />
      </Reveal>
      <Reveal delay={140} style={{ gap: 10 }}>
        {[
          ["⌘T", "Open a new tab"],
          ["⌘L", "Go anywhere from the command bar"],
          ["⌘S", "Hide the sidebar for more room"],
        ].map(([keys, label]) => (
          <View key={keys} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ minWidth: 38, height: 24, paddingHorizontal: 7, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}>
              <Text style={{ fontSize: 12, fontWeight: "500", color: colors.title }}>{keys}</Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.subtitle }}>{label}</Text>
          </View>
        ))}
      </Reveal>
    </StepLayout>
  );
}

/** The welcome postcard: stamp, postmark and a short note. */
function Postcard() {
  const colors = useOnboardingColors();
  return (
    <View
      style={{
        width: 300,
        height: 200,
        borderRadius: 6,
        padding: 18,
        flexDirection: "row",
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "-3deg" }],
      }}
    >
      <View style={{ flex: 1, justifyContent: "space-between", paddingRight: 14 }}>
        <Text style={{ fontSize: 20, fontWeight: "300", fontStyle: "italic", color: colors.title }}>Hello!</Text>
        <Text style={{ fontSize: 12, lineHeight: 17, color: colors.subtitle }}>
          {"Glad you're here. Make yourself at home — your tabs, bookmarks and pins are ready."}
        </Text>
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      <View style={{ width: 104, paddingLeft: 14, justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ padding: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.rowBorder, borderRadius: 3 }}>
          <Image source={ICON} style={{ width: 46, height: 46 }} />
        </View>
        <View style={{ alignSelf: "stretch", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 1, backgroundColor: colors.separator }} />
          ))}
        </View>
      </View>
      {/* Postmark, franking the stamp's corner. */}
      <View
        style={{
          position: "absolute",
          right: 54,
          top: 52,
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.steps,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: "-12deg" }],
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 6, fontWeight: "700", letterSpacing: 0.4, color: colors.steps }}>
          WELCOME
        </Text>
      </View>
    </View>
  );
}
