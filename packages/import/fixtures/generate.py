#!/usr/bin/env python3
"""Builds the synthetic browser profiles the import tests read.

Everything here is invented: no real profile, Keychain item or browsing data is involved.
Encryption goes through the system `openssl` CLI (and Python's hashlib), so the fixtures are
produced by code independent of the Swift decryptors they test.

Run from anywhere: `python3 packages/import/fixtures/generate.py`. Output is deterministic
(fixed salts, IVs and timestamps) apart from zip/sqlite page layout.

Don't open the Firefox places.sqlite fixture with the sqlite3 CLI: that checkpoints its -wal
file, and the tests rely on rows that only exist in the WAL. Regenerate if it happens.

Test secrets (also in secrets.json):
  Chromium-family "Safe Storage" secret: netnyahoo-fixture-secret
  Firefox default profile primary password: (none)
  Firefox "Work" profile primary password: hunter2
"""

import base64
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SUPPORT = os.path.join(HERE, "home", "Library", "Application Support")
MISC = os.path.join(HERE, "misc")

CHROMIUM_SECRET = b"netnyahoo-fixture-secret"
CHROMIUM_KEY = hashlib.pbkdf2_hmac("sha1", CHROMIUM_SECRET, b"saltysalt", 1003, 16)
WRONG_KEY = hashlib.pbkdf2_hmac("sha1", b"some-other-secret", b"saltysalt", 1003, 16)

BASE_UNIX = 1788220800  # 2026-09-01T00:00:00Z


def webkit(unix_seconds):
    return int((unix_seconds + 11644473600) * 1_000_000)


def openssl(cipher, key, iv, data, decrypt=False, nopad=False):
    args = ["openssl", "enc", "-" + cipher, "-K", key.hex(), "-iv", iv.hex()]
    if decrypt:
        args.append("-d")
    if nopad:
        args.append("-nopad")
    return subprocess.run(args, input=data, capture_output=True, check=True).stdout


def v10(plain, key=CHROMIUM_KEY):
    return b"v10" + openssl("aes-128-cbc", key, b" " * 16, plain)


def write(path, data, mode="wb"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode) as f:
        f.write(data)


def write_json(path, obj):
    write(path, json.dumps(obj, indent=2, ensure_ascii=False).encode("utf-8"))


def new_db(path, wal=False):
    if os.path.exists(path):
        os.remove(path)
    for suffix in ("-wal", "-shm", "-journal"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db = sqlite3.connect(path)
    if wal:
        db.execute("PRAGMA journal_mode=WAL")
    return db


# --------------------------------------------------------------------------------------
# Chromium


def chromium_local_state(root, profiles, last_used="Default"):
    info = {}
    for directory, meta in profiles.items():
        info[directory] = meta
    write_json(os.path.join(root, "Local State"), {
        "browser": {"enabled_labs_experiments": []},
        "profile": {"info_cache": info, "last_used": last_used, "profiles_order": list(profiles.keys())},
    })


def bookmark(name, url, added, guid):
    return {"date_added": str(webkit(added)), "date_last_used": "0", "guid": guid, "id": guid[-4:],
            "meta_info": {}, "name": name, "type": "url", "url": url}


def folder(name, children, added, guid):
    return {"children": children, "date_added": str(webkit(added)), "date_last_used": "0",
            "date_modified": str(webkit(added + 60)), "guid": guid, "id": guid[-4:], "name": name, "type": "folder"}


def chromium_bookmarks(path, bar, other, synced):
    write_json(path, {
        "checksum": "00000000000000000000000000000000",
        "roots": {
            "bookmark_bar": folder("Bookmarks bar", bar, BASE_UNIX - 86400 * 400, "0bc5d13f-2cba-5d74-951f-3f233fe60001"),
            "other": folder("Other bookmarks", other, BASE_UNIX - 86400 * 400, "82b081ec-3dd3-529c-8475-ab6c344590dd"),
            "synced": folder("Mobile bookmarks", synced, BASE_UNIX - 86400 * 400, "4cf2e351-0e85-532b-bb37-df045d8f8d0f"),
        },
        "version": 1,
    })


def chromium_history(path, rows):
    db = new_db(path)
    db.executescript("""
        CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
        CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,
          visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,
          last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL);
        CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,url INTEGER NOT NULL,visit_time INTEGER NOT NULL,
          from_visit INTEGER,external_referrer_url TEXT,transition INTEGER DEFAULT 0 NOT NULL,segment_id INTEGER,
          visit_duration INTEGER DEFAULT 0 NOT NULL,incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
          opener_visit INTEGER,originator_cache_guid TEXT,originator_visit_id INTEGER,originator_from_visit INTEGER,
          originator_opener_visit INTEGER,is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
          consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,visited_link_id INTEGER DEFAULT 0 NOT NULL,
          app_id TEXT);
        CREATE INDEX urls_url_index ON urls (url);
        INSERT INTO meta VALUES ('version', '70');
    """)
    for url, title, visits, typed, when, hidden in rows:
        cur = db.execute("INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time,hidden) VALUES (?,?,?,?,?,?)",
                         (url, title, visits, typed, webkit(when), hidden))
        db.execute("INSERT INTO visits(url,visit_time,transition) VALUES (?,?,?)", (cur.lastrowid, webkit(when), 0))
    db.commit()
    db.close()


LOGINS_SCHEMA = """
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR,
  password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL,
  date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER,
  times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR,
  skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB,
  id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB,
  date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER,
  sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR,
  date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
INSERT INTO meta VALUES ('version', '43');
"""


def chromium_logins(path, rows):
    db = new_db(path)
    db.executescript(LOGINS_SCHEMA)
    for origin, realm, user, password_blob, blacklisted, used in rows:
        db.execute("""INSERT INTO logins(origin_url, action_url, username_element, username_value, password_element,
                      password_value, signon_realm, date_created, blacklisted_by_user, scheme, times_used, date_last_used)
                      VALUES (?,?,?,?,?,?,?,?,?,0,?,?)""",
                   (origin, origin, "email", user, "password", password_blob, realm, webkit(BASE_UNIX - 86400 * 30),
                    blacklisted, used, webkit(BASE_UNIX - 3600) if used else 0))
    db.commit()
    db.close()


def chromium_cookies(path, rows):
    db = new_db(path)
    db.executescript("""
        CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
        INSERT INTO meta VALUES ('version', '24');
        CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,
          name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,
          expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,
          last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,
          priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,
          source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,
          has_cross_site_ancestor INTEGER NOT NULL);
    """)
    for host, name, value, encrypted, path_, expires, secure, httponly, samesite in rows:
        persistent = 1 if expires else 0
        db.execute("INSERT INTO cookies VALUES (?,?,'',?,?,?,?,?,?,?,?,?,?,1,?,2,443,?,0,0)",
                   (webkit(BASE_UNIX - 7200), host, name, value, encrypted, path_,
                    webkit(expires) if expires else 0, secure, httponly, webkit(BASE_UNIX - 60),
                    persistent, persistent, samesite, webkit(BASE_UNIX - 60)))
    db.commit()
    db.close()


# SNSS session files -------------------------------------------------------------------


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def p_i32(v):
    return struct.pack("<i", v)


def p_str(s):
    b = s.encode("utf-8")
    return p_i32(len(b)) + pad4(b)


def p_str16(s):
    b = s.encode("utf-16-le")
    return p_i32(len(b) // 2) + pad4(b)


def pickle(*fields):
    payload = b"".join(fields)
    return struct.pack("<I", len(payload)) + payload


def nav(tab, index, url, title):
    # SerializedNavigationEntry::WriteToPickle, abbreviated after the fields we read plus a
    # few of the optional trailing ones so the reader has to skip them.
    return 6, pickle(p_i32(tab), p_i32(index), p_str(url), p_str16(title), p_str(""), p_i32(0),
                     p_i32(0), p_str(""), p_i32(0), p_str(url))


def ids(command, *values):
    return command, b"".join(p_i32(v) for v in values)


def session_commands():
    group_high, group_low = 0x1122334455667788, 0x99AABBCCDDEEFF00
    cmds = [
        ids(9, 1, 0),  # window 1 is a normal window
        ids(0, 1, 10), ids(2, 10, 0), nav(10, 0, "https://mail.example.com/", "Inbox"),
        (12, struct.pack("<i?3x", 10, True)),  # pinned
        ids(7, 10, 0),
        ids(0, 1, 11), ids(2, 11, 2),
        nav(11, 0, "https://news.example.com/", "News"),
        nav(11, 1, "https://news.example.com/story", "Story"),
        ids(7, 11, 0),  # went back
        ids(0, 1, 12), ids(2, 12, 1),
        nav(12, 0, "https://a.example.com/", "A"),
        nav(12, 1, "https://b.example.com/", "B"),
        nav(12, 2, "https://c.example.com/", "C"),
        ids(7, 12, 2),
        ids(24, 12, 0, 1),  # prune entry 0: B→0, C→1, current 2→1
        ids(0, 1, 13), ids(2, 13, 3), nav(13, 0, "https://docs.example.com/", "Docs 文档"),
        (25, struct.pack("<i4xQQ?7x", 13, group_high, group_low, True)),
        (27, pickle(struct.pack("<QQ", group_high, group_low), p_str16("Research"), struct.pack("<I", 4), p_i32(1), p_i32(0))),
        ids(0, 1, 14), ids(2, 14, 4), nav(14, 0, "https://closed.example.com/", "Closed"),
        (16, struct.pack("<i4xq", 14, webkit(BASE_UNIX))),  # tab closed
        ids(8, 1, 2),  # selected tab index 2 in window 1
        (255, b""),  # end of the initial state; later commands are appended changes
        ids(9, 2, 1),  # window 2 is a popup
        ids(0, 2, 20), nav(20, 0, "https://popup.example.com/", "Popup"),
        ids(9, 3, 0),
        ids(0, 3, 30), nav(30, 0, "https://second.example.com/", "Second window"),
        (21, struct.pack("<i4xq", 30, webkit(BASE_UNIX - 120))),
        ids(9, 4, 0),
        ids(0, 4, 40), nav(40, 0, "https://gone.example.com/", "Gone"),
        (17, struct.pack("<i4xq", 4, webkit(BASE_UNIX))),  # window closed
        (19, pickle(p_i32(10), p_str("session-storage-id"))),  # a command the reader ignores
    ]
    return cmds


def snss_plain(cmds):
    out = b"SNSS" + struct.pack("<i", 3)
    for cid, payload in cmds:
        out += struct.pack("<H", len(payload) + 1) + bytes([cid]) + payload
    return out + b"\x09\x00\x06"  # truncated trailing command, as after a crash


def snss_encrypted(cmds):
    out = b"SNSS" + struct.pack("<i", 5)
    for cid, payload in cmds:
        blob = v10(bytes([cid]) + payload)
        out += struct.pack("<I", len(blob)) + blob
    return out


PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def build_chrome():
    root = os.path.join(SUPPORT, "Google", "Chrome")
    chromium_local_state(root, {
        "Default": {"name": "Personal", "user_name": "alex@example.com", "gaia_name": "Alex Example",
                    "avatar_icon": "chrome://theme/IDR_PROFILE_AVATAR_26", "is_using_default_name": False,
                    "profile_highlight_color": -12627531, "default_avatar_fill_color": -12627531},
        "Profile 1": {"name": "Work", "user_name": "", "avatar_icon": "chrome://theme/IDR_PROFILE_AVATAR_20",
                      "is_using_default_name": False},
    })
    # A directory Local State doesn't list (and that isn't a profile) must be ignored.
    write_json(os.path.join(root, "System Profile", "junk.json"), {})

    d = os.path.join(root, "Default")
    write_json(os.path.join(d, "Preferences"), {"profile": {"name": "Personal"}})
    write(os.path.join(d, "Google Profile Picture.png"), PNG_1PX)
    t = BASE_UNIX - 86400 * 100
    chromium_bookmarks(os.path.join(d, "Bookmarks"),
                       bar=[bookmark("Netnyahoo", "https://netnyahoo.example/", t, "00000000-0000-4000-8000-000000000101"),
                            folder("Dev", [
                                bookmark("Swift Forums", "https://forums.swift.example/", t, "00000000-0000-4000-8000-000000000102"),
                                folder("Docs", [bookmark("SQLite — Docs", "https://sqlite.example/docs.html", t,
                                                         "00000000-0000-4000-8000-000000000103")], t, "00000000-0000-4000-8000-000000000104"),
                            ], t, "00000000-0000-4000-8000-000000000105"),
                            bookmark("Bookmarklet", "javascript:alert(1)", t, "00000000-0000-4000-8000-000000000106")],
                       other=[bookmark("Café ☕", "https://cafe.example/menu?a=1&b=2", t, "00000000-0000-4000-8000-000000000107")],
                       synced=[])
    chromium_bookmarks(os.path.join(d, "AccountBookmarks"),
                       bar=[bookmark("From account", "https://account.example/", t, "00000000-0000-4000-8000-000000000201")],
                       other=[], synced=[bookmark("Phone link", "https://phone.example/", t, "00000000-0000-4000-8000-000000000202")])

    rows = []
    # 2,500 ordinary entries, newest first by id: url i visited i minutes before BASE.
    for i in range(2500):
        rows.append((f"https://site{i % 97}.example/page/{i}", f"Page {i}", 1 + i % 7, i % 3, BASE_UNIX - 60 * (i + 1), 0))
    rows += [
        ("https://newest.example/", "Newest", 42, 5, BASE_UNIX, 0),
        ("https://hidden.example/", "Hidden subframe", 1, 0, BASE_UNIX - 5, 1),
        ("chrome://settings/", "Settings", 3, 0, BASE_UNIX - 6, 0),
        ("file:///Users/someone/notes.txt", "notes.txt", 1, 0, BASE_UNIX - 7, 0),
        ("https://no-title.example/", None, 1, 0, BASE_UNIX - 86400 * 365, 0),
    ]
    chromium_history(os.path.join(d, "History"), rows)

    chromium_logins(os.path.join(d, "Login Data"), [
        ("https://accounts.example.com/login", "https://accounts.example.com/", "alex@example.com", v10(b"correct horse"), 0, 12),
        ("https://shop.example/", "https://shop.example/", "alex", v10("pässwörd 🔑".encode()), 0, 0),
        ("https://never.example/", "https://never.example/", "", b"", 1, 0),  # "never save"
        ("android://hash@com.example.app/", "android://hash@com.example.app/", "alex", v10(b"from-android"), 0, 1),
        ("https://wrongkey.example/", "https://wrongkey.example/", "bob", v10(b"secret", WRONG_KEY), 0, 0),
        ("https://legacy.example/", "https://legacy.example/", "old", b"plain-legacy", 0, 0),  # pre-encryption row
    ])
    chromium_logins(os.path.join(d, "Login Data For Account"), [
        ("https://accounts.example.com/login", "https://accounts.example.com/", "alex@example.com", v10(b"correct horse"), 0, 1),
        ("https://account-only.example/", "https://account-only.example/", "sam", v10(b"only-in-account"), 0, 0),
    ])

    def host_hashed(host, value):
        return v10(hashlib.sha256(host.encode()).digest() + value.encode())

    future = 4102444800  # 2100-01-01
    chromium_cookies(os.path.join(d, "Network", "Cookies"), [
        (".example.com", "sid", "", host_hashed(".example.com", "s3ss10n"), "/", future, 1, 1, 1),
        ("accounts.example.com", "legacy", "", v10(b"no-host-prefix"), "/", future, 1, 0, 2),
        ("plain.example", "pref", "dark", b"", "/", future, 0, 0, -1),
        ("session.example", "tmp", "", host_hashed("session.example", "until-quit"), "/app", 0, 0, 0, 0),
        ("expired.example", "old", "", host_hashed("expired.example", "gone"), "/", 978307200, 0, 0, 0),
        ("wrong.example", "bad", "", v10(b"x", WRONG_KEY), "/", future, 0, 0, 0),
    ])

    cmds = session_commands()
    sessions = os.path.join(d, "Sessions")
    write(os.path.join(sessions, f"Session_{webkit(BASE_UNIX - 86400)}"), b"SNSS" + struct.pack("<i", 3))  # older, empty
    write(os.path.join(sessions, f"Session_{webkit(BASE_UNIX)}"), snss_plain(cmds))
    write(os.path.join(sessions, f"Tabs_{webkit(BASE_UNIX)}"), b"SNSS" + struct.pack("<i", 3))
    write(os.path.join(MISC, "Session_v5_encrypted"), snss_encrypted(cmds))

    p1 = os.path.join(root, "Profile 1")
    write_json(os.path.join(p1, "Preferences"), {"profile": {"name": "Work"}})
    chromium_bookmarks(os.path.join(p1, "Bookmarks"),
                       bar=[bookmark("Work wiki", "https://wiki.work.example/", t, "00000000-0000-4000-8000-000000000301")],
                       other=[], synced=[])
    chromium_history(os.path.join(p1, "History"), [("https://work.example/", "Work", 3, 1, BASE_UNIX - 10, 0)])


def build_brave():
    root = os.path.join(SUPPORT, "BraveSoftware", "Brave-Browser")
    chromium_local_state(root, {"Default": {"name": "Person 1"}})
    d = os.path.join(root, "Default")
    write_json(os.path.join(d, "Preferences"), {})
    chromium_bookmarks(os.path.join(d, "Bookmarks"), bar=[bookmark("Brave Search", "https://search.brave.example/",
                                                                   BASE_UNIX, "00000000-0000-4000-8000-000000000401")],
                       other=[], synced=[])


def build_opera():
    # Opera keeps its main profile in the data directory itself.
    root = os.path.join(SUPPORT, "com.operasoftware.Opera")
    chromium_local_state(root, {})
    write_json(os.path.join(root, "Preferences"), {})
    chromium_bookmarks(os.path.join(root, "Bookmarks"), bar=[bookmark("Opera link", "https://opera.example/",
                                                                      BASE_UNIX, "00000000-0000-4000-8000-000000000501")],
                       other=[], synced=[])


# --------------------------------------------------------------------------------------
# Arc


def arc_color(r, g, b):
    return {"red": r, "green": g, "blue": b, "alpha": 1, "colorSpace": "extendedSRGB"}


def build_arc():
    arc = os.path.join(SUPPORT, "Arc")
    root = os.path.join(arc, "User Data")
    chromium_local_state(root, {"Default": {"name": "Your Chromium"}, "Profile 1": {"name": "Work"}})
    d = os.path.join(root, "Default")
    write_json(os.path.join(d, "Preferences"), {})
    chromium_history(os.path.join(d, "History"), [("https://arc-history.example/", "Arc history", 2, 0, BASE_UNIX - 30, 0)])
    chromium_logins(os.path.join(d, "Login Data"), [
        ("https://arc-login.example/", "https://arc-login.example/", "arc-user", v10(b"arc-pass"), 0, 1)])
    p1 = os.path.join(root, "Profile 1")
    write_json(os.path.join(p1, "Preferences"), {})

    ref = BASE_UNIX - 978307200  # NSDate reference time

    def tab(id_, parent, url, title, rename=None):
        return {"id": id_, "parentID": parent, "childrenIds": [], "title": rename, "isUnread": False,
                "createdAt": ref - 1000, "data": {"tab": {"savedURL": url, "savedTitle": title,
                                                          "timeLastActiveAt": ref - 60, "savedMuteStatus": "allowAudio"}}}

    def container(id_, children, kind):
        return {"id": id_, "parentID": None, "childrenIds": children, "title": None, "isUnread": False,
                "createdAt": ref - 5000, "data": {"itemContainer": {"containerType": kind}}}

    def folder_item(id_, parent, name, children):
        return {"id": id_, "parentID": parent, "childrenIds": children, "title": name, "isUnread": False,
                "createdAt": ref - 3000, "data": {"list": {}}}

    items = [
        container("P-PIN", ["T-1", "F-1", "SV-1"], {"spaceItems": {"_0": "S-PERSONAL"}}),
        tab("T-1", "P-PIN", "https://calendar.example/", "Calendar – Week of Sep 1", rename="Cal"),
        folder_item("F-1", "P-PIN", "Reading", ["T-2", "F-2"]),
        tab("T-2", "F-1", "https://blog.example/post", "A long blog post"),
        folder_item("F-2", "F-1", "Later", ["T-3"]),
        tab("T-3", "F-2", "https://later.example/", "Later"),
        {"id": "SV-1", "parentID": "P-PIN", "childrenIds": ["T-4", "T-5"], "title": None, "isUnread": False,
         "createdAt": ref - 2000, "data": {"splitView": {"layout": "horizontal"}}},
        tab("T-4", "SV-1", "https://left.example/", "Left"),
        tab("T-5", "SV-1", "https://right.example/", "Right"),
        container("P-TODAY", ["T-6", "T-7"], {"spaceItems": {"_0": "S-PERSONAL"}}),
        tab("T-6", "P-TODAY", "https://today.example/", "Today tab"),
        tab("T-7", "P-TODAY", "https://today2.example/", "Another today", rename="Renamed today"),
        container("W-PIN", ["T-8"], {"spaceItems": {"_0": "S-WORK"}}),
        tab("T-8", "W-PIN", "https://jira.example/", "Board"),
        container("W-TODAY", [], {"spaceItems": {"_0": "S-WORK"}}),
        container("U-PIN", ["T-9"], {"spaceItems": {"_0": "S-UNTITLED"}}),
        tab("T-9", "U-PIN", "https://untitled.example/", "Untitled space tab"),
        container("FAV-DEFAULT", ["T-10", "T-11", "F-3"], {"topApps": {"_0": {"default": True}}}),
        tab("T-10", "FAV-DEFAULT", "https://mail.example.com/", "Mail"),
        tab("T-11", "FAV-DEFAULT", "https://music.example/", "Music", rename="Tunes"),
        folder_item("F-3", "FAV-DEFAULT", "Fav folder", ["T-12"]),
        tab("T-12", "F-3", "https://maps.example/", "Maps"),
        container("FAV-WORK", ["T-13"], {"topApps": {"_0": {"custom": {"_0": {"directoryBasename": "Profile 1"}}}}}),
        tab("T-13", "FAV-WORK", "https://slack.example/", "Slack"),
        {"id": "E-1", "parentID": "P-TODAY", "childrenIds": [], "title": "Easel", "data": {"easel": {"easelID": "x"}}},
    ]
    spaces = [
        {"id": "S-PERSONAL", "title": "Personal",
         "profile": {"default": True},
         "containerIDs": ["unpinned", "P-TODAY", "pinned", "P-PIN"],
         "newContainerIDs": [{"unpinned": {"_0": {"shared": {}}}}, "P-TODAY", {"pinned": {}}, "P-PIN"],
         "customInfo": {"iconType": {"emoji_v2": "🏡"},
                        "windowTheme": {"primaryColorPalette": {"midTone": arc_color(0.2, 0.4, 0.8),
                                                                "shadedTone": arc_color(0.1, 0.2, 0.4)},
                                        "background": {"single": {"_0": {"style": {"color": {"_0": {
                                            "blendedSingleColor": {"_0": {"color": arc_color(0.2, 0.4, 0.8)}}}}}}}},
                                        "semanticColorPalette": {}}}},
        {"id": "S-WORK", "title": "Work",
         "profile": {"custom": {"_0": {"directoryBasename": "Profile 1", "machineID": "M-1"}}},
         "newContainerIDs": [{"pinned": {}}, "W-PIN", {"unpinned": {"_0": {"shared": {}}}}, "W-TODAY"],
         "customInfo": {"iconType": {"icon": "briefcase"},
                        "windowTheme": {"background": {"gradient": {"_0": {"blendedGradient": {"_0": {
                            "baseColors": [{"color": arc_color(1.0, 0.5, 0.0)}, {"color": arc_color(1.2, -0.1, 0.5)}]}}}}}}}},
        {"id": "S-UNTITLED",
         "profile": {"default": True},
         "containerIDs": ["pinned", "U-PIN"],
         "customInfo": {"iconType": {"emoji": 128640}}},
    ]

    def flat(objs):
        out = []
        for o in objs:
            out += [o["id"], o]
        return out

    sidebar = {
        "sidebarSyncState": {"items": [], "spaceModels": []},
        "sidebar": {"containers": [
            {"global": {}},
            {"spaces": flat(spaces), "items": flat(items),
             "topAppsContainerIDs": [{"default": True}, "FAV-DEFAULT",
                                     {"custom": {"_0": {"directoryBasename": "Profile 1", "machineID": "M-1"}}}, "FAV-WORK"]},
        ]},
        "version": 1,
    }
    write_json(os.path.join(arc, "StorableSidebar.json"), sidebar)


# --------------------------------------------------------------------------------------
# Firefox


def der(tag, content):
    n = len(content)
    if n < 0x80:
        length = bytes([n])
    else:
        b = n.to_bytes((n.bit_length() + 7) // 8, "big")
        length = bytes([0x80 | len(b)]) + b
    return bytes([tag]) + length + content


def seq(*parts):
    return der(0x30, b"".join(parts))


def octets(b):
    return der(0x04, b)


def integer(v):
    b = v.to_bytes((v.bit_length() + 8) // 8, "big")
    return der(0x02, b)


def oid(dotted):
    parts = [int(p) for p in dotted.split(".")]
    body = bytes([parts[0] * 40 + parts[1]])
    for p in parts[2:]:
        chunk = [p & 0x7F]
        p >>= 7
        while p:
            chunk.insert(0, 0x80 | (p & 0x7F))
            p >>= 7
        body += bytes(chunk)
    return der(0x06, body)


def pbes2(plain, global_salt, password, entry_salt, iv14, iterations=10000):
    k = hashlib.sha1(global_salt + password).digest()
    key = hashlib.pbkdf2_hmac("sha256", k, entry_salt, iterations, 32)
    ct = openssl("aes-256-cbc", key, b"\x04\x0e" + iv14, plain)
    return seq(
        seq(oid("1.2.840.113549.1.5.13"),
            seq(seq(oid("1.2.840.113549.1.5.12"),
                    seq(octets(entry_salt), integer(iterations), integer(32), seq(oid("1.2.840.113549.2.9")))),
                seq(oid("2.16.840.1.101.3.4.1.42"), octets(iv14)))),
        octets(ct))


CKA_ID = b"\xf8" + b"\0" * 14 + b"\x01"


def key4(path, global_salt, password, login_key):
    db = new_db(path)
    db.executescript("""
        CREATE TABLE metaData (id PRIMARY KEY UNIQUE ON CONFLICT REPLACE, item1, item2);
        CREATE TABLE nssPrivate (id PRIMARY KEY UNIQUE ON CONFLICT ABORT, a0, a1, a2, a3, a10, a11, a12, a102, a104, a105);
    """)
    # NSS encrypts "password-check" with PKCS#7 padding, i.e. "password-check\x02\x02".
    check = pbes2(b"password-check", global_salt, password, b"C" * 32, b"c" * 14)
    db.execute("INSERT INTO metaData VALUES ('Version', 1, NULL)")
    db.execute("INSERT INTO metaData VALUES ('password', ?, ?)", (global_salt, check))
    decoy = pbes2(b"D" * 24, global_salt, password, b"E" * 32, b"e" * 14)
    db.execute("INSERT INTO nssPrivate (id, a11, a102) VALUES (1, ?, ?)", (decoy, b"\x01" * 16))
    db.execute("INSERT INTO nssPrivate (id, a11, a102) VALUES (2, ?, ?)",
               (pbes2(login_key, global_salt, password, b"K" * 32, b"k" * 14), CKA_ID))
    db.commit()
    db.close()


def login_field(value, key):
    if len(key) == 24:
        iv = b"12345678"
        ct = openssl("des-ede3-cbc", key, iv, value.encode())
        algo = oid("1.2.840.113549.3.7")
    else:
        iv = b"0123456789abcdef"
        ct = openssl("aes-256-cbc", key, iv, value.encode())
        algo = oid("2.16.840.1.101.3.4.1.42")
    return base64.b64encode(seq(octets(CKA_ID), seq(algo, octets(iv)), octets(ct))).decode()


def logins_json(path, key, rows):
    logins = []
    for i, (host, action, user, password) in enumerate(rows, 1):
        logins.append({"id": i, "hostname": host, "httpRealm": None, "formSubmitURL": action,
                       "usernameField": "user", "passwordField": "pass",
                       "encryptedUsername": login_field(user, key), "encryptedPassword": login_field(password, key),
                       "guid": "{00000000-0000-4000-8000-%012d}" % i, "encType": 1,
                       "timeCreated": (BASE_UNIX - 86400) * 1000, "timeLastUsed": BASE_UNIX * 1000,
                       "timePasswordChanged": (BASE_UNIX - 86400) * 1000, "timesUsed": i})
    write_json(path, {"nextId": len(rows) + 1, "logins": logins, "potentiallyVulnerablePasswords": [],
                      "dismissedBreachAlertsByLoginGUID": {}, "version": 3})


def lz4_literals(data):
    # A valid LZ4 block made of one literal-only sequence: token, extended length, literals.
    n = len(data)
    if n < 15:
        return bytes([n << 4]) + data
    out = bytearray([0xF0])
    rest = n - 15
    while rest >= 255:
        out.append(255)
        rest -= 255
    out.append(rest)
    return bytes(out) + data


def mozlz4(obj):
    raw = json.dumps(obj, ensure_ascii=False).encode()
    return b"mozLz40\0" + struct.pack("<I", len(raw)) + lz4_literals(raw)


def places(path):
    # WAL mode, with the last rows left in the -wal file (as when Firefox is running), to
    # prove the reader sees uncheckpointed data.
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "places.sqlite")
    db = new_db(src, wal=True)
    db.execute("PRAGMA wal_autocheckpoint=0")
    db.executescript("""
        CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, rev_host LONGVARCHAR,
          visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, typed INTEGER DEFAULT 0 NOT NULL,
          frecency INTEGER DEFAULT -1 NOT NULL, last_visit_date INTEGER, guid TEXT, foreign_count INTEGER DEFAULT 0 NOT NULL,
          url_hash INTEGER DEFAULT 0 NOT NULL, description TEXT, preview_image_url TEXT, site_name TEXT, origin_id INTEGER,
          recalc_frecency INTEGER NOT NULL DEFAULT 0, alt_frecency INTEGER, recalc_alt_frecency INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER,
          position INTEGER, title LONGVARCHAR, keyword_id INTEGER, folder_type TEXT, dateAdded INTEGER,
          lastModified INTEGER, guid TEXT, syncStatus INTEGER NOT NULL DEFAULT 0, syncChangeCounter INTEGER NOT NULL DEFAULT 1);
    """)
    us = lambda s: s * 1_000_000
    place_rows = [
        (1, "https://www.mozilla.example/", "Mozilla", 10, 0, 1, us(BASE_UNIX - 100)),
        (2, "https://developer.mozilla.example/docs", "MDN Docs", 4, 0, 0, us(BASE_UNIX - 50)),
        (3, "https://bookmarked-never-visited.example/", "Never visited", 0, 0, 0, None),
        (4, "place:sort=8&maxResults=10", "Recent Tags", 0, 1, 0, None),
        (5, "https://hidden.example/frame", "Frame", 1, 1, 0, us(BASE_UNIX - 20)),
        (6, "about:config", "about:config", 2, 0, 0, us(BASE_UNIX - 10)),
        (7, "https://tagged.example/", "Tagged", 1, 0, 0, us(BASE_UNIX - 400)),
    ]
    for pid, url, title, visits, hidden, typed, last in place_rows:
        db.execute("INSERT INTO moz_places (id,url,title,visit_count,hidden,typed,last_visit_date,guid) VALUES (?,?,?,?,?,?,?,?)",
                   (pid, url, title, visits, hidden, typed, last, "p%011d" % pid))
    bm = [
        (1, 2, None, 0, 0, "", "root________"),
        (2, 2, None, 1, 0, "menu", "menu________"),
        (3, 2, None, 1, 1, "toolbar", "toolbar_____"),
        (4, 2, None, 1, 2, "tags", "tags________"),
        (5, 2, None, 1, 3, "unfiled", "unfiled_____"),
        (6, 2, None, 1, 4, "mobile", "mobile______"),
        (10, 1, 1, 3, 0, "Mozilla", "b00000000010"),
        (11, 2, None, 3, 1, "Dev & Docs", "b00000000011"),
        (12, 1, 2, 11, 0, "MDN", "b00000000012"),
        (13, 3, None, 11, 1, None, "b00000000013"),  # separator
        (14, 1, 4, 3, 2, "Recent Tags", "b00000000014"),  # smart bookmark
        (15, 1, 3, 2, 0, "Never visited", "b00000000015"),
        (16, 2, None, 4, 0, "sometag", "b00000000016"),  # tag folder
        (17, 1, 7, 16, 0, None, "b00000000017"),
    ]
    for bid, type_, fk, parent, pos, title, guid in bm:
        db.execute("INSERT INTO moz_bookmarks (id,type,fk,parent,position,title,dateAdded,lastModified,guid) VALUES (?,?,?,?,?,?,?,?,?)",
                   (bid, type_, fk, parent, pos, title, us(BASE_UNIX - 86400), us(BASE_UNIX - 86400), guid))
    db.commit()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    # These stay in the WAL.
    db.execute("INSERT INTO moz_places (id,url,title,visit_count,hidden,typed,last_visit_date,guid) VALUES (8,'https://in-wal.example/','Only in WAL',1,0,0,?,'p00000000008')",
               (us(BASE_UNIX),))
    db.execute("INSERT INTO moz_bookmarks (id,type,fk,parent,position,title,dateAdded,lastModified,guid) VALUES (18,1,8,5,0,'WAL bookmark',?,?,'b00000000018')",
               (us(BASE_UNIX), us(BASE_UNIX)))
    db.commit()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for suffix in ("", "-wal"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
        shutil.copyfile(src + suffix, path + suffix)
    db.close()
    shutil.rmtree(tmp)


def firefox_cookies(path):
    db = new_db(path)
    db.executescript("""
        CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT,
          host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER,
          isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0,
          schemeMap INTEGER DEFAULT 0, isPartitionedAttributeSet INTEGER DEFAULT 0);
    """)
    db.execute("INSERT INTO moz_cookies (name,value,host,path,expiry,lastAccessed,creationTime,isSecure,isHttpOnly,sameSite) VALUES ('ff','1','.mozilla.example','/',4102444800,0,?,1,1,1)",
               (BASE_UNIX * 1_000_000,))
    db.execute("INSERT INTO moz_cookies (name,value,host,path,expiry,lastAccessed,creationTime,isSecure,isHttpOnly,sameSite) VALUES ('ms','2','ms.example','/',4102444800000,0,0,0,0,2)")
    db.execute("INSERT INTO moz_cookies (name,value,host,path,expiry,lastAccessed,creationTime,isSecure,isHttpOnly,sameSite) VALUES ('old','3','old.example','/',978307200,0,0,0,0,0)")
    db.commit()
    db.close()


def build_firefox():
    root = os.path.join(SUPPORT, "Firefox")
    write(os.path.join(root, "profiles.ini"), """[Profile1]
Name=Work
IsRelative=1
Path=Profiles/zzzz9999.work
Default=1

[Profile0]
Name=default-release
IsRelative=1
Path=Profiles/abcd1234.default-release

[Profile2]
Name=elsewhere
IsRelative=0
Path=/Volumes/External/firefox-profile

[General]
StartWithLastProfile=1
Version=2

[Install308046B0AF4A39CB]
Default=Profiles/abcd1234.default-release
Locked=1
""".encode())
    d = os.path.join(root, "Profiles", "abcd1234.default-release")
    places(os.path.join(d, "places.sqlite"))
    firefox_cookies(os.path.join(d, "cookies.sqlite"))
    session = {
        "version": ["sessionrestore", 1],
        "windows": [
            {"selected": 2, "tabs": [
                {"entries": [{"url": "https://www.mozilla.example/", "title": "Mozilla"}], "index": 1, "pinned": True,
                 "hidden": False, "lastAccessed": BASE_UNIX * 1000},
                {"entries": [{"url": "https://a.example/", "title": "A"}, {"url": "https://b.example/", "title": "B"}],
                 "index": 1, "hidden": False, "groupId": "g-1", "lastAccessed": BASE_UNIX * 1000 - 5},
                {"entries": [{"url": "https://hidden-tab.example/", "title": "Hidden"}], "index": 1, "hidden": True},
                {"entries": [], "index": 0},
            ], "groups": [{"id": "g-1", "name": "Shopping", "color": "orange", "collapsed": False}]},
            {"selected": 1, "tabs": [{"entries": [{"url": "https://second.example/", "title": "Second"}], "index": 5}]},
        ],
        "_closedWindows": [{"tabs": [{"entries": [{"url": "https://closed.example/", "title": "Closed"}]}]}],
        "session": {"lastUpdate": BASE_UNIX * 1000},
    }
    write(os.path.join(d, "sessionstore-backups", "recovery.jsonlz4"), mozlz4(session))
    global_salt = b"S" * 20
    login_key = bytes(range(1, 25))  # 3DES
    key4(os.path.join(d, "key4.db"), global_salt, b"", login_key)
    logins_json(os.path.join(d, "logins.json"), login_key, [
        ("https://accounts.mozilla.example", "https://accounts.mozilla.example", "fox@example.com", "fire & fox"),
        ("https://unicode.example", "", "ユーザー", "パスワード🔒"),
    ])

    w = os.path.join(root, "Profiles", "zzzz9999.work")
    work_key = bytes(range(100, 132))  # AES-256
    key4(os.path.join(w, "key4.db"), b"W" * 20, b"hunter2", work_key)
    logins_json(os.path.join(w, "logins.json"), work_key, [("https://intranet.example", "https://intranet.example", "worker", "aes-protected")])
    write_json(os.path.join(w, "prefs.js.json"), {})

    # Legacy pbeWithSha1AndTripleDES-CBC vector (pre-2020 key4.db).
    entry_salt = b"legacy-entry-salt-20"[:20]
    gs, pw = b"G" * 20, b"old-primary"
    hp = hashlib.sha1(gs + pw).digest()
    pes = entry_salt + b"\0" * (20 - len(entry_salt))
    chp = hashlib.sha1(hp + entry_salt).digest()
    k1 = hmac.new(chp, pes + entry_salt, hashlib.sha1).digest()
    tk = hmac.new(chp, pes, hashlib.sha1).digest()
    k2 = hmac.new(chp, tk + entry_salt, hashlib.sha1).digest()
    k = k1 + k2
    ct = openssl("des-ede3-cbc", k[:24], k[-8:], b"password-check")
    blob = seq(seq(oid("1.2.840.113549.1.12.5.1.3"), seq(octets(entry_salt), integer(1))), octets(ct))
    write_json(os.path.join(MISC, "nss-legacy-pbe.json"), {
        "globalSalt": base64.b64encode(gs).decode(), "password": pw.decode(),
        "der": base64.b64encode(blob).decode(), "plain": "password-check"})


# --------------------------------------------------------------------------------------
# Safari export, CSVs, bookmark HTML

BOOKMARKS_HTML_SAFARI = """<!DOCTYPE NETSCAPE-Bookmark-file-1>
<HTML>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<Title>Bookmarks</Title>
<H1>Bookmarks</H1>
<DT><H3 FOLDED>Favorites</H3>
<DL><p>
<DT><A HREF="https://www.apple.example/">Apple</A>
<DT><A HREF="https://news.example/?a=1&amp;b=2">News &amp; Views</A>
</DL><p>
<DT><H3 FOLDED>Travel</H3>
<DL><p>
<DT><H3 FOLDED>Japan</H3>
<DL><p>
<DT><A HREF="https://kyoto.example/">京都 guide</A>
</DL><p>
</DL><p>
<DT><H3 id="com.apple.ReadingList">Reading List</H3>
<DL><p>
<DT><A HREF="https://longread.example/article">A long read</A>
</DL><p>
</HTML>
"""

BOOKMARKS_HTML_CHROME = """<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000100" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://netnyahoo.example/" ADD_DATE="1700000001" ICON="data:image/png;base64,AAAA">Netnyahoo</A>
        <DT><H3 ADD_DATE="1700000002" LAST_MODIFIED="0">Empty folder</H3>
        <DL><p>
        </DL><p>
        <DT><H3 ADD_DATE="1700000003">Tools</H3>
        <DL><p>
            <DT><A HREF="https://tool.example/?q=&quot;x&quot;&amp;y=&#39;1&#39;" ADD_DATE="1700000004">Tool &lt;beta&gt; &#x2713;</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://loose.example/">Loose link</A>
    <DT><H3 UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
        <dt><a href=https://unquoted.example/ add_date=1700000005>lowercase, unquoted</a>
    </DL><p>
</DL><p>
"""


def build_exports():
    history_default = {
        "metadata": {"browser_name": "Safari", "browser_version": "26.0", "data_type": "history",
                     "export_time_usec": BASE_UNIX * 1_000_000, "schema_version": 1},
        "history": [
            {"url": "https://maps.apple.example/", "time_usec": (BASE_UNIX - 100) * 1_000_000,
             "destination_url": "https://www.apple.example/maps/", "destination_time_usec": (BASE_UNIX - 100) * 1_000_000 + 97},
            {"url": "https://www.apple.example/maps/", "title": "Maps - Apple", "time_usec": (BASE_UNIX - 100) * 1_000_000 + 97,
             "source_url": "https://maps.apple.example/", "source_time_usec": (BASE_UNIX - 100) * 1_000_000,
             "visit_count": 3, "latest_visit_was_load_failure": False, "latest_visit_was_http_get": True},
            {"url": "https://newest.safari.example/", "title": "Newest", "time_usec": BASE_UNIX * 1_000_000, "visits_count": 9},
            {"url": "file:///tmp/x.html", "title": "local", "time_usec": BASE_UNIX * 1_000_000, "visit_count": 1},
        ],
    }
    history_work = {"metadata": {"browser_name": "Safari", "browser_version": "26.0", "data_type": "history",
                                 "export_time_usec": BASE_UNIX * 1_000_000, "schema_version": 1},
                    "history": [{"url": "https://work.safari.example/", "title": "Work thing",
                                 "time_usec": (BASE_UNIX - 5) * 1_000_000, "visit_count": 2}]}
    extensions = {"metadata": {"browser_name": "Safari", "browser_version": "26.0", "data_type": "extensions",
                               "export_time_usec": BASE_UNIX * 1_000_000, "schema_version": 1},
                  "extensions": [{"composed_identifier": "com.example.blocker.ext (AB12CD34EF)", "developer_name": "Example",
                                  "display_name": "Example Blocker",
                                  "marketplace_lookup": {"store_identifier": "123456789"}}]}
    cards = {"metadata": {"browser_name": "Safari", "browser_version": "26.0", "data_type": "payment_cards",
                          "export_time_usec": BASE_UNIX * 1_000_000, "schema_version": 1},
             "payment_cards": [{"card_number": "0000000000000000", "card_name": "Test card"}]}
    passwords = ("Title,URL,Username,Password,Notes,OTPAuth\r\n"
                 "apple.example (me@example.com),https://apple.example/,me@example.com,\"pa,ss\"\"word\",\"line one\nline two\",otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP\r\n"
                 "no-user.example,https://no-user.example/,,only-password,,\r\n"
                 "empty password,https://empty.example/,someone,,,\r\n")

    files = {
        "Bookmarks.html": BOOKMARKS_HTML_SAFARI.encode(),
        "History.json": json.dumps(history_default).encode(),
        "History_Work.json": json.dumps(history_work).encode(),
        "Extensions.json": json.dumps(extensions).encode(),
        "PaymentCards.json": json.dumps(cards).encode(),
        "Passwords.csv": b"\xef\xbb\xbf" + passwords.encode(),
    }
    folder_dir = os.path.join(HERE, "safari", "Safari Export")
    if os.path.exists(folder_dir):
        shutil.rmtree(folder_dir)
    for name, data in files.items():
        write(os.path.join(folder_dir, name), data)
    zip_path = os.path.join(HERE, "safari", "Safari Export.zip")
    with zipfile.ZipFile(zip_path, "w") as z:
        for name, data in files.items():
            info = zipfile.ZipInfo("Safari Export/" + name, date_time=(2026, 9, 1, 0, 0, 0))
            # Mix of deflated and stored entries, as zip writers do.
            info.compress_type = zipfile.ZIP_STORED if name.endswith(".csv") else zipfile.ZIP_DEFLATED
            z.writestr(info, data)
        z.writestr(zipfile.ZipInfo("__MACOSX/Safari Export/._Bookmarks.html", date_time=(2026, 9, 1, 0, 0, 0)), b"junk")
    write(os.path.join(HERE, "safari", "not-an-export.zip"), b"PK\x05\x06" + b"\0" * 18)

    csv_dir = os.path.join(HERE, "csv")
    write(os.path.join(csv_dir, "chrome-passwords.csv"),
          b"name,url,username,password,note\n"
          b"accounts.example.com,https://accounts.example.com/login,alex@example.com,correct horse,\n"
          b"shop.example,https://shop.example/,alex,\"with \"\"quotes\"\", commas\",gift card in note\n")
    write(os.path.join(csv_dir, "firefox-passwords.csv"),
          b'"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\r\n'
          b'"https://accounts.mozilla.example","fox@example.com","fire & fox",,"https://accounts.mozilla.example","{a}","1788134400000","1788220800000","1788134400000"\r\n'
          b'"https://realm.example","admin","basic-auth","Router",,"{b}","1788134400000","1788134400000","1788134400000"\r\n')
    write(os.path.join(csv_dir, "bitwarden.csv"),
          b"folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n"
          b",,login,Example,,,0,https://bw.example/,bw-user,bw-pass,\n")
    write(os.path.join(csv_dir, "not-passwords.csv"), b"a,b,c\n1,2,3\n")
    write(os.path.join(HERE, "html", "chrome-bookmarks.html"), BOOKMARKS_HTML_CHROME.encode())


def main():
    for d in (os.path.join(HERE, "home"), MISC):
        if os.path.exists(d):
            shutil.rmtree(d)
    build_chrome()
    build_brave()
    build_opera()
    build_arc()
    build_firefox()
    build_exports()
    write_json(os.path.join(HERE, "secrets.json"), {
        "chromiumSafeStorageSecret": CHROMIUM_SECRET.decode(),
        "chromiumKeyHex": CHROMIUM_KEY.hex(),
        "firefoxWorkPrimaryPassword": "hunter2",
    })
    print("fixtures written to", HERE)


if __name__ == "__main__":
    main()
