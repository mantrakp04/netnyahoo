// Big Yahu, the site's own rigged model (apps/site/public/models/big-yahu.glb, copied by scripts/prepare-assets.sh),
// rendered with three.js at a given time of one of his clips ("Griddy", "Default Dance"). Pure in time: the mixer is
// set, never advanced, so any frame renders the same in preview and export.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import {
  AnimationMixer, type AnimationAction, Box3, DirectionalLight, Group, HemisphereLight, NeutralToneMapping, type Object3D,
  PerspectiveCamera, PMREMGenerator, Scene, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Clip = "Griddy" | "Default Dance";
interface Rig {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  root: Object3D;
}

export function Yahu3D({ width, height, clip, time, yaw = 0 }: { width: number; height: number; clip: Clip; time: number; yaw?: number }) {
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
    renderer.toneMappingExposure = 1.05;
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
    scene.add(new HemisphereLight(0xfff6ea, 0x4a4036, 1.1));
    const key = new DirectionalLight(0xfff0dc, 2.4);
    key.position.set(-1.1, 3.6, 3.2);
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
        // Framed with room above his head for a jump and at his sides for the griddy's arms.
        const camera = new PerspectiveCamera(30, width / height, 0.1, 20);
        camera.position.set(0, 0.62, 2.75);
        camera.lookAt(0, 0.58, 0);
        setRig({ renderer, scene, camera, mixer, actions, root: turn });
      })
      .catch((error: unknown) => {
        throw new Error(`Big Yahu: ${String(error)} (run scripts/prepare-assets.sh)`);
      });
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, [width, height]);

  useLayoutEffect(() => {
    if (!rig) return;
    for (const [name, action] of rig.actions) {
      if (name === clip) action.play();
      else action.stop();
    }
    rig.mixer.setTime(time);
    rig.root.rotation.y = yaw;
    rig.renderer.render(rig.scene, rig.camera);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [rig, clip, time, yaw, handle]);

  return <canvas ref={canvas} width={width} height={height} style={{ width: "100%", height: "100%", display: "block" }} />;
}
