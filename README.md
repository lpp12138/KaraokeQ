# KaraokeQ — Smart Karaoke Queue Manager

A modern, cross-device karaoke song-request system built for GitHub Pages.

## Features

- **Display mode** — Full-screen video/audio player on your TV or projector
- **Remote control** — Any phone or tablet on the network can add, remove, and reorder songs
- **YouTube support** — Auto-plays YouTube videos with full API control and auto-advance
- **Multi-format** — Also supports Bilibili embeds, direct MP4/MP3 files, and generic iframes
- **Real-time sync** — Firebase Realtime Database keeps all devices in sync instantly
- **Multi-language** — English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), Japanese (日本語), Korean (한국어), Spanish (Español), French (Français), German (Deutsch)
- **Volume control** — Adjustable from any remote device
- **Drag to reorder** — Drag songs in the queue to change their order
- **QR code joining** — Display shows a QR code for easy phone access
- **Zero-install** — Pure HTML/CSS/JS, hosted on GitHub Pages

---

## Setup

### 1. Fork and deploy to GitHub Pages

1. Fork this repository
2. Go to **Settings → Pages**
3. Set Source to **Deploy from a branch → main → / (root)**
4. Your site will be at `https://YOUR_USERNAME.github.io/touchOK/`

### 2. Configure Firebase (required for cross-device sync)

Without Firebase, the app runs in **Demo Mode** (same-device only via BroadcastChannel).

To enable cross-device sync:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add project** and follow the setup wizard
3. In the left menu, go to **Build → Realtime Database → Create Database**
4. Choose your region, start in **Test mode** (you can add security rules later)
5. In **Project Settings → Your apps**, click the **</>** (Web) icon and register an app
6. Copy the `firebaseConfig` object values
7. Edit **`js/config.js`** in your fork and replace the placeholder values:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  databaseURL:       "https://your-project-default-rtdb.firebaseio.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123"
};
```

8. Commit and push — GitHub Pages will redeploy automatically.

### 3. (Optional) Firebase security rules

For a private venue, restrict access by adding these rules in the Firebase Console under **Realtime Database → Rules**:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        "playlist": {
          "$itemId": {
            ".validate": "newData.hasChildren(['url','type','title','order'])"
          }
        }
      }
    }
  }
}
```

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
| Bilibili | `https://bilibili.com/video/BVxxx` |
| Direct video | `https://example.com/song.mp4` |
| Direct audio | `https://example.com/song.mp3` |
| Generic iframe | Any other URL (limited auto-advance) |

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

## Project structure

```
touchOK/
├── index.html          # Landing / room creation page
├── display.html        # Full-screen player (TV/projector)
├── remote.html         # Remote control (phone/tablet)
├── css/
│   └── style.css       # All styles (dark neon theme)
├── js/
│   ├── config.js       # Firebase config ← edit this
│   ├── i18n.js         # Internationalization module
│   ├── utils.js        # Shared utilities
│   ├── db.js           # Firebase / BroadcastChannel abstraction
│   ├── player-page.js  # Display page logic
│   └── remote-page.js  # Remote control logic
└── locales/
    ├── de.json         # German strings
    ├── en.json         # English strings
    ├── es.json         # Spanish strings
    ├── fr.json         # French strings
    ├── ja.json         # Japanese strings
    ├── ko.json         # Korean strings
    ├── zh-CN.json      # Simplified Chinese strings
    └── zh-TW.json      # Traditional Chinese strings
```

---

## Browser compatibility

- Chrome 80+ / Edge 80+
- Firefox 75+
- Safari 14+ (iOS 14+)
- BroadcastChannel requires same browser on same device (demo mode only)
- Firebase mode works across all devices on any network

---

## License

MIT
