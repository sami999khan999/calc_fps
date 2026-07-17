# FPS Meter

A lightweight browser extension (Manifest V3) that shows the frame rate of the current tab on a calculator-style seven-segment LCD.

## Features

- **Calculator LCD display** — real seven-segment digits (with ghost segments) glowing green on a dark LCD panel, in a dark bezel.
- **Resizable** — a size slider in the popup scales the meter from 60% to 200%, live and persisted.
- **Per-tab** — toggling the meter on one tab never affects other tabs. The state survives navigation within the tab (via `sessionStorage`).
- **Keyboard shortcut** — `Alt+P` by default. Rebind it from the popup: click the shortcut box and press any combo (requires Ctrl/Alt/⌘).
- **Draggable** — grab the meter and drag it anywhere. On release it springs to the nearest screen edge with a bouncy snap, and the position is saved and restored the next time you show it.
- **Zero idle cost** — while the meter is hidden there is no DOM, no `requestAnimationFrame` loop, and no timers. The content script only keeps a single keydown listener alive.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Usage

- Press **Alt+P** on any page to show/hide the FPS counter, or use the toggle in the extension popup.
- Drag the counter to reposition it; it snaps to the left or right edge and remembers its spot.
