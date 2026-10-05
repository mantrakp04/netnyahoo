import {
  getContentBlocker,
  getSiteSettings,
  isContentBlockerAllowed,
  setContentBlockerAllowed,
  setSiteSetting,
  type SecurityInfo,
  type SiteSettingType,
  type SiteSettingValue,
  type SiteSettings,
} from "@netnyahoo/nncore";
import { cleanUrl, displayHost } from "@netnyahoo/core";
import { confirm, copyText, showMenu, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { useSettings, useTab } from "../../store/hooks";
import { engineProfile, tabLabel } from "../../store/model";
import { Favicon, useHover } from "../primitives";
import { Popover, PopoverRow, PopoverSeparator, Toggle } from "../layout/controls";
import { patchPage, setPopover, usePage } from "../layout/pageState";
import { showToast } from "../layout/splitActions";
import { toggleCastPicker } from "../media/cast";
import { useMedia, usePictureInPicture } from "../media/state";
import { shareTab } from "./share";
import { TranslateRows } from "./TranslateControls";
import { ZoomStepper } from "./ZoomControls";

const PERMISSIONS: { type: SiteSettingType; title: string; icon: string; choices: SiteSettingValue[] }[] = [
  { type: "popups", title: "Pop-ups and Redirects", icon: "macwindow.on.rectangle", choices: ["allow", "block"] },
  { type: "camera", title: "Camera", icon: "video", choices: ["ask", "allow", "block"] },
  { type: "microphone", title: "Microphone", icon: "mic", choices: ["ask", "allow", "block"] },
  { type: "location", title: "Location", icon: "location", choices: ["ask", "allow", "block"] },
  { type: "notifications", title: "Notifications", icon: "bell", choices: ["ask", "allow", "block"] },
  { type: "sound", title: "Sound", icon: "speaker.wave.2", choices: ["allow", "block"] },
];

const choiceTitle = (type: SiteSettingType, value: SiteSettingValue) =>
  type === "sound" ? (value === "block" ? "Muted" : "Allowed") : value === "allow" ? "Allowed" : value === "block" ? "Blocked" : "Ask";

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function SiteControls({ tabId, right, left, top }: { tabId: string; right?: number; left?: number; top: number }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const security = usePage(tabId, (p) => p.security);
  const blocked = usePage(tabId, (p) => p.blocked);
  const showFullUrl = useSettings((s) => s.showFullUrl);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [blocker, setBlocker] = useState<{ enabled: boolean; allowed: boolean } | null>(null);
  const [certOpen, setCertOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const shareRow = useRef<View>(null);
  const url = tab?.url ?? "";
  const origin = originOf(url);
  const host = origin ? new URL(origin).hostname : "";
  const profile = engineProfile(tab?.profileId ?? "");
  const close = () => setPopover(tabId, null);
  // Document PiP may have a window without a tab session.
  const video = useMedia((m) => !!m.sessions[tabId]?.hasVideo || !!m.pipOpen[tabId]);
  const [pip, togglePip] = usePictureInPicture(tabId);

  useEffect(() => {
    if (!origin) return;
    let live = true;
    void getSiteSettings(profile, origin).then((s) => live && setSettings(s));
    void Promise.all([getContentBlocker(), isContentBlockerAllowed(host)]).then(([state, allowed]) => live && setBlocker({ enabled: state.enabled, allowed }));
    // Navigation may finish before the popover subscribes to security updates.
    void webviews.get(tabId)?.getSecurityInfo().then((info) => live && info && patchPage(tabId, { security: info }));
    return () => {
      live = false;
    };
  }, [origin, profile]);

  if (!tab) return null;

  const setPermission = async (type: SiteSettingType, value: SiteSettingValue) => {
    if (!origin) return;
    await setSiteSetting(profile, origin, type, value);
    setSettings(await getSiteSettings(profile, origin));
    if (type === "sound") {
      useBrowser.getState().updateTab(tabId, { muted: value === "block" });
      void webviews.get(tabId)?.setMuted(value === "block");
    }
  };
  const pickPermission = async (type: SiteSettingType, choices: SiteSettingValue[]) => {
    const current = settings?.[type]?.value;
    const choice = await showMenu(choices.map((v) => ({ id: v, title: choiceTitle(type, v), checked: v === current })));
    if (choice) void setPermission(type, choice as SiteSettingValue);
  };
  const toggleBlocker = async (on: boolean) => {
    // A change that fails changed nothing: the toggle shows what the blocker has, and the window says so.
    const failed = await setContentBlockerAllowed(host, !on).then(() => false, () => true);
    const allowed = await isContentBlockerAllowed(host);
    setBlocker((b) => (b ? { ...b, allowed } : b));
    if (failed) return showToast(tab.windowId, "Couldn't Change the Ad Blocker", `Blocking on ${host} is as it was. Try again.`, { icon: "exclamationmark.triangle" });
    // Reload: blocking changes affect new requests only.
    void webviews.get(tabId)?.reload();
  };
  const clearData = async () => {
    if (!origin) return;
    const { confirmed } = await confirm({
      title: `Clear cookies and site data for ${host}?`,
      message: "You'll be signed out of this site, and its offline data will be deleted.",
      confirmTitle: "Clear",
      destructive: true,
      windowId: tab.windowId,
    });
    if (!confirmed) return;
    const result = await webviews.get(tabId)?.clearSiteData();
    const n = result && typeof result.cookies === "number" ? result.cookies : 0;
    setCleared(n ? `Cleared ${n} cookie${n === 1 ? "" : "s"} and site data` : "Cleared site data");
    void webviews.get(tabId)?.reload();
  };
  // The share sheet points at the row; the popover goes once the sheet closes.
  const share = () =>
    shareRow.current?.measureInWindow((x, y, width, height) => void shareTab(tab, tab.windowId, null, [x, y, width, height]).then(close));
  const copyClean = () => {
    copyText(cleanUrl(url));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Popover width={306} top={top} right={right} left={left} onDismiss={close}>
      <View style={{ paddingVertical: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, paddingTop: 6, paddingBottom: 8 }}>
          <Favicon url={url} favicon={tab.favicon} size={20} profileId={tab.profileId} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>
              {host ? displayHost(host) : tabLabel(tab)}
            </Text>
            {tab.title ? (
              <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
                {tab.title}
              </Text>
            ) : null}
          </View>
        </View>

        <ConnectionRow security={security} open={certOpen} onToggle={() => setCertOpen((o) => !o)} />
        {certOpen && security?.certificate ? <CertificateDetails security={security} /> : null}
        <PopoverSeparator />

        <ZoomRow tabId={tabId} zoom={tab.zoom} />
        <PopoverSeparator />

        {video ? (
          <PopoverRow
            icon={pip ? "pip.exit" : "pip.enter"}
            title={pip ? "Exit Picture in Picture" : "Picture in Picture"}
            onPress={() => {
              togglePip();
              close();
            }}
          />
        ) : null}
        {origin ? (
          <PopoverRow
            icon="tv.and.mediabox"
            title="Cast…"
            onPress={() => {
              close();
              if (tab) void toggleCastPicker(tab.windowId);
            }}
          />
        ) : null}
        {video || origin ? <PopoverSeparator /> : null}
        {origin ? <TranslateRows tabId={tabId} onClose={close} /> : null}

        {origin && (
          <>
            <PopoverRow
              icon="shield.lefthalf.filled"
              title="Block Ads & Trackers"
              detail={
                !blocker
                  ? undefined
                  : !blocker.enabled
                    ? "The built-in ad blocker is off. You can change this in Settings."
                    : blocker.allowed
                      ? "The built-in ad blocker is disabled for this site."
                      : blocked > 0
                        ? `${blocked} blocked on this page`
                        : "The built-in ad blocker is turned on for this site."
              }
              accessory={blocker?.enabled ? <Toggle value={!blocker.allowed} onChange={(on) => void toggleBlocker(on)} /> : null}
            />
            <PopoverSeparator />
            {PERMISSIONS.map((p) => (
              <PopoverRow
                key={p.type}
                icon={p.icon}
                title={p.title}
                accessory={<ValueButton title={settings ? choiceTitle(p.type, settings[p.type]?.value ?? "ask") : "…"} onPress={() => void pickPermission(p.type, p.choices)} />}
              />
            ))}
            <PopoverSeparator />
            <PopoverRow icon="trash" title="Clear Cookies and Site Data…" detail={cleared ?? undefined} onPress={() => void clearData()} />
          </>
        )}
        <PopoverRow icon={copied ? "checkmark" : "link"} title={copied ? "Copied a clean link without trackers" : "Copy Clean Link"} onPress={copyClean} />
        {origin ? (
          <View ref={shareRow} collapsable={false}>
            <PopoverRow icon="square.and.arrow.up" title="Share…" onPress={share} />
          </View>
        ) : null}
        <PopoverRow
          icon="text.alignleft"
          title="Show Full URL"
          accessory={<Toggle value={showFullUrl} onChange={(v) => useBrowser.getState().updateSettings({ showFullUrl: v })} />}
        />
      </View>
    </Popover>
  );
}

function ConnectionRow({ security, open, onToggle }: { security: SecurityInfo | null; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const level = security?.level ?? "none";
  const secure = level === "secure";
  const local = level === "local" || level === "none";
  const title = secure ? "Connection is secure" : local ? "This is a local or internal page" : "Connection is not secure";
  const detail =
    level === "certificateError"
      ? "The site's certificate isn't valid. Don't enter passwords or payment details."
      : level === "mixed"
        ? "Parts of this page aren't secure (such as images)."
        : level === "insecure"
          ? "Don't enter sensitive information on this site."
          : secure && security?.certificate
            ? `Certificate issued by ${security.certificate.issuer.organizations[0] || security.certificate.issuer.commonName}`
            : undefined;
  return (
    <PopoverRow
      icon={secure ? "lock.fill" : local ? "info.circle" : "lock.open.trianglebadge.exclamationmark.fill"}
      iconColor={level === "certificateError" || level === "insecure" ? "#FF6B63" : level === "mixed" ? "#F2B33D" : theme.icon}
      title={title}
      detail={detail}
      onPress={security?.certificate ? onToggle : undefined}
      accessory={security?.certificate ? <Symbol name={open ? "chevron.up" : "chevron.down"} size={10} color={theme.textSecondary} style={{ width: 14, height: 14 }} /> : null}
    />
  );
}

function CertificateDetails({ security }: { security: SecurityInfo }) {
  const theme = useTheme();
  const cert = security.certificate!;
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const rows: [string, string][] = [
    ["Issued to", cert.subject.commonName || cert.subject.displayName],
    ["Organization", cert.subject.organizations.join(", ") || "—"],
    ["Issued by", cert.issuer.commonName || cert.issuer.displayName],
    ["Valid from", date(cert.validFrom)],
    ["Expires", date(cert.validUntil)],
    ...(security.protocol ? [["Protocol", security.protocol] as [string, string]] : []),
    ...(cert.sha256 ? [["SHA-256", cert.sha256.replace(/(.{2})(?!$)/g, "$1 ").slice(0, 47) + "…"] as [string, string]] : []),
  ];
  return (
    <View style={{ marginHorizontal: 13, marginTop: 2, marginBottom: 4, padding: 9, borderRadius: 8, backgroundColor: theme.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", gap: 3 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={{ width: 82, fontSize: 11, color: theme.textSecondary }}>{k}</Text>
          <Text numberOfLines={2} selectable style={{ flex: 1, fontSize: 11, color: theme.textPrimary }}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ZoomRow({ tabId, zoom }: { tabId: string; zoom: number }) {
  return <PopoverRow icon="plus.magnifyingglass" title="Zoom" accessory={<ZoomStepper tabId={tabId} zoom={zoom} />} />;
}

function ValueButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 22, paddingLeft: 8, paddingRight: 5, borderRadius: 6, backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>{title}</Text>
          <Symbol name="chevron.up.chevron.down" size={9} color={theme.textSecondary} style={{ width: 12, height: 14 }} />
        </View>
      </Pressable>
    </View>
  );
}
