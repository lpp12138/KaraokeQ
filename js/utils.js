/**
 * Shared utility functions
 */
const Utils = (() => {

  // Generate a random 6-character uppercase room code
  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/1/I to avoid confusion
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // Read ?room= or #ROOMCODE from URL
  function getRoomCodeFromURL() {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get("room");
    if (qp && qp.length >= 4) return qp.toUpperCase();
    const hash = window.location.hash.replace("#", "");
    if (hash && hash.length >= 4) return hash.toUpperCase();
    return null;
  }

  // Build page URL with room param
  function buildURL(page, roomCode) {
    const base = getBaseURL();
    return `${base}${page}?room=${roomCode}`;
  }

  function getBaseURL() {
    const { protocol, host, pathname } = window.location;
    const dir = pathname.substring(0, pathname.lastIndexOf("/") + 1);
    return `${protocol}//${host}${dir}`;
  }

  // Detect URL type
  function detectUrlType(url) {
    if (!url) return "unknown";
    try {
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^www\./, "");
      if (["youtube.com", "youtu.be", "youtube-nocookie.com", "m.youtube.com"].includes(host)) return "youtube";
      if (["bilibili.com", "b23.tv", "m.bilibili.com"].includes(host)) return "bilibili";
      const ext = u.pathname.split(".").pop().toLowerCase().split("?")[0];
      if (["mp3", "ogg", "wav", "flac", "aac", "m4a", "opus"].includes(ext)) return "audio";
      if (["mp4", "webm", "ogv", "mov", "m4v", "mkv"].includes(ext)) return "video";
      return "iframe";
    } catch {
      return "unknown";
    }
  }

  // Extract YouTube video ID from various URL formats
  function getYouTubeId(url) {
    const patterns = [
      /youtu\.be\/([^?#&/]+)/,
      /youtube\.com\/watch[?&]v=([^?#&]+)/,
      /youtube\.com\/embed\/([^?#&/]+)/,
      /youtube\.com\/shorts\/([^?#&/]+)/,
      /youtube\.com\/v\/([^?#&/]+)/
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  }

  // Extract Bilibili video ID (BVxxx or avxxx)
  function getBilibiliId(url) {
    const bv = url.match(/(?:BV|bv)([a-zA-Z0-9]+)/);
    if (bv) return "BV" + bv[1];
    const av = url.match(/av(\d+)/i);
    if (av) return "av" + av[1];
    return null;
  }

  // Build Bilibili embed URL
  function getBilibiliEmbedUrl(url) {
    const id = getBilibiliId(url);
    if (!id) return null;
    if (id.startsWith("BV")) return `https://player.bilibili.com/player.html?bvid=${id}&autoplay=1&high_quality=1`;
    if (id.startsWith("av")) return `https://player.bilibili.com/player.html?aid=${id.slice(2)}&autoplay=1&high_quality=1`;
    return null;
  }

  // Try to extract page title from a URL (YouTube oEmbed)
  async function fetchYouTubeTitle(videoId) {
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://youtu.be/${videoId}`);
      const data = await res.json();
      return data.title || null;
    } catch {
      return null;
    }
  }

  // Generate YouTube thumbnail URL
  function getYouTubeThumbnail(videoId) {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }

  // Unique ID generator
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Clamp a number between min and max
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // Format seconds → M:SS
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // Save/load recent rooms from localStorage
  function saveRecentRoom(roomCode, title = "") {
    try {
      const key = "kq_recent_rooms";
      const rooms = JSON.parse(localStorage.getItem(key) || "[]");
      const filtered = rooms.filter(r => r.code !== roomCode);
      filtered.unshift({ code: roomCode, title, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
    } catch {}
  }

  function getRecentRooms() {
    try {
      return JSON.parse(localStorage.getItem("kq_recent_rooms") || "[]");
    } catch {
      return [];
    }
  }

  // Copy text to clipboard, with fallback
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }
  }

  // Show a brief toast notification
  function toast(message, type = "info", duration = 3000) {
    const container = document.getElementById("toast-container") || createToastContainer();
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--show"));
    setTimeout(() => {
      el.classList.remove("toast--show");
      el.addEventListener("transitionend", () => el.remove(), { once: true });
    }, duration);
  }

  function createToastContainer() {
    const div = document.createElement("div");
    div.id = "toast-container";
    document.body.appendChild(div);
    return div;
  }

  // Generate QR code SVG using qrcode.js (loaded externally)
  function renderQRCode(containerId, text) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    if (typeof QRCode === "undefined") {
      container.textContent = text;
      return;
    }
    new QRCode(container, {
      text,
      width: 200,
      height: 200,
      colorDark: "#1A1A2E",
      colorLight: "#FFFFFF",
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  return {
    generateRoomCode,
    getRoomCodeFromURL,
    buildURL,
    getBaseURL,
    detectUrlType,
    getYouTubeId,
    getBilibiliId,
    getBilibiliEmbedUrl,
    fetchYouTubeTitle,
    getYouTubeThumbnail,
    uid,
    clamp,
    formatTime,
    saveRecentRoom,
    getRecentRooms,
    copyToClipboard,
    toast,
    renderQRCode
  };
})();
