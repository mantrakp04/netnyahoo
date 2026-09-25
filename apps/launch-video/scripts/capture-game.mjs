// Captures the three puzzle rounds from the real offline game, frame by frame at 30 fps, into
// public/capture/<round>/NNNN.jpg (full tab content, 1846×1612), plus rounds.json with geometry.
//
//   node scripts/capture-game.mjs
//
// Each round: a fixed seed and level, the game's own clock set to 3 seconds (so its HUD and time
// bar count down on screen), then either a click on Big Yahu (the game's found animation) or the
// clock running out (level 10: the video stops at 0.0; the frames after it are the answer).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./headless.mjs";

const out = join(fileURLToPath(new URL(".", import.meta.url)), "../public/capture");
const FPS = 30;
const CLOCK = 3.02; // shows 3.0 on the first frame and 0.0 (not yet timed out) on frame 90

const rounds = [
  { id: "r1", seed: 7, level: 1, clickAt: 60, frames: 110 }, // press room, 82 suspects
  { id: "r2", seed: 8, level: 4, clickAt: 69, frames: 118 }, // the chamber, 131 suspects
  { id: "r3", seed: 7, level: 10, clickAt: null, frames: 91 + 75 }, // the gala, 503 suspects
];

const b = await launch();
const meta = {};
for (const r of rounds) {
  const dir = join(out, r.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await b.open(r.seed);
  await b.evaluate(`localStorage.clear()`); // every round starts with best 0
  await b.evaluate(`__clock.enter()`);
  await b.evaluate(`__yahu.startLevel(${r.level})`);
  // Let the level's "Level N: … suspects" toast come and go before the clock starts.
  for (let i = 0; i < 60; i++) await b.evaluate(`__clock.step(${1000 / FPS})`);
  await b.evaluate(`__yahu.level.time = ${CLOCK}; __yahu.timeLeft = ${CLOCK}`);
  const geo = JSON.parse(await b.evaluate(`(() => {
    const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return JSON.stringify({ game: rect("game"), stage: rect("stage"), suspects: __yahu.level.people.length, bg: __yahu.level.bg.id,
      yahu: __yahu.yahuScreen() });
  })()`));
  let timedOutAt = null;
  for (let f = 0; f < r.frames; f++) {
    if (f === r.clickAt) {
      const p = JSON.parse(await b.evaluate(`JSON.stringify(__yahu.yahuVisiblePage())`));
      await b.click(p.x, p.y);
    }
    await b.evaluate(`__clock.step(${1000 / FPS})`);
    const state = await b.evaluate(`__yahu.state`);
    if (state === "over" && timedOutAt === null) timedOutAt = f;
    writeFileSync(join(dir, `${String(f).padStart(4, "0")}.jpg`), await b.shot(null, "jpeg", 92));
  }
  meta[r.id] = { ...r, ...geo, timedOutAt };
  console.log(r.id, JSON.stringify(meta[r.id]));
}
writeFileSync(join(out, "rounds.json"), JSON.stringify(meta, null, 1));
b.close();
