#!/usr/bin/env python3
"""Builds the fake Chrome home that scripts/e2e.mjs imports from. Everything here is invented.

    python3 packages/import/scripts/e2e_fixture.py <home dir> [safe storage secret] [fixture server port]

Writes <home>/Library/Application Support/Google/Chrome/{Local State, Default/{Preferences, Network/Cookies, Web Data}}
(<home> is wiped first). Cookie values and the card number are encrypted the way Chrome does on macOS (v10,
AES-128-CBC, key = PBKDF2(secret, "saltysalt", 1003)), with the secret the app gets as NETNYAHOO_IMPORT_TEST_SECRET,
so no Keychain item is ever read. The localhost cookies carry the fixture server's port. The card is Visa's published test number.
"""

import hashlib, json, os, shutil, sqlite3, subprocess, sys, time

if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
    print(__doc__.strip())
    sys.exit(0 if len(sys.argv) > 1 else 64)

root = os.path.abspath(sys.argv[1])
SECRET = (sys.argv[2] if len(sys.argv) > 2 else "e2e-test-secret").encode()
KEY = hashlib.pbkdf2_hmac("sha1", SECRET, b"saltysalt", 1003, 16)
shutil.rmtree(root, ignore_errors=True)
chrome = os.path.join(root, "Library", "Application Support", "Google", "Chrome")
prof = os.path.join(chrome, "Default")
os.makedirs(os.path.join(prof, "Network"))
with open(os.path.join(chrome, "Local State"), "w") as f:
    json.dump({"profile": {"info_cache": {"Default": {"name": "E2E"}}, "last_used": "Default"}}, f)
with open(os.path.join(prof, "Preferences"), "w") as f:
    json.dump({"profile": {"name": "E2E"}}, f)


def v10(plain):
    out = subprocess.run(["openssl", "enc", "-aes-128-cbc", "-K", KEY.hex(), "-iv", "20" * 16],
                         input=plain, capture_output=True, check=True).stdout
    return b"v10" + out


def hashed(host, value):
    # Cookies DB v24+: the plaintext starts with SHA-256(host_key).
    return v10(hashlib.sha256(host.encode()).digest() + value.encode())


def webkit(unix):
    return int((unix + 11644473600) * 1_000_000)


now = time.time()
future = now + 30 * 86400
db = sqlite3.connect(os.path.join(prof, "Network", "Cookies"))
db.executescript("""
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
INSERT INTO meta VALUES ('version', '24');
CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL);
""")
# The cookies e2e.mjs checks, by name. Five import; the rest are refused or skipped on purpose.
# host, top_frame, name, plain value, encrypted value, path, expires (unix, 0 = session), secure, httponly,
# priority, samesite, source scheme, source port (0 = the fixture server's)
rows = [
    ("localhost", "", "nn_sid", "", hashed("localhost", "s3ss10n-e2e"), "/", future, 1, 1, 2, 1, 2, 443),
    ("localhost", "", "nn_legacy", "", v10(b"no-host-prefix"), "/", future, 0, 0, 1, 2, 1, 80),  # undecryptable
    ("localhost", "", "nn_session", "until-quit", b"", "/", 0, 0, 0, 0, -1, 1, 0),
    ("localhost", "", "nn_expired", "", hashed("localhost", "gone"), "/", now - 86400, 0, 0, 1, 0, 1, 80),
    ("localhost", "", "nn_other_path", "", hashed("localhost", "elsewhere"), "/private", future, 0, 0, 1, 1, 1, 0),
    (".example.com", "", "nn_domain", "", hashed(".example.com", "dom"), "/", future, 1, 0, 1, 0, 2, 443),
    ("localhost", "", "nn_dotdot", "", hashed("localhost", "widened"), "/private/../", future, 0, 0, 1, 1, 1, 0),
    (".com", "", "nn_supercookie", "", hashed(".com", "everywhere"), "/", future, 1, 0, 1, 0, 2, 443),
    ("partitioned.example", "https://top.example", "nn_chips", "", hashed("partitioned.example", "chips"), "/", future, 1, 0, 1, 0, 2, 443),
]
port = int(sys.argv[3]) if len(sys.argv) > 3 else 80  # the fixture server's port, for localhost cookies
for (host, top, name, value, enc, path, exp, sec, http, prio, ss, scheme, src_port) in rows:
    persistent = 1 if exp else 0
    db.execute("INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)",
               (webkit(now - 3600), host, top, name, value, enc, path, webkit(exp) if exp else 0, sec, http,
                webkit(now - 60), persistent, persistent, prio, ss, scheme, src_port or port, webkit(now - 60)))
db.commit()
db.close()

wd = sqlite3.connect(os.path.join(prof, "Web Data"))
wd.executescript("""
CREATE TABLE addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, date_modified INTEGER NOT NULL DEFAULT 0, language_code VARCHAR, label VARCHAR, initial_creator_id INTEGER DEFAULT 0, record_type INTEGER);
CREATE TABLE address_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER DEFAULT 0, observations BLOB, PRIMARY KEY (guid, type));
CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER NOT NULL DEFAULT 0, origin VARCHAR DEFAULT '', use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR, nickname VARCHAR);
""")
g = "00000000-0000-4000-8000-00000000e2e1"
wd.execute("INSERT INTO addresses VALUES (?,1,0,0,'en','',0,0)", (g,))
# Chrome's FieldType numbers: name, company, street, city, state, zip, country, phone, email.
for t, v in [(7, "Big Yahu"), (60, "Netnyahoo Test Co"), (77, "1 Fixture Way"), (33, "Testville"), (34, "CA"),
             (35, "94000"), (36, "US"), (14, "+14155550100"), (9, "bigyahu@example.com")]:
    wd.execute("INSERT INTO address_type_tokens VALUES (?,?,?,0,NULL)", (g, t, v))
wd.execute("INSERT INTO credit_cards VALUES ('00000000-0000-4000-8000-00000000e2c1','Big Yahu',12,2031,?,0,'',0,0,'',NULL)",
           (v10(b"4111111111111111"),))
wd.commit()
wd.close()
print(root)
