import { getSiteSettings, resolveExternalApp, setSiteSetting, type PasswordPrompt as ChromePasswordPrompt, type PasswordPromptAnswer } from "@netnyahoo/cef";
import { Symbol } from "@netnyahoo/shell";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { useHover } from "../primitives";
import { Popover, PopoverRow, PopoverSeparator, PromptButton } from "../layout/controls";
import { Checkbox } from "../settings/controls";
import { patchPage, pageOf, setPopover, usePage } from "../layout/pageState";
import { answerPermission, describePermission } from "./permissions";

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, "") || origin;
  } catch {
    return origin;
  }
};

function PromptBody({
  icons,
  image,
  title,
  message,
  detail,
  children,
}: {
  icons: string[];
  image?: string | null;
  title: string;
  message?: string | null;
  detail?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {image ? <Image source={{ uri: image }} style={{ width: 32, height: 32, marginLeft: -1, marginVertical: -1 }} /> : null}
        {icons.map((icon) => (
          <View key={icon} style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }}>
            <Symbol name={icon} size={14} color={theme.icon} style={{ width: 20, height: 20 }} />
          </View>
        ))}
      </View>
      <View style={{ gap: 3 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
        {message ? <Text style={{ fontSize: 12, color: theme.textSecondary }}>{message}</Text> : null}
      </View>
      {detail}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>{children}</View>
    </View>
  );
}

export function PermissionPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const theme = useTheme();
  const request = usePage(tabId, (p) => p.permission);
  if (!request) return null;
  const { icons, question } = describePermission(request);
  return (
    <Popover key={request.id} width={300} top={top} left={left} modal={false}>
      <View>
        <PromptBody icons={icons} title={question} message="Click the lock to change this any time">
          <PromptButton title="Don't Allow" onPress={() => answerPermission(tabId, "deny")} />
          <PromptButton title="Allow" primary onPress={() => answerPermission(tabId, "accept")} />
        </PromptBody>
        <CloseButton onPress={() => answerPermission(tabId, "dismiss")} color={theme.textSecondary} />
      </View>
    </Popover>
  );
}

function CloseButton({ onPress, color }: { onPress: () => void; color: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ position: "absolute", top: 8, right: 8 }} tooltip="Dismiss">
      <Pressable onPress={onPress}>
        <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Symbol name="xmark" size={9} weight="semibold" color={color} style={{ width: 14, height: 14 }} />
        </View>
      </Pressable>
    </View>
  );
}

export function BlockedPopupsPrompt({ tabId, right, left, top }: { tabId: string; right?: number; left?: number; top: number }) {
  const theme = useTheme();
  const popups = usePage(tabId, (p) => p.popups);
  if (!popups.length) return null;
  const origin = popups[0]!.origin;
  const site = hostOf(origin);
  const web = () => webviews.get(tabId);
  const close = () => setPopover(tabId, null);
  const done = () => {
    patchPage(tabId, { popups: [] });
    close();
  };
  const profile = () => engineProfile(useBrowser.getState().tabs[tabId]?.profileId ?? "");
  return (
    <Popover width={360} top={top} right={right} left={left} onDismiss={close}>
      <View style={{ paddingBottom: 6 }}>
        <PromptBody
          icons={["macwindow.badge.plus"]}
          title={`Always allow pop-ups from ${site}?`}
          message={`Allow ${site} to always open pop-up windows, choose every time, or always deny pop-ups.`}
        >
          <PromptButton
            title="Always Deny"
            onPress={() => {
              void setSiteSetting(profile(), origin, "popups", "block");
              done();
            }}
          />
          <PromptButton
            title="Only Once"
            onPress={() => {
              for (const p of popups) void web()?.openBlockedPopup(p.id, false);
              done();
            }}
          />
          <PromptButton
            title="Always Allow"
            primary
            onPress={() => {
              for (const p of popups) void web()?.openBlockedPopup(p.id, true);
              done();
            }}
          />
        </PromptBody>
        <PopoverSeparator />
        {popups.slice(-5).map((p) => (
          <PopoverRow
            key={p.id}
            icon="arrow.up.forward.app"
            title={p.url.replace(/^https?:\/\//, "") || "about:blank"}
            onPress={() => {
              void web()?.openBlockedPopup(p.id, false);
              const rest = pageOf(tabId).popups.filter((x) => x.id !== p.id);
              patchPage(tabId, { popups: rest });
              if (!rest.length) close();
            }}
          />
        ))}
        {popups.length > 5 ? <Text style={{ fontSize: 11, color: theme.textSecondary, paddingHorizontal: 18, paddingTop: 2 }}>{`and ${popups.length - 5} more`}</Text> : null}
      </View>
    </Popover>
  );
}

export async function shouldPromptForPopups(profile: string, origin: string): Promise<boolean> {
  try {
    const settings = await getSiteSettings(profile, origin);
    return settings.popups.isDefault;
  } catch {
    return true;
  }
}

export function showPasswordPrompt(tabId: string, prompt: ChromePasswordPrompt) {
  patchPage(tabId, { passwordPrompt: prompt.state === "saved" ? null : prompt });
}

export function PasswordPrompt({ tabId, right, top }: { tabId: string; right: number; top: number }) {
  const theme = useTheme();
  const prompt = usePage(tabId, (p) => p.passwordPrompt);
  const [chosen, setChosen] = useState<string | null>(null);
  if (!prompt) return null;
  const site = hostOf(prompt.origin);
  const update = prompt.state === "update";
  const username = chosen ?? prompt.username;
  const answer = (action: PasswordPromptAnswer) => {
    void webviews.get(tabId)?.resolvePasswordPrompt(action, action === "save" || action === "update" ? { username } : undefined);
    setChosen(null);
    patchPage(tabId, { passwordPrompt: null });
  };
  const well = theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const choices = update && prompt.usernames.length > 1 ? prompt.usernames : [];
  return (
    <Popover key={`${prompt.origin}|${prompt.username}|${prompt.state}`} width={update ? 310 : 350} top={top} right={right} modal={false}>
      <View>
        <PromptBody
          icons={["key.fill"]}
          title={update ? "Update saved password?" : `Save password for ${site}?`}
          message={update ? `It will be auto-filled on ${site}` : "That way, it'll be auto-filled next time"}
          detail={
            choices.length ? (
              <View style={{ borderRadius: 8, paddingVertical: 3, backgroundColor: well }}>
                {choices.map((name) => (
                  <UsernameChoice key={name} name={name} selected={name === username} onPress={() => setChosen(name)} />
                ))}
              </View>
            ) : (
              <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 3, backgroundColor: well }}>
                <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>
                  {username || (prompt.federation ? `Signed in with ${hostOf(prompt.federation)}` : "No username")}
                </Text>
                {prompt.passwordLength > 0 && (
                  <Text numberOfLines={1} style={{ fontSize: 12, letterSpacing: 1, color: theme.textSecondary }}>
                    {"•".repeat(Math.min(prompt.passwordLength, 16))}
                  </Text>
                )}
              </View>
            )
          }
        >
          {!update && <PromptButton title="Never on This Site" onPress={() => answer("never")} />}
          <PromptButton title="Not Now" onPress={() => answer(update ? "nope" : "dismiss")} />
          <PromptButton title={update ? "Update" : "Save"} primary onPress={() => answer(update ? "update" : "save")} />
        </PromptBody>
        <CloseButton color={theme.textSecondary} onPress={() => answer("dismiss")} />
      </View>
    </Popover>
  );
}

// "Open “Codex”?": a site (or an OAuth redirect) sent this tab to another app's link.
export function ExternalAppPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const theme = useTheme();
  const request = usePage(tabId, (p) => p.externalApp);
  const [always, setAlways] = useState(false);
  if (!request) return null;
  const answer = (open: boolean) => {
    answerExternalApp(tabId, open, open && always);
    setAlways(false);
  };
  return (
    <Popover key={request.id} width={340} top={top} left={left} modal={false}>
      <View>
        <PromptBody
          icons={request.icon ? [] : [request.app ? "app" : "questionmark.app.dashed"]}
          image={request.icon}
          title={request.title}
          message={request.message}
          detail={
            request.remember ? (
              <Pressable onPress={() => setAlways(!always)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}>
                <View style={{ marginTop: 1 }}>
                  <Checkbox value={always} onChange={setAlways} />
                </View>
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: theme.textPrimary }}>{request.remember}</Text>
              </Pressable>
            ) : undefined
          }
        >
          {request.app ? (
            <>
              <PromptButton title="Cancel" onPress={() => answer(false)} />
              <PromptButton title="Open" primary onPress={() => answer(true)} />
            </>
          ) : (
            <PromptButton title="OK" primary onPress={() => answer(false)} />
          )}
        </PromptBody>
        <CloseButton color={theme.textSecondary} onPress={() => answer(false)} />
      </View>
    </Popover>
  );
}

export function answerExternalApp(tabId: string, open: boolean, remember = false) {
  const request = pageOf(tabId).externalApp;
  if (!request) return;
  patchPage(tabId, { externalApp: null });
  void resolveExternalApp(request.id, open, remember);
}

function UsernameChoice({ name, selected, onPress }: { name: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ height: 28, marginHorizontal: 3, paddingHorizontal: 7, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: hovered ? theme.rowHover : undefined }}>
          {selected ? (
            <Symbol name="checkmark" size={10} weight="semibold" color={theme.textPrimary} style={{ width: 14, height: 14 }} />
          ) : (
            <View style={{ width: 14, height: 14 }} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textPrimary }}>
            {name || "No username"}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
