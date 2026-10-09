import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, reorder, resample, simplify, sparse, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const [ratio = "0.16", texture = "2048", quality = "76"] = process.argv.slice(2);
const source = process.env.AC_BRAND_OUTPUT ?? `${homedir()}/Documents/arcadia/output`;
const out = fileURLToPath(new URL("../public/models/big-mascot.glb", import.meta.url));

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(`${source}/mascot-griddy/arcadia-griddy.glb`);
const dance = await io.read(`${source}/mascot-dance/arcadia-default-dance.glb`);

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
