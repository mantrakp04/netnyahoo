import { useEffect, useRef } from "react";
import { newTabIntroDurationMs } from "@/hooks/motion";
import { useTheme } from "@/hooks/use-theme";

type WebglGlowVariant = "shell" | "new-tab";

interface WebglGlowProps {
  variant: WebglGlowVariant;
  tabId?: string;
  playIntro?: boolean;
}

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dark;
uniform float u_variant;
uniform float u_intro;
uniform float u_card_radius;
uniform vec3 u_primary;
uniform vec4 u_sidebar_rect;
uniform vec4 u_main_rect;
uniform vec4 u_card_rect;

varying vec2 v_uv;

float ellipse(vec2 p, vec2 center, vec2 radius) {
  vec2 q = (p - center) / radius;
  return exp(-dot(q, q));
}

float rectGlow(vec2 p, vec4 rect, float radius, float spread) {
  vec2 center = rect.xy + rect.zw * 0.5;
  vec2 halfSize = max(rect.zw * 0.5 - radius, vec2(0.001));
  vec2 delta = abs(p - center) - halfSize;
  float signedDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - radius;
  return exp(-max(signedDistance, 0.0) * spread);
}

float roundedRectDistance(vec2 p, vec4 rect, float radius) {
  vec2 center = rect.xy + rect.zw * 0.5;
  vec2 halfSize = max(rect.zw * 0.5 - radius, vec2(0.001));
  vec2 delta = abs(p - center) - halfSize;
  return length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - radius;
}

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float dither(vec2 p) {
  return (noise(p) - 0.5) / 255.0;
}

vec3 lightPalette(float index) {
  if (index < 0.5) return vec3(0.965, 0.984, 0.976);
  if (index < 1.5) return vec3(0.815, 0.918, 0.882);
  if (index < 2.5) return vec3(0.620, 0.850, 0.780);
  if (index < 3.5) return vec3(0.800, 0.950, 0.900);
  return vec3(0.149, 0.212, 0.188);
}

vec3 darkPalette(float index) {
  if (index < 0.5) return vec3(0.038, 0.066, 0.057);
  if (index < 1.5) return vec3(0.118, 0.192, 0.168);
  if (index < 2.5) return vec3(0.372, 0.470, 0.436);
  if (index < 3.5) return vec3(0.150, 0.206, 0.188);
  return vec3(0.013, 0.024, 0.021);
}

vec3 palette(float index) {
  return mix(lightPalette(index), darkPalette(index), u_dark);
}

vec4 shellGlow(vec2 p) {
  vec3 base = palette(0.0);
  vec3 sidebar = palette(1.0);
  vec3 glow = palette(2.0);
  vec3 glowSoft = palette(3.0);
  vec3 shade = palette(4.0);

  float sidebarEdge = clamp(u_sidebar_rect.x + u_sidebar_rect.z, 0.0, 1.0);
  float sidebarMask = 1.0 - smoothstep(sidebarEdge - 0.012, sidebarEdge + 0.018, p.x);
  base = mix(base, sidebar, sidebarMask * (0.24 + 0.06 * u_dark));

  float topWash = ellipse(p, vec2(0.58, -0.12), vec2(0.825, 0.475));
  float mainBreath = ellipse(p, vec2(u_card_rect.x + u_card_rect.z * 0.5, u_card_rect.y + u_card_rect.w * 0.68), vec2(0.575, 0.300));
  float sidebarBloom = ellipse(p, vec2(max(sidebarEdge * 0.45, 0.08), 0.20), vec2(0.275, 0.600));
  float frameGlow = rectGlow(p, u_main_rect, 0.044, 11.2);
  float pulse = 0.96 + 0.04 * sin(u_time * 0.34);

  vec3 color = base;
  color = mix(color, glowSoft, topWash * (0.10 + 0.012 * u_dark));
  color += glow * mainBreath * (0.007 + 0.005 * u_dark) * pulse;
  color += glow * sidebarBloom * (0.014 + 0.005 * u_dark);
  color += glowSoft * frameGlow * (0.010 + 0.005 * u_dark);

  float vignette = ellipse(p, vec2(0.50, 0.46), vec2(0.82, 0.72));
  color = mix(color, shade, (1.0 - vignette) * (0.018 + 0.028 * u_dark));
  color += (noise(p * u_resolution + u_time) - 0.5) * (0.003 + 0.002 * u_dark);

  float alpha = 0.18 + sidebarMask * 0.05 + topWash * 0.02 + mainBreath * 0.008;
  alpha = mix(alpha, alpha * 0.55, u_dark);
  return vec4(color, clamp(alpha, 0.08, 0.24));
}

vec4 newTabGlow(vec2 p) {
  vec3 glow = mix(u_primary, mix(u_primary, vec3(0.92, 0.58, 0.72), 0.36), u_dark);
  vec3 glowSoft = mix(glow, vec3(1.0, 0.86, 0.91), mix(0.28, 0.14, u_dark));
  vec3 shadowTint = mix(glow, vec3(0.09, 0.075, 0.08), mix(0.58, 0.70, u_dark));

  // Keep the source geometric and tight to the card so it does not pool under
  // the command surface.
  vec2 inset = 18.0 / u_resolution;
  vec4 rect = vec4(u_card_rect.xy + inset, u_card_rect.zw - inset * 2.0);
  rect.y += (1.0 - u_intro) * 0.40;

  float aspect = u_resolution.x / u_resolution.y;
  vec2 P = vec2(p.x * aspect, p.y);
  vec4 rectC = vec4(rect.x * aspect, rect.y, rect.z * aspect, rect.w);

  float signedDistance = roundedRectDistance(P, rectC, u_card_radius);
  float outside = max(signedDistance, 0.0);

  vec2 center = rect.xy + rect.zw * 0.5;
  float upperEdge = rect.y;
  float aboveFade = 1.0 - smoothstep(upperEdge - 0.14, upperEdge + 0.05, p.y);

  float breath = 0.5 + 0.5 * sin(u_time * 0.72);
  float leftBreath = 0.5 + 0.5 * sin(u_time * 0.72 + 0.55);
  float rightBreath = 0.5 + 0.5 * sin(u_time * 0.72 - 0.38);
  float sideBlend = smoothstep(-0.95, 0.95, (p.x - center.x) / max(rect.z * 0.5, 0.001));
  float sideBreath = mix(leftBreath, rightBreath, sideBlend);
  float breathIntensity = 1.0 + (breath - 0.5) * 0.10 + (sideBreath - 0.5) * 0.030;
  float breathRadius = 1.0 + (breath - 0.5) * 0.10 + (sideBreath - 0.5) * 0.026;
  float lift = mix(0.008125, 0.006875, u_dark) * breathRadius;
  float irradiance = 1.0 / (1.0 + pow(outside / lift, 2.35));
  float rim = smoothstep(0.018, 0.82, irradiance);
  float outerBloom = 1.0 / (1.0 + pow(outside / (mix(0.034, 0.030, u_dark) * breathRadius), 2.0));
  float topFalloff = 1.0 - smoothstep(upperEdge + rect.w * 0.18, upperEdge + rect.w * 0.78, p.y);
  float upperCrown = outerBloom * topFalloff * aboveFade;
  float edgeSource = outerBloom;
  float faintStreaks = pow(noise(vec2(p.x * 34.0, p.y * 7.0 + u_time * 0.035)), 2.6);

  float glowField =
    rim * mix(0.24, 0.42, u_dark) +
    edgeSource * mix(0.030, 0.052, u_dark) +
    upperCrown * mix(0.026, 0.044, u_dark) +
    faintStreaks * upperCrown * mix(0.006, 0.011, u_dark);
  glowField *= breathIntensity * u_intro;

  vec3 color = mix(shadowTint, glowSoft, rim * 0.42 + edgeSource * 0.12);
  color += glow * upperCrown * 0.08 * breathIntensity;
  float outputDither = dither(gl_FragCoord.xy + u_time * 17.0);
  color += outputDither + (noise(p * u_resolution * 0.42 + u_time * 0.25) - 0.5) * 0.0016;
  float alpha = clamp(glowField + outputDither, 0.0, mix(0.34, 0.58, u_dark));
  return vec4(color, alpha);
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  gl_FragColor = u_variant < 0.5 ? shellGlow(p) : newTabGlow(p);
}
`;

export function WebglGlow({ variant, tabId, playIntro = false }: WebglGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
      stencil: false,
    });
    if (!gl) return;

    const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    const positionBuffer = gl.createBuffer();
    if (!program || !positionBuffer) return;

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const darkLocation = gl.getUniformLocation(program, "u_dark");
    const variantLocation = gl.getUniformLocation(program, "u_variant");
    const introLocation = gl.getUniformLocation(program, "u_intro");
    const cardRadiusLocation = gl.getUniformLocation(program, "u_card_radius");
    const primaryLocation = gl.getUniformLocation(program, "u_primary");
    const primary = readCssColor(canvas, "--new-tab-glow");
    const sidebarRectLocation = gl.getUniformLocation(program, "u_sidebar_rect");
    const mainRectLocation = gl.getUniformLocation(program, "u_main_rect");
    const cardRectLocation = gl.getUniformLocation(program, "u_card_rect");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const introStart = performance.now();
    const shouldPlayIntro = variant === "new-tab" && playIntro;
    let animationFrame = 0;
    let reduceMotion = motionQuery.matches;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const render = (timestamp = 0) => {
      resizeCanvas(canvas, gl);
      const rects = measureRects(canvas);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, timestamp / 1000);
      gl.uniform1f(darkLocation, resolvedTheme === "dark" ? 1 : 0);
      gl.uniform1f(variantLocation, variant === "shell" ? 0 : 1);
      const introT = Math.min(
        (performance.now() - introStart) / newTabIntroDurationMs,
        1,
      );
      gl.uniform1f(
        introLocation,
        reduceMotion || !shouldPlayIntro ? 1 : 1 - Math.pow(1 - introT, 3),
      );
      gl.uniform1f(cardRadiusLocation, rects.cardRadius);
      gl.uniform3fv(primaryLocation, primary);
      gl.uniform4fv(sidebarRectLocation, rects.sidebar);
      gl.uniform4fv(mainRectLocation, rects.main);
      gl.uniform4fv(cardRectLocation, rects.card);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reduceMotion) animationFrame = window.requestAnimationFrame(render);
    };

    const onMotionChange = () => {
      reduceMotion = motionQuery.matches;
      window.cancelAnimationFrame(animationFrame);
      render();
    };
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrame);
      render();
    });

    resizeObserver.observe(canvas);
    motionQuery.addEventListener("change", onMotionChange);
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, [playIntro, resolvedTheme, variant, tabId]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      style={variant === "new-tab" ? { filter: "blur(10px)" } : undefined}
    />
  );
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("WebGL glow program failed to link", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("WebGL glow shader failed to compile", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function resizeCanvas(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width === width && canvas.height === height) return;

  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
}

function measureRects(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  return {
    sidebar: readRect(bounds, ".sidebar-panel", [0, 0, 0.13, 1]),
    main: readRect(bounds, ".browser-frame", [0.13, 0.004, 0.87, 0.992]),
    card: readRect(bounds, ".new-tab-command-card", [0.41, 0.43, 0.38, 0.13]),
    cardRadius: readRadius(bounds, ".new-tab-command-card"),
  };
}

// Corner radius as a fraction of the canvas height — the unit the glow's
// aspect-corrected distance field works in, so it tracks the box exactly.
function readRadius(bounds: DOMRect, selector: string) {
  const element = document.querySelector(selector);
  if (!element || bounds.height <= 0) return 0.02;
  const radiusPx = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return radiusPx / bounds.height;
}

function readRect(
  bounds: DOMRect,
  selector: string,
  fallback: [number, number, number, number],
) {
  const element = document.querySelector(selector);
  if (!element || bounds.width <= 0 || bounds.height <= 0) {
    return new Float32Array(fallback);
  }

  const rect = element.getBoundingClientRect();
  return new Float32Array([
    clamp((rect.left - bounds.left) / bounds.width),
    clamp((rect.top - bounds.top) / bounds.height),
    clamp(rect.width / bounds.width),
    clamp(rect.height / bounds.height),
  ]);
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

// Resolve a CSS hex color token (e.g. --primary) to 0..1 RGB. Read off the
// canvas so the theme cascade resolves wherever the .dark class lives.
function readCssColor(element: Element, varName: string): Float32Array {
  const raw = getComputedStyle(element).getPropertyValue(varName).trim();
  const hex = raw.replace("#", "");
  if (hex.length === 6) {
    return new Float32Array([
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ]);
  }
  return new Float32Array([0.18, 0.62, 0.52]);
}
