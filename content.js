// === FPS Meter: content script ===
// Dormant by default — no DOM nodes, no rAF loop until the meter is toggled on.
// The only idle cost is one keydown listener and a single storage read.

(() => {
  "use strict";

  if (window.top !== window) return; // top frame only

  const ext = typeof chrome !== "undefined" && chrome.runtime ? chrome : browser;

  const DEFAULT_KEYBIND = "Alt+P";
  const BIND_KEY = "fps_keybind";
  const POS_KEY = "fps_pos";
  const SIZE_KEY = "fps_size";
  const SESSION_KEY = "__fps_meter_on";
  const PADDING = 10;
  const SCROLLBAR_PADDING = 18;
  const SPRING = "left 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28), top 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)";

  let keybind = DEFAULT_KEYBIND;
  let sizeScale = 1;
  let visible = false;
  let host = null;
  let meterEl = null;
  let digitEls = []; // [{a: el, b: el, ...}, ...] one map per digit
  let rafId = null;
  let frames = 0;
  let windowStart = 0;
  let lastShown = null;

  function clampSize(v) {
    const n = parseFloat(v);
    return isFinite(n) ? Math.max(0.1, Math.min(2.5, n)) : 1;
  }

  ext.storage.local.get([BIND_KEY, SIZE_KEY], (data) => {
    if (data && data[BIND_KEY]) keybind = data[BIND_KEY];
    if (data && data[SIZE_KEY] != null) {
      sizeScale = clampSize(data[SIZE_KEY]);
      if (meterEl) applySize(); // meter may already be up via session restore
    }
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[BIND_KEY]) keybind = changes[BIND_KEY].newValue || DEFAULT_KEYBIND;
    if (changes[SIZE_KEY]) {
      sizeScale = clampSize(changes[SIZE_KEY].newValue);
      applySize();
    }
    // Keep position in sync if it was moved in another tab while visible here
    if (changes[POS_KEY] && visible && host) applyPosition(changes[POS_KEY].newValue);
  });

  // --- Keybind matching (same method as YouTube Time Tracker) ---

  function parseKeybind(bindString) {
    const parts = bindString.split("+");
    return {
      key: parts[parts.length - 1].toLowerCase(),
      alt: parts.includes("Alt"),
      shift: parts.includes("Shift"),
      ctrl: parts.includes("Ctrl") || parts.includes("Control"),
      meta: parts.includes("Meta") || parts.includes("Command"),
    };
  }

  function matchesKeybind(e, bindString) {
    if (!bindString) return false;
    const bind = parseKeybind(bindString);
    if (e.key.toLowerCase() !== bind.key) return false;
    if (e.altKey !== bind.alt) return false;
    if (e.shiftKey !== bind.shift) return false;
    if (e.ctrlKey !== bind.ctrl) return false;
    if (e.metaKey !== bind.meta) return false;
    return true;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || (t && t.isContentEditable)) return;
      if (matchesKeybind(e, keybind)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      }
    },
    true,
  );

  // --- Popup messaging ---

  ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "FPS_TOGGLE") {
      toggle();
      sendResponse({ visible });
    } else if (request.action === "FPS_STATE") {
      sendResponse({ visible });
    }
  });

  // --- Seven-segment display (Minimal, background-free) ---

  const SEG_NAMES = ["a", "b", "c", "d", "e", "f", "g"];
  const DIGIT_SEGS = {
    "0": "abcdef",
    "1": "bc",
    "2": "abdeg",
    "3": "abcdg",
    "4": "bcfg",
    "5": "acdfg",
    "6": "acdefg",
    "7": "abc",
    "8": "abcdefg",
    "9": "abcdfg",
    " ": "",
  };

  const STYLE = `
    * { box-sizing: border-box; }
    .meter {
      display: inline-flex;
      padding: 0;
      background: transparent;
      box-shadow: none;
      border: none;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    .meter.dragging {
      transform: scale(1.1);
      opacity: 0.85;
    }
    .digits {
      display: flex;
      gap: 3px;
      transform: skewX(-4deg);
    }
    .digit {
      position: relative;
      width: 14px;
      height: 24px;
    }
    .seg {
      position: absolute;
      background: #4ade80;
      opacity: 0.08;
      transition: opacity 0.06s linear;
    }
    .seg.on {
      opacity: 1;
      filter: drop-shadow(0 0 2px rgba(74, 222, 128, 0.7));
    }
    .seg.h {
      left: 2px;
      width: 10px;
      height: 3px;
      clip-path: polygon(15% 0, 85% 0, 100% 50%, 85% 100%, 15% 100%, 0 50%);
    }
    .seg.v {
      width: 3px;
      height: 9px;
      clip-path: polygon(0 15%, 50% 0, 100% 15%, 100% 85%, 50% 100%, 0 85%);
    }
    .seg.a { top: 0; }
    .seg.g { top: 10.5px; }
    .seg.d { bottom: 0; }
    .seg.f { left: 0; top: 1.8px; }
    .seg.b { right: 0; top: 1.8px; }
    .seg.e { left: 0; bottom: 1.8px; }
    .seg.c { right: 0; bottom: 1.8px; }
  `;

  function buildMeter() {
    host = document.createElement("div");
    host.setAttribute("data-fps-meter", "");
    Object.assign(host.style, {
      position: "fixed",
      top: "20px",
      left: "0px",
      zIndex: "2147483647",
      cursor: "grab",
      userSelect: "none",
      visibility: "hidden",
      transition: SPRING,
    });

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    meterEl = document.createElement("div");
    meterEl.className = "meter";
    meterEl.style.zoom = sizeScale;

    const digits = document.createElement("div");
    digits.className = "digits";

    digitEls = [];
    for (let i = 0; i < 3; i++) {
      const digit = document.createElement("div");
      digit.className = "digit";
      const segMap = {};
      for (const name of SEG_NAMES) {
        const seg = document.createElement("div");
        const orient = name === "a" || name === "d" || name === "g" ? "h" : "v";
        seg.className = `seg ${orient} ${name}`;
        digit.appendChild(seg);
        segMap[name] = seg;
      }
      digits.appendChild(digit);
      digitEls.push(segMap);
    }

    meterEl.appendChild(digits);
    shadow.appendChild(meterEl);

    setupDrag();
  }

  function renderText(text3) {
    if (text3 === lastShown) return;
    lastShown = text3;
    for (let i = 0; i < 3; i++) {
      const segs = DIGIT_SEGS[text3[i]] || "";
      const map = digitEls[i];
      if (!map) continue;
      for (const name of SEG_NAMES) {
        map[name].classList.toggle("on", segs.includes(name));
      }
    }
  }

  function render(fps) {
    if (!isFinite(fps)) return;
    const n = Math.round(Math.max(0, Math.min(999, fps)));
    renderText(String(n).padStart(3, " "));
  }

  // Applies the current size scale and re-anchors the meter to its snapped
  // edge (instantly — no spring while the slider is being dragged)
  function applySize() {
    if (!meterEl) return;
    meterEl.style.zoom = sizeScale;
    if (!visible || !host) return;
    ext.storage.local.get(POS_KEY, (data) => {
      if (!visible || !host) return;
      host.style.transition = "none";
      applyPosition(data && data[POS_KEY]);
      host.offsetWidth; // flush layout so the re-anchor isn't animated
      host.style.transition = SPRING;
    });
  }

  // --- Position (stored, shared across tabs; snaps to left/right edge) ---

  function applyPosition(savedPos) {
    const w = host.offsetWidth || 110;
    const h = host.offsetHeight || 55;

    let top = savedPos ? parseInt(savedPos.top, 10) : NaN;
    if (isNaN(top)) top = 20;
    const maxTop = window.innerHeight - h - PADDING;
    top = Math.max(PADDING, Math.min(maxTop, top));

    const snapped = savedPos && savedPos.snapped === "left" ? "left" : "right";
    const left = snapped === "left" ? PADDING : window.innerWidth - w - SCROLLBAR_PADDING;

    host.style.top = top + "px";
    host.style.left = left + "px";
  }

  // --- Drag (same feel as the YTT sidebar toggle button) ---

  function setupDrag() {
    host.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = host.getBoundingClientRect();
      const hostStartX = rect.left;
      const hostStartY = rect.top;
      let dragging = false;

      const onMouseMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (!dragging && Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;

        if (!dragging) {
          dragging = true;
          host.style.transition = "none";
          host.style.cursor = "grabbing";
          meterEl.classList.add("dragging");
        }

        let newLeft = hostStartX + dx;
        let newTop = hostStartY + dy;
        newLeft = Math.max(PADDING, Math.min(window.innerWidth - host.offsetWidth - PADDING, newLeft));
        newTop = Math.max(PADDING, Math.min(window.innerHeight - host.offsetHeight - PADDING, newTop));
        host.style.left = newLeft + "px";
        host.style.top = newTop + "px";
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        if (!dragging) return;

        meterEl.classList.remove("dragging");
        host.style.cursor = "grab";
        host.style.transition = SPRING;

        // Springy edge snapping — the transition animates `left`
        const r = host.getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        let snapped;
        if (centerX < window.innerWidth / 2) {
          host.style.left = PADDING + "px";
          snapped = "left";
        } else {
          host.style.left = window.innerWidth - r.width - SCROLLBAR_PADDING + "px";
          snapped = "right";
        }

        ext.storage.local.set({
          [POS_KEY]: { top: parseInt(host.style.top, 10), snapped },
        });
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    if (!visible || !host) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      ext.storage.local.get(POS_KEY, (data) => {
        if (visible && host) applyPosition(data && data[POS_KEY]);
      });
    }, 150);
  });

  // --- FPS loop (only runs while the meter is visible) ---

  function loop(now) {
    frames++;
    const elapsed = now - windowStart;
    if (elapsed >= 400) {
      render(Math.round((frames * 1000) / elapsed));
      frames = 0;
      windowStart = now;
    }
    rafId = requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    // rAF pauses in background tabs; reset the window so we don't show a bogus dip
    if (!visible) return;
    frames = 0;
    windowStart = performance.now();
  });

  // --- Show / hide / toggle ---

  function show() {
    if (visible) return;
    visible = true;

    if (!host) buildMeter();
    lastShown = null;
    renderText("--"); // placeholder until the first measurement
    (document.body || document.documentElement).appendChild(host);

    // Apply saved position before revealing, with the spring transition
    // disabled so the meter doesn't animate/fly in from the default spot
    ext.storage.local.get(POS_KEY, (data) => {
      if (!visible || !host) return;
      host.style.transition = "none";
      applyPosition(data && data[POS_KEY]);
      host.offsetWidth; // flush layout so the jump isn't animated
      host.style.transition = SPRING;
      host.style.visibility = "visible";
    });

    frames = 0;
    windowStart = performance.now();
    rafId = requestAnimationFrame(loop);

    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch (e) {}
  }

  function hide() {
    if (!visible) return;
    visible = false;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (host) host.style.visibility = "hidden";

    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function toggle() {
    visible ? hide() : show();
  }

  // Restore per-tab state across navigations (sessionStorage is per-tab,
  // so turning it on in one tab never affects the others)
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") show();
  } catch (e) {}
})();
