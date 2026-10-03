import { track } from "./track";
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
  attach(host: HTMLElement, framing: Framing): void;
  dance(which: Dance, loop?: boolean): void;
  stop(): void;
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
  // Redrawn only when he moves (tick()), not every frame.
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.className = "yahu-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  scene.add(new HemisphereLight(0xfff6ea, 0x4a4036, 1.1));
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

  let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl);
  } catch (e) {
    renderer.dispose();
    throw e;
  }
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
  const idleClip = clips.get(CLIP_NAMES.default);
  const idle = idleClip ? mixer.clipAction(idleClip.clone()) : null;
  if (idle) idle.play().paused = true;
  mixer.update(0);
  let current: AnimationAction | null = null;

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
    camera.fov = baseFov / Math.min(1, camera.aspect / 0.8);
    camera.updateProjectionMatrix();
    // setSize clears the canvas, and a ResizeObserver runs after this frame's animation frames: drawn now, or he's
    // blank for a frame on every resize (a window, a browser's toolbar).
    if (visible && !document.hidden) renderer.render(scene, camera);
    dirty = true;
    invalidate();
  };
  const ro = new ResizeObserver(resize);

  let visible = false;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) {
      dirty = true;
      invalidate();
    }
  });

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
  let spun = false;
  canvas.addEventListener("pointerup", (e) => {
    release();
    const stage = canvas.parentElement?.dataset.stage ?? null;
    if (moved < 4) {
      const dance = e.pointerType === "mouse" && e.shiftKey ? "griddy" : "default";
      api.dance(dance);
      track("yahu_danced", { stage, dance });
    } else if (!spun && moved > 40) {
      spun = true;
      track("yahu_spun", { stage });
    }
  });
  canvas.addEventListener("pointercancel", release);

  let look: { x: number; y: number } | null = null;
  const headYaw = { v: 0, t: 0 };
  const headPitch = { v: 0, t: 0 };
  const q = new Quaternion();
  const euler = new Euler();
  const head = bones.get("head");
  const neck = bones.get("neck");
  const chest = bones.get("chest");
  const rest = [head, neck, chest].filter((b): b is Bone => !!b).map((b) => ({ b, q: b.quaternion.clone(), s: b.scale.clone() }));

  // Frames: at the display's rate while something moves (a dance, a drag, the head following the pointer, the
  // turn back to rest); otherwise only his breathing, at AMBIENT_FPS, and only until the visitor has been still
  // for AMBIENT_IDLE_MS (any move starts it again). Never offscreen or in a hidden tab. A frame that would
  // draw the same picture isn't drawn, and the shadow is redrawn only when he has moved enough to change it.
  const AMBIENT_FPS = 15;
  const AMBIENT_IDLE_MS = 8000;
  const clock = new Timer();
  let raf = 0;
  let timer = 0;
  let settleFrames = 0;
  let fresh = true;
  let dirty = true;
  let breath = 0;
  let mixerUntil = 0;
  let lastActivity = performance.now();
  const drawn: number[] = [];
  const shadowed: number[] = [];

  function schedule() {
    if (raf) return;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    } else fresh = true;
    raf = requestAnimationFrame(tick);
  }
  function invalidate() {
    settleFrames = 90;
    schedule();
  }
  const onActivity = () => {
    lastActivity = performance.now();
    if (!reduced && !raf && !timer) schedule();
  };
  for (const type of ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"])
    addEventListener(type, onActivity, { capture: true, passive: true });

  function tick() {
    raf = 0;
    clock.update();
    // After a pause the clock's delta is the pause: the first frame back starts from where he stopped.
    const elapsed = fresh ? 0 : clock.getDelta();
    fresh = false;
    const dt = Math.min(elapsed, 1 / 20);
    if (!visible || document.hidden) {
      fresh = true;
      return;
    }
    const now = performance.now();
    const breathing = !reduced && now - lastActivity < AMBIENT_IDLE_MS;
    if (breathing) breath += Math.min(elapsed, 0.25);

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
      if (now - lastInput > 2500) {
        yaw = MathUtils.damp(yaw, REST_YAW, 1.2, dt);
        if (Math.abs(yaw - REST_YAW) < 1e-3) yaw = REST_YAW;
      }
    }
    turntable.rotation.y = yaw;

    if (!reduced && chest) {
      chest.scale.y *= 1 + Math.sin(breath * 1.7) * 0.012;
      turntable.rotation.z = Math.sin(breath * 0.6) * 0.01;
    }

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
    const k = current ? 0.35 : 1;
    headYaw.v = MathUtils.damp(headYaw.v, headYaw.t * k, 6, dt);
    headPitch.v = MathUtils.damp(headPitch.v, headPitch.t * k, 6, dt);
    if (head) head.quaternion.multiply(q.setFromEuler(euler.set(headPitch.v * 0.7, headYaw.v * 0.7, 0)));
    if (neck) neck.quaternion.multiply(q.setFromEuler(euler.set(headPitch.v * 0.3, headYaw.v * 0.3, 0)));

    const mixing = !!current || now < mixerUntil;
    const pose = [yaw, turntable.rotation.z, chest?.scale.y ?? 1, headYaw.v, headPitch.v, mixing ? mixer.time : -1];
    if (dirty || pose.some((v, i) => v !== drawn[i])) {
      // Breathing alone moves the shadow by well under a pixel a frame: it's redrawn once that adds up.
      const shadowMoved =
        !shadowed.length ||
        pose.some((v, i) => (i === 1 ? Math.abs(v - shadowed[i]) > 0.002 : i === 2 ? Math.abs(v - shadowed[i]) > 0.003 : v !== shadowed[i]));
      if (shadowMoved) {
        renderer.shadowMap.needsUpdate = true;
        shadowed.splice(0, pose.length, ...pose);
      }
      renderer.render(scene, camera);
      drawn.splice(0, pose.length, ...pose);
      dirty = false;
    }
    if (!ready) {
      ready = true;
      stage.dispatchEvent(new CustomEvent("yahu:ready", { bubbles: true }));
    }

    const waitYaw = !dragging && yaw !== REST_YAW ? Math.max(0, lastInput + 2500 - now) : Infinity;
    const moving =
      mixing ||
      dragging ||
      waitYaw === 0 ||
      Math.abs(yawVel) > 1e-4 ||
      Math.abs(headYaw.v - headYaw.t) > 1e-3 ||
      Math.abs(headPitch.v - headPitch.t) > 1e-3;
    if (settleFrames > 0) settleFrames--;
    if (moving || settleFrames > 0) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const wait = Math.min(breathing ? 1000 / AMBIENT_FPS - 8 : Infinity, waitYaw);
    if (wait < Infinity)
      timer = window.setTimeout(() => {
        timer = 0;
        raf = requestAnimationFrame(tick);
      }, wait);
  }
  let ready = false;

  function settle() {
    if (!current) return;
    if (idle) {
      idle.reset().play().paused = true;
      current.crossFadeTo(idle, 0.45, false);
    } else current.fadeOut(0.45);
    current = null;
    mixerUntil = performance.now() + 600;
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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    dirty = true;
    invalidate();
  });
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __yahu: {
        api,
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
