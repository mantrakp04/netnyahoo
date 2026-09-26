# Sync

End-to-end-encrypted sync with no server, no account and no Apple entitlement. Every Mac reads
and writes sealed files in a folder the user picks; any service that syncs a folder carries them
between Macs. The default is `iCloud Drive › Netnyahoo Sync`
(`~/Library/Mobile Documents/com~apple~CloudDocs/Netnyahoo Sync`: iCloud Drive syncs any folder
under it, with no CloudKit container and no entitlement). Dropbox, a NAS or a USB drive work
the same way.

The UX follows Dia's sync (Settings › Account › Sync in Dia 1.50.1; its strings are quoted from
its binary below). Dia's data sits on its servers and devices pair with a 6-character code; here
the folder takes the servers' place and devices pair by entering the recovery phrase.

Code:
- `packages/sync/ios/Core`: plain Swift, also built by `packages/sync/Package.swift`.
  - `RecoveryPhrase.swift`: the phrase (BIP-39).
  - `SyncCrypto.swift`: keys, the file format and names.
  - `SyncVault.swift`: the folder, with file coordination and partial files.
  - `SyncKeyStore.swift`: Keychain.
  - `RecoveryKit.swift`: PDF, text sheet and QR code.
- `packages/sync/ios/SyncModule.swift`: the Expo module (`NetnyahooSync`). It also reads this app's saved passwords.
- `packages/sync/src`: the merge, in TypeScript with no dependencies.
  - `scope.ts`: replica, logs, snapshots, compaction.
  - `hlc.ts`: hybrid logical clocks.
  - `order.ts`: fractional positions.
- `apps/browser/src/sync`:
  - `adapters.ts`: store ↔ records.
  - `engine.ts`: state, setup flows, the cycle.
  - `menu.ts`: the overflow menu's synced devices.
- `apps/browser/src/components/settings/panes/Sync.tsx` and `SyncSheets.tsx`: Settings › Sync.

## Threat model

Protected against anyone who can read or write the sync folder but doesn't have the phrase:
Apple, Dropbox, whoever has the NAS or finds the USB drive, malware that reads cloud files.

- They can't read anything. File contents are AES-256-GCM. Folder and file names are keyed
  (HMAC) or random, and say nothing about profiles, sites or data kinds.
- They can't change anything undetected. Every file is authenticated. The associated data binds a
  file to its folder and name, so a file can't be renamed, moved or truncated without failing to
  open. Files that fail are never applied.
- Contents are padded to 1 KiB steps and not compressed. The size of a file says little, and
  attacker-chosen page titles can't be used to probe passwords through compression
  (CRIME-style).

What they do see (metadata): how many profiles sync (one folder each) and how many devices; when
and how much each writes (file count, times, sizes to 1 KiB); and that it's Netnyahoo sync data
(the `NNS1` magic and `.nns` extension).

What they can do: delete or withhold files (denial of service). Withheld files show as
"waiting for N files to download". They can also replay an old file under its own name, which is
harmless: files are immutable, and a replayed op merges as a no-op. They can't forge, reorder
within a file, or move data between profiles.

Not protected against:
- Someone with the phrase. The phrase is the key, like Dia's.
- Someone with the unlocked Mac. They have the data in the clear anyway.
- A compromised Netnyahoo binary.

The phrase's entropy is in each Mac's login Keychain (`Netnyahoo Sync Key`, this device only,
never iCloud Keychain). Losing every Mac and the Recovery Kit loses the synced data. There's no
reset by email, because there's no one to email.

## Recovery phrase and keys

- 24 BIP-39 English words encode 256 bits from `SecRandomCopyBytes` plus an 8-bit checksum (the
  first byte of their SHA-256). The same format as Dia's (its errors: "Recovery phrase must be
  exactly 24 words.", "This recovery phrase is not valid. Please check for typos.", "“%@” is not
  a valid recovery phrase word.").
- Input is lenient: case, punctuation, the kit's numbering ("1. abandon") and 4-letter prefixes
  are all accepted.
- The wordlist is the standard one; a test checks its SHA-256
  (`2f5eed53…dbda`) and Trezor's reference vectors.
- Keys: HKDF-SHA256 over the entropy, salt `netnyahoo-sync/v1`.
  - `file-key` (AES-256-GCM) seals every file.
  - `name-key` (HMAC-SHA256) names folders: the chain tag is `HMAC("chain")` and a scope's tag
    is `HMAC("scope/<scope id>")`, each cut to 128 bits and written in base32.
  - The phrase already has 256 bits of entropy, so no password stretching is needed.
- Where the entropy is kept: the login Keychain, as a generic password (`Netnyahoo Sync Key`,
  account = this device's sync id, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not
  synchronizable).
  - Test instances (`NETNYAHOO_DATA_DIR`) keep it in a 0600 file in their data folder instead,
    as Chrome's mock keychain does for them.
  - A Debug build can't read an item an earlier build saved (no prompt, by design). Sync then
    shows "not syncing" with Enter Recovery Phrase…, and the same device carries on.
- The key never crosses to JS. The words do, only for the Recovery Kit and Connect Another Device
  sheets, or when the user types them.

A wrong phrase is caught in one of two ways. A typo fails the checksum. A valid but different
phrase derives a chain tag that isn't in the folder: "This recovery phrase doesn’t match the
synced data in this folder".

## Folder layout and file format

```
<sync folder>/
  <chain tag>/                 one per phrase (several people can share one folder)
    <scope tag>/               "app" (settings, profiles, devices) or "p:<profile sync id>"
      <file id>.nns            128 random bits, base32
```

A file is `"NNS1" | nonce (12) | AES-GCM ciphertext | tag (16)`.
- AAD: `"NNS1" + "<chain>/<scope>/<file>"`.
- Plaintext: `length (u32 BE) | UTF-8 JSON | zero padding` to the next 1024 bytes.

The JSON is one of:

```jsonc
// A log: a batch of one device's changes. seq counts up per device and scope.
{ "v": 1, "kind": "log", "device": "<id>", "seq": 7, "at": 1790000000000,
  "ops": [{ "k": "bm:bm-…", "h": "<hlc>", "v": { … } }, { "k": "h:https://…", "h": "…", "v": null }] }
// A snapshot: a device's whole merged replica, and the seqs it covers per device.
{ "v": 1, "kind": "snapshot", "device": "<id>", "at": …, "vv": { "<device>": 41, … },
  "seen": { "<device>": <ms> }, "records": { "<key>": { "h": "<hlc>", "v": …, "o": ["<device>", <seq>] } } }
```

Writing:
- A device only ever creates files, each under a fresh random name, and never changes one. Two
  Macs never write the same file, so the sync service never sees a conflict.
- A file is written whole in a same-volume temporary folder, then moved in inside a coordinated
  write (`NSFileCoordinator`, `.forReplacing`). The sync client never sees half a file under a
  real name.

Reading (`SyncVault.read`) handles files that aren't there in full yet:
- iCloud placeholders (`.<id>.nns.icloud` stubs, or dataless files whose
  `ubiquitousItemDownloadingStatus` isn't current) are reported as pending, and
  `startDownloadingUbiquitousItem` is asked for them.
- Files mid-copy (Dropbox, SMB) and empty files fail to open. They're reported as damaged, with
  their age, and retried next cycle; a file that still fails after a day is given up on.
- Everything else is read in a coordinated read.
- Nothing half-arrived is ever applied.

## Merge

Each scope holds a replica: `key → { h: HLC, v: value | null, o: [device, seq] }`.

- **Last writer wins per record** by hybrid logical clock. The HLC is
  `wall(ms, base 36, 9 digits).counter(4).device`, fixed width, so string comparison is clock
  comparison and the device id breaks ties.
- A deletion is a record with `v: null`, a tombstone.
- Merging is a join: commutative, associative and idempotent. Devices converge whatever order
  files arrive in, and a file read twice changes nothing.
- **Clock skew.** A clock never goes below the newest timestamp it has seen, so an edit made
  after seeing another device's edit is newer even if this Mac's clock is behind. Only truly
  concurrent edits are ordered by the (possibly skewed) wall clocks. A Mac whose clock is days
  ahead wins edits concurrent with it, but the next edit anywhere after it syncs wins again (tested).
- **Base, three-way.** Each scope keeps `base`: what the local store held after the last publish
  or apply. A local value different from base is a local edit and becomes an op. A key in base
  but gone locally is a local deletion. Remote changes are applied only over keys with no
  unpublished edits. Each adapter publishes and then applies, with no wait in between, so an
  edit made while files were being read wins and isn't overwritten (tested).
- **Joining.** Local data is published before remote data is applied, so joining is a union: no
  local bookmark, visit or password is lost. Settings and profile names are the exception
  (`adoptRemoteOnJoin`): a joining Mac takes the synced values and doesn't publish its defaults
  until it has read another device's file (`awaitRemote`). Data that existed before sync was
  turned on (passwords, history) is published with its own creation time
  (`Clock.at(editedAt)`), so it doesn't beat a later edit made elsewhere.
- **Version vectors.** `vv[device]` is the highest seq such that every file of that device up to
  it is in the replica. Seqs that arrive out of order wait in `extra` until the gap fills
  (tested).

### Compaction

- **When.** A device writes a snapshot of its replica when a scope has more than 40 files and no
  snapshot has been written in 10 minutes.
- **What it leaves out.** Tombstones older than 45 days are dropped from the snapshot, and so are
  history records older than 90 days.
- **What it removes.** Then it removes, once they're an hour old, the files the snapshot covers:
  logs `(d, s)` with `s ≤ vv[d]`, and snapshots whose `vv` it dominates.
- **Why that's safe.** A snapshot is self-contained, so any device can start from it, and
  concurrent compactions only remove files covered by their own snapshot.
- **Collected tombstones.** A device that missed a deletion whose tombstone has since been
  collected still learns of it. Applying a snapshot drops every local record whose origin file
  the snapshot covers but which the snapshot doesn't contain (`ingestSnapshot`). A log a snapshot
  covers is never replayed after it, so a collected deletion can't come back.
- **A device offline for weeks.** It reads the newest snapshot and whatever logs came after,
  applies them, and publishes its offline edits (tested). The one gap: an edit made offline to a
  record that was deleted elsewhere, whose tombstone was collected more than 45 days ago, comes
  back as a new record.

### Order

Bookmark folders and the pinned container are ordered by fractional positions (`order.ts`,
base 62, never ending in "0"). A move changes the moved item's position only. Positions are
assigned by keeping the longest increasing run of known positions, so two Macs reordering
different items merge. Equal positions (two inserts in the same place) sort by id and are
separated on the next publish.

## What syncs

Per profile: each synced profile is its own scope, with its own opt-in (Settings › Sync ›
Profiles).
- On joining, Personal pairs with the synced default profile and other profiles pair by name.
- A synced profile this Mac lacks is offered as "Add to This Mac".
- Profiles that share another's data (Dia's "Share data with another profile") sync their tabs;
  the shared data syncs with the profile that owns it.

| Key | Scope | What | Notes |
|---|---|---|---|
| `set:<name>` | app | the settings that follow the user (`SYNCED_SETTINGS`: search engine and custom engines, appearance, address bar, tab layout and behaviour, bookmarks bar, full URL, muted sites, clean-up, keyboard shortcuts…) | not window sizes, battery saver, extension engines or the default profile id |
| `prof:<sync id>` | app | a profile's name, colour, icon (`d` for the default) | deleting a profile on one Mac doesn't delete it on another |
| `dev:<device id>` | app | a device's name | removed when it stops syncing |
| `bm:<node id>` | profile | `{ k, p (parent: id, "bar" or "other"), t, u, a (added), pos }` | favicons stay local. A node whose folder was deleted elsewhere lands in Other Bookmarks; a cycle from two concurrent moves is broken the same way on every Mac (tested) |
| `h:<url>` | profile | `{ t, n (visits), vt (last 50 visit times) }` for pages visited in the last 90 days | older history stays on the Mac that has it: it's never published, never deleted by sync, and dropped from snapshots |
| `tabs:<device id>` | profile | `{ n (device name), tabs: [{ u, t }] }`: that device's 30 most recent open tabs | only its device writes it. It feeds the overflow menu's "Your Devices" |
| `pin:t:<tab id>`, `pin:g:<group id>` | profile | pinned tabs `{ g, u, t, i, ti, pos }` and pinned groups `{ n, i, c, pos }` (Dia's pinned container) | they arrive as unloaded tiles in the window showing the profile and load when selected. Unpinning on one Mac removes the tile on the others |
| `pw:<origin>\n<username>` | profile | `{ o, u, p }` | see below |

### Passwords

Saved passwords are Chrome's (its password manager).
- **Reading.** Chrome's own API (`passwordsPrivate`) reveals a password only after device
  authentication, so sync reads the profile's `Login Data` with the importer's reader
  (`ChromiumSecrets`, `packages/import`). Chrome's key is its "Netnyahoo Safe Storage" item, or
  the mock keychain's where NNCef uses that. No Touch ID prompt is needed each cycle, and no
  Chromium change.
- **Writing.** Writes go through Chrome's API (`savePassword`, `deletePassword` in
  `@netnyahoo/cef`), so Chrome's in-memory store and autofill see them at once. A changed
  password is a delete plus an add: the update API needs the device check.
- **Safety.**
  - A read that finds any row it can't decrypt is skipped (a partial list would read as
    deletions).
  - After applying, sync waits until Chrome's store on disk shows the change before reading it
    again.
  - A login changed here but not read yet isn't overwritten.
  - Turning sync off, or turning Passwords off, never removes a password. Only a password
    deleted on another Mac is deleted here.
- **Cadence.** Passwords are read at most every 30 s (and at once with Sync Now).

## UX (from Dia's binary)

Settings › Sync. Dia puts sync in Account › Sync, with the section icon
`arrow.triangle.2.circlepath`.

- **Off.** The row reads "Sync · Off", with **Turn On Sync** and **Enter Recovery Phrase…**. If
  the folder already has sync data, the primary button is **Enter Recovery Phrase…**, next to
  **Other Options** (Dia's menu: "Set Up Without Another Device", "Enter Recovery Phrase").
  Below is the sync folder, with Choose…. If iCloud Drive is off it says so, links to iCloud
  settings, and offers another folder; test instances never default to iCloud Drive.
- **Turn On Sync** makes a phrase and shows **Save Your Recovery Kit**, with Dia's copy:
  - "Your Recovery Kit contains all you need to recover your data should you lose access to
    this device."
  - "Save a copy of your Recovery Kit to another device or to the cloud. You'll need it if you
    lose access to this device.", with "another" underlined.
  - A preview of the page.
  - Buttons: Save…, Close, and Other Options (Copy, Share…, Save as Text…).
  - The PDF is "Netnyahoo Recovery Kit.pdf", US Letter as Dia's, with the 24 words and a QR code.
- **Connect with Recovery Phrase.**
  - Dia's copy: "Enter your 24-word recovery phrase to sync with another device.", the
    placeholder "Enter your 24-word recovery phrase", the "%d/%d words" counter, "too many
    words", and Connect / "Connecting…" / Cancel.
  - It also shows the folder the phrase is checked against, with Change….
- **On.**
  - The status line uses Dia's words: "starting up", "updating", "updated just now", "not
    syncing · last synced %@" and "offline" (the folder isn't there: a drive is unplugged, or
    iCloud Drive is off). Downloads still to come add "· waiting for N files to download".
  - **Connect Another Device…** shows the steps for the other Mac and a QR code of the phrase:
    scan it with an iPhone and paste it on the Mac with Universal Clipboard. It also has Show
    Words and Copy Words. Dia's version is an OTP between signed-in devices, which needs its
    server.
  - **Advanced…** has Save Recovery Kit…, Copy Recovery Code (Dia's ⌥ item, copied as
    `org.nspasteboard.ConcealedType`), Sync Now, Show Sync Folder in Finder and Stop Syncing….
  - Then Profiles (toggles, and Add to This Mac), What Syncs (Bookmarks, History, Open Tabs,
    Pinned Tabs and Groups, Passwords, Settings) and Devices (each with "last synced …").
- **Stop Syncing This Device?** Dia's copy, plus "Everything on this Mac stays as it is", with
  Save Recovery Kit / Cancel / Stop Syncing.
  - Then **Delete Sync Data?**: "Would you also like to permanently delete your synced data
    from the sync folder? …", the checkbox "I understand this cannot be undone", and Keep Sync
    Data / Delete My Sync Data.
  - Stopping removes this Mac's tabs and name from the other devices and forgets the key. It
    keeps all local data.
  - Deleting removes this phrase's chain folder. The other Macs then show Dia's "This device is
    out of sync. Sync may have been reset from another device." and stop, keeping their data.
- **Overflow menu.** One other device with open tabs shows "Your %@ Tabs" (the kind of Mac, from
  its name: "Your MacBook Pro Tabs"). Several roll up into **Your Devices**
  (`macbook.and.iphone`), a submenu per device. Each lists "Recent Tabs"; picking one opens it
  in a new tab. The fallback name is "Unknown Device".

## Cycle

The engine (`apps/browser/src/sync/engine.ts`) runs a cycle 15 s after the last one, 3 s after a
bookmark, settings, profile or group edit, and on Sync Now. A cycle:
1. Checks the chain folder: gone means reset elsewhere; the folder missing means offline.
2. Syncs the app scope and links profiles.
3. Syncs each synced profile's scope, publishing, flushing, pulling, and then publishing and
   applying per adapter.
4. Compacts when due.
5. Saves `sync.json` (in the app's data folder): the replica, base, version vectors, known
   files, links and settings of sync.

## Tests

- `pnpm --filter @netnyahoo/sync test`:
  - `swift test`: 21 tests.
    - The phrase: the wordlist hash, reference vectors, round trips, lenient input, and errors
      (count, word, checksum).
    - Crypto: round trip across padding sizes, randomized sealing, no plaintext, tampering
      (nonce, ciphertext, tag), truncation, renamed or moved files, the wrong phrase, stable
      opaque tags, base32 vectors.
    - The vault: new files only, the wrong phrase finds nothing, partial and placeholder files
      (a cut file, an empty file, a `.icloud` stub, foreign files), no plaintext in names or
      contents, deleting one chain leaves another.
    - Key stores: file and Keychain.
    - The Recovery Kit: every word in the PDF, the text sheet parses back, the QR code decodes
      back.
  - `node --test`: 13 tests.
    - HLC, positions.
    - Both-way sync; concurrent edits in both orders; deletes, re-adds and edit-after-delete;
      clock skew (slow, and days ahead).
    - Late, out-of-order and half-copied files; an edit during a read.
    - Joining; compaction and a new device from a snapshot; offline for weeks with collected
      tombstones; expiry.
    - 40 randomized three-device runs with flaky delivery and compaction.
- `apps/browser`: `node --import ./src/sync/test-loader.mjs --test src/sync/adapters.test.mjs`
  runs 8 tests against the real store.
  - Bookmarks, both ways; delete versus add; concurrent moves that would make a cycle.
  - History and its 90-day window; settings adopted on join; pinned tabs and pinned groups
    (order, unloaded, unpin); open tabs; passwords both ways.
  - Steady state publishes nothing.
- End to end: `node packages/sync/scripts/e2e.mjs [Debug app] [work dir]` drives two hidden
  instances (then a third) with their own data folders through a temporary sync folder, never
  iCloud Drive, over the dev harness. It checks 40 things, and all 40 passed on 2026-09-26 (Debug
  build; the Release build was built and started hidden).
  - B rejects four wrong phrases: someone else's valid phrase ("mismatch"), two words swapped
    (checksum), a word not on the list, and 23 words. Then it joins with the kit's numbered, upper-case lines.
  - After joining: A's bookmarks, history, pinned tab (unloaded) and password (in Chrome's password
    manager) are on B, and B's own bookmark and password are on A. B took the synced settings.
    The two converge.
  - B's rename, delete and new bookmark, history delete and new visit, settings (a null one
    included), and password change and delete all reach A. A's move out of a folder, folder
    delete, new bookmark in Other Bookmarks, new pinned tab and new password reach B.
  - Open tabs: A shows B's tabs but not its pinned ones. "Your … Tabs" with "Recent Tabs" for one
    device, "Your Devices" for two.
  - Concurrent edits to one bookmark, one setting and one password converge, and the later edit
    wins. Idle rounds write no files.
  - A half-copied file and an iCloud placeholder aren't applied ("waiting for 1 file"). Both apply
    once whole.
  - The folder: no plaintext in names or contents (13 strings searched: titles, URLs, the password,
    usernames, device and setting names), every file padded to 1 KiB. Each Mac's own sync state
    holds no plaintext password.
  - A third Mac joins from the folder as it is (logs and a snapshot) and converges.
  - Turning sync off on B keeps its bookmarks, history, settings, pinned tabs and passwords, and
    removes its key. A drops B's device and tabs, and what B does while off stays on B.
  - Delete My Sync Data on A empties the folder. C shows Dia's reset message and stops, and A and C
    keep all their data.

  The runs found and fixed:
  - Settings whose value is null bounced between Macs: a null record is a tombstone, so settings
    are now wrapped.
  - Two instances launched in the same millisecond made the same store ids: `newId` now has a
    random part.

## Left for a person

A real two-Mac run over iCloud Drive: turn on sync on one Mac, save the kit, enter the phrase on
the other, and watch bookmarks, history, pinned tabs, passwords and settings go both ways. Also
check the iCloud Drive permission prompt, if macOS shows one the first time. The tests use a
temporary folder, never iCloud Drive.
