import { permissionWarnings, WebView, type InstalledExtension, type WebViewHandle } from "@netnyahoo/cef";
import { Surface } from "@netnyahoo/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { PromptButton } from "../layout/controls";
import { Checkbox } from "../settings/controls";
import {
  cancelInstall,
  closeExtensionPopup,
  confirmInstall,
  extensionProfile,
  setPinned,
  useExtensionList,
  useExtensions,
  type InstallRequest,
} from "./state";

/** The extension popup, install dialog and Pin Extensions dialog of this window. */
export function ExtensionOverlays() {
  const windowId = useWindowId();
  const popup = useExtensions((e) => (e.popup?.windowId === windowId ? e.popup : null));
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  const pin = useExtensions((e) => e.pinDialog?.windowId === windowId);
  return (
    <>
      {popup && <ActionPopup key={`${popup.extensionId}|${popup.url}`} {...popup} />}
      {install && <InstallDialog request={install} />}
      {pin && <PinDialog windowId={windowId} />}
    </>
  );
}

/** The install dialog for another host (the Settings window). */
export function InstallDialogHost({ windowId, onClosed }: { windowId: string; onClosed: () => void }) {
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  useEffect(() => {
    if (!install) onClosed();
  }, [!install]);
  return install ? <InstallDialog request={install} /> : null;
}

// MARK: Action popup

// Chrome's limits for extension popups.
const MIN = { width: 25, height: 25 };
const MAX = { width: 800, height: 600 };

/**
 * Reports the page's content size whenever it changes (resolves once per change;
 * call again to keep watching).
 */
const MEASURE = `
const measure = () => {
  const d = document.documentElement, b = document.body;
  return { w: Math.ceil(Math.max(d.scrollWidth, b ? b.scrollWidth : 0)), h: Math.ceil(Math.max(d.scrollHeight, b ? b.scrollHeight : 0)) };
};
const last = window.__netnyahooSize;
const now = measure();
if (!last || last.w !== now.w || last.h !== now.h) {
  window.__netnyahooSize = now;
  post("result", JSON.stringify(now));
} else {
  const ro = new ResizeObserver(() => {
    const m = measure();
    if (m.w === window.__netnyahooSize.w && m.h === window.__netnyahooSize.h) return;
    ro.disconnect();
    window.__netnyahooSize = m;
    post("result", JSON.stringify(m));
  });
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
}`;

/**
 * An extension's action popup: its page in a bubble hanging from the toolbar
 * button, sized to the page like Chrome (25×25 up to 800×600). Clicking
 * elsewhere or the page's window.close() dismisses it.
 */
function ActionPopup({ windowId, profile, url, anchor }: { windowId: string; profile: string; extensionId: string; url: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const theme = useTheme();
  const web = useRef<WebViewHandle>(null);
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const watchSize = () => {
    void web.current?.evaluate<{ w: number; h: number }>(MEASURE).then((m) => {
      if (!alive.current || !m) return;
      const next = {
        width: Math.min(MAX.width, Math.max(MIN.width, m.w)),
        height: Math.min(MAX.height, Math.max(MIN.height, m.h)),
      };
      setSize((prev) => {
        if (!prev) Animated.timing(appear, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
        return prev && prev.width === next.width && prev.height === next.height ? prev : next;
      });
      watchSize();
    });
  };

  // Right edge on the button's right edge, clamped to the window.
  // The bubble's hairline border sits inside it: one more point keeps the page from scrolling.
  const width = (size?.width ?? MIN.width) + 1;
  const height = (size?.height ?? MIN.height) + 1;
  const left = Math.max(8, Math.min(anchor.x + anchor.width - width, window.width - width - 8));
  const top = anchor.y + anchor.height + 6;

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={closeExtensionPopup} />
      <Animated.View
        style={{
          position: "absolute",
          left,
          top,
          // Measured off-screen-sized first: invisible until the page reports its size.
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
        }}
      >
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={10}
          borderColor={hex(theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)")}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.45 : 0.18}
          shadowRadius={16}
          shadowOffset={[0, 6]}
          style={{ width, height }}
        >
          <View style={{ flex: 1, borderRadius: 10, overflow: "hidden" }}>
            <WebView
              ref={web}
              style={StyleSheet.absoluteFill}
              url={url}
              profile={profile}
              // A popup, not a tab: outside the window's Chrome tab strip.
              standalone
              pageBackgroundColor="#FFFFFF"
              onNavigationChange={({ isLoading }) => {
                if (isLoading) return;
                watchSize();
                void web.current?.focus();
              }}
              onWindowClose={closeExtensionPopup}
              onOpenWindow={({ url: target, disposition }) => {
                useBrowser.getState().newTab(windowId, { url: target, background: disposition === "background" });
                if (disposition !== "background") closeExtensionPopup();
              }}
            />
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}

// MARK: Install dialog

/**
 * Dia's "Add “…”?" confirmation: the extension's icon and name, what it will
 * be able to do (Chrome's permission warnings), Cancel / Add Extension.
 */
function InstallDialog({ request }: { request: InstallRequest }) {
  const theme = useTheme();
  const pkg = request.pkg;
  const name = pkg?.name ?? "Extension";
  // Chrome's own flow brings its warnings; an unpacked folder's are read off its manifest.
  const warnings = request.prompt ? request.prompt.permissions : pkg ? permissionWarnings(pkg) : [];
  const kind = request.prompt?.type;
  const title = kind === "re-enable" ? `Turn “${name}” back on?` : kind === "permissions" ? `“${name}” needs new permissions` : `Add “${name}”?`;
  const action = kind === "re-enable" ? "Turn On" : kind === "permissions" ? "Allow" : "Add Extension";
  const busy = request.status === "installing";

  let body;
  if (request.status === "error") {
    body = (
      <>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Couldn't add the extension</Text>
        <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 6 }}>{request.error}</Text>
      </>
    );
  } else {
    body = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {pkg?.icon ? <Image source={{ uri: pkg.icon }} style={{ width: 36, height: 36 }} /> : null}
          <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
        </View>
        {warnings.length ? (
          <>
            <Text style={{ fontSize: 13, color: theme.textPrimary, marginTop: 14, marginBottom: 6 }}>It can:</Text>
            <ScrollView style={{ maxHeight: 180 }}>
              {warnings.map((w) => (
                <View key={w} style={{ flexDirection: "row", gap: 7, marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: theme.textSecondary }}>•</Text>
                  <Text style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>{w}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 14 }}>This extension requires no special permissions.</Text>
        )}
        {request.source === "unpacked" ? (
          <Text numberOfLines={2} ellipsizeMode="middle" style={{ fontSize: 11, color: theme.textTertiary, marginTop: 10 }}>
            {`Loaded from ${pkg?.path ?? ""}`}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Dialog onDismiss={busy ? undefined : cancelInstall}>
      {body}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        {request.status === "error" ? (
          <PromptButton title="OK" primary onPress={cancelInstall} />
        ) : (
          <>
            <PromptButton title="Cancel" onPress={cancelInstall} />
            <PromptButton title={request.status === "installing" ? "Adding…" : action} primary onPress={() => void confirmInstall()} />
          </>
        )}
      </View>
    </Dialog>
  );
}

// MARK: Pin Extensions

/** Extensions › Pin Extensions…: which extensions show in the toolbar. */
function PinDialog({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const profile = useBrowser((s) => extensionProfile(s, windowId));
  const list = useExtensionList(profile).filter((x) => x.enabled);
  const close = () => useExtensions.setState({ pinDialog: null });
  return (
    <Dialog onDismiss={close}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Pin Extensions</Text>
      <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 4, marginBottom: 12 }}>
        Pinned extensions appear in the toolbar, next to the address.
      </Text>
      {list.length ? (
        <ScrollView style={{ maxHeight: 300 }}>
          {list.map((ext) => (
            <PinRow key={ext.id} ext={ext} onChange={(pinned) => void setPinned(profile, ext.id, pinned)} />
          ))}
        </ScrollView>
      ) : (
        <Text style={{ fontSize: 13, color: theme.textTertiary }}>No extensions are turned on.</Text>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16 }}>
        <PromptButton title="Done" primary onPress={close} />
      </View>
    </Dialog>
  );
}

function PinRow({ ext, onChange }: { ext: InstalledExtension; onChange: (pinned: boolean) => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={() => onChange(!ext.pinned)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
      <Checkbox value={ext.pinned} onChange={onChange} />
      <Image source={{ uri: ext.actionIcon || ext.icon }} style={{ width: 16, height: 16 }} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
        {ext.name}
      </Text>
    </Pressable>
  );
}

/** A centred modal panel over the window (dimmed backdrop). */
function Dialog({ onDismiss, children }: { onDismiss?: () => void; children: ReactNode }) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear, backgroundColor: theme.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)" }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>
      <Animated.View style={{ opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={14}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={30}
          shadowOffset={[0, 12]}
          style={{ width: 380, padding: 20 }}
        >
          {children}
        </Surface>
      </Animated.View>
    </View>
  );
}
