# KaraokeQ — Smart Karaoke Queue Manager

[![English](https://img.shields.io/badge/lang-English-blue.svg)](./README.md)
[![简体中文](https://img.shields.io/badge/lang-简体中文-red.svg)](./README.zh-CN.md)
[![日本語](https://img.shields.io/badge/lang-日本語-green.svg)](./README.ja.md)

A modern web-based karaoke song-request and queue manager that works across all your devices.

## Features

- **Display mode** — Full-screen video/audio player on your TV or projector
- **Remote control** — Any phone or tablet on the network can add, remove, and reorder songs
- **YouTube support** — Auto-plays YouTube videos with full API control and auto-advance
- **Multi-format** — Also supports Bilibili embeds, direct MP4/MP3 files, and generic iframes
- **Real-time sync** — Every connected device stays in sync instantly
- **Multi-language** — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Japanese (日本語), Korean (한국어), Spanish (Español), French (Français), German (Deutsch)
- **Volume control** — Adjustable from any remote device
- **Drag to reorder** — Drag songs in the queue to change their order
- **QR code joining** — Display shows a QR code for easy phone access

---

## Usage

### Starting a karaoke session

1. Open the site on the **display device** (TV/projector/laptop)
2. Click **Create Room** — a 6-character room code and QR code will appear
3. The display switches to full-screen player mode and shows the room code + QR code

### Adding songs (from any phone)

1. Scan the QR code on the display, or open `remote.html?room=XXXXXX`
2. Or open the site and click **Join Room**, then enter the code
3. Tap the **+** button → paste a URL → tap **Add to Queue**

**Supported URL types:**
| Type | Example |
|------|---------|
| YouTube | `https://youtube.com/watch?v=...` or `https://youtu.be/...` |
| YouTube Shorts | `https://youtube.com/shorts/...` |
| Bilibili | `https://bilibili.com/video/BVxxx` |
| Direct video | `https://example.com/song.mp4` |
| Direct audio | `https://example.com/song.mp3` |
| Generic iframe | Any other URL (limited auto-advance) |

> **⚠️ Bilibili limitations**
> Bilibili videos play inside a cross-origin iframe. Due to browser security policy:
> - The remote **pause / play** button has **no effect** on Bilibili videos — use the player controls on screen
> - Auto-skip fires approximately **3 seconds after the video ends** (estimated via the Bilibili API, not precise detection)
> - If the API cannot return a duration (network issue or av-number URLs), auto-skip will **not** trigger — use the Skip button manually

### Keyboard shortcuts (on display device)

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `→` | Skip to next song |
| `↑` / `↓` | Volume up / down |
| `Q` | Toggle queue panel |

---

## Auto-advance behavior

| Player type | Auto-advance when song ends? |
|-------------|------------------------------|
| YouTube | ✅ Yes (via YouTube IFrame API) |
| HTML5 Video/Audio | ✅ Yes (via `ended` event) |
| Bilibili / iframe | ❌ Manual skip required |

---

## Browser compatibility

- Chrome 80+ / Edge 80+
- Firefox 75+
- Safari 14+ (iOS 14+)
- The display and remote stay in sync in real time across all connected devices

---

## License

MIT
