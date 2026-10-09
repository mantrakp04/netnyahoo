// Autoplay blocking that arrives after a page started playing (page_script.js › pauseUnasked): the browser's answer to
// the page's hello crosses processes, and a fast page (the one a launch starts early) can play first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/arcadiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.match(/const pauseUnasked = (\(media, activated\) => \{[\s\S]*?\n {2}\});\n/)?.[1];
assert.ok(source, "page_script.js defines pauseUnasked");
const pauseUnasked = new Function(`return ${source}`)();

const media = (playing) => ({ paused: !playing, pause() { this.paused = true; } });

test("media playing before the config came is paused", () => {
  const video = media(true), audio = media(true), idle = media(false);
  assert.equal(pauseUnasked([video, audio, idle], false), 2);
  assert.ok(video.paused && audio.paused && idle.paused);
});

test("the same element listed twice (the active one, then from the DOM) is paused once", () => {
  const video = media(true);
  assert.equal(pauseUnasked([video, video, null], false), 1);
  assert.ok(video.paused);
});

test("a page the user already used keeps playing: autoplay blocking is for media nobody asked for", () => {
  const video = media(true);
  assert.equal(pauseUnasked([video], true), 0);
  assert.equal(video.paused, false);
});
