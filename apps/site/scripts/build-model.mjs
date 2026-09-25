// Builds public/models/big-yahu.glb from the brand sources (gitignored, in the main checkout's output/).
//
// The Griddy export is the base: its mesh carries the finger/shoulder morphs Griddy needs, and it shares
// the Default Dance rig exactly (same joints, rest pose and inverse binds), so the Default Dance clip is
// copied in by joint name. Floss is left out: its rig was bound in a different rest pose.
// Then: simplify 291k → ~47k triangles, 4096px texture → 2048px WebP, quantize, meshopt. ~1.4 MB.
//
//   node scripts/build-model.mjs [ratio=0.16] [texture=2048] [webpQuality=76]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, reorder, resample, simplify, sparse, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const [ratio = "0.16", texture = "2048", quality = "76"] = process.argv.slice(2);
const source = process.env.NN_BRAND_OUTPUT ?? `${homedir()}/Documents/netnyahoo/output`;
const out = fileURLToPath(new URL("../public/models/big-yahu.glb", import.meta.url));

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(`${source}/mascot-griddy/netnyahoo-griddy.glb`);
const dance = await io.read(`${source}/mascot-dance/netnyahoo-default-dance.glb`);

const root = doc.getRoot();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];
const copy = (a) => doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setBuffer(buffer);
for (const clip of dance.getRoot().listAnimations()) {
  const anim = doc.createAnimation(clip.getName());
  for (const channel of clip.listChannels()) {
    const target = nodes.get(channel.getTargetNode().getName());
    if (!target) throw new Error(`no joint ${channel.getTargetNode().getName()}`);
    const s = channel.getSampler();
    const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(channel.getTargetPath()).setSampler(sampler));
  }
}

// Glossy vinyl: the export leaves glTF's metallic default (1), which renders the toy as dark chrome.
for (const material of root.listMaterials()) material.setMetallicFactor(0).setRoughnessFactor(0.42);

await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: 0.002 }),
  resample(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [Number(texture), Number(texture)], quality: Number(quality) }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  sparse(),
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);
await io.write(out, doc);

const prim = root.listMeshes()[0].listPrimitives()[0];
console.log(`${out}: ${prim.getIndices().getCount() / 3} triangles, clips ${root.listAnimations().map((a) => a.getName()).join(", ")}`);
