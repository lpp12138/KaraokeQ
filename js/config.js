/**
 * App Settings
 * No external database required — data lives in the browser (localStorage).
 * Cross-device sync uses WebRTC P2P via PeerJS (free broker, no data stored).
 */
const APP_SETTINGS = {
  // Auto-advance to next song when current one ends (YouTube & HTML5 media only)
  autoAdvance: true,

  // Default volume (0–100)
  defaultVolume: 80,

  // Max songs in queue per room
  maxQueueLength: 50,

  // Supported languages
  languages: ["zh-CN", "zh-TW", "en"],

  // Default language (falls back to browser language)
  defaultLanguage: "zh-CN",

  // PeerJS peer ID prefix
  peerPrefix: "kq-"
};
