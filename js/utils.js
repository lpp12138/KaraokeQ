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

  // Detect URL type — also accepts bare BV/AV IDs
  function detectUrlType(url) {
    if (!url) return "unknown";
    const s = url.trim();
    if (/^BV[a-zA-Z0-9]+$/i.test(s)) return "bilibili";
    if (/^av\d+$/i.test(s)) return "bilibili";
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "");
      if (["youtube.com", "youtu.be", "youtube-nocookie.com", "m.youtube.com"].includes(host)) return "youtube";
      if (["bilibili.com", "b23.tv", "m.bilibili.com"].includes(host)) return "bilibili";
      if (["nicovideo.jp", "sp.nicovideo.jp", "nico.ms"].includes(host)) return "nicovideo";
      const ext = u.pathname.split(".").pop().toLowerCase().split("?")[0];
      if (["mp3", "ogg", "wav", "flac", "aac", "m4a", "opus"].includes(ext)) return "audio";
      if (["mp4", "webm", "ogv", "mov", "m4v", "mkv"].includes(ext)) return "video";
      return "iframe";
    } catch {
      return "unknown";
    }
  }

  // Normalize a pasted URL:
  //  - Bare BV/AV ID → full bilibili.com URL
  //  - Bilibili URL   → canonical /video/BVxxx/ (strips spm and all tracking params)
  //  - YouTube URL    → canonical watch?v= (strips tracking params)
  //  - Other URLs     → strip common tracking params
  function normalizeUrl(url) {
    if (!url) return url;
    const s = url.trim();
    // Bare BV ID (e.g. "BV1xx411c7mD")
    if (/^BV[a-zA-Z0-9]+$/i.test(s)) return `https://www.bilibili.com/video/${s}/`;
    // Bare AV ID (e.g. "av170001")
    if (/^av\d+$/i.test(s)) return `https://www.bilibili.com/video/${s}/`;
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "");
      // Bilibili: rebuild canonical URL, keeping only the part number (p=) if > 1
      if (["bilibili.com", "m.bilibili.com"].includes(host)) {
        const bvid = getBilibiliId(s);
        if (bvid) {
          const p = u.searchParams.get("p");
          const query = p && p !== "1" ? `?p=${p}` : "";
          return `https://www.bilibili.com/video/${bvid}/${query}`;
        }
      }
      // NicoNico: rebuild canonical watch URL
      if (["nicovideo.jp", "sp.nicovideo.jp", "nico.ms"].includes(host)) {
        const nid = getNicovideoId(s);
        if (nid) return `https://www.nicovideo.jp/watch/${nid}`;
      }
      // YouTube: rebuild canonical watch URL
      if (["youtube.com", "youtu.be", "youtube-nocookie.com", "m.youtube.com"].includes(host)) {
        const vid = getYouTubeId(s);
        if (vid) return `https://www.youtube.com/watch?v=${vid}`;
      }
      // Other: strip known tracking params
      ["spm_id_from", "vd_source", "from_source", "share_source", "share_medium",
       "bbid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
       "unique_k"].forEach(p => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return s;
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

  // Extract NicoNico video ID (sm/nm/so + digits)
  function getNicovideoId(url) {
    const m = url.match(/(?:watch\/|nico\.ms\/)((?:sm|nm|so)\d+)/i);
    return m ? m[1] : null;
  }

  // Build NicoNico embed URL
  function getNicovideoEmbedUrl(url) {
    const id = getNicovideoId(url);
    if (!id) return null;
    return `https://embed.nicovideo.jp/watch/${id}?persistence_enabled=0&autoplay=1`;
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
  // opts: { danmaku: boolean (default false), autoplay: boolean (default true) }
  function getBilibiliEmbedUrl(url, opts = {}) {
    const id = getBilibiliId(url);
    if (!id) return null;
    const danmaku = opts.danmaku === true ? 1 : 0;
    const autoplay = opts.autoplay === false ? 0 : 1;
    const base = "https://player.bilibili.com/player.html";
    const common = `&autoplay=${autoplay}&high_quality=1&danmaku=${danmaku}`;
    if (id.startsWith("BV")) return `${base}?bvid=${id}${common}`;
    if (id.startsWith("av")) return `${base}?aid=${id.slice(2)}${common}`;
    return null;
  }

  // Get the "native" (non-embed) watch URL for a song
  function getNativeUrl(song) {
    if (!song) return null;
    if (song.type === "youtube") {
      const vid = getYouTubeId(song.url);
      return vid ? `https://www.youtube.com/watch?v=${vid}` : song.url;
    }
    if (song.type === "bilibili") {
      const id = getBilibiliId(song.url);
      return id ? `https://www.bilibili.com/video/${id}` : song.url;
    }
    if (song.type === "nicovideo") {
      const id = getNicovideoId(song.url);
      return id ? `https://www.nicovideo.jp/watch/${id}` : song.url;
    }
    return song.url;
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

  // Fetch Bilibili video title via public API
  async function fetchBilibiliTitle(bvid) {
    try {
      const res = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { referrerPolicy: "no-referrer" }
      );
      const data = await res.json();
      if (data.code === 0 && data.data?.title) return data.data.title;
    } catch {}
    return null;
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
  function saveRecentRoom(roomCode, title = "", role = "remote") {
    try {
      const key = "kq_recent_rooms";
      const rooms = JSON.parse(localStorage.getItem(key) || "[]");
      const filtered = rooms.filter(r => r.code !== roomCode);
      filtered.unshift({ code: roomCode, title, ts: Date.now(), role });
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

  // ─── Theme ────────────────────────────────────────────────────────────────

  function getEffectiveTheme() {
    const manual = document.documentElement.getAttribute("data-theme");
    if (manual === "light" || manual === "dark") return manual;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function initTheme() {
    const saved = localStorage.getItem("kq_theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    return getEffectiveTheme();
  }

  function toggleTheme() {
    const next = getEffectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("kq_theme", next);
    return next;
  }

  return {
    generateRoomCode,
    getRoomCodeFromURL,
    buildURL,
    getBaseURL,
    detectUrlType,
    normalizeUrl,
    getYouTubeId,
    getBilibiliId,
    getBilibiliEmbedUrl,
    getNicovideoId,
    getNicovideoEmbedUrl,
    getNativeUrl,
    fetchYouTubeTitle,
    fetchBilibiliTitle,
    getYouTubeThumbnail,
    uid,
    clamp,
    formatTime,
    saveRecentRoom,
    getRecentRooms,
    copyToClipboard,
    toast,
    renderQRCode,
    getEffectiveTheme,
    initTheme,
    toggleTheme
  };
})();
