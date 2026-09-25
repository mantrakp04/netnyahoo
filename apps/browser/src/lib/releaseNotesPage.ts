import { systemInfo } from "@netnyahoo/shell";
import { openUrls } from "./actions";

/**
 * The release notes page on the website (Info.plist NNReleaseNotesURL, apps/site's /release-notes),
 * one entry per version at `#<version>`. Like Dia, the first launch after an update opens the new
 * version's entry in a new tab of the front window, once; Help › Release Notes opens it any time.
 */
export function releaseNotesUrl(version = systemInfo().appVersion): string | null {
  const page = systemInfo().releaseNotesURL;
  if (!page || !/^https?:\/\//i.test(page)) return null;
  return version ? `${page}#${version}` : page;
}

/** Help › Release Notes: the running version's entry, in a new tab of the window. */
export function openReleaseNotesPage(windowId?: string | null) {
  const url = releaseNotesUrl();
  if (url) openUrls([url], windowId);
}

/**
 * At launch, after the session is restored (so the tab isn't lost to it), when `trackAppVersion`
 * found a new version. Hidden test instances (NETNYAHOO_BACKGROUND / NETNYAHOO_DATA_DIR) and DEV
 * builds skip it unless launched with NETNYAHOO_RELEASE_NOTES=1, which is how a test exercises it:
 * set `lastVersion` in the data dir's release-notes.json to an older version and relaunch.
 */
export function openReleaseNotesAfterUpdate() {
  const info = systemInfo();
  if (!info.forceReleaseNotes && (__DEV__ || info.isolatedInstance !== false)) return;
  openReleaseNotesPage();
}
