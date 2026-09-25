import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  AnimationMixer,
  Box3,
  Group,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Big Yahu, the site's model (apps/site/public/models/big-yahu.glb) lit like the site's hero,
// posed by the current frame: `clip` at `time` seconds, `yaw` radians of turn.
type Rig = { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; mixer: AnimationMixer; actions: Map<string, AnimationAction>; root: Object3D };

export const Yahu3D: React.FC<{ width: number; height: number; clip: "Griddy" | "Default Dance"; time: number; yaw?: number }> = ({ width, height, clip, time, yaw = 0.12 }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [handle] = useState(() => delayRender("Loading Big Yahu"));
  const released = useRef(false);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  useEffect(() => {
    let cancelled = false;
    const renderer = new WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
    scene.add(new HemisphereLight(0xfff6ea, 0x4a4036, 1.1));
    const key = new DirectionalLight(0xfff0dc, 2.4);
    key.position.set(-1.1, 3.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.5, far: 8 });
    key.shadow.radius = 4;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new DirectionalLight(0xb9c8ff, 1.6);
    rim.position.set(2.2, 1.8, -2.4);
    scene.add(rim);
    const floor = new Mesh(new PlaneGeometry(6, 6), new ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(staticFile("models/big-yahu.glb"))
      .then((gltf) => {
        if (cancelled) return;
        gltf.scene.traverse((o: Object3D) => {
          if (o instanceof SkinnedMesh) {
            o.castShadow = true;
            o.frustumCulled = false;
          }
        });
        const mixer = new AnimationMixer(gltf.scene);
        const actions = new Map<string, AnimationAction>();
        for (const c of gltf.animations) actions.set(c.name, mixer.clipAction(c));
        // Normalise from the Default Dance's opening stance: feet on the floor, 1 unit tall, centred.
        const idle = actions.get("Default Dance");
        idle?.play();
        mixer.setTime(0);
        gltf.scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(gltf.scene, true);
        const size = box.getSize(new Vector3());
        const s = 1 / size.y;
        gltf.scene.scale.setScalar(s);
        gltf.scene.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
        idle?.stop();
        const turn = new Group();
        turn.add(gltf.scene);
        scene.add(turn);

        // A campaign poster's low angle: knee height, looking up at him.
        const camera = new PerspectiveCamera(26, width / height, 0.1, 20);
        camera.position.set(0, 0.3, 3.3);
        camera.lookAt(0, 0.56, 0);
        setRig({ renderer, scene, camera, mixer, actions, root: turn });
      })
      .catch((e) => {
        console.error(e);
        throw e;
      });
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, [width, height]);

  useLayoutEffect(() => {
    if (!rig) return;
    for (const [name, a] of rig.actions) {
      if (name === clip) a.play();
      else a.stop();
    }
    rig.mixer.setTime(time);
    rig.root.rotation.y = yaw;
    rig.renderer.render(rig.scene, rig.camera);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [rig, clip, time, yaw, frame, fps, handle]);

  return <canvas ref={canvas} width={width} height={height} style={{ width, height }} />;
};
