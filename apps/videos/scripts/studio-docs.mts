// Writes src/videos/<id>/studio.json, the Remocn Studio document for each cut: every text and window the film
// draws, with its plan.ts defaults. An existing document keeps its values, removals and operation history; only
// objects it lacks are added. usage: node scripts/studio-docs.mts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Aspect, CUTS, type CutName, FRAME } from "../src/lib/ac-launch/plan.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VIDEOS: Record<string, { cut: CutName; aspect: Aspect }> = {
  "launch-16x9": { cut: "launch", aspect: "land" },
  "launch-9x16": { cut: "launch", aspect: "port" },
  "teaser-16x9": { cut: "teaser", aspect: "land" },
  "teaser-9x16": { cut: "teaser", aspect: "port" },
};

const geometry = (group: string, frame: readonly [number, number]) => [
  { id: "x", label: "X", type: "number", default: 0, min: -frame[0], max: frame[0] * 2, step: 1, unit: "px", group },
  { id: "y", label: "Y", type: "number", default: 0, min: -frame[1], max: frame[1] * 2, step: 1, unit: "px", group },
  { id: "width", label: "Width", type: "number", default: 100, min: 1, max: frame[0] * 3, step: 1, unit: "px", group },
  { id: "height", label: "Height", type: "number", default: 100, min: 1, max: frame[1] * 3, step: 1, unit: "px", group },
  { id: "rotation", label: "Rotation", type: "number", default: 0, min: -180, max: 180, step: 0.5, unit: "deg", group },
];

const definitions = (frame: readonly [number, number]) => [
  {
    id: "type", version: 1,
    fields: [
      { id: "text", label: "Text", type: "text", default: "", group: "Typography" },
      { id: "size", label: "Size", type: "number", default: 100, min: 8, max: 800, step: 1, unit: "px", group: "Typography" },
      { id: "color", label: "Colour", type: "color", default: "#16130F", group: "Fill" },
      { id: "fill", label: "Plate", type: "color", default: "#00000000", group: "Fill" },
      ...geometry("Layout", frame),
    ],
  },
  { id: "window", version: 1, fields: geometry("Layout", frame) },
];

for (const [video, { cut, aspect }] of Object.entries(VIDEOS)) {
  const path = join(root, "src", "videos", video, "studio.json");
  const doc = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { version: 1, video, definitions: definitions(FRAME[aspect]), objects: [], operations: [] };
  const have = new Set(doc.objects.map((o: { id: string }) => o.id));
  for (const shot of CUTS[cut].shots) {
    for (const w of [shot.window, ...(shot.extra ?? [])]) {
      if (!w || have.has(w.id)) continue;
      const [x, y, width, height] = w.box[aspect];
      doc.objects.push({ id: w.id, definition: "window", label: `${shot.id} · ${w.id.replace(`${shot.id}-`, "")}`, parentId: null, values: { x, y, width, height, rotation: 0 } });
      have.add(w.id);
    }
    for (const t of shot.type) {
      if (have.has(t.id)) continue;
      const [x, y, width, height] = t.box[aspect];
      const size = aspect === "port" && t.portSize ? t.portSize : t.size;
      doc.objects.push({
        id: t.id, definition: "type", label: `${shot.id} · ${t.text.replace(/\n/g, " ").slice(0, 28)}`, parentId: null,
        values: { text: aspect === "port" && t.portText ? t.portText : t.text, size, color: t.color, fill: t.fill ?? "#00000000", x, y, width, height, rotation: t.rotation ?? 0 },
      });
      have.add(t.id);
    }
  }
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${video}: ${doc.objects.length} objects`);
}
