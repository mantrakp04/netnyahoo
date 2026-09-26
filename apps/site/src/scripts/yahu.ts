// Big Yahu, live: one WebGL renderer that can move between stages (the hero, the closing poster).
// Loaded lazily by stage.ts; nothing here runs until the hero is near the viewport.
import {
  AnimationMixer,
  Box3,
  Bone,
  Timer,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShadowMaterial,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type Dance = "griddy" | "default";
export type Framing = "hero" | "poster";

export interface Yahu {
  /** Moves the canvas into another stage element and reframes the camera. */
  attach(host: HTMLElement, framing: Framing): void;
  /** Plays a dance once (or on a loop), then settles back to the idle pose. */
  dance(which: Dance, loop?: boolean): void;
  stop(): void;
  /** Where he should look, in viewport pixels (null: straight ahead). */
  lookAt(x: number | null, y: number | null): void;
  readonly canvas: HTMLCanvasElement;
}

const CLIP_NAMES: Record<Dance, string> = { griddy: "Griddy", default: "Default Dance" };

export async function createYahu(modelUrl: string, host: HTMLElement, framing: Framing): Promise<Yahu> {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = matchMedia("(max-width: 700px)").matches;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "yahu-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  scene.add(new HemisphereLight(0xfff6ea, 0x4a4036, 1.1));
  // Warm key from high left (the podium light), cool rim from behind right (the tie's blue).
  const key = new DirectionalLight(0xfff0dc, 2.4);
  key.position.set(-1.1, 3.6, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -1.2;
  key.shadow.camera.right = 1.2;
  key.shadow.camera.top = 1.2;
  key.shadow.camera.bottom = -1.2;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 8;
  key.shadow.radius = 4;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new DirectionalLight(0xb9c8ff, 1.6);
  rim.position.set(2.2, 1.8, -2.4);
  scene.add(rim);

  const floor = new Mesh(new PlaneGeometry(4, 4), new ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl);
  const bones = new Map<string, Bone>();
  gltf.scene.traverse((o: Object3D) => {
    if (o instanceof SkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
    if (o instanceof Bone) bones.set(o.name, o);
  });

  const mixer = new AnimationMixer(gltf.scene);
  const clips = new Map(gltf.animations.map((c: AnimationClip) => [c.name, c]));
  // Idle is the Default Dance's opening stance, held (the rig's bind pose is a stiff T-pose).
  // A one-frame subclip has zero duration, which the mixer can't play, so it's a paused copy instead.
  // (A replacement model without that clip just stands in its bind pose.)
  const idleClip = clips.get(CLIP_NAMES.default);
  const idle = idleClip ? mixer.clipAction(idleClip.clone()) : null;
  if (idle) idle.play().paused = true;
  mixer.update(0);
  let current: AnimationAction | null = null;

  // Normalise the posed figure (the clips scale the rig): feet on the floor, 1 unit tall, centred.
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o: Object3D) => o instanceof SkinnedMesh && o.skeleton.update());
  const box = new Box3().setFromObject(gltf.scene, true);
  const size = box.getSize(new Vector3());
  const s = 1 / size.y;
  gltf.scene.scale.setScalar(s);
  gltf.scene.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  const turntable = new Group();
  turntable.add(gltf.scene);
  scene.add(turntable);

  const camera = new PerspectiveCamera(24, 1, 0.1, 20);
  const target = new Vector3();
  let baseFov = 23;
  function frame(kind: Framing) {
    // Low angle, a campaign poster's: the camera sits at knee height and looks up at him.
    // He's 1 unit tall; the hero frames him head to toe with a little air, the poster leaves room to dance.
    baseFov = kind === "hero" ? 22 : 24;
    camera.position.set(0, 0.26, kind === "hero" ? 3.45 : 3.35);
    target.set(0, 0.55, 0);
    camera.lookAt(target);
  }

  let stage = host;
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Narrower than 4:5, widen the lens so his elbows stay in frame.
    camera.fov = baseFov / Math.min(1, camera.aspect / 0.8);
    camera.updateProjectionMatrix();
    invalidate();
  };
  const ro = new ResizeObserver(resize);

  let visible = false;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) invalidate();
  });

  // Turntable: drag to turn him, with inertia; he drifts back to facing you when left alone.
  // Kept to front and three-quarter views (a caricature reads worst in profile): past ±MAX_YAW the
  // drag rubber-bands and springs back.
  const REST_YAW = 0.12;
  const MAX_YAW = 0.62;
  let yaw = REST_YAW;
  let yawVel = 0;
  let dragging = false;
  let lastX = 0;
  let lastInput = 0;
  let moved = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
    invalidate();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    const over = Math.max(0, Math.abs(yaw) - MAX_YAW);
    yawVel = dx * 0.01 * (1 / (1 + over * 12));
    yaw += yawVel;
    lastInput = performance.now();
    invalidate();
  });
  const release = () => {
    dragging = false;
  };
  canvas.addEventListener("pointerup", (e) => {
    release();
    // A tap (not a spin) makes him dance.
    if (moved < 4) api.dance(e.pointerType === "mouse" && e.shiftKey ? "griddy" : "default");
  });
  canvas.addEventListener("pointercancel", release);

  // Head tracking.
  let look: { x: number; y: number } | null = null;
  const headYaw = { v: 0, t: 0 };
  const headPitch = { v: 0, t: 0 };
  const q = new Quaternion();
  const euler = new Euler();
  const head = bones.get("head");
  const neck = bones.get("neck");
  const chest = bones.get("chest");
  // Offsets below are applied on top of whatever the mixer wrote this frame; channels a clip doesn't
  // key keep their last value, so restore the idle values first or the offsets would accumulate.
  const rest = [head, neck, chest].filter((b): b is Bone => !!b).map((b) => ({ b, q: b.quaternion.clone(), s: b.scale.clone() }));

  const clock = new Timer();
  let raf = 0;
  let settleFrames = 0;
  function invalidate() {
    settleFrames = 90;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = 0;
    clock.update();
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const t = clock.getElapsed();
    const animating = !!current || !reduced;
    if (!visible || document.hidden) return;

    for (const r of rest) {
      r.b.quaternion.copy(r.q);
      r.b.scale.copy(r.s);
    }
    mixer.update(dt);

    if (!dragging) {
      yaw += yawVel;
      yawVel *= 0.92;
      const over = Math.abs(yaw) - MAX_YAW;
      if (over > 0) yaw = MathUtils.damp(yaw, Math.sign(yaw) * MAX_YAW, 10, dt);
      if (performance.now() - lastInput > 2500) yaw = MathUtils.damp(yaw, REST_YAW, 1.2, dt);
    }
    turntable.rotation.y = yaw;

    if (!reduced && chest) {
      chest.scale.y *= 1 + Math.sin(t * 1.7) * 0.012;
      turntable.rotation.z = Math.sin(t * 0.6) * 0.01;
    }

    // Look toward the pointer: head yaw up to ~30°, pitch ~15°; the head does most, the neck the rest.
    // The body's own turn counts against it, so his face never goes past three-quarter view.
    if (look) {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.3;
      const want = MathUtils.clamp((look.x - cx) / (innerWidth * 0.5), -1, 1) * 0.55;
      headYaw.t = MathUtils.clamp(want, -MAX_YAW - yaw, MAX_YAW - yaw);
      headPitch.t = MathUtils.clamp((look.y - cy) / (innerHeight * 0.6), -1, 1) * 0.26;
    } else {
      headYaw.t = 0;
      headPitch.t = 0;
    }
    const k = current ? 0.35 : 1; // mostly let the dance lead
    headYaw.v = MathUtils.damp(headYaw.v, headYaw.t * k, 6, dt);
    headPitch.v = MathUtils.damp(headPitch.v, headPitch.t * k, 6, dt);
    if (head) head.quaternion.multiply(q.setFromEuler(euler.set(headPitch.v * 0.7, headYaw.v * 0.7, 0)));
    if (neck) neck.quaternion.multiply(q.setFromEuler(euler.set(headPitch.v * 0.3, headYaw.v * 0.3, 0)));

    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      stage.dispatchEvent(new CustomEvent("yahu:ready", { bubbles: true }));
    }

    const moving = animating || dragging || Math.abs(yawVel) > 1e-4 || Math.abs(headYaw.v - headYaw.t) > 1e-3;
    if (moving || --settleFrames > 0) raf = requestAnimationFrame(tick);
  }
  let ready = false;

  function settle() {
    if (!current) return;
    if (idle) {
      idle.reset().play().paused = true;
      current.crossFadeTo(idle, 0.45, false);
    } else current.fadeOut(0.45);
    current = null;
    invalidate();
  }
  mixer.addEventListener("finished", (e) => e.action === current && settle());

  const api: Yahu = {
    canvas,
    attach(next, kind) {
      if (stage !== next || !canvas.isConnected) {
        ro.disconnect();
        io.disconnect();
        stage = next;
        stage.appendChild(canvas);
        ro.observe(stage);
        io.observe(stage);
      }
      frame(kind);
      resize();
    },
    dance(which, loop = false) {
      const clip = clips.get(CLIP_NAMES[which]);
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (current === action && action.isRunning()) return;
      action.reset().setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = true;
      action.play();
      const from = current ?? idle;
      if (from) from.crossFadeTo(action, 0.35, false);
      else action.fadeIn(0.35);
      current = action;
      invalidate();
    },
    stop: settle,
    lookAt(x, y) {
      look = x == null || y == null ? null : { x, y };
      invalidate();
    },
  };

  document.addEventListener("visibilitychange", () => !document.hidden && invalidate());
  if (import.meta.env.DEV) {
    // Posing for screenshots: __yahu.pose("Default Dance", 3.2) freezes that frame.
    Object.assign(window, {
      __yahu: {
        api,
        // The hero's poster image: the idle pose, straight on, rendered with a transparent background.
        snapshot() {
          renderer.render(scene, camera);
          return canvas.toDataURL("image/png");
        },
        debug: () => ({ size: size.toArray(), s, cam: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect, after: new Box3().setFromObject(gltf.scene, true).max.toArray() }),
        pose(name: string, t: number) {
          mixer.stopAllAction();
          const a = mixer.clipAction(clips.get(name)!);
          a.reset().play();
          a.paused = true;
          a.time = t;
          current = a;
          mixer.update(0);
          invalidate();
        },
        yaw(v: number) {
          yaw = v;
          lastInput = performance.now() + 1e9;
          invalidate();
        },
      },
    });
  }
  api.attach(host, framing);
  invalidate();
  return api;
}
