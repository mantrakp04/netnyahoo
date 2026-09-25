// Compiles the Metal sources embedded in ios/*.swift so shader errors show up
// without launching the app.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const iosDir = new URL("../ios/", import.meta.url).pathname;
const read = (f) => readFileSync(join(iosDir, f), "utf8");
const block = (src, name) => src.match(new RegExp(`let ${name} = """\\n([\\s\\S]*?)\\n"""`))?.[1];

const vertex = block(read("MetalSurface.swift"), "fullscreenVertexSource");
const out = mkdtempSync(join(tmpdir(), "shaders-"));
let failed = false;
for (const file of readdirSync(iosDir).filter((f) => f.endsWith(".swift"))) {
  const src = read(file);
  for (const [, name] of src.matchAll(/^let (\w+Source) = """/gm)) {
    if (name === "fullscreenVertexSource") continue;
    const path = join(out, `${name}.metal`);
    writeFileSync(path, vertex + "\n" + block(src, name));
    try {
      execFileSync("xcrun", ["-sdk", "macosx", "metal", "-c", path, "-o", path + ".air"], { stdio: "pipe" });
      console.log(`✓ ${file} ${name}`);
    } catch (e) {
      failed = true;
      console.error(`✗ ${file} ${name}\n${e.stderr}`);
    }
  }
}
process.exit(failed ? 1 : 0);
