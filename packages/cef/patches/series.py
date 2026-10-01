#!/usr/bin/env python3
"""Netnyahoo's changes to the CEF/Chromium tree, in the order `series` gives.

  series.py apply [--phase cef|chromium|layer]   apply to the tree; skips what is already applied
  series.py check [--keep DIR]                   apply the whole series to a scratch copy of the base and
                                                 compare the result with the tree, byte for byte
  series.py capture-base [--phase cef|chromium]  record the files the series touches as they are now (run
                                                 just before applying that phase to a fresh or rebased tree)
  series.py materialize --until NAME DIR         the touched files as the series leaves them after NAME (to
                                                 remake a patch: edit there, diff against --until the line above)
  series.py files                                every path the series touches, by step

The base is the tree as CEF's own patches, ungoogled-chromium and domain substitution leave it, before any line of
`series`: ~/chromium-build/series-base (NN_SERIES_BASE), one file per touched path, relative to chromium/src (CEF's
files under cef/). `check` exits 0 when every step applies strictly (git apply: no fuzz) and the result equals the
tree; 1 with a report otherwise. It writes nothing outside its scratch directory.

Environment: CHROMIUM_SRC (default ~/chromium-build/chromium_git/chromium/src), NN_SERIES_BASE.
"""

import argparse
import filecmp
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.environ.get("CHROMIUM_SRC", os.path.expanduser("~/chromium-build/chromium_git/chromium/src"))
BASE = os.environ.get("NN_SERIES_BASE", os.path.expanduser("~/chromium-build/series-base"))


class Step:
    def __init__(self, kind, name, line):
        self.kind, self.name, self.line = kind, name, line

    def __repr__(self):
        return f"{self.kind} {self.name}"

    @property
    def patch(self):
        return os.path.join(HERE, self.name)

    @property
    def root(self):
        """Where the step's paths are relative to, inside a tree."""
        return "cef" if self.kind == "cef" else ""

    def paths(self):
        """(path relative to chromium/src, is_dir) for everything the step writes."""
        if self.kind in ("cef", "chromium"):
            out = []
            for line in open(self.patch, encoding="utf-8", errors="surrogateescape"):
                m = re.match(r"^\+\+\+ (?:b/)?(\S+)", line)
                if m and m.group(1) != "/dev/null":
                    out.append((os.path.join(self.root, m.group(1)), False))
            return dedupe(out)
        return layer_paths(os.path.join(REPO, self.name))


def dedupe(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def layer_paths(layer):
    """What a layer's apply.sh writes: the directories it mirrors from <layer>/src (copied whole) and each
    Chromium file it hooks (`"$src/<path>"`)."""
    script = open(os.path.join(layer, "apply.sh")).read()
    out = []
    m = re.search(r"^owned=\(([^)]*)\)", script, re.M)
    dirs = m.group(1).split() if m else []
    for path in re.findall(r'"\$src/([A-Za-z0-9_./-]+)"', script):
        if os.path.isdir(os.path.join(layer, "src", path)):
            dirs.append(path)
        else:
            out.append((path, False))
    return dedupe([(d, True) for d in dirs] + out)


def read_series():
    steps = []
    for n, raw in enumerate(open(os.path.join(HERE, "series")), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        kind, _, name = line.partition(" ")
        name = name.strip()
        if kind not in ("cef", "chromium", "layer") or not name:
            sys.exit(f"series:{n}: expected `cef|chromium|layer <name>`: {raw.rstrip()}")
        step = Step(kind, name, n)
        if kind != "layer" and not os.path.isfile(step.patch):
            sys.exit(f"series:{n}: no such patch {name}")
        if kind == "layer" and not os.path.isfile(os.path.join(REPO, name, "apply.sh")):
            sys.exit(f"series:{n}: no {name}/apply.sh")
        steps.append(step)
    names = [s.name for s in steps if s.kind != "layer"]
    unlisted = sorted(set(f for f in os.listdir(HERE) if f.endswith(".patch")) - set(names))
    if unlisted:
        sys.exit("patches missing from series: " + ", ".join(unlisted))
    return steps


def run(cmd, cwd, env=None, check=False):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if check and p.returncode:
        sys.exit(f"{' '.join(cmd)} (in {cwd}): {p.stderr or p.stdout}")
    return p


def apply_step(step, tree, strict=True):
    """Applies one step to `tree` (a chromium/src or a scratch copy of its touched files). Returns an error or
    None. strict: git apply (exact context, offsets allowed, no fuzz)."""
    if step.kind == "layer":
        env = dict(os.environ, CHROMIUM_SRC=tree)
        p = run([os.path.join(REPO, step.name, "apply.sh")], REPO, env)
        return None if p.returncode == 0 else (p.stderr or p.stdout).strip()
    cwd = os.path.join(tree, step.root)
    p = run(["git", "apply", "--whitespace=nowarn", step.patch], cwd)
    if p.returncode == 0:
        return None
    if strict:
        return p.stderr.strip()
    p = run(["patch", "-p1", "--forward", "-s", "-i", step.patch], cwd)
    return None if p.returncode == 0 else (p.stdout + p.stderr).strip()


def is_applied(step, tree):
    if step.kind == "layer":
        p = run([os.path.join(REPO, step.name, "apply.sh"), "--check"], REPO, dict(os.environ, CHROMIUM_SRC=tree))
        return p.returncode == 0
    cwd = os.path.join(tree, step.root)
    return run(["git", "apply", "--check", "-R", step.patch], cwd).returncode == 0 or \
        run(["patch", "-p1", "--dry-run", "-R", "-s", "-f", "-i", step.patch], cwd).returncode == 0


def phase_of(step):
    """Step 2 applies CEF's tree; step 4 (after ungoogled and domain substitution) the rest."""
    return "cef" if step.kind == "cef" else "chromium"


def touched(steps):
    out = []
    for step in steps:
        out.extend(step.paths())
    return dedupe(out)


def copy_path(src_root, dst_root, path, is_dir, missing_ok=True):
    src, dst = os.path.join(src_root, path), os.path.join(dst_root, path)
    if is_dir:
        if os.path.isdir(src):
            shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
        return
    if not os.path.exists(src):
        if missing_ok:
            return
        sys.exit(f"missing {src}")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def base_from_git(path, out):
    """A touched file the base doesn't have (a hook added after the base was captured): the checkout's own
    git HEAD, right when nothing upstream (CEF's patches, ungoogled, domain substitution) changes it."""
    repo, rel = (os.path.join(SRC, "cef"), path[4:]) if path.startswith("cef/") else (SRC, path)
    p = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=repo, capture_output=True)
    if p.returncode:
        return False
    os.makedirs(os.path.dirname(os.path.join(out, path)), exist_ok=True)
    open(os.path.join(out, path), "wb").write(p.stdout)
    return True


# Commands


def cmd_files(args):
    for step in read_series():
        print(f"{step}:")
        for path, is_dir in step.paths():
            print(f"  {path}{'/' if is_dir else ''}")


def cmd_apply(args):
    for step in read_series():
        if args.phase and phase_of(step) != args.phase:
            continue
        if step.kind != "layer" and is_applied(step, SRC):
            print(f"already applied {step.name}")
            continue
        error = apply_step(step, SRC, strict=False)
        if error:
            sys.exit(f"error: {step} does not apply:\n{error}")
        print(f"applied {step}")
    if args.phase != "cef":
        # The offline page chromium-neterror-yahu.patch names is generated, not patched in.
        run([os.path.join(HERE, "build", "yahu-resource.sh")], HERE, check=True)


def cmd_capture_base(args):
    steps = [s for s in read_series() if not args.phase or phase_of(s) == args.phase]
    count = 0
    for path, is_dir in touched(steps):
        if is_dir:
            continue  # A layer's own directory: absent before it, copied whole.
        if os.path.exists(os.path.join(BASE, path)) and not args.force:
            continue
        copy_path(SRC, BASE, path, False)
        count += 1
    print(f"captured {count} files into {BASE}")


def materialize(steps, out, until=None, report=None):
    """Copies the base into `out` and applies `steps` in order (stopping after `until`). Returns errors."""
    paths = touched(steps)
    for path, is_dir in paths:
        if is_dir:
            continue
        if os.path.exists(os.path.join(BASE, path)):
            copy_path(BASE, out, path, False)
        elif base_from_git(path, out):
            print(f"note: {path} isn't in the base; using the checkout's git HEAD (capture-base it before hooking it)")
    errors = []
    for step in steps:
        error = apply_step(step, out, strict=True)
        if error:
            errors.append(f"{step} (series:{step.line}) does not apply cleanly:\n    " + error.replace("\n", "\n    "))
            apply_step(step, out, strict=False)  # Keep going to report every problem.
        elif report:
            report(f"ok  {step}")
        if until and step.name == until:
            break
    return errors


def cmd_materialize(args):
    steps = read_series()
    if args.until not in [s.name for s in steps]:
        sys.exit(f"{args.until} isn't in series")
    os.makedirs(args.dir, exist_ok=True)
    errors = materialize(steps, args.dir, until=args.until)
    print("\n".join(errors) or f"{args.dir}: the touched files after {args.until}")


def cmd_check(args):
    if not os.path.isdir(BASE):
        sys.exit(f"no base at {BASE}: run `series.py capture-base` on a tree before its series is applied")
    steps = read_series()
    scratch = args.keep or tempfile.mkdtemp(prefix="nn-series-")
    os.makedirs(scratch, exist_ok=True)
    try:
        errors = materialize(steps, scratch, report=print if args.verbose else None)
        differ = []
        for path, is_dir in touched(steps):
            a, b = os.path.join(scratch, path), os.path.join(SRC, path)
            if is_dir:
                cmp = filecmp.dircmp(a, b) if os.path.isdir(a) and os.path.isdir(b) else None
                if cmp is None or tree_differs(cmp):
                    differ.append(path + "/")
            elif os.path.exists(a) != os.path.exists(b) or (os.path.exists(a) and not filecmp.cmp(a, b, shallow=False)):
                differ.append(path)
        for path in differ:
            errors.append(f"{path}: the series doesn't reproduce the tree's file"
                          f"\n    diff -u {os.path.join(scratch, path)} {os.path.join(SRC, path)}")
        files = sum(1 for p, d in touched(steps))
        if errors:
            print("\n".join(errors))
            print(f"FAIL: {len(steps)} steps, {files} paths, {len(errors)} problems (scratch kept: {scratch})")
            args.keep = scratch
            return 1
        print(f"OK: {len(steps)} steps apply in order to the base and reproduce the tree's {files} touched paths")
        return 0
    finally:
        if not args.keep:
            shutil.rmtree(scratch, ignore_errors=True)


def tree_differs(cmp):
    if cmp.left_only or cmp.right_only or cmp.funny_files:
        return True
    _, mismatch, errors = filecmp.cmpfiles(cmp.left, cmp.right, cmp.common_files, shallow=False)
    if mismatch or errors:
        return True
    return any(tree_differs(sub) for sub in cmp.subdirs.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("apply")
    p.add_argument("--phase", choices=["cef", "chromium"])
    p = sub.add_parser("check")
    p.add_argument("--keep", metavar="DIR", help="scratch directory to keep")
    p.add_argument("-v", "--verbose", action="store_true")
    p = sub.add_parser("capture-base")
    p.add_argument("--phase", choices=["cef", "chromium"])
    p.add_argument("--force", action="store_true", help="replace files already captured")
    p = sub.add_parser("materialize")
    p.add_argument("--until", required=True)
    p.add_argument("dir")
    sub.add_parser("files")
    args = parser.parse_args()
    handler = {"apply": cmd_apply, "check": cmd_check, "capture-base": cmd_capture_base,
               "materialize": cmd_materialize, "files": cmd_files}[args.command]
    sys.exit(handler(args) or 0)


if __name__ == "__main__":
    main()
