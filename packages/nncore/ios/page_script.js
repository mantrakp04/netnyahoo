// Install before page scripts.
(function (post) {
  "use strict";
  if (!/^(https?|file):$/.test(location.protocol)) return () => {};
  const isTop = window === window.top;
  const handlers = Object.create(null);
  // Page code runs after this and can replace any global or prototype method:
  // keep the originals, and send plain copies (a page's Object.prototype.toJSON
  // can't reach them). The browser still checks every message.
  const { stringify: toJSON, parse: fromJSON } = JSON;
  const apply = Reflect.apply;
  const { keys, setPrototypeOf } = Object;
  const { isArray } = Array;
  const { isFinite } = Number;
  const startsWith = String.prototype.startsWith;
  const plain = (value, depth) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (typeof value !== "object" || depth > 4) return null;
    const out = setPrototypeOf(isArray(value) ? [] : {}, null);
    const names = keys(value);
    for (let i = 0; i < names.length; i++) {
      const v = value[names[i]];
      if (v !== undefined && typeof v !== "function") out[names[i]] = plain(v, depth + 1);
    }
    return out;
  };
  const serialize = (data) => toJSON(plain(data, 0));
  const send = (kind, data) => post(kind, serialize(data));
  const onReady = (fn) =>
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn();
  const guard = (fn) =>
    function () {
      try {
        return apply(fn, this, arguments);
      } catch (e) {}
    };
  const later = (fn, ms) => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        guard(fn)();
      }, ms);
    };
  };

  // MARK: Media — audible state (tab speaker glyph), now playing, transport controls.
  const frame = Math.random().toString(36).slice(2);
  const tracked = new WeakSet();
  let active = null;
  let lastPlaying = null;
  const audible = (m) => !m.paused && !m.ended && !m.muted && m.volume > 0 && m.readyState > 2;
  const reportAudible = () => {
    const playing = [...document.querySelectorAll("video,audio")].some(audible) || (active && audible(active)) || webAudible();
    if (playing === lastPlaying) return;
    lastPlaying = playing;
    send("media", { frame, playing });
  };

  const session = navigator.mediaSession;
  const actions = new Map();
  let positionState = null;
  const pickMedia = () => {
    const all = [...document.querySelectorAll("video,audio")];
    if (active && !all.includes(active)) all.push(active);
    return all.find((m) => !m.paused && !m.ended) || active || null;
  };
  const absolute = (src) => {
    try {
      return new URL(src, location.href).href;
    } catch {
      return null;
    }
  };
  const artworkOf = (metadata) => {
    const art = metadata && metadata.artwork;
    if (!art || !art.length) return null;
    const size = (a) => Math.max(0, ...String(a.sizes || "0x0").split(/\s+/).map((s) => parseInt(s, 10) || 0));
    return absolute([...art].sort((a, b) => size(b) - size(a))[0].src);
  };
  let lastNowPlaying = "";
  const reportNowPlaying = later(() => {
    const el = pickMedia();
    const md = session && session.metadata;
    let state = null;
    if (el || md) {
      const duration = positionState?.duration ?? el?.duration;
      const sessionState = session ? session.playbackState : "none";
      state = {
        frame,
        title: md?.title || document.title || "",
        artist: md?.artist || "",
        album: md?.album || "",
        artwork: artworkOf(md),
        playbackState: sessionState !== "none" ? sessionState : el ? (el.paused || el.ended ? "paused" : "playing") : "none",
        position: positionState?.position ?? el?.currentTime ?? 0,
        duration: Number.isFinite(duration) ? duration : null,
        playbackRate: positionState?.playbackRate ?? el?.playbackRate ?? 1,
        hasVideo: !!el && el.tagName === "VIDEO" && el.videoWidth > 0,
        actions: [...actions.keys()],
      };
      if (!state.title && !el) state = null;
    }
    const json = serialize(state && { ...state, position: Math.round(state.position) });
    if (json === lastNowPlaying) return;
    lastNowPlaying = json;
    send("nowPlaying", state && { ...state, timestamp: Date.now() });
  }, 100);
  let blockAutoplay = false;
  const onMediaEvent = (e) => {
    const m = e.target;
    if (!(m instanceof HTMLMediaElement)) return;
    if (blockAutoplay && e.type === "play" && !(navigator.userActivation && navigator.userActivation.hasBeenActive)) {
      m.pause();
      return;
    }
    if (e.type === "play" || e.type === "playing") active = m;
    reportAudible();
    if (e.type !== "volumechange") reportNowPlaying();
  };
  document.addEventListener("enterpictureinpicture", (e) => send("pip", { active: true, kind: "video" }), true);
  document.addEventListener("leavepictureinpicture", (e) => send("pip", { active: false, kind: "video" }), true);
  const mediaEvents = ["play", "playing", "pause", "ended", "volumechange", "emptied", "seeked", "ratechange", "loadedmetadata"];
  for (const e of mediaEvents) document.addEventListener(e, onMediaEvent, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!tracked.has(this) && !this.isConnected) {
      tracked.add(this);
      for (const e of mediaEvents) this.addEventListener(e, onMediaEvent);
    }
    return play.apply(this, arguments);
  };
  const QUIET_MS = 3000;
  const audioContexts = new Set();
  const taps = new WeakMap();
  const samples = new Float32Array(256);
  let webAudioUntil = 0;
  let audioPoll = 0;
  function webAudible() {
    return Date.now() < webAudioUntil;
  }
  const pollWebAudio = guard(() => {
    let running = false;
    for (const ctx of audioContexts) {
      if (ctx.state === "closed") audioContexts.delete(ctx);
      if (ctx.state !== "running") continue;
      running = true;
      taps.get(ctx).getFloatTimeDomainData(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      if (peak > 1e-4) webAudioUntil = Date.now() + QUIET_MS;
    }
    if (!running && !webAudible()) {
      clearInterval(audioPoll);
      audioPoll = 0;
    }
    reportAudible();
  });
  const pollAudio = () => audioPoll || (audioPoll = setInterval(pollWebAudio, 500));
  if (window.AudioNode && window.AudioDestinationNode && window.AudioContext) {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, output) {
      const result = connect.apply(this, arguments);
      guard(() => {
        const ctx = target instanceof AudioDestinationNode ? target.context : null;
        if (!(ctx instanceof AudioContext)) return;
        if (!taps.has(ctx)) {
          const tap = ctx.createAnalyser();
          tap.fftSize = samples.length;
          taps.set(ctx, tap);
          audioContexts.add(ctx);
          ctx.addEventListener("statechange", () => (ctx.state === "running" ? pollAudio() : pollWebAudio()));
        }
        connect.call(this, taps.get(ctx), output || 0);
        pollAudio();
      })();
      return result;
    };
  }

  const proto = session && Object.getPrototypeOf(session);
  if (proto) {
    const wrapSetter = (name) => {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.set) return;
      Object.defineProperty(proto, name, {
        ...d,
        set(value) {
          d.set.call(this, value);
          reportNowPlaying();
        },
      });
    };
    wrapSetter("metadata");
    wrapSetter("playbackState");
    const setActionHandler = proto.setActionHandler;
    proto.setActionHandler = function (action, handler) {
      if (action === "enterpictureinpicture") send("pipTrace", { event: "setActionHandler", action, set: !!handler });
      const result = setActionHandler.apply(this, arguments);
      if (handler) actions.set(action, handler);
      else actions.delete(action);
      reportNowPlaying();
      return result;
    };
    const setPositionState = proto.setPositionState;
    proto.setPositionState = function (state) {
      positionState = state || null;
      reportNowPlaying();
      return setPositionState.apply(this, arguments);
    };
  }
  handlers.media = ({ action, seconds }) => {
    const el = pickMedia();
    const call = (name, details) => {
      const h = actions.get(name);
      if (!h) return false;
      h({ action: name, ...details });
      return true;
    };
    const playing = session?.playbackState === "playing" || (el && !el.paused);
    switch (action) {
      case "play":
        call("play") || el?.play();
        break;
      case "pause":
        call("pause") || el?.pause();
        break;
      case "toggle":
        if (playing) call("pause") || el?.pause();
        else call("play") || el?.play();
        break;
      case "next":
        call("nexttrack");
        break;
      case "previous":
        call("previoustrack");
        break;
      case "seekBy": {
        const handled = seconds >= 0 ? call("seekforward", { seekOffset: seconds }) : call("seekbackward", { seekOffset: -seconds });
        if (!handled && el) el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + seconds));
        break;
      }
      case "seekTo":
        if (!call("seekto", { seekTime: seconds }) && el) el.currentTime = seconds;
        break;
      case "stop":
        call("stop") || el?.pause();
        break;
      case "enterpictureinpicture":
        call("enterpictureinpicture");
        break;
    }
    reportNowPlaying();
  };

  // MARK: Password reveal — an eye button in a focused password field the user
// Reveal only user-typed passwords; never expose saved passwords.
  const typedByUser = new WeakSet();
  let revealedField = null;
  let eyeField = null;
  let eyeHost = null;
  let eyeButton = null;
  const isPassword = (el) => el.type === "password" || el === revealedField;
  const EYE =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2.1"/></svg>';
  const EYE_SLASH =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M4.3 4.9C2.5 6.1 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-.9"/><path d="M6.6 6.6a2.1 2.1 0 0 0 2.8 2.8"/><path d="M2 2l12 12"/></svg>';
  const hasOwnToggle = (el) => {
    for (let n = el.parentElement, depth = 0; n && depth < 3 && n.querySelectorAll("input").length === 1; n = n.parentElement, depth++)
      for (const c of n.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="eye" i], [class*="toggle" i]'))
        if (c !== el && /show|hide|reveal|toggle|visib|eye|peek|afficher|mostrar|anzeigen/i.test((c.getAttribute("aria-label") || "") + " " + (c.getAttribute("title") || "") + " " + (c.getAttribute("class") || "")))
          return true;
    return false;
  };
  const placeEye = () => {
    if (!eyeHost || !eyeField) return;
    const r = eyeField.getBoundingClientRect();
    const cs = getComputedStyle(eyeField);
    const size = Math.min(24, Math.max(18, r.height - 8));
    const inset = Math.max(4, Math.min(10, parseFloat(cs.paddingRight) || 4));
    eyeHost.style.left = r.right - (parseFloat(cs.borderRightWidth) || 0) - inset - size + "px";
    eyeHost.style.top = r.top + (r.height - size) / 2 + "px";
    eyeButton.style.width = eyeButton.style.height = size + "px";
    eyeButton.style.color = cs.color;
  };
  const hideEye = () => {
    if (eyeHost) eyeHost.style.display = "none";
    eyeField = null;
  };
  const conceal = () => {
    const el = revealedField;
    if (!el) return;
    revealedField = null;
    if (el.type === "text") el.type = "password";
    if (eyeButton) eyeButton.innerHTML = EYE;
  };
  const ensureEye = () => {
    if (eyeHost && eyeHost.isConnected) return;
    eyeHost = document.createElement("netnyahoo-reveal");
    eyeHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;display:none;";
    const root = eyeHost.attachShadow({ mode: "closed" });
    root.innerHTML =
      "<style>button{all:initial;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:5px;cursor:default;opacity:.55;transition:opacity .12s,background-color .12s}" +
      "button:hover{opacity:.85;background:color-mix(in srgb,currentColor 9%,transparent)}button:active{background:color-mix(in srgb,currentColor 16%,transparent)}</style>" +
      '<button type="button" tabindex="-1"></button>';
    eyeButton = root.querySelector("button");
    eyeButton.innerHTML = EYE;
    eyeButton.addEventListener("mousedown", (e) => e.preventDefault());
    eyeButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = eyeField;
      if (!el) return;
      const [start, end] = [el.selectionStart, el.selectionEnd];
      if (revealedField === el) conceal();
      else {
        revealedField = el;
        el.type = "text";
        eyeButton.innerHTML = EYE_SLASH;
      }
      eyeButton.title = revealedField ? "Hide password" : "Show password";
      el.focus();
      try {
        el.setSelectionRange(start, end);
      } catch {}
    });
    eyeButton.title = "Show password";
    document.documentElement.appendChild(eyeHost);
  };
  const updateEye = guard(() => {
    const el = document.activeElement;
    const show = el instanceof HTMLInputElement && isPassword(el) && el.value && typedByUser.has(el) && el.getBoundingClientRect().width >= 80;
    if (!show) return hideEye();
    if (eyeField !== el && hasOwnToggle(el)) return hideEye();
    ensureEye();
    eyeField = el;
    eyeHost.style.display = "block";
    placeEye();
  });
  document.addEventListener(
    "input",
    guard((e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !isPassword(el)) return;
      if (!el.value) typedByUser.delete(el);
      else if (e.isTrusted) typedByUser.add(el);
      updateEye();
    }),
    true,
  );
  document.addEventListener("focusin", updateEye, true);
  document.addEventListener(
    "focusout",
    guard((e) => {
      setTimeout(() => {
        if (document.activeElement === e.target) return;
        if (revealedField === e.target) conceal();
        updateEye();
      }, 0);
    }),
    true,
  );
  document.addEventListener("submit", conceal, true);
  document.addEventListener("keydown", (e) => e.key === "Enter" && conceal(), true);
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest && e.target.closest('button, input[type="submit"], [role="button"]');
      if (b && eyeHost && !eyeHost.contains(b)) conceal();
    },
    true,
  );
  addEventListener("scroll", () => eyeField && requestAnimationFrame(placeEye), { passive: true, capture: true });
  addEventListener("resize", () => eyeField && requestAnimationFrame(placeEye));
  addEventListener("pagehide", conceal);

  // MARK: Notifications — shown by the app (macOS notifications that open the
// Wait a microtask so Blink installs Notification before page scripts.
  const installNotifications = () => {
    const NativeNotification = window.Notification;
    if (!NativeNotification || NativeNotification.__nn) return !!NativeNotification;
    const live = new Map();
    let seq = 0;
    const show = (title, options, fire) => {
      options = options || {};
      const id = frame + ":" + ++seq;
      const icon = options.icon ? absolute(String(options.icon)) : null;
      if (options.tag)
        for (const [otherId, n] of live)
          if (n.tag === String(options.tag)) {
            live.delete(otherId);
            n._fire("close");
          }
      send("notification", {
        id,
        title: String(title),
        body: options.body == null ? "" : String(options.body),
        icon,
        tag: options.tag == null ? "" : String(options.tag),
        silent: !!options.silent,
        requireInteraction: !!options.requireInteraction,
      });
      return id;
    };
    class PageNotification extends EventTarget {
      constructor(title, options) {
        if (!new.target) throw new TypeError("Failed to construct 'Notification': Please use the 'new' operator.");
        if (arguments.length < 1) throw new TypeError("Failed to construct 'Notification': 1 argument required, but only 0 present.");
        super();
        options = options || {};
        const fields = { title: String(title), body: String(options.body ?? ""), tag: String(options.tag ?? ""),
          icon: String(options.icon ?? ""), data: options.data ?? null, silent: !!options.silent,
          requireInteraction: !!options.requireInteraction, dir: options.dir || "auto", lang: options.lang || "" };
        for (const [k, v] of Object.entries(fields)) Object.defineProperty(this, k, { value: v, enumerable: true });
        this.onclick = this.onshow = this.onclose = this.onerror = null;
        Object.defineProperty(this, "_fire", {
          value: (type) => {
            const event = new Event(type, { cancelable: type === "click" });
            const handler = this["on" + type];
            if (typeof handler === "function") guard(handler).call(this, event);
            this.dispatchEvent(event);
            return event;
          },
        });
        if (NativeNotification.permission !== "granted") {
          setTimeout(() => this._fire("error"), 0);
          return;
        }
        const id = show(title, options);
        live.set(id, this);
        Object.defineProperty(this, "_id", { value: id });
        setTimeout(() => this._fire("show"), 0);
      }
      close() {
        if (!this._id || !live.has(this._id)) return;
        live.delete(this._id);
        send("notificationClose", { id: this._id });
        setTimeout(() => this._fire("close"), 0);
      }
      static get permission() { return NativeNotification.permission; }
      static requestPermission(callback) { return NativeNotification.requestPermission(callback); }
      static get maxActions() { return NativeNotification.maxActions || 0; }
    }
    Object.defineProperty(PageNotification, "name", { value: "Notification" });
    Object.defineProperty(PageNotification, "__nn", { value: true });
    window.Notification = PageNotification;
    const Registration = window.ServiceWorkerRegistration;
    if (Registration && Registration.prototype.showNotification) {
      Registration.prototype.showNotification = function (title, options) {
        if (NativeNotification.permission !== "granted")
          return Promise.reject(new TypeError("No notification permission has been granted for this origin."));
        show(title, options);
        return Promise.resolve();
      };
    }
    handlers.notification = ({ id, action }) => {
      const n = live.get(id);
      if (!n) return;
      if (action === "click") {
        const event = n._fire("click");
        if (!event.defaultPrevented) window.focus();
      } else {
        live.delete(id);
        n._fire("close");
      }
    };
    return true;
  };
  if (!installNotifications()) queueMicrotask(() => installNotifications() || setTimeout(installNotifications, 0));

  // MARK: Screen sharing — getDisplayMedia() through the app's source picker
  const displayRequests = new Map();
  let displaySeq = 0;
  const installDisplayMedia = () => {
    const devices = navigator.mediaDevices;
    const proto = devices && Object.getPrototypeOf(devices);
    if (!proto || !proto.getDisplayMedia || proto.getDisplayMedia.__nn) return;
    const getUserMedia = proto.getUserMedia;
    const getDisplayMedia = function getDisplayMedia(constraints) {
      const self = this;
      return new Promise((resolve, reject) => {
        const id = ++displaySeq;
        displayRequests.set(id, { self, resolve, reject, constraints: constraints || {} });
        send("displayMedia", { id, audio: !!(constraints && constraints.audio) });
      });
    };
    Object.defineProperty(getDisplayMedia, "__nn", { value: true });
    proto.getDisplayMedia = getDisplayMedia;
    handlers.displayMedia = ({ id, sourceId }) => {
      const request = displayRequests.get(id);
      if (!request) return;
      displayRequests.delete(id);
      if (!sourceId) {
        request.reject(new DOMException("Permission denied", "NotAllowedError"));
        return;
      }
      const video = request.constraints.video;
      const frameRate = (video && video.frameRate && (video.frameRate.max || video.frameRate.ideal || video.frameRate)) || 30;
      const tabAudio = !!request.constraints.audio && apply(startsWith, sourceId, ["web-contents-media-stream://"]);
      // The browser allows only the approved source, whatever reaches getUserMedia.
      apply(getUserMedia, request.self, [
        {
          audio: tabAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
          video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: +frameRate || 30 } },
        },
      ]).then(request.resolve, request.reject);
    };
  };

  // MARK: Field timing — only while the user shares diagnostics (the browser says so in config, and again whenever it
  // changes): when the page first painted content, and its first frame each time it's shown again after being hidden.
  // Times only, as epoch ms. Turned off, nothing stays installed and nothing in flight is sent.
  const PO = window.PerformanceObserver;
  const disconnect = PO && PO.prototype.disconnect;
  const { addEventListener: listen, removeEventListener: unlisten } = EventTarget.prototype;
  const raf = window.requestAnimationFrame;
  const dateNow = Date.now;
  const timeOrigin = performance.timeOrigin;
  let fieldTiming = null;
  const setFieldTiming = (on) => {
    if (!isTop || !on === !fieldTiming) return;
    if (!on) {
      fieldTiming.live = false;
      try {
        if (fieldTiming.observer) apply(disconnect, fieldTiming.observer, []);
      } catch (e) {}
      apply(unlisten, document, ["visibilitychange", fieldTiming.onVisibility]);
      fieldTiming = null;
      return;
    }
    const state = (fieldTiming = { live: true, observer: null, onVisibility: null });
    const report = (data) => state.live && send("perf", data);
    try {
      state.observer = new PO((list) => {
        for (const e of list.getEntries()) if (e.name === "first-contentful-paint") report({ fcp: timeOrigin + e.startTime });
      });
      state.observer.observe({ type: "paint", buffered: true });
    } catch (e) {}
    state.onVisibility = () => {
      if (!state.live || document.visibilityState !== "visible") return;
      apply(raf, window, [() => apply(raf, window, [() => report({ shown: apply(dateNow, Date, []) })])]);
    };
    apply(listen, document, ["visibilitychange", state.onVisibility]);
  };
  handlers.fieldTiming = (message) => setFieldTiming(!!(message && message.on));

  handlers.config = (config) => {
    blockAutoplay = !!config.blockAutoplay;
    if (config.displayMediaPicker) installDisplayMedia();
    if (config.fieldTiming) setFieldTiming(true);
  };
  send("hello", { top: isTop, url: location.href });

  const receive = (kind, json) => {
    const handler = handlers[kind];
    if (handler) guard(handler)(fromJSON(json));
  };
  if (!isTop) return receive;

  // MARK: Theme color — <meta name="theme-color">, else the colour at the top of
  const parse = (css) => {
    const m = css && css.match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
  };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const normalize = (value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    if (!probe.style.color) return null;
    document.documentElement.appendChild(probe);
    const c = parse(getComputedStyle(probe).color);
    probe.remove();
    return c && c.a > 0 ? hex(c) : null;
  };
  const metaColor = () => {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      const media = m.getAttribute("media");
      if (!media || matchMedia(media).matches) {
        const c = normalize(m.getAttribute("content") || "");
        if (c) return c;
      }
    }
    return null;
  };
  const backgroundOf = (el) => el && parse(getComputedStyle(el).backgroundColor);
  const pageBackground = () => {
    for (const el of [document.body, document.documentElement]) {
      const c = backgroundOf(el);
      if (c && c.a > 0) return c;
    }
    const dark = /dark/.test(getComputedStyle(document.documentElement).colorScheme) && matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  };
  const blend = (c, under) =>
    c.a >= 1 ? c : { r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a), a: 1 };
  const headerColor = (page) => {
    const scrolled = window.scrollY > 4;
    for (const x of [innerWidth / 2, innerWidth * 0.2, innerWidth * 0.8]) {
      let pinned = false;
      let color = null;
      for (let el = document.elementFromPoint(x, 1); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.position === "sticky") pinned = true;
        if (!color) {
          const c = parse(cs.backgroundColor);
          if (c && c.a >= 0.5) color = c;
        }
        if (color && pinned) break;
      }
      if (color && (pinned || !scrolled)) return blend(color, page);
    }
    return null;
  };
  let lastTheme;
  const reportTheme = guard(() => {
    if (!document.documentElement) return;
    let color = metaColor();
    let source = color ? "meta" : null;
    if (!color && document.body) {
      const page = pageBackground();
      const header = headerColor(page);
      color = hex(header || page);
      source = header ? "header" : "background";
    }
    const key = color + source;
    if (key === lastTheme) return;
    lastTheme = key;
    send("theme", { color, source });
  });
  let themeQueued = false;
  const scheduleTheme = () => {
    if (themeQueued) return;
    themeQueued = true;
    requestAnimationFrame(() => {
      themeQueued = false;
      reportTheme();
    });
  };
  const startTheme = () => {
    reportTheme();
    const observer = new MutationObserver(scheduleTheme);
    observer.observe(document.head || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["content", "media", "name"],
    });
    for (const el of [document.documentElement, document.body])
      if (el) observer.observe(el, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    for (const ms of [300, 1000, 3000]) setTimeout(scheduleTheme, ms);
  };
  onReady(startTheme);
  // The app forgets a document's colour when another one commits (NNCoreWebView tabDidCommitDocument:): a page back from
  // the back/forward cache, or a prerendered page shown, says again what it last said.
  const resendTheme = () => {
    lastTheme = undefined;
    reportTheme();
  };
  addEventListener("pageshow", (e) => e.persisted && resendTheme());
  document.addEventListener("prerenderingchange", resendTheme);
  addEventListener("load", scheduleTheme);
  addEventListener("scroll", scheduleTheme, { passive: true, capture: true });
  addEventListener("resize", scheduleTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleTheme);

  // MARK: Pinch zoom (visual viewport scale), for the zoom indicator.
  if (window.visualViewport) {
    let lastScale = 1;
    visualViewport.addEventListener("resize", () => {
      const scale = Math.round(visualViewport.scale * 100) / 100;
      if (scale === lastScale) return;
      lastScale = scale;
      send("pinch", { scale });
    });
  }

  // MARK: Selected text — a mouse selection of page text (not in a text field)
  let selectionShown = false;
  let selecting = false;
  const hideSelection = () => {
    if (!selectionShown) return;
    selectionShown = false;
    send("selection", null);
  };
  const editableSelection = (sel) => {
    const active = document.activeElement;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return true;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!el && el.isContentEditable;
  };
  const reportSelection = guard(() => {
    const sel = getSelection();
    const text = sel && !sel.isCollapsed && sel.rangeCount ? sel.toString().trim() : "";
    const pinched = window.visualViewport && visualViewport.scale !== 1;
    if (!text || pinched || editableSelection(sel)) return hideSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return hideSelection();
    selectionShown = true;
    send("selection", { text: text.slice(0, 2000), rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      selecting = e.button === 0;
      hideSelection();
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.button !== 0 || !selecting) return;
      selecting = false;
      setTimeout(reportSelection, 0);
    },
    true,
  );
  document.addEventListener("selectionchange", () => selectionShown && !selecting && getSelection().isCollapsed && hideSelection());
  document.addEventListener("keydown", (e) => e.metaKey || /^(Shift|Meta|Alt|Control)$/.test(e.key) || hideSelection(), true);
  addEventListener("scroll", hideSelection, { passive: true, capture: true });
  addEventListener("resize", hideSelection);
  addEventListener("pagehide", hideSelection);

  // MARK: Scroll direction, for the toolbar that tucks away while you read (tabs on top). From the page's real scroll
  // (the document, or an element scroller filling most of the window), not wheel deltas, and only while the user is
  // scrolling (wheel, keys, a press or a scrollbar drag in the last second): scroll restoration or a chat scrolling
  // itself doesn't hide the bar. "down" once a gesture has gone DOWN px down, "up" after UP px back, "top" at the top.
  // A page with under MIN_RANGE px to scroll never hides it (the bar's own height could make it unscrollable). Hiding
  // or showing the bar resizes the viewport, which can move the scroll position (the clamp at the bottom, scroll
  // anchoring): for SETTLE ms the anchor absorbs up to the viewport's change, so that move can't flip the bar back and
  // forth while a real scroll still counts. Sent on a change, and "down" again at the start of a gesture (the app
  // shows the bar on its own: tab switch, navigation, a click on the strip).
  const scrollDirection = () => {
    const DOWN = 24, UP = 12, MIN_RANGE = 120, SETTLE = 300, GESTURE = 300;
    let anchor = 0, last = 0, lastAt = -1e9, settleUntil = -1e9, budget = 0, height = 0, sent = null, gestureSent = false;
    const resized = (viewport, now) => {
      if (now >= settleUntil) budget = 0;
      if (height && viewport !== height) {
        settleUntil = now + SETTLE;
        budget += Math.abs(viewport - height) + 2;
      }
      height = viewport;
    };
    return {
      resized,
      rebase(y) {
        anchor = last = y;
      },
      scrolled(y, range, viewport, now, user) {
        resized(viewport, now);
        if (now - lastAt > GESTURE) {
          gestureSent = false;
          anchor = last;
        }
        lastAt = now;
        const moved = y - last;
        last = y;
        if (budget > 0 && moved) {
          const absorbed = Math.min(budget, Math.abs(moved));
          budget -= absorbed;
          anchor += moved > 0 ? absorbed : -absorbed;
        }
        let state = null;
        if (y <= 2) state = "top";
        else if (!user) anchor = y;
        else if (y - anchor >= DOWN) {
          if (range >= MIN_RANGE) state = "down";
          else anchor = y;
        } else if (anchor - y >= UP) state = "up";
        else if (sent === "down" ? gestureSent && y > anchor : y < anchor) anchor = y;
        if (state) anchor = y;
        if (!state || (state === sent && (state !== "down" || gestureSent))) return null;
        sent = state;
        if (state === "down") gestureSent = true;
        return state;
      },
    };
  };
  const direction = scrollDirection();
  let scroller = null;
  let scrollTarget = null;
  let inputAt = -1e9;
  const noteInput = () => {
    inputAt = performance.now();
    // The document's position before the first scroll, so a single jump (End, Space) counts.
    if (!scroller && document.scrollingElement) direction.rebase((scroller = document.scrollingElement).scrollTop);
  };
  for (const type of ["wheel", "keydown", "mousedown", "touchstart"]) addEventListener(type, noteInput, { passive: true, capture: true });
  addEventListener("mousemove", (e) => e.buttons && noteInput(), { passive: true, capture: true });
  const measureScroll = guard(() => {
    const target = scrollTarget;
    scrollTarget = null;
    const doc = document.scrollingElement || document.documentElement;
    const el = target === document || target === doc ? doc : target;
    if (!el || !doc || (el !== doc && (el.clientHeight < innerHeight * 0.5 || el.clientWidth < innerWidth * 0.5))) return;
    // Another scroller: measured from here on (its first move only tells the top).
    if (el !== scroller) direction.rebase((scroller = el).scrollTop);
    const now = performance.now();
    const state = direction.scrolled(el.scrollTop, el.scrollHeight - el.clientHeight, innerHeight, now, now - inputAt < 1000);
    if (state) send("scroll", { state });
  });
  addEventListener(
    "scroll",
    (e) => {
      if (!scrollTarget) requestAnimationFrame(measureScroll);
      scrollTarget = e.target;
    },
    { passive: true, capture: true },
  );
  addEventListener("resize", () => direction.resized(innerHeight, performance.now()));

  return receive;
})
