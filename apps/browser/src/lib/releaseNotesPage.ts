import { systemInfo } from "@arcadia/shell";
import { openUrls } from "./actions";

export function releaseNotesUrl(version = systemInfo().appVersion): string | null {
  const page = systemInfo().releaseNotesURL;
  if (!page || !/^https?:\/\//i.test(page)) return null;
  return version ? `${page}#${version}` : page;
}

export function openReleaseNotesPage(windowId?: string | null) {
  const url = releaseNotesUrl();
  if (url) openUrls([url], windowId);
}

export function openReleaseNotesAfterUpdate() {
  const info = systemInfo();
  if (!info.forceReleaseNotes && (__DEV__ || info.isolatedInstance !== false)) return;
  openReleaseNotesPage();
}
