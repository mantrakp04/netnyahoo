import { StyleSheet, View } from "react-native";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { tourAnchorRef } from "../onboarding/tour/anchors";
import { CheckInBanner } from "./CheckInBanner";
import { PersonalizeButton } from "./Personalize";
import { ReleaseNotesPage, ReleaseNotesPostcard } from "./Postcard";
import { TelemetryAsk } from "./TelemetryAsk";
import { closeReleaseNotes, openReleaseNotes, retireReleaseNotes, usePendingReleaseNotes, useReleaseNotesPage } from "./releaseNotes";

export type Frame = { x: number; y: number; width: number; height: number };

export function NewTabExtras({ size, bar }: { size: { width: number; height: number }; bar: Frame }) {
  const windowId = useWindowId();
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const pending = usePendingReleaseNotes();
  const page = useReleaseNotesPage(windowId);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View ref={tourAnchorRef(windowId, "page")} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View ref={tourAnchorRef(windowId, "commandBar")} style={{ position: "absolute", left: bar.x, top: bar.y, width: bar.width, height: bar.height }} pointerEvents="none" />
      <CheckInBanner windowId={windowId} />
      <TelemetryAsk windowId={windowId} />
      {incognito ? null : <PersonalizeButton windowId={windowId} />}
      {pending && !incognito && !page ? (
        <ReleaseNotesPostcard notes={pending} size={size} onOpen={() => openReleaseNotes(windowId)} onDismiss={retireReleaseNotes} />
      ) : null}
      {page ? <ReleaseNotesPage notes={page} size={size} onClose={closeReleaseNotes} /> : null}
    </View>
  );
}
