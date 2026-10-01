import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// The bundle checks its version against the build's at launch; the two sides must move together.
test("the JS bundle and the native build declare the same API version", () => {
  const js = read("./nativeApi.tsx").match(/export const NATIVE_API_VERSION = (\d+);/)?.[1];
  const native = read("../../../packages/shell/ios/AppModule.swift").match(/Constant\("apiVersion"\) \{ \(\) -> Int in (\d+) \}/)?.[1];
  assert.ok(js && native, "both declarations found");
  assert.equal(js, native);
});
