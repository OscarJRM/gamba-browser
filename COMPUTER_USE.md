# Computer Use Engine (macOS Native)

## Overview
High-speed Computer Use engine matching the speed and fluidity of **OpenBot** (`openbot.run`). 
It bypasses DOM timeouts and obfuscated React component hierarchies by directly capturing screen states and dispatching native macOS mouse and keyboard events.

## Architecture

```
+--------------------------------------------------------------------+
|                         Agent / Antigravity                         |
+--------------------------------------------------------------------+
                                  |
                                  v
                  src/computer_use.js (Unified SDK)
                                  |
            +---------------------+---------------------+
            |                                           |
            v                                           v
    cua-driver (Rust)                           cliclick (CLI)
(Cua AI / OpenBot Daemon Engine)           (Ultra-fast Local Dispatch)
- get_desktop_state (Retina Capture)       - c:x,y (Left Click)
- get_window_state (AX Tree + Window Img)  - rc:x,y (Right Click)
- Background AX clicks (element_token)     - m:x,y (Cursor Movement)
- Tahoe / Sequoia Screen Recording TCC     - t:"text" (Native typing)
```

## Quick Start

```javascript
const cu = require('./src/computer_use');

// 1. Capture Full Desktop Screen (Retina resolution)
const screen = await cu.captureDesktop({ outputPath: '/tmp/screen.png' });
console.log('Screen size:', screen.width, 'x', screen.height);

// 2. Move & Click
cu.moveCursor(500, 300);
cu.click({ x: 500, y: 300 });

// 3. Type text & press Return
cu.typeText('Hola desde Computer Use');
cu.pressKey('return');

// 4. Inspect open windows & AX hierarchy
const windows = cu.listWindows();
console.log('Open windows:', windows.windows.map(w => w.app_name));
```

## Benchmarks & Latency

| Action | Playwright (DOM) | Computer Use (Native) | Speedup |
|---|---|---|---|
| Screen Capture | 450ms - 1200ms | 80ms - 120ms | ~**5x - 10x faster** |
| Mouse Click | 200ms - 30,000ms (timeout) | 5ms - 15ms | **Instantaneous** |
| Native OS Dialogs | Blocked / Unsupported | Fully Supported | 100% Coverage |
