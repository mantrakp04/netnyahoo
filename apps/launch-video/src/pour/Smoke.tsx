import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from "three";

// The dark behind the window: slow smoke, drawn procedurally (domain-warped noise), lit from one side by the
// film's champagne light. It stays under the window and never competes with it: its brightest folds are a few
// percent. Deterministic in `t` (seconds), so a frame always renders the same.
const frag = /* glsl */ `
precision highp float;
uniform vec2 res;
uniform float t;
uniform vec2 light;
uniform float glow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.02; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y * 1.8;
  vec2 q = vec2(fbm(p + vec2(0.0, 0.04 * t)), fbm(p + vec2(5.2, 1.3) - 0.03 * t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.05 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.04 * t));
  float n = fbm(p + 2.6 * r);
  // folds: thin bright ridges where the warped field crosses a level, like smoke turning edge-on to the light
  float ridge = pow(1.0 - abs(sin(7.0 * n + 1.5 * r.x)), 9.0);
  float lit = smoothstep(1.25, 0.0, distance(uv * vec2(res.x / res.y, 1.0), light * vec2(res.x / res.y, 1.0)));
  vec3 black = vec3(0.039, 0.031, 0.027);
  vec3 champ = vec3(0.86, 0.77, 0.60);
  vec3 col = black + champ * (0.055 * ridge + 0.035 * n) * lit * glow;
  col *= 1.0 - 0.55 * pow(length(uv - 0.5) * 1.3, 2.2);
  // a touch of dither so the gradient never bands
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

type Rig = { renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera; mat: ShaderMaterial };

export const Smoke: React.FC<{ width: number; height: number; t: number; light?: [number, number]; glow?: number }> = ({ width, height, t, light = [0.25, 0.8], glow = 1 }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [handle] = useState(() => delayRender("Smoke"));
  const released = useRef(false);
  // drawn at half size and scaled up: it's all soft
  const w = Math.round(width / 2), h = Math.round(height / 2);

  useEffect(() => {
    const renderer = new WebGLRenderer({ canvas: canvas.current!, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new ShaderMaterial({
      fragmentShader: frag,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      uniforms: { res: { value: new Vector2(w, h) }, t: { value: 0 }, light: { value: new Vector2(0.25, 0.8) }, glow: { value: 1 } },
    });
    scene.add(new Mesh(new PlaneGeometry(2, 2), mat));
    setRig({ renderer, scene, camera, mat });
    return () => renderer.dispose();
  }, [w, h]);

  useLayoutEffect(() => {
    if (!rig) return;
    rig.mat.uniforms.t.value = t;
    rig.mat.uniforms.light.value.set(light[0], light[1]);
    rig.mat.uniforms.glow.value = glow;
    rig.renderer.render(rig.scene, rig.camera);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [rig, t, light, glow, handle]);

  return <canvas ref={canvas} width={w} height={h} style={{ width, height, display: "block" }} />;
};
