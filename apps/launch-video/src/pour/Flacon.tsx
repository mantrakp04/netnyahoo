import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  BackSide,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { SANS } from "../theme";
import { P } from "./theme";

type Rig = { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; turn: Group };

function studio(renderer: WebGLRenderer) {
  const env = new Scene();
  env.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: new Color(0x050403), side: BackSide })));
  const box = (w: number, h: number, x: number, y: number, z: number, ry: number, c: number, k: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c).multiplyScalar(k), side: DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0.5, 0);
    m.rotation.z += ry;
    env.add(m);
  };
  box(0.5, 10, -5.5, 1.5, 1.5, 0, 0xffe6c4, 7);
  box(0.35, 10, 5.5, 1.5, 0.5, 0, 0xffd6a0, 5);
  box(2.5, 1.2, 0, 7, 0.5, 0, 0xfff0dc, 1.2);
  box(0.6, 6, 2.5, 1.5, -6, 0, 0xffc07a, 4);
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

function halo() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(256, 300, 10, 256, 300, 256);
  r.addColorStop(0, "#7a5630");
  r.addColorStop(0.42, "#2a1c12");
  r.addColorStop(1, "#0a0807");
  g.fillStyle = r;
  g.fillRect(0, 0, 512, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function label() {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = 512;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = P.champagne;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const spaced = (text: string, y: number, px: number, weight: number, tracking: number) => {
    g.font = `${weight} ${px}px ${SANS}`;
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tracking * px}px`;
    g.fillText(text, c.width / 2 + (tracking * px) / 2, y);
  };
  spaced("NETNYAHOO", 230, 150, 500, 0.42);
  spaced("EAU DE CHROMIUM", 360, 54, 400, 0.5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function bottle(): Group {
  const g = new Group();
  const W = 1.3, H = W * (860 / 1360), D = 0.46;
  const glass = new MeshPhysicalMaterial({
    color: 0xffffff, transmission: 1, thickness: 0.9, roughness: 0, ior: 1.5, metalness: 0,
    attenuationColor: new Color(0xe9d6b4), attenuationDistance: 3, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1,
  });
  const body = new Mesh(new RoundedBoxGeometry(W, H, D, 8, 0.075), glass);
  body.position.y = H / 2;
  g.add(body);
  const juice = new Mesh(
    new RoundedBoxGeometry(W - 0.16, H * 0.74, D - 0.16, 6, 0.035),
    new MeshPhysicalMaterial({ color: 0x9a5518, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: new Color(0x5c2c09), emissiveIntensity: 1 }),
  );
  juice.position.y = 0.08 + (H * 0.74) / 2;
  g.add(juice);
  const lacquer = new MeshPhysicalMaterial({ color: 0x050505, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 });
  const cap = new Mesh(new RoundedBoxGeometry(0.36, 0.3, 0.3, 6, 0.025), lacquer);
  cap.position.y = H + 0.15 + 0.03;
  g.add(cap);
  const collar = new Mesh(new CylinderGeometry(0.09, 0.09, 0.06, 32), new MeshPhysicalMaterial({ color: 0xcfb07a, metalness: 1, roughness: 0.22 }));
  collar.position.y = H + 0.02;
  g.add(collar);
  const dot = (i: number, color: number, metal: number) => {
    const m = new Mesh(new CylinderGeometry(0.028, 0.028, 0.01, 32), new MeshPhysicalMaterial({ color, metalness: metal, roughness: 0.2, clearcoat: 1 }));
    m.rotation.x = Math.PI / 2;
    m.position.set(-W / 2 + 0.11 + i * 0.075, H - 0.09, D / 2 + 0.002);
    g.add(m);
  };
  dot(0, new Color(P.red).getHex(), 0);
  dot(1, 0x1a1512, 0.4);
  dot(2, 0x1a1512, 0.4);
  const print = new Mesh(new PlaneGeometry(0.96, 0.24), new MeshBasicMaterial({ map: label(), transparent: true, toneMapped: false, opacity: 0.9 }));
  print.position.set(0, H * 0.42, D / 2 + 0.003);
  g.add(print);
  return g;
}

export const Flacon: React.FC<{ width: number; height: number; yaw: number; exposure?: number }> = ({ width, height, yaw, exposure = 1 }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [handle] = useState(() => delayRender("Flacon"));
  const released = useRef(false);

  useEffect(() => {
    let live = true;
    const renderer = new WebGLRenderer({ canvas: canvas.current!, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    const scene = new Scene();
    scene.background = new Color(0x0a0807);
    scene.environment = studio(renderer);
    const back = new Mesh(new PlaneGeometry(9, 9), new MeshBasicMaterial({ map: halo() }));
    back.position.set(0, 0.7, -3.2);
    scene.add(back);
    const key = new DirectionalLight(0xffe6c4, 1.2);
    key.position.set(-3, 5, 4);
    scene.add(key);
    const turn = new Group();
    document.fonts.ready.then(() => {
      if (!live) return;
      const b = bottle();
      turn.add(b);
      const mirror = bottle();
      mirror.scale.y = -1;
      turn.add(mirror);
      const floor = new Mesh(new PlaneGeometry(40, 40), new MeshPhysicalMaterial({ color: 0x070605, roughness: 0.35, transparent: true, opacity: 0.9, clearcoat: 1 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.0005;
      scene.add(floor);
      const spill = document.createElement("canvas");
      spill.width = spill.height = 256;
      const sg = spill.getContext("2d")!;
      const rg = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
      rg.addColorStop(0, "rgba(214,140,60,0.55)");
      rg.addColorStop(1, "rgba(214,140,60,0)");
      sg.fillStyle = rg;
      sg.fillRect(0, 0, 256, 256);
      const glow = new Mesh(new PlaneGeometry(2.6, 1.3), new MeshBasicMaterial({ map: new CanvasTexture(spill), transparent: true, depthWrite: false, toneMapped: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.002, 0.35);
      scene.add(glow);
      scene.add(turn);
      const camera = new PerspectiveCamera(24, width / height, 0.1, 50);
      camera.position.set(0, 0.7, 6.4);
      camera.lookAt(0, 0.52, 0);
      setRig({ renderer, scene, camera, turn });
    });
    return () => {
      live = false;
      renderer.dispose();
    };
  }, [width, height]);

  useLayoutEffect(() => {
    if (!rig) return;
    rig.turn.rotation.y = yaw;
    rig.renderer.toneMappingExposure = exposure;
    rig.renderer.render(rig.scene, rig.camera);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [rig, yaw, exposure, handle]);

  return <canvas ref={canvas} width={width} height={height} style={{ width, height, display: "block" }} />;
};
