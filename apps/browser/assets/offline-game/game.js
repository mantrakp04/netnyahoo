/*
 * Where's Big Yahu? — Netnyahoo's no-internet game.
 *
 * Static, dependency-free, zero network: everything it needs ships in this folder.
 * URL parameters:
 *   code=ERR_…      net error name shown in the header (enables offline framing)
 *   url=https://…   the page that failed; Retry navigates back to it
 *   theme=dark|light  force a colour scheme (default: follow the system)
 *   seed=123        deterministic levels (testing)
 *   debug=1         exposes window.__yahu for automated checks
 * An embedder that can't use the query string (e.g. a patched Chrome net-error
 * page, whose URL is the failed URL) may set window.YAHU_ERROR = {code, url}
 * before this script runs.
 * Retry, in order: window.netnyahoo.retry(), Chrome's error-page
 * errorPageController.reloadButtonClick(), navigate to `url`, reload.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MANIFEST = window.YAHU_MANIFEST;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- framing
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;

  const injected = window.YAHU_ERROR || {};
  const errorCode = injected.code || params.get("code");
  const failedUrl = injected.url || params.get("url");
  let failedHost = "";
  try {
    if (failedUrl) failedHost = new URL(failedUrl).host;
  } catch (_) {}
  if (errorCode || failedUrl) {
    $("error-code").textContent = (errorCode || "ERR_INTERNET_DISCONNECTED").replace(/[^A-Z0-9_]/gi, "");
    $("error-host").textContent = failedHost;
    document.title = failedHost ? `${failedHost} · No internet` : "No internet";
  } else {
    document.body.classList.add("standalone");
    document.title = "Where's Big Yahu?";
    $("offline-title").textContent = "Where's Big Yahu?";
    $("offline-sub").textContent = "One man, one crowd, a great deal of money. Find him before the clock runs out.";
  }

  function retry() {
    try {
      const host = window.netnyahoo;
      if (host && typeof host.retry === "function") return void host.retry();
      const epc = window.errorPageController;
      if (epc && typeof epc.reloadButtonClick === "function") return void epc.reloadButtonClick();
    } catch (_) {}
    if (failedUrl && /^https?:\/\//i.test(failedUrl)) location.replace(failedUrl);
    else location.reload();
  }
  $("retry").addEventListener("click", retry);
  $("online-retry").addEventListener("click", retry);
  addEventListener("online", () => { if (errorCode || failedUrl) $("online").hidden = false; });
  addEventListener("offline", () => { $("online").hidden = true; });

  // ---------------------------------------------------------------- storage
  const BEST_KEY = "netnyahoo.yahu.best";
  function loadBest() {
    try { return Math.max(0, parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0); } catch (_) { return 0; }
  }
  // On Chrome's net-error page (opaque origin, no localStorage) the browser
  // keeps the dino high score for us; reuse that channel when it exists.
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) {}
    try {
      const epc = window.errorPageController;
      if (epc && typeof epc.updateEasterEggHighScore === "function") epc.updateEasterEggHighScore(v);
    } catch (_) {}
  }
  window.initializeEasterEggHighScore = (v) => {
    if (v > best) { best = v; updateHud(); }
  };

  // ---------------------------------------------------------------- random
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const seedParam = parseInt(params.get("seed") || "", 10);
  let rng = mulberry32(Number.isFinite(seedParam) ? seedParam : (Math.random() * 2 ** 31) | 0);
  const pick = (arr) => arr[(rng() * arr.length) | 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------------------------------------------------------------- copy
  const CAPTIONS = [
    "Found him. Now try finding the donor list.",
    "Hiding in a crowd of lobbyists. Bold camouflage.",
    "He blends right in. That's rather the problem.",
    "The name tags are blank. The cheques never are.",
    "Found. The lobbyists, sadly, are still everywhere.",
    "Ah yes, a completely spontaneous gathering of major donors.",
    "Transparency achieved, for about four seconds.",
    "He's not hiding. He's “unavailable for comment.”",
    "No internet, yet somehow the money still gets through.",
    "Access costs extra. Finding him was free.",
    "Every hand in this room is shaking another hand's wallet.",
    "Spotted between two concerned citizens with seven-figure concerns.",
    "Caught mid-photo-op. The fundraiser runs until the vote.",
    "Policy is made by those who show up. And those who pay for the room.",
  ];
  const TIMEOUT_LINES = [
    "Time's up. He's already at the next fundraiser.",
    "Gone. Left through the side door with the gift bags.",
    "Too slow. The press conference has been cancelled.",
  ];
  const MISS = {
    crowd: [
      "Just a lobbyist.", "That's a donor.", "Wrong suit.", "Nope, a “concerned citizen.”",
      "That's the treasurer.", "A consultant. Bills by the hour.", "Not him. Same donors, though.",
      "An ethics advisor. Allegedly.",
    ],
    hair: ["Right hair, wrong politician.", "Silver hair, different wallet."],
    tie: ["Blue tie, wrong guy.", "Same tie. Different sponsor."],
  };
  function makeBag(list) {
    let bag = [];
    return () => {
      if (!bag.length) bag = shuffle(list);
      return bag.pop();
    };
  }
  const nextCaption = makeBag(CAPTIONS);
  const nextTimeout = makeBag(TIMEOUT_LINES);
  const nextMiss = { crowd: makeBag(MISS.crowd), hair: makeBag(MISS.hair), tie: makeBag(MISS.tie) };

  // ---------------------------------------------------------------- assets
  const sprites = { crowd: [], decoy: [], yahu: [] };
  const backgrounds = [];
  function parseMask(rows) {
    return Uint32Array.from(rows, (h) => parseInt(h, 16) >>> 0);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("failed to load " + src));
      img.src = src;
    });
  }
  async function loadAssets() {
    const jobs = [];
    for (const s of MANIFEST.sprites) {
      jobs.push(loadImage(`assets/crowd/${s.id}.webp`).then((img) => {
        sprites[s.kind].push({ ...s, img, aspect: s.w / s.h, bits: parseMask(s.mask) });
      }));
    }
    for (const b of MANIFEST.backgrounds) {
      jobs.push(loadImage(`assets/bg/${b.id}.webp`).then((img) => backgrounds.push({ ...b, img })));
    }
    await Promise.all(jobs);
    for (const k of Object.keys(sprites)) sprites[k].sort((a, b) => (a.id < b.id ? -1 : 1));
    backgrounds.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // ---------------------------------------------------------------- geometry
  // A person is a bust anchored at its bottom-centre (x, y) in world units,
  // drawn h tall, rotated by rot and mirrored by flip.
  function toLocal(p, wx, wy) {
    const dx = wx - p.x, dy = wy - p.y;
    const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
    const lx = (dx * c - dy * s) * p.flip;
    const ly = dx * s + dy * c;
    const w = p.h * p.sprite.aspect;
    return { u: (lx + w / 2) / w, v: (ly + p.h) / p.h };
  }
  function toWorld(p, u, v) {
    const w = p.h * p.sprite.aspect;
    const lx = (u * w - w / 2) * p.flip, ly = v * p.h - p.h;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
  }
  function maskAt(sprite, u, v) {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const bits = sprite.bits;
    const row = bits[Math.min(bits.length - 1, (v * bits.length) | 0)];
    return ((row >>> (31 - ((u * 32) | 0))) & 1) === 1;
  }
  function hits(p, wx, wy) {
    const { u, v } = toLocal(p, wx, wy);
    return maskAt(p.sprite, u, v);
  }
  // Centre of the face, roughly: sprites are head-and-shoulders, head on top.
  const headCenter = (p) => toWorld(p, 0.5, 0.36);

  // ---------------------------------------------------------------- levels
  let bgOrder = [];
  function buildLevel(n) {
    const t = clamp((n - 1) / 9, 0, 1);
    const bg = backgrounds[bgOrder[(n - 1) % bgOrder.length]];
    const W = bg.w, H = bg.h;
    const frontH = lerp(340, 205, t);
    const backH = lerp(170, 86, t);
    const yBack = H * lerp(0.52, 0.45, t);
    const yFront = H * 1.16;
    const rowK = lerp(0.4, 0.26, t);
    const colK = lerp(0.86, 0.62, t);
    const avgAspect = sprites.crowd.reduce((a, s) => a + s.aspect, 0) / sprites.crowd.length;

    const nextCrowd = makeBag(sprites.crowd);
    const people = [];
    for (let y = yBack; y < yFront; ) {
      const d = (y - yBack) / (yFront - yBack);
      const h = lerp(backH, frontH, d);
      const step = h * avgAspect * colK;
      for (let x = -step * rng(); x < W + step; x += step * (0.82 + rng() * 0.36)) {
        people.push({
          x: x + (rng() - 0.5) * step * 0.3,
          y: y + (rng() - 0.5) * h * 0.08,
          h: h * (0.9 + rng() * 0.18),
          rot: (rng() - 0.5) * lerp(0.12, 0.26, t),
          flip: rng() < 0.5 ? -1 : 1,
          sprite: nextCrowd(),
          kind: "crowd",
          depth: d,
        });
      }
      y += h * rowK;
    }

    // Decoys share one Big Yahu trait. Blue ties first; silver hair from level 3.
    const decoyPool = sprites.decoy.filter((s) => n >= 3 || s.trait === "tie");
    const decoyCount = Math.round(lerp(2, 16, t));
    const nextDecoy = makeBag(decoyPool.length ? decoyPool : sprites.decoy);
    for (const p of shuffle(people).slice(0, decoyCount)) {
      p.sprite = nextDecoy();
      p.kind = p.sprite.trait;
    }

    people.sort((a, b) => a.y - b.y);

    // Hide Big Yahu: a slot fully inside the frame, not too close to the camera
    // on later levels, with a level-dependent amount of his face occluded.
    const minVis = lerp(0.95, 0.55, t);
    const wantOccluded = n >= 3;
    const pose = pick(sprites.yahu);
    const candidates = people.filter((p) => {
      const top = p.y - p.h;
      return p.x > W * 0.07 && p.x < W * 0.93 && top > H * 0.03 && p.y - p.h * 0.45 < H * 0.95 &&
        (t < 0.15 || p.depth < lerp(1, 0.7, t));
    });
    for (const p of candidates) p.rot *= 0.5; // whoever he replaces: a gentle tilt at most
    let yahu = null;
    let fallback = null; // most visible slot seen, in case nothing qualifies
    for (let i = 0; i < 80 && candidates.length; i++) {
      const p = pick(candidates);
      const prev = { sprite: p.sprite, kind: p.kind };
      p.sprite = pose; p.kind = "yahu";
      const vis = visibility(p, people);
      if (vis >= minVis && (!wantOccluded || i > 50 || vis <= 0.9)) { yahu = p; break; }
      if (!fallback || vis > fallback.vis) fallback = { p, vis };
      p.sprite = prev.sprite; p.kind = prev.kind;
    }
    if (!yahu) {
      yahu = fallback ? fallback.p : pick(people);
      yahu.sprite = pose; yahu.kind = "yahu";
      // Last resort: clear whoever blocks his face.
      for (let guard = 0; guard < 24 && visibility(yahu, people) < minVis; guard++) {
        const idx = people.indexOf(yahu);
        const blocker = people.slice(idx + 1).find((q) => blocksFace(yahu, q));
        if (!blocker) break;
        people.splice(people.indexOf(blocker), 1);
      }
    }

    // Later levels: seat look-alikes right next to him.
    if (n >= 4) {
      const near = people
        .filter((p) => p !== yahu && p.kind === "crowd" && Math.abs(p.y - yahu.y) < yahu.h * 0.6)
        .sort((a, b) => Math.abs(a.x - yahu.x) - Math.abs(b.x - yahu.x))
        .slice(0, n >= 7 ? 2 : 1);
      const saved = near.map((p) => ({ p, sprite: p.sprite, kind: p.kind }));
      for (const p of near) { p.sprite = nextDecoy(); p.kind = p.sprite.trait; }
      // A new silhouette in front of him must not eat into his visible face.
      if (visibility(yahu, people) < minVis) for (const r of saved) { r.p.sprite = r.sprite; r.p.kind = r.kind; }
    }

    return { n, t, bg, W, H, people, yahu, time: Math.max(35, 60 - (n - 1) * 2.5) };
  }

  function faceSamples(p) {
    const out = [];
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        const u = (i + 0.5) / 9, v = 0.04 + (j + 0.5) / 9 * 0.56;
        if (maskAt(p.sprite, u, v)) out.push(toWorld(p, u, v));
      }
    }
    return out;
  }
  function visibility(p, people) {
    const pts = faceSamples(p);
    if (!pts.length) return 0;
    const front = people.filter((q) => q !== p && q.y > p.y && Math.abs(q.x - p.x) < (q.h + p.h) && q.y - q.h < p.y);
    let seen = 0;
    for (const pt of pts) if (!front.some((q) => hits(q, pt.x, pt.y))) seen++;
    return seen / pts.length;
  }
  function blocksFace(p, q) {
    return faceSamples(p).some((pt) => hits(q, pt.x, pt.y));
  }

  // ---------------------------------------------------------------- canvas + camera
  const stage = $("stage");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  let dpr = 1, vw = 1, vh = 1;
  const cam = { k: 1, x: 0, y: 0 };
  let camTween = null;
  let level = null;
  let dirty = true;
  let stageColor = "#222";
  const readStageColor = () => { stageColor = getComputedStyle(stage).backgroundColor || stageColor; dirty = true; };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readStageColor);

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = Math.max(1, r.width); vh = Math.max(1, r.height);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    clampCam();
    readStageColor();
  }
  const minK = () => (level ? Math.max(vw / level.W, vh / level.H) : 1);
  const maxK = () => minK() * 5;
  function clampCam(c = cam) {
    if (!level) return c;
    c.k = clamp(c.k, minK(), maxK());
    c.x = clamp(c.x, vw - level.W * c.k, 0);
    c.y = clamp(c.y, vh - level.H * c.k, 0);
    return c;
  }
  function fitCam() {
    cam.k = minK();
    cam.x = (vw - level.W * cam.k) / 2;
    cam.y = vh - level.H * cam.k; // favour the crowd (bottom) when cropping
    clampCam();
    dirty = true;
  }
  function zoomAt(sx, sy, f) {
    camTween = null;
    const k = clamp(cam.k * f, minK(), maxK());
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y) / cam.k;
    cam.k = k;
    cam.x = sx - wx * k;
    cam.y = sy - wy * k;
    clampCam();
    dirty = true;
  }
  function panBy(dx, dy) {
    camTween = null;
    cam.x += dx; cam.y += dy;
    clampCam();
    dirty = true;
  }
  function tweenCam(target, ms) {
    const to = clampCam({ ...target });
    if (reduceMotion || ms <= 0) { Object.assign(cam, to); dirty = true; return; }
    camTween = { from: { ...cam }, to, start: performance.now(), ms };
  }
  function camToShow(wx, wy, heightFrac, worldH) {
    const k = heightFrac && worldH ? clamp((vh * heightFrac) / worldH, minK(), maxK()) : cam.k;
    return { k, x: vw / 2 - wx * k, y: vh / 2 - wy * k };
  }
  const toScreen = (wx, wy) => ({ x: wx * cam.k + cam.x, y: wy * cam.k + cam.y });
  const toWorldPt = (sx, sy) => ({ x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k });

  // ---------------------------------------------------------------- effects
  const effects = []; // {type, start, ms, ...}
  let hint = null; // {cx, cy, r0, r1, start, ms}
  let reveal = null; // {start}
  let confetti = [];

  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3.2) + 1),
  };

  // ---------------------------------------------------------------- render
  function drawPerson(p, scale = 1, lift = 0) {
    const img = p.sprite.img;
    const s = (p.h / img.height) * scale;
    const c = Math.cos(p.rot), sn = Math.sin(p.rot);
    const K = cam.k * dpr;
    const ax = (p.x * cam.k + cam.x) * dpr;
    const ay = ((p.y - lift) * cam.k + cam.y) * dpr;
    ctx.setTransform(K * c * s * p.flip, K * sn * s * p.flip, -K * sn * s, K * c * s, ax, ay);
    ctx.drawImage(img, -img.width / 2, -img.height);
  }

  function render(now) {
    const L = level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = stageColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!L) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.setTransform(cam.k * dpr, 0, 0, cam.k * dpr, cam.x * dpr, cam.y * dpr);
    ctx.drawImage(L.bg.img, 0, 0, L.W, L.H);

    // Depth haze: fade the far rows toward the room's light a touch.
    const view = { x0: -cam.x / cam.k, y0: -cam.y / cam.k, x1: (vw - cam.x) / cam.k, y1: (vh - cam.y) / cam.k };
    const revealing = reveal && state !== "over";
    for (const p of L.people) {
      if (revealing && p === L.yahu) continue;
      const r = p.h * 0.8;
      if (p.x + r < view.x0 || p.x - r > view.x1 || p.y - p.h > view.y1 || p.y < view.y0) continue;
      drawPerson(p);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Hint spotlight.
    if (hint && (state === "playing" || state === "paused")) {
      const k = ease.outCubic(clamp((now - hint.start) / hint.ms, 0, 1));
      const r = lerp(hint.r0, hint.r1, k) * cam.k;
      const c = toScreen(hint.cx, hint.cy);
      ctx.beginPath();
      ctx.rect(0, 0, vw, vh);
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2, true);
      ctx.fillStyle = `rgba(10, 8, 9, ${0.62 * Math.min(1, k * 3)})`;
      ctx.fill("evenodd");
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255, 214, 120, ${0.65 + 0.35 * pulse})`;
      ctx.stroke();
    }

    // Wrong-click rings.
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const k = (now - e.start) / e.ms;
      if (k >= 1) { effects.splice(i, 1); continue; }
      const s = toScreen(e.wx, e.wy);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10 + 26 * ease.outCubic(k), 0, Math.PI * 2);
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.strokeStyle = `rgba(225, 72, 80, ${1 - k})`;
      ctx.stroke();
      const x = 7 * (1 - k);
      ctx.beginPath();
      ctx.moveTo(s.x - x, s.y - x); ctx.lineTo(s.x + x, s.y + x);
      ctx.moveTo(s.x + x, s.y - x); ctx.lineTo(s.x - x, s.y + x);
      ctx.stroke();
    }

    // Found: dim the crowd, pop Big Yahu out with a bounce.
    if (reveal) {
      const t = (now - reveal.start) / 1000;
      const Y = L.yahu;
      if (state === "found") {
        ctx.fillStyle = `rgba(10, 8, 9, ${0.55 * Math.min(1, t * 3)})`;
        ctx.fillRect(0, 0, vw, vh);
        const pop = reduceMotion ? 1 : ease.outElastic(clamp(t / 1.1, 0, 1));
        const scale = 1 + 0.32 * pop;
        const lift = Y.h * 0.1 * pop;
        const hc = toScreen(Y.x, Y.y - Y.h * 0.5);
        const glow = ctx.createRadialGradient(hc.x, hc.y, 0, hc.x, hc.y, Y.h * cam.k * 0.9);
        glow.addColorStop(0, `rgba(255, 220, 140, ${0.45 * pop})`);
        glow.addColorStop(1, "rgba(255, 220, 140, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, vw, vh);
        const rot = Y.rot;
        Y.rot = rot + (reduceMotion ? 0 : Math.sin(t * 9) * 0.06 * Math.max(0, 1 - t));
        drawPerson(Y, scale, lift);
        Y.rot = rot;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else if (state === "over") {
        const c = toScreen(Y.x, Y.y - Y.h * 0.55);
        const pulse = 0.5 + 0.5 * Math.sin(now / 160);
        ctx.beginPath();
        ctx.rect(0, 0, vw, vh);
        ctx.arc(c.x, c.y, Y.h * cam.k * 0.62, 0, Math.PI * 2, true);
        ctx.fillStyle = "rgba(10, 8, 9, 0.55)";
        ctx.fill("evenodd");
        ctx.beginPath();
        ctx.arc(c.x, c.y, Y.h * cam.k * 0.62, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(225, 72, 80, ${0.6 + 0.4 * pulse})`;
        ctx.stroke();
      }
    }

    // Banknote confetti on a find.
    if (confetti.length) {
      const dt = 1 / 60;
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vy += 520 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt;
        if (c.life <= 0 || c.y > vh + 40) { confetti.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.r);
        ctx.scale(1, Math.cos(c.r * 2.3));
        ctx.globalAlpha = Math.min(1, c.life * 2);
        ctx.fillStyle = c.color;
        ctx.fillRect(-11, -5.5, 22, 11);
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-8, -3, 16, 6);
        ctx.restore();
      }
    }
  }

  function burstConfetti(sx, sy) {
    if (reduceMotion) return;
    const colors = ["#7fb77e", "#a9d18e", "#5e9c68", "#cfe3b4"];
    for (let i = 0; i < 38; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.2;
      const v = 260 + rng() * 360;
      confetti.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rng() * 6, vr: (rng() - 0.5) * 14, life: 1.3 + rng() * 0.8, color: pick(colors) });
    }
  }

  // ---------------------------------------------------------------- game state
  // loading → title → playing ⇄ paused → found → playing … → over → playing
  let state = "loading";
  let score = 0;
  let best = loadBest();
  let timeLeft = 0;
  let hintsUsed = 0;
  let misses = 0;
  let last = performance.now();

  const hud = {
    level: $("hud-level"), time: $("hud-time"), score: $("hud-score"), best: $("hud-best"),
    bar: $("timebar"), hint: $("hint-btn"), pause: $("pause-btn"),
  };
  const overlay = $("overlay");
  const card = {
    title: $("card-title"), body: $("card-body"), quote: $("card-quote"), action: $("card-action"),
    keys: $("card-keys"), portrait: $("card-portrait"),
  };

  function showCard({ title, body, quote, action, keys = true, portrait = true, mode = "" }) {
    card.title.textContent = title;
    card.body.textContent = body || "";
    card.body.hidden = !body;
    card.quote.textContent = quote || "";
    card.quote.hidden = !quote;
    card.action.textContent = action;
    card.keys.hidden = !keys;
    card.portrait.hidden = !portrait;
    overlay.className = "overlay" + (mode ? " " + mode : "");
    const el = $("card");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }
  function hideCard() { overlay.className = "overlay hidden"; }

  let toastTimer = 0;
  function toast(msg, bad) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.toggle("bad", !!bad);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
  }

  let shownTime = "";
  function updateHud() {
    const tl = Math.max(0, timeLeft);
    const txt = tl.toFixed(1);
    if (txt !== shownTime) {
      shownTime = txt;
      hud.time.textContent = txt;
      const low = state === "playing" && tl < 10;
      hud.time.classList.toggle("low", low);
      hud.bar.classList.toggle("low", low);
      hud.bar.style.transform = `scaleX(${level ? clamp(tl / level.time, 0, 1) : 1})`;
    }
    hud.score.textContent = String(score);
    hud.best.textContent = String(best);
    hud.level.textContent = level ? `Level ${level.n} · ${level.people.length} suspects` : "Level 1";
    hud.hint.disabled = state !== "playing" || hintsUsed >= 3;
    hud.pause.disabled = !(state === "playing" || state === "paused");
  }

  function startGame() {
    score = 0;
    try { window.errorPageController && window.errorPageController.trackEasterEgg(); } catch (_) {}
    bgOrder = shuffle(backgrounds.map((_, i) => i));
    startLevel(1);
  }
  function startLevel(n) {
    level = buildLevel(n);
    timeLeft = level.time;
    hintsUsed = 0;
    misses = 0;
    hint = null;
    reveal = null;
    effects.length = 0;
    confetti = [];
    fitCam();
    state = "playing";
    hideCard();
    stage.classList.remove("paused");
    last = performance.now();
    updateHud();
    toast(n === 1 ? "Find Big Yahu. Click him." : `Level ${n}: ${level.people.length} suspects`);
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    stage.classList.add("paused");
    showCard({ title: "Paused", body: "The crowd will wait. The donors won't.", action: "Resume" });
    updateHud();
  }
  function resume() {
    if (state !== "paused") return;
    state = "playing";
    stage.classList.remove("paused");
    hideCard();
    last = performance.now();
    updateHud();
  }

  function useHint() {
    if (state !== "playing" || hintsUsed >= 3) return;
    hintsUsed++;
    timeLeft -= 8;
    const Y = level.yahu;
    const hc = headCenter(Y);
    const r1 = Y.h * [2.4, 1.4, 0.75][hintsUsed - 1];
    const off = r1 * (hintsUsed === 3 ? 0.15 : 0.5) * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    const cx = hc.x + Math.cos(a) * off, cy = hc.y + Math.sin(a) * off;
    const view = Math.max(vw, vh) / cam.k;
    hint = { cx, cy, r0: Math.max(view * 0.75, r1 * 2), r1, start: performance.now(), ms: reduceMotion ? 1 : 1400 };
    const s = toScreen(cx, cy);
    if (s.x - r1 * cam.k < 0 || s.x + r1 * cam.k > vw || s.y - r1 * cam.k < 0 || s.y + r1 * cam.k > vh) {
      tweenCam(camToShow(cx, cy), 500);
    }
    toast(`Hint ${hintsUsed}/3 · −8s`, true);
    updateHud();
  }

  function found() {
    state = "found";
    const Y = level.yahu;
    const bonus = misses === 0 ? 150 : 0;
    const points = 100 * level.n + Math.round(Math.max(0, timeLeft) * 10) + bonus;
    score += points;
    if (score > best) { best = score; saveBest(best); }
    reveal = { start: performance.now() };
    hint = null;
    const hc = headCenter(Y);
    tweenCam(camToShow(hc.x, hc.y + Y.h * 0.3, 0.46, Y.h), 650);
    setTimeout(() => {
      const s = toScreen(hc.x, hc.y - Y.h * 0.55);
      burstConfetti(s.x, s.y);
    }, reduceMotion ? 0 : 520);
    const secs = (level.time - timeLeft).toFixed(1);
    const bits = [`Found in ${secs}s`, `+${points}`];
    if (bonus) bits.push("clean sweep +150");
    showCard({
      title: "Found him!",
      body: bits.join(" · "),
      quote: nextCaption(),
      action: `Next level`,
      keys: false,
      portrait: false,
      mode: "reveal",
    });
    updateHud();
  }

  function gameOver() {
    state = "over";
    timeLeft = 0;
    reveal = { start: performance.now() };
    hint = null;
    const Y = level.yahu;
    const hc = headCenter(Y);
    tweenCam(camToShow(hc.x, hc.y, 0.42, Y.h), 700);
    const newBest = score > 0 && score >= best;
    showCard({
      title: "Time's up",
      body: `Level ${level.n} · Final score ${score}${newBest ? " · new best!" : ` · best ${best}`}`,
      quote: nextTimeout(),
      action: "Play again",
      keys: false,
      portrait: false,
      mode: "reveal",
    });
    updateHud();
  }

  function onPrimary() {
    if (state === "title" || state === "over") startGame();
    else if (state === "found") startLevel(level.n + 1);
    else if (state === "paused") resume();
  }
  card.action.addEventListener("click", onPrimary);
  hud.hint.addEventListener("click", useHint);
  hud.pause.addEventListener("click", () => (state === "paused" ? resume() : pause()));

  function clickAt(sx, sy) {
    if (state !== "playing") return;
    const w = toWorldPt(sx, sy);
    const L = level;
    for (let i = L.people.length - 1; i >= 0; i--) {
      const p = L.people[i];
      if (Math.abs(p.x - w.x) > p.h || w.y > p.y || w.y < p.y - p.h * 1.2) continue;
      if (!hits(p, w.x, w.y)) continue;
      if (p === L.yahu) return found();
      misses++;
      timeLeft -= 5;
      effects.push({ wx: w.x, wy: w.y, start: performance.now(), ms: 600 });
      toast(`−5s · ${nextMiss[p.kind === "hair" || p.kind === "tie" ? p.kind : "crowd"]()}`, true);
      return;
    }
    // Clicked scenery: free, but say so.
    effects.push({ wx: w.x, wy: w.y, start: performance.now(), ms: 400 });
  }

  // ---------------------------------------------------------------- input
  // Canvas-local coordinates from client coordinates (offsetX is unreliable
  // for synthesized events and under ancestor transforms).
  const lx = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const ly = (e) => e.clientY - canvas.getBoundingClientRect().top;
  const pointers = new Map();
  let drag = null; // {x, y, moved}
  let pinch = null; // {dist, cx, cy}
  canvas.addEventListener("pointerdown", (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    pointers.set(e.pointerId, { x: lx(e), y: ly(e) });
    if (pointers.size === 1) drag = { x: lx(e), y: ly(e), sx: lx(e), sy: ly(e), moved: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (drag) drag.moved = true;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: lx(e), y: ly(e) });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      panBy(cx - pinch.cx, cy - pinch.cy);
      if (pinch.dist > 0) zoomAt(cx, cy, dist / pinch.dist);
      pinch = { dist, cx, cy };
    } else if (drag) {
      const dx = lx(e) - drag.x, dy = ly(e) - drag.y;
      if (!drag.moved && Math.hypot(lx(e) - drag.sx, ly(e) - drag.sy) > 5) {
        drag.moved = true;
        canvas.classList.add("grabbing");
      }
      if (drag.moved) panBy(dx, dy);
      drag.x = lx(e); drag.y = ly(e);
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (drag && !drag.moved && e.type === "pointerup") clickAt(lx(e), ly(e));
      drag = null;
      canvas.classList.remove("grabbing");
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (state === "paused" || state === "loading") return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    // Trackpad pinch arrives as ctrl+wheel. A notched mouse wheel zooms too;
    // two-finger scrolling pans.
    const notched = e.deltaMode === 1 || (dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy) && Math.abs(dy) % 50 === 0);
    if (e.ctrlKey || e.metaKey) zoomAt(lx(e), ly(e), Math.exp(-dy * 0.012));
    else if (notched) zoomAt(lx(e), ly(e), dy > 0 ? 1 / 1.2 : 1.2);
    else panBy(-dx, -dy);
  }, { passive: false });
  // Safari pinch.
  let gestureBase = 1;
  canvas.addEventListener("gesturestart", (e) => { e.preventDefault(); gestureBase = 1; });
  canvas.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.scale / gestureBase);
    gestureBase = e.scale;
  });

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    const onButton = tag === "BUTTON";
    switch (e.key) {
      case " ":
      case "Enter":
        if (onButton && e.key === "Enter") return; // native button activation
        e.preventDefault();
        onPrimary();
        break;
      case "h":
      case "H":
        useHint();
        break;
      case "Escape":
        if (state === "playing") pause();
        else if (state === "paused") resume();
        break;
      case "+":
      case "=":
        zoomAt(vw / 2, vh / 2, 1.25);
        break;
      case "-":
      case "_":
        zoomAt(vw / 2, vh / 2, 0.8);
        break;
      case "0":
        if (level) fitCam();
        break;
      case "ArrowLeft": panBy(60, 0); e.preventDefault(); break;
      case "ArrowRight": panBy(-60, 0); e.preventDefault(); break;
      case "ArrowUp": panBy(0, 60); e.preventDefault(); break;
      case "ArrowDown": panBy(0, -60); e.preventDefault(); break;
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  new ResizeObserver(resize).observe(stage);

  // ---------------------------------------------------------------- loop
  function frame(now) {
    // Wall-clock timer; long gaps only happen when hidden, and hiding pauses.
    const dt = Math.min(1, Math.max(0, (now - last) / 1000));
    last = now;
    if (state === "playing") {
      timeLeft -= dt;
      if (timeLeft <= 0) gameOver();
      updateHud();
    }
    if (camTween) {
      const k = clamp((now - camTween.start) / camTween.ms, 0, 1);
      const e = ease.inOutCubic(k);
      cam.k = lerp(camTween.from.k, camTween.to.k, e);
      cam.x = lerp(camTween.from.x, camTween.to.x, e);
      cam.y = lerp(camTween.from.y, camTween.to.y, e);
      if (k >= 1) camTween = null;
      dirty = true;
    }
    const animating = hint || reveal || effects.length || confetti.length || camTween;
    if (dirty || animating) {
      render(now);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    resize();
    updateHud();
    try {
      await loadAssets();
    } catch (err) {
      $("loading").textContent = "The crowd didn't show up. (Assets failed to load.)";
      console.error(err);
      return;
    }
    const face = sprites.yahu[0];
    if (face) {
      $("wanted").src = face.img.src;
      card.portrait.src = face.img.src;
    }
    bgOrder = shuffle(backgrounds.map((_, i) => i));
    level = buildLevel(1);
    timeLeft = level.time;
    fitCam();
    state = "title";
    $("loading").classList.add("done");
    showCard({
      title: "Where's Big Yahu?",
      body: "He's hiding in a crowd of donors, lobbyists and very generous friends. Click him before the clock runs out. Wrong guesses cost 5 seconds.",
      action: "Start",
    });
    updateHud();
    requestAnimationFrame(frame);
  }

  if (params.get("debug") === "1") {
    window.__yahu = {
      get state() { return state; },
      get level() { return level; },
      get score() { return score; },
      get timeLeft() { return timeLeft; },
      set timeLeft(v) { timeLeft = v; },
      yahuScreen() {
        const c = headCenter(level.yahu);
        return toScreen(c.x, c.y);
      },
      // A point on Big Yahu's face that no one stands in front of, in page coordinates.
      yahuVisiblePage() {
        const Y = level.yahu;
        const r = canvas.getBoundingClientRect();
        const ps = level.people;
        const pts = faceSamples(Y).sort((a, b) => Math.hypot(a.x - Y.x, a.y - Y.y + Y.h * 0.64) - Math.hypot(b.x - Y.x, b.y - Y.y + Y.h * 0.64));
        for (const pt of pts) {
          const top = ps.slice().reverse().find((q) => hits(q, pt.x, pt.y));
          const s = toScreen(pt.x, pt.y);
          if (top === Y && s.x > 4 && s.y > 4 && s.x < vw - 4 && s.y < vh - 4) return { x: r.left + s.x, y: r.top + s.y };
        }
        return null;
      },
      fit: () => fitCam(),
      timeout: () => gameOver(),
      zoomAt,
      // A screen point whose topmost person is not Big Yahu (for wrong-click tests).
      wrongScreen(kind) {
        const ps = level.people;
        for (let i = ps.length - 1; i >= 0; i--) {
          const p = ps[i];
          if (p === level.yahu || (kind && p.kind !== kind)) continue;
          const c = headCenter(p);
          const top = ps.slice().reverse().find((q) => hits(q, c.x, c.y));
          const s = toScreen(c.x, c.y);
          if (top === p && s.x > 20 && s.x < vw - 20 && s.y > 20 && s.y < vh - 20) return { ...s, kind: p.kind };
        }
        return null;
      },
      visibility: () => visibility(level.yahu, level.people),
      // Average ms per full-scene render (the frame budget at 60fps is 16.7ms).
      renderCost(frames = 60) {
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) render(performance.now());
        return (performance.now() - t0) / frames;
      },
      startLevel,
    };
  }

  boot();
})();
