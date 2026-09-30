---
name: stats
description: Netnyahoo's numbers in one short report — users and installs, site traffic and downloads, the phone Send to my Mac panel, GitHub, and new errors. Use whenever the owner asks how things are going, "what are the stats", "how many users/downloads/installs", "how many updated", "how's the site doing", GitHub stats, or a growth check-in, even if they don't say "stats".
---

# Netnyahoo stats

Fetch the numbers yourself: PostHog through its MCP (EU project 287835, site and app events) and GitHub
through `gh` (repo, traffic, release download counts). `docs/growth.md` explains what the events mean;
compare against its last **Log** entry and say what changed since.

## What I want to know

- **Users:** how many people have the app. Keep the kinds of number apart: DMG downloads, first launches
  (`update_check` with `first`, 0.2.14 on), copies still running, updates (Sparkle zips), and opted-in app
  users by version. There's no exact user count; say which number is which.
- **Site:** visitors (recent and all time) and whether traffic is rising or tapering; download clicks and
  the Mac download rate; other platforms briefly.
- **Phones:** Send to my Mac taps → links that got out (shared, copied, emailed) → Macs that opened one.
- **GitHub:** stars (and how many are recent), repo views, where they come from.
- **Errors:** anything new from the site or the app. Fix real ones without asking (AGENTS.md); skip noise
  that isn't ours (X's in-app browser, wallets, webviews, cross-origin "Script error.", network drops).
- **Needs me:** only if something does.

## Report

Short and plain, in that order, numbers first. Then add a dated entry to the Log in `docs/growth.md` and
commit it.
