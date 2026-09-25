import { toAppUrl, urlForDisplay } from "@netnyahoo/core";
import { Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { PromptButton } from "./controls";
import { patchPage, usePage } from "./pageState";

/**
 * The hovered link's URL at the bottom-left of the page (Chrome's status
 * bubble): appears right away, lingers briefly, then fades out.
 */
export function StatusBubble({ tabId, maxWidth }: { tabId: string; maxWidth: number }) {
  const theme = useTheme();
  const status = usePage(tabId, (p) => p.status);
  const [shown, setShown] = useState(status);
  const opacity = useRef(new Animated.Value(status ? 1 : 0)).current;
  useEffect(() => {
    if (status) {
      setShown(status);
      Animated.timing(opacity, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
      return;
    }
    // Chrome keeps the bubble up a moment so moving between links doesn't flicker it.
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: false }).start(({ finished }) => {
        if (finished) setShown("");
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [status]);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 6, bottom: 6, maxWidth, opacity }}>
      <Surface
        fill={hex(theme.dark ? "rgba(40,38,39,0.96)" : "rgba(250,249,250,0.97)")}
        cornerRadius={7}
        borderColor={hex(theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)")}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.dark ? 0.3 : 0.1}
        shadowRadius={6}
        shadowOffset={[0, 2]}
        style={{ paddingHorizontal: 8, height: 22, justifyContent: "center" }}
      >
        <Text numberOfLines={1} ellipsizeMode="middle" style={{ fontSize: 12, color: theme.dark ? "#FFFFFFD9" : "#000000C7" }}>
          {displayUrl(shown)}
        </Text>
      </Surface>
    </Animated.View>
  );
}

/**
 * Chrome elides the scheme of http(s) links, shows safe IDNs in Unicode and decodes percent-escapes.
 * Links between Chrome's pages read netnyahoo://.
 */
function displayUrl(url: string) {
  let out = /^https?:\/\//i.test(url) ? urlForDisplay(url) : toAppUrl(url);
  try {
    out = decodeURI(out);
  } catch {}
  return out;
}

/**
 * Dia's native error view for a crashed renderer: "This tab needs to reload"
 * with a Reload button. Also shows the Page Unresponsive prompt.
 */
export function SadTab({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const crashed = usePage(tabId, (p) => !!p.crashed);
  const unresponsive = usePage(tabId, (p) => p.unresponsive);
  if (crashed) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "#1C1A1B" : "#F6F5F6", alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Symbol name="exclamationmark.triangle" size={30} weight="light" color={theme.textSecondary} style={{ width: 44, height: 40, marginBottom: 14 }} />
        <Text style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary, marginBottom: 6 }}>This tab needs to reload</Text>
        <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", maxWidth: 340, marginBottom: 18 }}>
          Something went wrong with this tab. Reloading often fixes it.
        </Text>
        <PromptButton
          title="Reload"
          primary
          onPress={() => {
            patchPage(tabId, { crashed: null });
            void webviews.get(tabId)?.reload();
          }}
        />
      </View>
    );
  }
  if (!unresponsive) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)" }]}>
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ width: 320, padding: 18, gap: 6 }}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme.textPrimary }}>Page Unresponsive</Text>
        <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 10 }}>You can wait for it to become responsive or exit the page.</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <PromptButton
            title="Exit Page"
            onPress={() => {
              patchPage(tabId, { unresponsive: false });
              void webviews.get(tabId)?.resolveUnresponsive(true);
            }}
          />
          <PromptButton
            title="Wait"
            primary
            onPress={() => {
              patchPage(tabId, { unresponsive: false });
              void webviews.get(tabId)?.resolveUnresponsive(false);
            }}
          />
        </View>
      </Surface>
    </View>
  );
}
