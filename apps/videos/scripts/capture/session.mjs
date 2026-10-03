// The demo state the film is shot in: three profiles with real tabs, the address in the sidebar, dark.
// usage: node scripts/capture/session.mjs <out.json>
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
  T("work", "https://vercel.com/docs"),
  T("campaign", "https://en.wikipedia.org/wiki/Political_campaign"),
  T("campaign", "https://en.wikipedia.org/wiki/Campaign_button"),
  T("campaign", "https://en.wikipedia.org/wiki/Opinion_poll"),
  T("campaign", "https://en.wikipedia.org/wiki/Stump_speech"),
  T("campaign", "https://en.wikipedia.org/wiki/Bumper_sticker"),
  T("campaign", "https://en.wikipedia.org/wiki/Lawn_sign"),
].map((t, i) => ({ id: `t${i + 1}`, ...t }));

const s = session({
  profiles: [
    { id: "default", name: "Personal", color: "plum" },
    { id: "work", name: "Work", color: "blue" },
    { id: "campaign", name: "Campaign", color: "orange" },
  ],
  windows: [{ id: "w1", frame: [80, 60, 1440, 900], profileId: "default" }],
  tabs,
});
s.windows[0].tabIds = tabs.map((t) => t.id);
s.windows[0].activeTabIds = { default: "t1", work: "t7", campaign: "t13" };
s.settings = { addressBar: "sidebar", appearance: "dark", searchSuggestions: false, warnBeforeQuitting: false };
writeFileSync(process.argv[2], JSON.stringify(s, null, 2));
