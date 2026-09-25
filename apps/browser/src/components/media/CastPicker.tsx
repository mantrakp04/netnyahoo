import { CastMode, preferredCastMode, startCasting, stopCasting, type CastSink } from "@netnyahoo/cef";
import { openExternalURL, showMenu, Symbol } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { Popover, PromptButton } from "../layout/controls";
import { useHover } from "../primitives";
import { closeCastPicker, useCast } from "./cast";

/**
 * Chrome's Cast dialog, drawn here: the devices Chrome's Media Router finds and what
 * each is doing. Clicking a device casts the site's own media when it offers it
 * (YouTube, the Presentation API), else the tab; "Screen" in the source menu mirrors
 * the whole screen. A device that's casting from here offers Stop.
 */
const WIDTH = 340;

/** SF Symbol per media_router::SinkIconType. */
const SINK_ICON: Record<number, string> = { 0: "tv", 1: "hifispeaker.2", 2: "hifispeaker", 6: "display", 7: "tv" };

export function CastPicker({ tabId, paneWidth }: { tabId: string; paneWidth: number }) {
  const theme = useTheme();
  const dialog = useCast((c) => c.dialogs[tabId]);
  // "Source": the page (the site's cast or the tab), or the whole screen.
  const [screen, setScreen] = useState(false);
  useEffect(() => setScreen(false), [dialog?.id]);
  if (!dialog) return null;
  const close = () => closeCastPicker(tabId);
  const available = dialog.sinks.filter((s) => s.state !== "unavailable");
  const canScreen = dialog.sinks.some((s) => s.modes & CastMode.screen);
  const width = Math.min(WIDTH, paneWidth - 24);
  const cast = (sink: CastSink) => {
    const mode = screen && sink.modes & CastMode.screen ? CastMode.screen : preferredCastMode(sink.modes & ~CastMode.screen) || preferredCastMode(sink.modes);
    if (mode) void startCasting(dialog.id, sink.id, mode);
  };

  return (
    <Popover key={dialog.id} width={width} top={4} right={8} onDismiss={close}>
      <View style={{ paddingTop: 14, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14 }}>
          <Symbol name="tv.and.mediabox" size={14} color={theme.icon} style={{ width: 20, height: 20 }} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>
            {screen ? "Cast screen" : dialog.header || "Cast tab"}
          </Text>
          {canScreen ? <SourceButton screen={screen} onChange={setScreen} /> : null}
        </View>

        {dialog.permissionRejected ? (
          <Message
            text="Netnyahoo needs Local Network access to find Cast devices."
            link="Open Local Network Settings"
            onLink={() => void openExternalURL("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork")}
          />
        ) : available.length ? (
          <ScrollView style={{ maxHeight: 280, marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: 6, gap: 2 }}>
            {available.map((sink) => (
              <SinkRow key={sink.id} sink={sink} onCast={() => cast(sink)} onStop={() => void stopCasting(dialog.id, sink.routeId)} />
            ))}
          </ScrollView>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
            <ActivityIndicator size="small" style={{ transform: [{ scale: 0.6 }], width: 14, height: 14 }} />
            <Text style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
              Looking for devices… Cast devices need to be on the same Wi‑Fi network as this Mac.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 14, marginTop: 10 }}>
          <PromptButton title="Done" onPress={close} />
        </View>
      </View>
    </Popover>
  );
}

function SinkRow({ sink, onCast, onStop }: { sink: CastSink; onCast(): void; onStop(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const active = sink.state === "connected" && !!sink.routeId;
  const busy = sink.state === "connecting" || sink.state === "disconnecting";
  return (
    <View {...hoverProps}>
      <Pressable onPress={active || busy ? undefined : onCast}>
        <View style={{ minHeight: 42, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: hovered && !active ? theme.rowHover : undefined }}>
          <View style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: active ? theme.accent : theme.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }}>
            <Symbol name={SINK_ICON[sink.icon] ?? "tv"} size={13} color={active ? "#FFFFFF" : theme.icon} style={{ width: 20, height: 20 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textPrimary }}>
              {sink.name}
            </Text>
            {sink.issue || sink.status ? (
              <Text numberOfLines={1} style={{ fontSize: 11.5, color: sink.issue ? "#FF453A" : theme.textSecondary }}>
                {sink.issue || sink.status}
              </Text>
            ) : null}
          </View>
          {busy ? <ActivityIndicator size="small" style={{ transform: [{ scale: 0.6 }], width: 16, height: 16 }} /> : null}
          {active ? <PromptButton title="Stop" onPress={onStop} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function SourceButton({ screen, onChange }: { screen: boolean; onChange: (screen: boolean) => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const pick = async () => {
    const choice = await showMenu([
      { id: "tab", title: "Cast Tab", checked: !screen },
      { id: "screen", title: "Cast Screen", checked: screen },
    ]);
    if (choice) onChange(choice === "screen");
  };
  return (
    <View {...hoverProps} tooltip="Source">
      <Pressable onPress={() => void pick()}>
        <View style={{ height: 24, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>Sources</Text>
          <Symbol name="chevron.down" size={8} weight="semibold" color={theme.textSecondary} style={{ width: 10, height: 10 }} />
        </View>
      </Pressable>
    </View>
  );
}

function Message({ text, link, onLink }: { text: string; link: string; onLink: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 5 }}>
      <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>{text}</Text>
      <View {...hoverProps}>
        <Pressable onPress={onLink}>
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.accent, textDecorationLine: hovered ? "underline" : "none" }}>{link}</Text>
        </Pressable>
      </View>
    </View>
  );
}
