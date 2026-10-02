import type { ImageRequireSource } from "react-native";

// Icons the app ships for the sites it suggests (onboarding's apps), so they show before Chrome has one for the
// page: on a fresh profile, offline, and for a pinned tab that hasn't loaded yet. Chrome's icon wins once it has one.
// Each is the site's own official icon at 64 px (fetched once; light, dark):
// gmail: ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico · calendar, docs, drive: www.gstatic.com/images/branding/
// product/2x/<name>_2020q4_48dp.png · slack: slack.com/favicon.ico · notion: notion.com/front-static/logo-ios.png ·
// figma: static.figma.com/app/icon/2/favicon.svg · github: github.githubassets.com/favicons/favicon.svg (dark: its
// white favicon-dark) · linear: linear.app/static/favicon.svg · outlook: the Outlook PWA manifest's
// Outlook.128x128x32.png · youtube: youtube.com/s/desktop/…/favicon_144x144.png · spotify: the web player
// manifest's Spotify_256.png.
type Icon = ImageRequireSource | readonly [light: ImageRequireSource, dark: ImageRequireSource];

const GITHUB: Icon = [require("../../assets/site-icons/github.png"), require("../../assets/site-icons/github-dark.png")];
const NOTION: Icon = require("../../assets/site-icons/notion.png");
const OUTLOOK: Icon = require("../../assets/site-icons/outlook.png");

// By host (no "www."), or host and first path segment ("docs.google.com/" is the root only: Sheets and Slides
// live on that host too).
const ICONS: Record<string, Icon> = {
  "mail.google.com": require("../../assets/site-icons/gmail.png"),
  "calendar.google.com": require("../../assets/site-icons/calendar.png"),
  "docs.google.com/": require("../../assets/site-icons/docs.png"),
  "docs.google.com/document": require("../../assets/site-icons/docs.png"),
  "drive.google.com": require("../../assets/site-icons/drive.png"),
  "app.slack.com": require("../../assets/site-icons/slack.png"),
  "notion.so": NOTION,
  "notion.com": NOTION,
  "figma.com": require("../../assets/site-icons/figma.png"),
  "github.com": GITHUB,
  "linear.app": require("../../assets/site-icons/linear.png"),
  "outlook.office.com": OUTLOOK,
  "outlook.office365.com": OUTLOOK,
  "outlook.live.com": OUTLOOK,
  "youtube.com": require("../../assets/site-icons/youtube.png"),
  "open.spotify.com": require("../../assets/site-icons/spotify.png"),
};

const PAGE = /^https?:\/\/(?:www\.)?([^/?#:@]+)(?::\d+)?(?:\/([^/?#]*))?/i;

export function bundledSiteIcon(url: string, dark: boolean): ImageRequireSource | undefined {
  const match = PAGE.exec(url);
  if (!match) return undefined;
  const host = match[1]!.toLowerCase();
  const icon = ICONS[`${host}/${match[2] ?? ""}`] ?? ICONS[host];
  if (icon === undefined) return undefined;
  return Array.isArray(icon) ? icon[dark ? 1 : 0] : (icon as ImageRequireSource);
}
