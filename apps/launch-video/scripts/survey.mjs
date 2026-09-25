// Finds good seeds: renders levels 1, 4 and 10 for a range of seeds and marks where Big Yahu is.
import { mkdirSync, writeFileSync } from "node:fs";
import { launch } from "./headless.mjs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const b = await launch();
const rows = [];
for (let seed = 1; seed <= +(process.argv[3] || 8); seed++) for (const n of [1, 4, 10]) {
  await b.open(seed);
  await b.evaluate(`__yahu.startLevel(${n}); __clock.enter()`);
  const info = JSON.parse(await b.evaluate(`for (let i = 0; i < 60; i++) __clock.step(1000 / 30);
    const r = document.getElementById("stage").getBoundingClientRect();
    JSON.stringify({ n: __yahu.level.people.length, y: __yahu.yahuScreen(), vis: __yahu.visibility(), stage: [r.x, r.y, r.width, r.height], bg: __yahu.level.bg.id })`));
  const f = `${out}/s${seed}-l${n}.jpg`;
  writeFileSync(f, await b.shot({ x: info.stage[0], y: info.stage[1], width: info.stage[2], height: info.stage[3] }, "jpeg", 80));
  rows.push({ seed, level: n, ...info, f });
  console.log(seed, n, info.n, info.bg, Math.round(info.y.x), Math.round(info.y.y), info.vis.toFixed(2));
}
writeFileSync(`${out}/survey.json`, JSON.stringify(rows, null, 1));
b.close();
