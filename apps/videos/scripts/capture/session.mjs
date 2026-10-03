// The demo state the film is shot in: five profiles with real tabs, light, the address in the toolbar (the profile's
// name then sits next to the traffic lights, in its colour, which is what makes a swipe readable).
// usage: node scripts/capture/session.mjs <out.json> [appearance] [addressBar]
import { writeFileSync } from "node:fs";
import { session } from "../../../../scripts/lib/instance.mjs";

const T = (profileId, url, extra = {}) => ({ profileId, url, ...extra });
const tabs = [
  T("default", "https://en.wikipedia.org/wiki/Mount_Everest"),
  T("default", "https://unsplash.com/"),
  T("default", "https://www.nps.gov/yose/index.htm"),
  T("default", "https://www.nasa.gov/"),
  T("default", "https://en.wikipedia.org/wiki/Hummus"),
  T("default", "https://www.nationalgeographic.com/"),
  T("work", "https://developer.mozilla.org/en-US/docs/Web/CSS/grid"),
  T("work", "https://github.com/chromium/chromium"),
  T("work", "https://react.dev/learn"),
  T("work", "https://www.chromium.org/Home/"),
  T("work", "https://stackoverflow.com/questions"),
  T("work", "https://developer.apple.com/documentation/swiftui"),
  T("campaign", "https://en.wikipedia.org/wiki/Political_campaign"),
  T("campaign", "https://en.wikipedia.org/wiki/Campaign_button"),
  T("campaign", "https://en.wikipedia.org/wiki/Opinion_poll"),
  T("campaign", "https://en.wikipedia.org/wiki/Stump_speech"),
  T("campaign", "https://en.wikipedia.org/wiki/Bumper_sticker"),
  T("campaign", "https://en.wikipedia.org/wiki/Lawn_sign"),
  T("side", "https://excalidraw.com/"),
  T("side", "https://tailwindcss.com/"),
  T("side", "https://www.typescriptlang.org/docs/handbook/intro.html"),
  T("side", "https://www.npmjs.com/"),
  T("weekend", "https://www.nps.gov/grca/index.htm"),
  T("weekend", "https://en.wikipedia.org/wiki/Sourdough"),
  T("weekend", "https://en.wikipedia.org/wiki/Bicycle_touring"),
  T("weekend", "https://unsplash.com/t/nature"),
].map((t, i) => ({ id: `t${i + 1}`, ...t }));

const s = session({
  profiles: [
    { id: "default", name: "Personal", color: "plum" },
    { id: "work", name: "Work", color: "blue" },
    { id: "campaign", name: "Campaign", color: "orange" },
    { id: "side", name: "Side Project", color: "green" },
    { id: "weekend", name: "Weekend", color: "yellow" },
  ],
  windows: [{ id: "w1", frame: [80, 60, 1440, 900], profileId: "default" }],
  tabs,
});
s.windows[0].tabIds = tabs.map((t) => t.id);
s.windows[0].activeTabIds = { default: "t1", work: "t7", campaign: "t14", side: "t21", weekend: "t23" };
// APPEARANCE / ADDRESS_BAR override for a test run: node session.mjs out.json light toolbar
const [, , , appearance = "light", addressBar = "toolbar"] = process.argv;
s.settings = { addressBar, appearance, searchSuggestions: false, warnBeforeQuitting: false };
writeFileSync(process.argv[2], JSON.stringify(s, null, 2));
