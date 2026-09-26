import { showMenu, translation, type MenuItem } from "@netnyahoo/shell";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import { PopoverRow, PopoverSeparator, Toggle, ToolbarButton } from "../layout/controls";
import type { ToolbarPalette } from "../layout/toolbarColors";
import {
  defaultTarget,
  isNeverTranslated,
  languageName,
  otherLanguages,
  revertPage,
  setNeverTranslate,
  toggleTranslation,
  translatePage,
  translateStateOf,
  useTranslateState,
} from "./translate";

/** Dia's translate button by the address: when the page isn't in your language, or is translated. */
export function TranslateButton({ tabId, palette, onFocus }: { tabId: string; palette: ToolbarPalette; onFocus: () => void }) {
  const theme = useTheme();
  const state = useTranslateState(tabId);
  if (!translation || (!state.source && state.status === "idle")) return null;
  const translated = state.status !== "idle";
  return (
    <ToolbarButton
      palette={palette}
      icon="translate"
      size={13}
      box={24}
      radius={6}
      color={translated ? theme.accent : undefined}
      onPress={() => {
        onFocus();
        toggleTranslation(tabId);
      }}
      onContextMenu={() => void showTranslateMenu(tabId)}
      tooltip={translated ? `Show Original (${languageName(state.source ?? "")})` : "Translate this page"}
    />
  );
}

/** "Choose Another Language": every language this Mac translates into, by name. */
async function chooseLanguage(tabId: string) {
  const languages = await otherLanguages();
  const current = translateStateOf(tabId).target;
  const items: MenuItem[] = languages.map((l) => ({ id: l.id, title: l.name, checked: l.id === current }));
  const choice = await showMenu(items);
  if (choice) void translatePage(tabId, choice);
}

/** The translate button's right-click menu: the site menu's translate items. */
async function showTranslateMenu(tabId: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab) return;
  const translated = translateStateOf(tabId).status !== "idle";
  const items: MenuItem[] = [
    translated ? { id: "original", title: "Show Original", symbol: "arrow.uturn.backward" } : { id: "translate", title: `Translate to ${languageName(defaultTarget())}`, symbol: "translate" },
    { id: "choose", title: "Choose Another Language…", symbol: "globe" },
  ];
  if (!isIncognitoProfile(tab.profileId)) {
    items.push({ separator: true }, { id: "never", title: "Never Translate This Site", checked: isNeverTranslated(tab.profileId, tab.url) });
  }
  const choice = await showMenu(items);
  if (choice === "original") void revertPage(tabId);
  else if (choice === "translate") void translatePage(tabId);
  else if (choice === "choose") void chooseLanguage(tabId);
  else if (choice === "never") setNeverTranslate(tabId, !isNeverTranslated(tab.profileId, tab.url));
}

/** Site Controls' translate rows (Dia's site menu: Translate to…, Choose Another Language, Never Translate This Site). */
export function TranslateRows({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  const tab = useBrowser((s) => s.tabs[tabId]);
  // Re-rendered when the list changes (isNeverTranslated reads it from the store).
  useBrowser((s) => s.settings.neverTranslateSites);
  const never = tab ? isNeverTranslated(tab.profileId, tab.url) : false;
  if (!translation || !tab || (!state.source && state.status === "idle" && !never)) return null;
  const translated = state.status !== "idle";
  return (
    <>
      {!never && (
        <PopoverRow
          icon={translated ? "arrow.uturn.backward" : "translate"}
          title={translated ? `Show Original (${languageName(state.source ?? "")})` : `Translate to ${languageName(defaultTarget())}`}
          onPress={() => {
            onClose();
            toggleTranslation(tabId);
          }}
        />
      )}
      {!never && (
        <PopoverRow
          icon="globe"
          title="Choose Another Language…"
          onPress={() => {
            onClose();
            void chooseLanguage(tabId);
          }}
        />
      )}
      {!isIncognitoProfile(tab.profileId) && (
        <PopoverRow icon="nosign" title="Never Translate This Site" accessory={<Toggle value={never} onChange={(v) => setNeverTranslate(tabId, v)} />} />
      )}
      <PopoverSeparator />
    </>
  );
}
