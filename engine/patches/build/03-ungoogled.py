#!/usr/bin/env python3
"""Step 3: apply ungoogled-chromium's patch series on top of the CEF-patched tree.

Reproduces the patch set this build ships (logs/ungoogled-final.tsv; the
Netnyahoo repo's docs/cef-source-build.md explains each exception):
  - SKIP: not applied, with the reason;
  - PARTIAL_EXCLUDE: applied without the listed files (git apply --exclude);
  - PARTIAL_FUZZY: applied with `patch`, dropping the hunk CEF already covers;
  - FIXUPS: small edits after the series (CEF build requirements);
  - everything else: `git apply` exactly, falling back to `patch -F2`.
Run once on a fresh (CEF-patched) tree.

Usage: 03-ungoogled.py [--dry-run]
"""
import pathlib
import subprocess
import sys

CB = pathlib.Path.home() / 'chromium-build'
SRC = CB / 'chromium_git/chromium/src'
UG = CB / 'ungoogled'
UGMAC = CB / 'ungoogled-macos'
REPORT = CB / 'logs/ungoogled-patches.tsv'
dry = '--dry-run' in sys.argv

SB = ('assumes safe_browsing_mode=0 / removed Safe Browsing prefs; Safe Browsing stays compiled in '
      '(CEF needs it) and domain substitution cuts its Google endpoints')
SKIP = {
    'core/ungoogled-chromium/fix-building-with-prunned-binaries.patch': 'assumes pruned binaries (not pruned)',
    'core/ungoogled-chromium/build-with-wasm-rollup.patch': 'only needed when prebuilt rollup is pruned',
    'extra/inox-patchset/0016-chromium-sandbox-pie.patch': 'Linux-only',
    'extra/ungoogled-chromium/remove-disable-setuid-sandbox-as-bad-flag.patch': 'Linux-only',
    'core/inox-patchset/0001-fix-building-without-safebrowsing.patch': SB,
    'core/ungoogled-chromium/fix-building-without-safebrowsing.patch': SB,
    'ungoogled-chromium/macos/fix-disabling-safebrowsing.patch': SB,
    'core/ungoogled-chromium/remove-unused-preferences-fields.patch': SB,
    'core/ungoogled-chromium/move-js-optimizer-unfamiliar-sites.patch': SB,
    'extra/ungoogled-chromium/fix-building-without-mdns-and-service-discovery.patch':
        'build fix for enable_mdns/enable_service_discovery=false (kept enabled)',
    # Netnyahoo needs the Chrome Web Store (install + extension auto-updates).
    'core/ungoogled-chromium/disable-webstore-urls.patch':
        'disables the Web Store and extension update checks (Netnyahoo needs both)',
    'extra/ungoogled-chromium/enable-extra-locales.patch':
        "breaks CEF's cef_strings.grd output list; not privacy-related",
}
PARTIAL_EXCLUDE = {
    # Its webstore_installer.cc hunks stub out Web Store installs; Netnyahoo
    # needs them. The default component extensions stay disabled.
    'core/inox-patchset/0005-disable-default-extensions.patch': ['extensions/browser/webstore_installer.cc'],
    'core/inox-patchset/0021-disable-rlz.patch': ['rlz/buildflags/buildflags.gni'],  # CEF requires enable_rlz
    'extra/ungoogled-chromium/add-flag-to-show-avatar-button.patch':
        ['chrome/browser/ui/views/toolbar/toolbar_view.cc'],  # conflicts with CEF's toolbar patch
    'extra/ungoogled-chromium/add-flag-for-incognito-themes.patch':
        ['chrome/browser/ui/views/frame/browser_widget.cc'],  # conflicts with CEF's frame patch
}
PARTIAL_FUZZY = {
    'core/ungoogled-chromium/disable-gcm.patch': 'GCMClientImpl::Start hunk (CEF already stubs Start)',
}
# Small edits after the series: (file, old text, new text).
FIXUPS = [
    # 0006-modify-default-prefs turns off saving/filling passwords, addresses
    # and cards by default; Netnyahoo uses Chrome's password manager and
    # autofill (local only). Autosign-in stays off.
    ('components/password_manager/core/browser/password_manager.cc',
     '      prefs::kCredentialsEnableService, false,', '      prefs::kCredentialsEnableService, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillProfileEnabled, false,', '      kAutofillProfileEnabled, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillCreditCardEnabled, false,', '      kAutofillCreditCardEnabled, true,'),
    # disable-ai sets enable_screen_ai_service=false, but the macOS sandbox
    # setup in ChromeContentBrowserClient (linked into libcef) still calls
    # ScreenAIInstallState unconditionally.
    ('chrome/browser/chrome_content_browser_client.cc',
     '  if (sandbox_type == sandbox::mojom::Sandbox::kScreenAI) {\n',
     '#if BUILDFLAG(ENABLE_SCREEN_AI_SERVICE)\n'
     '  if (sandbox_type == sandbox::mojom::Sandbox::kScreenAI) {\n'),
    ('chrome/browser/chrome_content_browser_client.cc',
     '        screen_ai_binary_path.value());\n  }\n',
     '        screen_ai_binary_path.value());\n  }\n'
     '#endif  // BUILDFLAG(ENABLE_SCREEN_AI_SERVICE)\n'),
    ('chrome/browser/chrome_content_browser_client.cc',
     '#include "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom.h"\n',
     '#include "services/screen_ai/buildflags/buildflags.h"\n'
     '#include "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom.h"\n'),
]


def series():
    for line in (UG / 'patches/series').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            yield UG / 'patches', line
    yield UGMAC / 'patches', 'ungoogled-chromium/macos/fix-disabling-safebrowsing.patch'


def run(cmd):
    return subprocess.run(cmd, cwd=SRC, capture_output=True, text=True)


rows = []
for base, rel in series():
    path = str(base / rel)
    if rel in SKIP:
        rows.append((rel, 'skipped', SKIP[rel]))
        continue
    if rel in PARTIAL_EXCLUDE:
        excl = [f'--exclude={f}' for f in PARTIAL_EXCLUDE[rel]]
        ok = run(['git', 'apply', '--check', '-p1', *excl, path]).returncode == 0
        if ok and not dry:
            run(['git', 'apply', '-p1', *excl, path]).check_returncode()
        rows.append((rel, 'partial' if ok else 'FAILED', 'without ' + ', '.join(PARTIAL_EXCLUDE[rel])))
        continue
    if rel in PARTIAL_FUZZY:
        if not dry:
            run(['patch', '-p1', '-F2', '--forward', '--no-backup-if-mismatch', '-r', '-', '-i', path])
        rows.append((rel, 'partial', 'dropped: ' + PARTIAL_FUZZY[rel]))
        continue
    if run(['git', 'apply', '--check', '-p1', path]).returncode == 0:
        if not dry:
            run(['git', 'apply', '-p1', path]).check_returncode()
        rows.append((rel, 'applied', 'exact'))
        continue
    p = run(['patch', '-p1', '-F2', '--dry-run', '--forward', '-i', path])
    if p.returncode == 0:
        if not dry:
            run(['patch', '-p1', '-F2', '--forward', '--no-backup-if-mismatch', '-i', path]).check_returncode()
        rows.append((rel, 'applied', 'with fuzz/offset'))
        continue
    detail = [l for l in (p.stdout + p.stderr).splitlines() if 'failed' in l.lower() or 'No such' in l]
    rows.append((rel, 'FAILED', ' | '.join(detail)[:500]))

if not dry:
    for rel, old, new in FIXUPS:
        f = SRC / rel
        s = f.read_text()
        if new not in s:
            assert s.count(old) == 1, f'fixup anchor missing in {rel}'
            f.write_text(s.replace(old, new, 1))

REPORT.write_text('patch\tstatus\tdetail\n' + ''.join('\t'.join(r) + '\n' for r in rows))
for r in rows:
    if r[1] != 'applied':
        print('%-8s %s  %s' % (r[1], r[0], r[2]))
counts = {s: sum(1 for r in rows if r[1] == s) for s in ('applied', 'partial', 'skipped', 'FAILED')}
print(' '.join(f'{k}={v}' for k, v in counts.items()))
sys.exit(1 if counts['FAILED'] else 0)
