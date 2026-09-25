// Media sessions: bookkeeping behind the mini players (components/media/state.ts).
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/media/media.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const model = await import("../../store/model.ts");
const media = await import("./state.ts");

const S = () => useBrowser.getState();
const M = () => media.useMedia.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
const report = (overrides = {}) => ({
  title: "Song",
  artist: "Band",
  album: "",
  artwork: null,
  playbackState: "playing",
  position: 10,
  duration: 200,
  playbackRate: 1,
  timestamp: Date.now(),
  hasVideo: false,
  actions: ["play", "pause"],
  ...overrides,
});

test("sessions remember when a tab started playing; closing the player lasts until it plays again", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const [a] = model.viewTabIds(S(), w);
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });

  media.setNowPlaying(b, report());
  const playedB = M().sessions[b].playedAt;
  assert.ok(playedB > 0);
  // Progress reports while playing keep the start time.
  media.setNowPlaying(b, report({ position: 20 }));
  assert.equal(M().sessions[b].playedAt, playedB);

  // A page that only ever paused doesn't count as played.
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  assert.equal(M().sessions[c].playedAt, 0);
  assert.equal(media.playerTabFor(M(), [a, b, c]), b);

  // Paused sessions lose to playing ones; among paused ones the latest wins.
  media.setNowPlaying(b, report({ playbackState: "paused" }));
  await tick();
  media.setNowPlaying(c, report());
  assert.equal(media.playerTabFor(M(), [a, b, c]), c);
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  assert.equal(media.playerTabFor(M(), [a, b, c]), c);

  media.useMedia.setState({ dismissed: { [c]: true } });
  assert.equal(media.playerTabFor(M(), [a, b, c]), b);
  media.setNowPlaying(c, report());
  assert.equal(M().dismissed[c], undefined);
  assert.equal(media.playerTabFor(M(), [a, b, c]), c);

  // Nothing playing any more / tab closed.
  media.setNowPlaying(c, null);
  assert.equal(M().sessions[c], undefined);
  S().closeTab(b);
  assert.equal(M().sessions[b], undefined);
});

test("position advances with the clock while playing, clamped to the duration", () => {
  const t = 1_000_000;
  const session = { ...report({ position: 30, timestamp: t, playbackRate: 2 }), playedAt: t };
  assert.equal(media.positionOf(session, t + 5000), 40);
  assert.equal(media.positionOf({ ...session, playbackState: "paused" }, t + 5000), 30);
  assert.equal(media.positionOf(session, t + 1_000_000), 200);
  assert.equal(media.formatTime(65), "1:05");
  assert.equal(media.formatTime(3725), "1:02:05");
  assert.equal(media.hasTrackControls({ ...session, actions: ["nexttrack"] }), true);
  assert.equal(media.hasTrackControls(session), false);
});

test("a tab counts as shown when it's active or a pane of the active split", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const [a] = model.viewTabIds(S(), w);
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });
  assert.equal(media.isTabShown(S(), a), true);
  assert.equal(media.isTabShown(S(), b), false);
  S().createSplit([a, b]);
  assert.equal(media.isTabShown(S(), b), true);
  assert.equal(media.isTabShown(S(), c), false);
});
