/**
 * Display / Player page logic
 */
const PlayerPage = (() => {

  // ─── State ───────────────────────────────────────────────────────────────────
  let _playlist = [];
  let _state = {};
  let _currentSong = null;
  let _currentType = null;
  let _ytPlayer = null;
  let _ytReady = false;
  let _ytPendingLoad = null;
  let _controlsTimeout = null;
  let _danmakuEnabled = true;
  let _panelOpen = false;

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async function init() {
    const roomCode = Utils.getRoomCodeFromURL();
    if (!roomCode) { window.location.href = "index.html"; return; }

    _bindControls();

    document.getElementById("room-code").textContent = roomCode;
    document.getElementById("room-code-overlay").textContent = roomCode;
    const remoteUrl = Utils.buildURL("remote.html", roomCode);
    Utils.renderQRCode("qr-code", remoteUrl);
    document.getElementById("remote-url").textContent = remoteUrl;
    document.getElementById("remote-url").href = remoteUrl;

    await I18n.init();
    _showScreen("idle");

    await DB.init(roomCode, "display");
    if (DB.mode === "broadcast") {
      const ind = document.getElementById("mode-indicator");
      if (ind) { ind.textContent = "⚡ 单机模式"; ind.title = "PeerJS 不可用，仅同浏览器标签同步"; }
    }

    Utils.saveRecentRoom(roomCode);
    DB.onPlaylistChange(_onPlaylistChange);
    DB.onStateChange(_onStateChange);

    _loadYouTubeAPI();

    document.addEventListener("mousemove", _showFab);
    document.addEventListener("touchstart", _showFab, { passive: true });
    document.addEventListener("keydown", _onKeyDown);

    // Enter fullscreen on first user interaction (browsers require a gesture)
    const _onFirstGesture = () => {
      _enterFullscreen();
      const hint = document.getElementById("fullscreen-hint");
      if (hint) hint.hidden = true;
      document.removeEventListener("click", _onFirstGesture);
      document.removeEventListener("touchstart", _onFirstGesture);
      document.removeEventListener("keydown", _onFirstGesture);
    };
    document.addEventListener("click", _onFirstGesture);
    document.addEventListener("touchstart", _onFirstGesture, { passive: true });
    document.addEventListener("keydown", _onFirstGesture);
    // Close panel on click outside
    document.addEventListener("click", e => {
      if (!_panelOpen) return;
      const fab = document.getElementById("fab-ctrl");
      const panel = document.getElementById("ctrl-panel");
      if (!fab?.contains(e.target) && !panel?.contains(e.target)) _closePanel();
    });
  }

  // ─── Screen management ────────────────────────────────────────────────────────

  function _showScreen(name) {
    ["idle", "player"].forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.hidden = (s !== name);
    });
    if (name === "idle") _cleanupCurrentPlayer();
    if (name === "player") _enterFullscreen();
  }

  function _enterFullscreen() {
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.() ?? Promise.resolve())
      .catch(() => {});
  }

  // ─── Player cleanup ───────────────────────────────────────────────────────────

  function _cleanupCurrentPlayer() {
    if (_ytPlayer) {
      try { _ytPlayer.stopVideo(); } catch {}
      try { _ytPlayer.destroy(); } catch {}
      _ytPlayer = null;
    }
    const ytContainer = document.getElementById("yt-container");
    if (ytContainer) { ytContainer.innerHTML = ""; ytContainer.hidden = true; }

    const vid = document.getElementById("player-video");
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); vid.hidden = true; }

    const aud = document.getElementById("player-audio");
    if (aud) { aud.pause(); aud.removeAttribute("src"); aud.load(); aud.hidden = true; }
    const audioBg = document.getElementById("audio-bg");
    if (audioBg) audioBg.hidden = true;

    _recreateIframe();

    _currentType = null;
    _updateControlsForType(null);
  }

  function _recreateIframe() {
    const old = document.getElementById("player-iframe");
    if (!old) return;
    const parent = old.parentNode;
    const fresh = document.createElement("iframe");
    fresh.id = "player-iframe";
    fresh.className = "sub-player";
    fresh.setAttribute("allow", "autoplay; fullscreen; accelerometer; gyroscope");
    fresh.setAttribute("allowfullscreen", "");
    fresh.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
    fresh.hidden = true;
    parent.replaceChild(fresh, old);
  }

  // ─── YouTube IFrame API ───────────────────────────────────────────────────────

  function _loadYouTubeAPI() {
    window.onYouTubeIframeAPIReady = () => {
      _ytReady = true;
      if (_ytPendingLoad) { _loadYouTube(_ytPendingLoad); _ytPendingLoad = null; }
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  function _loadYouTube(videoId) {
    if (!_ytReady) { _ytPendingLoad = videoId; return; }
    const container = document.getElementById("yt-container");
    if (!container) return;
    container.innerHTML = '<div id="yt-player"></div>';
    container.hidden = false;

    _ytPlayer = new YT.Player("yt-player", {
      videoId,
      playerVars: {
        autoplay: 1, controls: 1, disablekb: 0,
        fs: 1, iv_load_policy: 3, modestbranding: 1, rel: 0, playsinline: 1
      },
      events: {
        onReady: e => {
          e.target.setVolume(_state.volume ?? APP_SETTINGS.defaultVolume);
          e.target.playVideo();
          DB.setState({ playerState: "playing" });
        },
        onStateChange: e => {
          if (e.data === YT.PlayerState.ENDED) _onSongEnded();
          if (e.data === YT.PlayerState.PLAYING) DB.setState({ playerState: "playing" });
        },
        onError: () => {
          Utils.toast("视频加载失败，跳过", "error");
          setTimeout(_onSongEnded, 2000);
        }
      }
    });
  }

  // ─── Song loading ─────────────────────────────────────────────────────────────

  function _loadSong(song) {
    if (!song) { _showScreen("idle"); return; }

    _cleanupCurrentPlayer();

    _currentSong = song;
    _showScreen("player");
    _updateNowPlaying(song);
    _updateUpNext();

    const type = song.type || Utils.detectUrlType(song.url);
    _currentType = type;
    _updateControlsForType(type);

    if (type === "youtube") {
      const vid = Utils.getYouTubeId(song.url);
      if (!vid) { _handleInvalidSong(); return; }
      _loadYouTube(vid);

    } else if (type === "video") {
      const el = document.getElementById("player-video");
      el.hidden = false;
      el.src = song.url;
      el.volume = (_state.volume ?? APP_SETTINGS.defaultVolume) / 100;
      el.play().catch(() => {});
      el.onended = _onSongEnded;

    } else if (type === "audio") {
      const aud = document.getElementById("player-audio");
      const bg  = document.getElementById("audio-bg");
      aud.hidden = false;
      if (bg) {
        bg.hidden = false;
        const t = document.getElementById("audio-title");
        if (t) t.textContent = song.title || song.url;
      }
      aud.src = song.url;
      aud.volume = (_state.volume ?? APP_SETTINGS.defaultVolume) / 100;
      aud.play().catch(() => {});
      aud.onended = _onSongEnded;

    } else if (type === "bilibili") {
      const embedUrl = Utils.getBilibiliEmbedUrl(song.url, { danmaku: _danmakuEnabled });
      if (!embedUrl) { _handleInvalidSong(); return; }
      const frame = document.getElementById("player-iframe");
      frame.hidden = false;
      frame.src = embedUrl;

    } else {
      const frame = document.getElementById("player-iframe");
      frame.hidden = false;
      frame.src = song.url;
    }

    DB.setState({ playerState: "playing" });
  }

  // ─── Controls per content type ────────────────────────────────────────────────
  // Bilibili: show danmaku + native-window buttons in panel.
  // All types: FAB is shown when a song is loaded.

  function _updateControlsForType(type) {
    const isBilibili = type === "bilibili";

    const danmakuBtn = document.getElementById("btn-danmaku");
    if (danmakuBtn) {
      danmakuBtn.hidden = !isBilibili;
      danmakuBtn.textContent = _danmakuEnabled ? "弹幕 ON" : "弹幕 OFF";
    }
    const nativeBtn = document.getElementById("btn-native");
    if (nativeBtn) nativeBtn.hidden = !type || type === "youtube" || type === "video" || type === "audio";
  }

  // ─── Playback ─────────────────────────────────────────────────────────────────

  function _onSongEnded() {
    if (!_currentSong) return;
    DB.removeSong(_currentSong.id).catch(() => {});
    _currentSong = null;
  }

  function _setVolumeAll(vol) {
    if (_ytPlayer?.setVolume) _ytPlayer.setVolume(vol);
    const vid = document.getElementById("player-video");
    if (vid) vid.volume = vol / 100;
    const aud = document.getElementById("player-audio");
    if (aud) aud.volume = vol / 100;
  }

  function _pauseAll() {
    if (_ytPlayer?.pauseVideo) _ytPlayer.pauseVideo();
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.pause();
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.pause();
  }

  function _playAll() {
    if (_ytPlayer?.playVideo) _ytPlayer.playVideo();
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.play().catch(() => {});
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.play().catch(() => {});
  }

  // ─── DB handlers ──────────────────────────────────────────────────────────────

  function _onPlaylistChange(songs) {
    _playlist = songs;
    _updateQueueList();

    const first = songs[0] || null;
    if (!first) { _currentSong = null; _showScreen("idle"); return; }
    if (!_currentSong || _currentSong.id !== first.id) _loadSong(first);
    _updateUpNext();
  }

  function _onStateChange(state) {
    const prev = _state;
    _state = state;

    if (state.volume !== undefined && state.volume !== prev.volume) {
      if (_currentType !== "bilibili" && _currentType !== "iframe") {
        _setVolumeAll(state.volume);
      }
    }

    if (state.playerState && state.playerState !== prev.playerState) {
      if (_currentType !== "bilibili" && _currentType !== "iframe") {
        if (state.playerState === "paused") _pauseAll();
        else if (state.playerState === "playing") _playAll();
      }
    }
  }

  // ─── UI updates ───────────────────────────────────────────────────────────────

  function _updateNowPlaying(song) {
    const section = document.getElementById("ctrl-nowplaying");
    const t = document.getElementById("now-playing-title");
    const b = document.getElementById("now-playing-by");
    if (t) t.textContent = song.title || song.url;
    if (b) b.textContent = song.addedBy ? `${I18n.t("display.by")} ${song.addedBy}` : "";
    if (section) section.hidden = false;
  }

  function _updateUpNext() {
    const next = _playlist[1];
    const el = document.getElementById("up-next-title");
    if (el) el.textContent = next ? (next.title || next.url) : "";
    const sec = document.getElementById("up-next-section");
    if (sec) sec.hidden = !next;
  }

  function _updateQueueList() {
    // Update FAB badge (show count when panel closed, "×" when open)
    if (!_panelOpen) {
      const fabCount = document.getElementById("fab-queue-count");
      if (fabCount) fabCount.textContent = _playlist.length;
    }
    const panelCount = document.getElementById("queue-count");
    if (panelCount) panelCount.textContent = _playlist.length;
    const panelBadge = document.getElementById("queue-count-panel");
    if (panelBadge) panelBadge.textContent = _playlist.length;

    const list = document.getElementById("queue-list");
    if (!list) return;
    list.innerHTML = "";
    _playlist.forEach((song, i) => {
      const li = document.createElement("li");
      li.className = "queue-item" + (i === 0 ? " queue-item--current" : "");
      li.innerHTML = `
        <span class="queue-num">${i === 0 ? "▶" : i}</span>
        <span class="queue-title">${_esc(song.title || song.url)}</span>
        ${song.addedBy ? `<span class="queue-by">${_esc(song.addedBy)}</span>` : ""}
      `;
      list.appendChild(li);
    });
  }

  // ─── FAB + Panel ──────────────────────────────────────────────────────────────

  function _showFab() {
    const fab = document.getElementById("fab-ctrl");
    if (!fab) return;
    fab.classList.remove("fab--hidden");
    clearTimeout(_controlsTimeout);
    if (!_panelOpen) {
      _controlsTimeout = setTimeout(() => {
        if (!_panelOpen) fab.classList.add("fab--hidden");
      }, 4000);
    }
  }

  function _togglePanel() {
    _panelOpen ? _closePanel() : _openPanel();
  }

  function _openPanel() {
    _panelOpen = true;
    const fab = document.getElementById("fab-ctrl");
    const panel = document.getElementById("ctrl-panel");
    const fabCount = document.getElementById("fab-queue-count");
    clearTimeout(_controlsTimeout);
    if (fab) { fab.classList.remove("fab--hidden"); fab.setAttribute("aria-expanded", "true"); }
    if (fabCount) fabCount.textContent = "×";
    if (panel) panel.classList.add("panel--open");
  }

  function _closePanel() {
    _panelOpen = false;
    const fab = document.getElementById("fab-ctrl");
    const panel = document.getElementById("ctrl-panel");
    const fabCount = document.getElementById("fab-queue-count");
    if (fab) fab.setAttribute("aria-expanded", "false");
    if (fabCount) fabCount.textContent = _playlist.length;
    if (panel) panel.classList.remove("panel--open");
    clearTimeout(_controlsTimeout);
    _controlsTimeout = setTimeout(() => {
      if (!_panelOpen) {
        const f = document.getElementById("fab-ctrl");
        if (f) f.classList.add("fab--hidden");
      }
    }, 4000);
  }

  // ─── Draggable FAB ────────────────────────────────────────────────────────────

  function _makeFabDraggable() {
    const fab = document.getElementById("fab-ctrl");
    if (!fab) return;

    // Restore saved position
    const saved = localStorage.getItem("kq_fab_pos");
    if (saved) {
      try {
        const { left, top } = JSON.parse(saved);
        fab.style.right = "auto";
        fab.style.bottom = "auto";
        fab.style.left = left;
        fab.style.top = top;
      } catch {}
    }

    let startX, startY, startLeft, startTop, didDrag;

    fab.addEventListener("pointerdown", e => {
      e.preventDefault();
      fab.setPointerCapture(e.pointerId);
      const rect = fab.getBoundingClientRect();
      // Switch from right/bottom to left/top on first drag
      if (fab.style.left === "") {
        fab.style.right = "auto";
        fab.style.bottom = "auto";
        fab.style.left = rect.left + "px";
        fab.style.top = rect.top + "px";
      }
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseFloat(fab.style.left) || rect.left;
      startTop = parseFloat(fab.style.top) || rect.top;
      didDrag = false;
      fab.style.transition = "none";
    });

    fab.addEventListener("pointermove", e => {
      if (e.buttons === 0) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!didDrag && Math.hypot(dx, dy) < 6) return;
      didDrag = true;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const fw = fab.offsetWidth;
      const fh = fab.offsetHeight;
      const newLeft = Math.max(0, Math.min(W - fw, startLeft + dx));
      const newTop  = Math.max(0, Math.min(H - fh, startTop + dy));
      fab.style.left = newLeft + "px";
      fab.style.top  = newTop + "px";
    });

    fab.addEventListener("pointerup", e => {
      fab.style.transition = "";
      if (didDrag) {
        // Snap to nearest horizontal edge
        const W = window.innerWidth;
        const fw = fab.offsetWidth;
        const cur = parseFloat(fab.style.left);
        const snapped = cur + fw / 2 < W / 2 ? 12 : W - fw - 12;
        fab.style.left = snapped + "px";
        localStorage.setItem("kq_fab_pos", JSON.stringify({
          left: fab.style.left,
          top: fab.style.top
        }));
        // Suppress click that fires after pointerup
        fab.addEventListener("click", e => e.stopImmediatePropagation(), { once: true, capture: true });
      }
    });
  }

  // ─── Controls binding ─────────────────────────────────────────────────────────

  function _bindControls() {
    document.getElementById("fab-ctrl")?.addEventListener("click", _togglePanel);
    _makeFabDraggable();
    document.getElementById("btn-queue")?.addEventListener("click", _toggleQueuePanel);
    document.getElementById("btn-qr")?.addEventListener("click", _toggleQrPanel);
    document.getElementById("btn-danmaku")?.addEventListener("click", _toggleDanmaku);
    document.getElementById("btn-native")?.addEventListener("click", _openNativeWindow);
  }

  function _toggleQueuePanel() {
    const p = document.getElementById("queue-panel");
    if (p) p.hidden = !p.hidden;
  }

  function _toggleQrPanel() {
    const p = document.getElementById("qr-panel");
    if (!p) return;
    const qrEl = document.getElementById("qr-code-player");
    if (qrEl && !qrEl.innerHTML) {
      const roomCode = Utils.getRoomCodeFromURL();
      const url = Utils.buildURL("remote.html", roomCode);
      Utils.renderQRCode("qr-code-player", url);
      const urlEl = document.getElementById("qr-url");
      if (urlEl) urlEl.textContent = url;
    }
    p.hidden = !p.hidden;
  }

  function _toggleDanmaku() {
    _danmakuEnabled = !_danmakuEnabled;
    const btn = document.getElementById("btn-danmaku");
    if (btn) btn.textContent = _danmakuEnabled ? "弹幕 ON" : "弹幕 OFF";
    if (_currentSong && _currentType === "bilibili") {
      const embedUrl = Utils.getBilibiliEmbedUrl(_currentSong.url, { danmaku: _danmakuEnabled });
      if (embedUrl) {
        _recreateIframe();
        const frame = document.getElementById("player-iframe");
        if (frame) { frame.hidden = false; frame.src = embedUrl; }
      }
    }
  }

  function _openNativeWindow() {
    if (!_currentSong) return;
    const url = Utils.getNativeUrl(_currentSong);
    if (url) window.open(url, "_blank", "noopener");
  }

  function _handleInvalidSong() {
    Utils.toast("无效链接，跳过", "error");
    setTimeout(_onSongEnded, 1500);
  }

  function _onKeyDown(e) {
    if (e.code === "KeyQ") _togglePanel();
    if (e.code === "KeyD") _toggleDanmaku();
    _showFab();
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", PlayerPage.init);
