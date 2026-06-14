# KaraokeQ - Smart Karaoke Queue Manager

A modern, cross-device karaoke song-request system built for GitHub Pages. It runs as a static site: room data stays in the display browser, and remotes sync over PeerJS/WebRTC.

## Features

- **Display mode** — Full-screen video/audio player on your TV or projector
- **Remote control** — Phones or tablets can add, remove, skip, and reorder songs
- **YouTube support** — Auto-plays YouTube videos with full API control and auto-advance
- **Bilibili support** — Accepts Bilibili URLs plus bare BV/AV IDs, with title auto-fetching for BV videos
- **Multi-format** — Also supports direct MP4/MP3 files and generic iframes
- **Real-time sync** — PeerJS/WebRTC keeps remotes synced with the display; BroadcastChannel is used as same-browser fallback
- **Multi-language** — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文)
- **URL cleanup** — Normalizes supported links and removes common tracking parameters such as `spm_id_from`
- **Volume control** — Adjustable from remote devices for YouTube, video, and audio playback
- **Drag to reorder** — Drag songs in the queue to change their order
- **QR code joining** — Display shows a QR code for easy phone access
- **Zero-install** — Pure HTML/CSS/JS, hosted on GitHub Pages with CDN-loaded helper libraries

---

## Setup

### Fork and deploy to GitHub Pages

1. Fork this repository
2. Go to **Settings → Pages**
3. Set Source to **Deploy from a branch → master (or main) → / (root)**
4. Your site will be at `https://YOUR_USERNAME.github.io/touchOK/`

No database setup is required. The display page is the source of truth, stores room state in `localStorage`, and accepts remote commands over PeerJS/WebRTC. If PeerJS is unavailable, the app falls back to BroadcastChannel for same-browser tab testing.

Optional settings such as default volume, max queue length, languages, and PeerJS room prefix live in `js/config.js`.

---

## Usage

### Starting a karaoke session

1. Open `https://YOUR_USERNAME.github.io/touchOK/` on the **display device** (TV/projector/laptop)
2. Click **Create Room** — a 6-character room code and QR code will appear
3. The display switches to full-screen player mode and shows the room code + QR code

### Adding songs (from any phone)

1. Scan the QR code on the display, or visit `https://YOUR_USERNAME.github.io/touchOK/remote.html?room=XXXXXX`
2. Or open `https://YOUR_USERNAME.github.io/touchOK/` and click **Join Room**, enter the code
3. Tap the **+** button → paste a URL → tap **Add to Queue**

**Supported URL types:**
| Type | Example |
|------|---------|
| YouTube | `https://youtube.com/watch?v=...` or `https://youtu.be/...` |
| YouTube Shorts | `https://youtube.com/shorts/...` |
| Bilibili | `https://www.bilibili.com/video/BVxxx` or `https://www.bilibili.com/video/av123` |
| Bare Bilibili ID | `BV1xx411c7mD` or `av170001` |
| Direct video | `https://example.com/song.mp4`, `.webm`, `.ogv`, `.mov`, `.m4v`, `.mkv` |
| Direct audio | `https://example.com/song.mp3`, `.ogg`, `.wav`, `.flac`, `.aac`, `.m4a`, `.opus` |
| Generic iframe | Any other URL (limited auto-advance) |

If no title is entered, KaraokeQ tries to fetch titles for YouTube and Bilibili BV links automatically.

### Playback controls

- Remote play/pause and volume control work for YouTube, direct video, and direct audio.
- Bilibili and generic iframe playback use the embedded player's own controls.
- When Bilibili or iframe content is active, the display shows a compact management bar with queue, QR, original page, and Bilibili danmaku toggle actions.
- Remote **Skip** always removes the current song and advances the queue.

### Keyboard shortcuts (on display device)

| Key | Action |
|-----|--------|
| `Q` | Toggle queue panel |
| `D` | Toggle Bilibili danmaku |

---

## Auto-advance behavior

| Player type | Auto-advance when song ends? |
|-------------|------------------------------|
| YouTube | ✅ Yes (via YouTube IFrame API) |
| HTML5 Video/Audio | ✅ Yes (via `ended` event) |
| Bilibili / iframe | ❌ Manual skip required |

---

## Project structure

```
touchOK/
├── index.html          # Landing / room creation page
├── display.html        # Full-screen player (TV/projector)
├── remote.html         # Remote control (phone/tablet)
├── css/
│   └── style.css       # All styles (dark neon theme)
├── js/
│   ├── config.js       # App settings
│   ├── i18n.js         # Internationalization module
│   ├── utils.js        # Shared URL, title, QR, and utility helpers
│   ├── db.js           # localStorage + PeerJS/BroadcastChannel sync layer
│   ├── player-page.js  # Display page logic
│   └── remote-page.js  # Remote control logic
└── locales/
    ├── en.json         # English strings
    ├── zh-CN.json      # Simplified Chinese
    └── zh-TW.json      # Traditional Chinese
```

---

## Browser compatibility

- Chrome 80+ / Edge 80+
- Firefox 75+
- Safari 14+ (iOS 14+)
- WebRTC/PeerJS is required for cross-device remote control
- BroadcastChannel fallback only syncs tabs in the same browser profile

---

## License

MIT
