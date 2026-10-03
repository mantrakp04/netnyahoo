// Big Yahu, the site's own rigged model (apps/site/public/models/big-yahu.glb, copied by scripts/prepare-assets.sh),
// rendered with three.js at a given time of one of his clips ("Griddy", "Default Dance"). Pure in time: the mixer is
// set, never advanced, so any frame renders the same in preview and export.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import {
  AnimationMixer, type AnimationAction, Box3, CanvasTexture, DataTexture, MeshToonMaterial, NearestFilter, RedFormat, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, type Object3D, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Clip = "Griddy" | "Default Dance";
interface Rig {
  renderer: WebGLRenderer;
  outline: OutlineEffect;
  scene: Scene;
  camera: PerspectiveCamera;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  root: Object3D;
}

/** Contact shadow under his feet: a soft radial blob (ambient occlusion) for the paper he stands on. */
function blob() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(22,19,15,0.55)");
  r.addColorStop(0.45, "rgba(22,19,15,0.28)");
  r.addColorStop(1, "rgba(22,19,15,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

/**
 * The scan's colour texture, smoothed and flattened for the printed look: a small blur takes out the blotchy pores and
 * creases, and a gentle posterise pulls the skin into fewer, flatter tones. (One atlas for the whole figure.)
 */
function smooth(map: MeshStandardMaterial["map"]) {
  const image = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!map || !image || !image.width) return map;
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const g = c.getContext("2d")!;
  g.filter = "blur(2.5px) saturate(0.9)";
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const step = 20;
  for (let i = 0; i < px.length; i += 4) {
    // Take the bruise out of the scan: strongly red or purple skin (eye sockets, blotchy cheeks) loses most of its
    // excess red toward an even skin tone.
    const r = px[i], g = px[i + 1], bl = px[i + 2];
    const excess = r - (g + bl) / 2;
    if (excess > 55 && r > 70) {
      const k = Math.min(1, (excess - 55) / 60) * 0.55;
      px[i] = r - (r - (g * 1.28 + 6)) * k;
      px[i + 2] = bl + (g * 0.92 - bl) * k * 0.5;
    }
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] / step) * step * 0.5 + px[i + k] * 0.5;
  }
  g.putImageData(data, 0, 0);
  const t = new CanvasTexture(c);
  t.flipY = map.flipY;
  t.colorSpace = map.colorSpace;
  t.wrapS = map.wrapS;
  t.wrapT = map.wrapT;
  t.channel = map.channel;
  return t;
}

/** "full": head to toe, room for the dance. "bust": framed on the face and shoulders (the hands stay out). */
export type Framing = "full" | "bust";

export function Yahu3D({ width, height, clip, time, yaw = 0, framing = "full" }: { width: number; height: number; clip: Clip; time: number; yaw?: number; framing?: Framing }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [handle] = useState(() => delayRender("Big Yahu"));
  const released = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const renderer = new WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    const scene = new Scene();
    const ramp = new DataTexture(new Uint8Array([150, 210, 255]), 3, 1, RedFormat);
    ramp.minFilter = ramp.magFilter = NearestFilter;
    ramp.needsUpdate = true;
    const outline = new OutlineEffect(renderer, { defaultThickness: 0.0038, defaultColor: [0.086, 0.075, 0.06], defaultAlpha: 1 });
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // Less mirror-like reflection and a warm key: the suit reads as cloth, not lacquer.
    scene.environmentIntensity = 0.4;
    pmrem.dispose();
    scene.add(new HemisphereLight(0xfff3e4, 0x4a4036, 1.15));
    const key = new DirectionalLight(0xffe2c2, 2.7);
    key.position.set(-1.1, 3.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    key.shadow.camera.left = -1;
    key.shadow.camera.right = 1;
    key.shadow.camera.top = 1.5;
    key.shadow.camera.bottom = -0.5;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new DirectionalLight(0xb9c8ff, 1.6);
    rim.position.set(2.2, 1.8, -2.4);
    scene.add(rim);
    new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(staticFile("models/big-yahu.glb"))
      .then((gltf) => {
        if (cancelled) return;
        gltf.scene.traverse((o: Object3D) => {
          if (o instanceof SkinnedMesh) o.frustumCulled = false;
          if (o instanceof Mesh) {
            o.castShadow = true;
            // A printed look for the paper brand: three-tone (posterised) shading over his own colours, and an ink
            // outline (OutlineEffect). It flattens the scan's texture smears and reads as an illustration.
            const toon = (m: MeshStandardMaterial) =>
              new MeshToonMaterial({ map: smooth(m.map), color: m.color, gradientMap: ramp, transparent: m.transparent, alphaTest: m.alphaTest, side: m.side });
            o.material = Array.isArray(o.material)
              ? o.material.map((m) => (m instanceof MeshStandardMaterial ? toon(m) : m))
              : o.material instanceof MeshStandardMaterial ? toon(o.material) : o.material;
          }
        });
        const mixer = new AnimationMixer(gltf.scene);
        const actions = new Map<string, AnimationAction>();
        for (const c of gltf.animations) actions.set(c.name, mixer.clipAction(c));
        // Size him from his rest pose in the first clip, feet on the floor, 1 unit tall.
        const first = actions.get("Default Dance");
        first?.play();
        mixer.setTime(0);
        gltf.scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(gltf.scene, true);
        const size = box.getSize(new Vector3());
        const s = 1 / size.y;
        gltf.scene.scale.setScalar(s);
        gltf.scene.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
        first?.stop();
        const turn = new Group();
        turn.add(gltf.scene);
        scene.add(turn);
        // The floor: a cast shadow from the key light, and a soft contact blob under his feet.
        const floor = new Mesh(new PlaneGeometry(4, 4), new ShadowMaterial({ opacity: 0.22 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);
        const contact = new Mesh(new PlaneGeometry(0.75, 0.42), new MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false }));
        contact.rotation.x = -Math.PI / 2;
        contact.position.y = 0.002;
        scene.add(contact);
        const camera = new PerspectiveCamera(30, width / height, 0.1, 20);
        if (framing === "bust") {
          camera.position.set(0, 0.8, 1.45);
          camera.lookAt(0, 0.72, 0);
        } else {
          // Room above his head for a jump and at his sides for the griddy's arms.
          camera.position.set(0, 0.62, 2.75);
          camera.lookAt(0, 0.58, 0);
        }
        setRig({ renderer, outline, scene, camera, mixer, actions, root: turn });
      })
      .catch((error: unknown) => {
        throw new Error(`Big Yahu: ${String(error)} (run scripts/prepare-assets.sh)`);
      });
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, [width, height, framing]);

  useLayoutEffect(() => {
    if (!rig) return;
    for (const [name, action] of rig.actions) {
      if (name === clip) action.play();
      else action.stop();
    }
    rig.mixer.setTime(time);
    rig.root.rotation.y = yaw;
    // Clear first: the outline pass leaves autoClear off, and the drawing buffer is preserved, so frames would stack.
    rig.renderer.setClearColor(0x000000, 0);
    rig.renderer.clear(true, true, true);
    rig.outline.render(rig.scene, rig.camera);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [rig, clip, time, yaw, handle]);

  return <canvas ref={canvas} width={width} height={height} style={{ width: "100%", height: "100%", display: "block" }} />;
}
