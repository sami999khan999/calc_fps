// === FPS Meter: popup ===

const DEFAULT_KEYBIND = "Alt+P";
const BIND_KEY = "fps_keybind";
const SIZE_KEY = "fps_size";

const SEG_NAMES = ["a", "b", "c", "d", "e", "f", "g"];
const LETTER_SEGS = { F: "aefg", P: "abefg", S: "acdfg" };

// --- Seven-segment "FPS" logo ---

function buildLogo() {
  const container = document.getElementById("logoDigits");
  for (const letter of "FPS") {
    const digit = document.createElement("div");
    digit.className = "digit";
    const lit = LETTER_SEGS[letter];
    for (const name of SEG_NAMES) {
      const seg = document.createElement("div");
      const orient = name === "a" || name === "d" || name === "g" ? "h" : "v";
      seg.className = `seg ${orient} ${name}${lit.includes(name) ? " on" : ""}`;
      digit.appendChild(seg);
    }
    container.appendChild(digit);
  }
}

// --- Per-tab toggle switch ---

const toggleCard = document.getElementById("toggleCard");
const toggleHint = document.getElementById("toggleHint");
const switchBtn = document.getElementById("switchBtn");

let activeTabId = null;

function setSwitch(on) {
  switchBtn.setAttribute("aria-checked", on ? "true" : "false");
  toggleHint.textContent = on ? "Meter is visible on this tab" : "Meter is hidden";
}

function setUnsupported() {
  toggleCard.classList.add("disabled");
  toggleHint.textContent = "Not available on this page";
}

async function initToggle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return setUnsupported();
    activeTabId = tab.id;
    const state = await chrome.tabs.sendMessage(tab.id, { action: "FPS_STATE" });
    setSwitch(!!(state && state.visible));
  } catch (e) {
    // No content script here (chrome://, web store, PDF viewer, ...)
    setUnsupported();
  }
}

switchBtn.addEventListener("click", async () => {
  if (activeTabId == null) return;
  try {
    const state = await chrome.tabs.sendMessage(activeTabId, { action: "FPS_TOGGLE" });
    setSwitch(!!(state && state.visible));
  } catch (e) {
    setUnsupported();
  }
});

// --- Size slider ---

const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");

function renderSize(pct) {
  sizeValue.textContent = pct + "%";
  const fill = ((pct - sizeSlider.min) / (sizeSlider.max - sizeSlider.min)) * 100;
  sizeSlider.style.setProperty("--fill", fill + "%");
}

sizeSlider.addEventListener("input", () => {
  const pct = parseInt(sizeSlider.value, 10);
  renderSize(pct);
  chrome.storage.local.set({ [SIZE_KEY]: pct / 100 });
});

// Double-click the badge to reset to 100%
sizeValue.addEventListener("dblclick", () => {
  sizeSlider.value = 100;
  renderSize(100);
  chrome.storage.local.set({ [SIZE_KEY]: 1 });
});

// --- Keybind recorder (same method as YouTube Time Tracker) ---

const bindBtn = document.getElementById("bindBtn");
const bindKeys = document.getElementById("bindKeys");
const bindHint = document.getElementById("bindHint");

let currentBind = DEFAULT_KEYBIND;
let isRecording = false;

function renderBind(bindString, placeholder) {
  bindKeys.textContent = "";
  if (placeholder) {
    bindKeys.textContent = placeholder;
    return;
  }
  const parts = bindString.split("+");
  parts.forEach((part, i) => {
    if (i > 0) {
      const plus = document.createElement("span");
      plus.className = "plus";
      plus.textContent = "+";
      bindKeys.appendChild(plus);
    }
    const kbd = document.createElement("kbd");
    kbd.textContent = part;
    bindKeys.appendChild(kbd);
  });
}

function setHint(text, isError) {
  bindHint.textContent = text;
  bindHint.classList.toggle("error", !!isError);
}

function stopRecording() {
  isRecording = false;
  bindBtn.classList.remove("recording");
  renderBind(currentBind);
}

function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  return parts;
}

bindBtn.addEventListener("click", () => {
  if (isRecording) return;
  isRecording = true;
  bindBtn.classList.add("recording");
  renderBind(null, "Press keys…");
  setHint("Recording · Esc cancels", false);
});

document.addEventListener("keydown", (e) => {
  if (!isRecording) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === "Escape") {
    stopRecording();
    setHint("Click above, then press a combo · Esc cancels", false);
    return;
  }

  const mods = comboFromEvent(e);

  // Still holding only modifiers — show a live preview
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
    renderBind(null, mods.join(" + ") + " + …");
    return;
  }

  // Require a real modifier so plain typing can't toggle the meter
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    renderBind(null, "Press keys…");
    setHint("Add Ctrl, Alt or ⌘ to the combo", true);
    return;
  }

  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  currentBind = [...mods, key].join("+");
  chrome.storage.local.set({ [BIND_KEY]: currentBind });
  stopRecording();
  setHint("Saved ✓", false);
});

// --- Init ---

buildLogo();
initToggle();
chrome.storage.local.get([BIND_KEY, SIZE_KEY], (data) => {
  if (data && data[BIND_KEY]) currentBind = data[BIND_KEY];
  renderBind(currentBind);
  let pct = Math.round((data && data[SIZE_KEY] ? data[SIZE_KEY] : 1) * 100);
  pct = Math.max(60, Math.min(200, pct));
  sizeSlider.value = pct;
  renderSize(pct);
});
