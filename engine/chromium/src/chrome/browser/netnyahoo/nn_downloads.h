// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Downloads: Chrome's DownloadManager is the one store (it keeps history and
// resumes interrupted downloads); the app shows its own UI. Chrome's download
// bubble never shows (the app's browser windows have no bubble controller).
//
//   nn_downloads_list    {} -> {downloads: [Download]}: every download the
//       profile and its private profiles' managers hold, earlier sessions'
//       history included, newest first.
//   nn_downloads_cancel  {id} -> {ok}
//   nn_downloads_pause   {id} -> {ok}
//   nn_downloads_resume  {id} -> {ok}: an interrupted download too, when
//       Chrome can resume it.
//   nn_downloads_keep    {id} -> {ok}: keeps a download Chrome held as
//       dangerous or insecure (the "Keep" of Chrome's warning).
//   nn_downloads_remove  {id} -> {ok}: forgets a finished or failed download
//       (Chrome's history entry; the file stays).
//   Each control replies {error: "no such download"} for an unknown id.
//
// Download, the JS `Download` (packages/cef/src/module.ts) without profile:
//   {id, url, filename, path, state: "downloading"|"finished"|"failed"|
//    "cancelled", paused, received, total (-1 when unknown), speed (bytes/s),
//    mimeType, dangerous, error (Chrome's interrupt reason, e.g.
//    "NETWORK_FAILED", or null), offTheRecord, startTime (ms since the
//    epoch)}
// id is Chrome's GUID for the download: unique across profiles and stable
// across launches. offTheRecord marks a private window's download (its event
// still names the original profile).
//
// Events, once something has called nn_downloads_* for the profile (call
// nn_downloads_list at startup):
//   "downloads.changed" {download}: a download of this session started,
//       progressed (at most every 100 ms), paused, finished or failed.
//       "finished" comes after the file is quarantined.
//   "downloads.removed" {id}: gone from Chrome's list (removed, history
//       cleared, its private profile closed).
//
// Files go to Chrome's download directory (download.default_directory,
// ~/Downloads by default; NETNYAHOO_DOWNLOADS_DIR overrides it, for tests),
// named uniquely by Chrome (" (1)"), without a save panel: the first call
// turns "Ask where to save each file" (download.prompt_for_download, which the
// ungoogled patches default to on) off unless it was set. A finished file gets com.apple.quarantine
// (Gatekeeper checks what it opens) unless it already has one; a private
// download's record leaves out its URLs.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_DOWNLOADS_H_
#define CHROME_BROWSER_NETNYAHOO_NN_DOWNLOADS_H_

#include "base/files/file_path.h"
#include "chrome/browser/netnyahoo/nn_engine.h"
#include "url/gurl.h"

NN_ENGINE_CALL(nn_downloads_list);
NN_ENGINE_CALL(nn_downloads_cancel);
NN_ENGINE_CALL(nn_downloads_pause);
NN_ENGINE_CALL(nn_downloads_resume);
NN_ENGINE_CALL(nn_downloads_keep);
NN_ENGINE_CALL(nn_downloads_remove);

namespace netnyahoo {

// nn_downloads_mac.mm: adds com.apple.quarantine to |file| unless it has one.
// |source| and |referrer| go into the record when they are web URLs (without
// credentials). Blocking: call on a MayBlock thread.
void QuarantineDownload(const base::FilePath& file,
                        const GURL& source,
                        const GURL& referrer);

}  // namespace netnyahoo

#endif  // CHROME_BROWSER_NETNYAHOO_NN_DOWNLOADS_H_
