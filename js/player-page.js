/**
 * Display / Player page logic
 */
const PlayerPage = (() => {

  // ─── State ───────────────────────────────────────────────────────────────────
  let _playlist = [];
  let _state = {};
  let _currentSong = null;
  let _currentType = null;   // active player type
  let _ytPlayer = null;
  let _ytReady = false;
  let _ytPendingLoad = null;
  let _controlsTimeout = null;
  let _danmakuEnabled = true;

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async function init() {
    const roomCode = Utils.getRoomCodeFromURL();
    if (!roomCode) { window.location.href = "index.html"; return; }

    _bindControls();

    // Room code display + QR
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

    document.addEventListener("mousemove", _showControls);
    document.addEventListener("touchstart", _showControls, { passive: true });
    document.addEventListener("keydown", _onKeyDown);
    _showControls();
  }

  // ─── Screen management ────────────────────────────────────────────────────────

  function _showScreen(name) {
    ["idle", "player"].forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.hidden = (s !== name);
    });
    if (name === "idle") _cleanupCurrentPlayer();
  }

  // ─── Player cleanup ───────────────────────────────────────────────────────────
  // Must be called before loading a new song or returning to idle screen.

  function _cleanupCurrentPlayer() {
    // YouTube
    if (_ytPlayer) {
      try { _ytPlayer.stopVideo(); } catch {}
      try { _ytPlayer.destroy(); } catch {}
      _ytPlayer = null;
    }
    const ytContainer = document.getElementById("yt-container");
    if (ytContainer) { ytContainer.innerHTML = ""; ytContainer.hidden = true; }

    // HTML5 video
    const vid = document.getElementById("player-video");
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); vid.hidden = true; }

    // HTML5 audio
    const aud = document.getElementById("player-audio");
    if (aud) { aud.pause(); aud.removeAttribute("src"); aud.load(); aud.hidden = true; }
    const audioBg = document.getElementById("audio-bg");
    if (audioBg) audioBg.hidden = true;

    // iframe — navigate to blank to stop all playback immediately
    const frame = document.getElementById("player-iframe");
    if (frame) { frame.src = "about:blank"; frame.hidden = true; }

    _currentType = null;
    _updateControlsForType(null);
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

    // Stop whatever was playing before
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
      // Generic iframe
      const frame = document.getElementById("player-iframe");
      frame.hidden = false;
      frame.src = song.url;
    }

    DB.setState({ playerState: "playing" });
  }

  // ─── Control state per content type ──────────────────────────────────────────
  // YouTube / video / audio → full control.
  // bilibili / iframe       → pause/volume disabled (cross-origin restriction).

  function _updateControlsForType(type) {
    const isControllable = type === "youtube" || type === "video" || type === "audio";
    const isIframe = type === "bilibili" || type === "iframe";
    const isBilibili = type === "bilibili";

    // Play/pause button
    const ppBtn = document.getElementById("btn-play-pause");
    if (ppBtn) {
      ppBtn.disabled = isIframe;
      ppBtn.title = isIframe ? "iframe 内容不支持外部控制，请使用播放器自带控件" : "";
      ppBtn.style.opacity = isIframe ? "0.35" : "";
    }

    // Volume slider in overlay
    const volSlider = document.getElementById("volume-slider");
    if (volSlider) {
      volSlider.disabled = isIframe;
      volSlider.style.opacity = isIframe ? "0.35" : "";
      volSlider.title = isIframe ? "iframe 内容不支持外部音量控制" : "";
    }

    // Danmaku toggle — only for Bilibili
    const danmakuBtn = document.getElementById("btn-danmaku");
    if (danmakuBtn) {
      danmakuBtn.hidden = !isBilibili;
      danmakuBtn.textContent = _danmakuEnabled ? "弹幕 ON" : "弹幕 OFF";
    }

    // Open-in-native-window button — show for all except idle
    const nativeBtn = document.getElementById("btn-native");
    if (nativeBtn) nativeBtn.hidden = !type;

    // iframe notice
    const notice = document.getElementById("iframe-notice");
    if (notice) notice.hidden = !isIframe;
  }

  // ─── Playback control ─────────────────────────────────────────────────────────

  function _onSongEnded() {
    if (!_currentSong) return;
    DB.removeSong(_currentSong.id).catch(() => {});
    _currentSong = null;
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

  function _setVolumeAll(vol) {
    if (_ytPlayer?.setVolume) _ytPlayer.setVolume(vol);
    const vid = document.getElementById("player-video");
    if (vid) vid.volume = vol / 100;
    const aud = document.getElementById("player-audio");
    if (aud) aud.volume = vol / 100;
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
      const slider = document.getElementById("volume-slider");
      if (slider) slider.value = state.volume;
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

  // ─── UI ───────────────────────────────────────────────────────────────────────

  function _updateNowPlaying(song) {
    const t = document.getElementById("now-playing-title");
    const b = document.getElementById("now-playing-by");
    if (t) t.textContent = song.title || song.url;
    if (b) b.textContent = song.addedBy ? `${I18n.t("display.by")} ${song.addedBy}` : "";
  }

  function _updateUpNext() {
    const next = _playlist[1];
    const el = document.getElementById("up-next-title");
    if (el) el.textContent = next ? (next.title || next.url) : "";
    const sec = document.getElementById("up-next-section");
    if (sec) sec.hidden = !next;
  }

  function _updateQueueList() {
    const list = document.getElementById("queue-list");
    if (!list) return;
    ["queue-count", "queue-count-panel"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = _playlist.length;
    });
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

  // ─── Controls ─────────────────────────────────────────────────────────────────

  function _bindControls() {
    document.getElementById("btn-play-pause")?.addEventListener("click", _togglePlayPause);
    document.getElementById("btn-next")?.addEventListener("click", _skipNext);
    document.getElementById("btn-queue")?.addEventListener("click", () => {
      const p = document.getElementById("queue-panel");
      if (p) p.hidden = !p.hidden;
    });
    document.getElementById("btn-qr")?.addEventListener("click", () => {
      const p = document.getElementById("qr-panel");
      if (p) {
        // Render QR in the in-player panel on first open
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
    });
    document.getElementById("btn-danmaku")?.addEventListener("click", _toggleDanmaku);
    document.getElementById("btn-native")?.addEventListener("click", _openNativeWindow);

    const slider = document.getElementById("volume-slider");
    if (slider) {
      slider.value = APP_SETTINGS.defaultVolume;
      slider.addEventListener("input", e => {
        const vol = parseInt(e.target.value);
        _setVolumeAll(vol);
        DB.setState({ volume: vol });
      });
    }
  }

  function _togglePlayPause() {
    if (_currentType === "bilibili" || _currentType === "iframe") return;
    const next = _state.playerState === "playing" ? "paused" : "playing";
    if (next === "paused") _pauseAll(); else _playAll();
    DB.setState({ playerState: next });
  }

  function _skipNext() {
    if (_currentSong) {
      _cleanupCurrentPlayer();          // stop playback immediately
      DB.removeSong(_currentSong.id);
      _currentSong = null;
    }
  }

  function _toggleDanmaku() {
    _danmakuEnabled = !_danmakuEnabled;
    const btn = document.getElementById("btn-danmaku");
    if (btn) btn.textContent = _danmakuEnabled ? "弹幕 ON" : "弹幕 OFF";
    // Reload bilibili iframe with new danmaku setting
    if (_currentSong && _currentType === "bilibili") {
      const embedUrl = Utils.getBilibiliEmbedUrl(_currentSong.url, { danmaku: _danmakuEnabled });
      const frame = document.getElementById("player-iframe");
      if (frame && embedUrl) frame.src = embedUrl;
    }
  }

  function _openNativeWindow() {
    if (!_currentSong) return;
    const url = Utils.getNativeUrl(_currentSong);
    if (url) window.open(url, "_blank", "noopener");
  }

  function _showControls() {
    const overlay = document.getElementById("overlay-controls");
    if (overlay) overlay.classList.add("visible");
    clearTimeout(_controlsTimeout);
    _controlsTimeout = setTimeout(() => {
      if (overlay) overlay.classList.remove("visible");
    }, 4000);
  }

  function _handleInvalidSong() {
    Utils.toast("无效链接，跳过", "error");
    setTimeout(_onSongEnded, 1500);
  }

  function _onKeyDown(e) {
    if (e.code === "Space")      { e.preventDefault(); _togglePlayPause(); }
    if (e.code === "ArrowRight") _skipNext();
    if (e.code === "ArrowUp") {
      const s = document.getElementById("volume-slider");
      if (s && !s.disabled) { s.value = Math.min(100, +s.value + 5); s.dispatchEvent(new Event("input")); }
    }
    if (e.code === "ArrowDown") {
      const s = document.getElementById("volume-slider");
      if (s && !s.disabled) { s.value = Math.max(0, +s.value - 5); s.dispatchEvent(new Event("input")); }
    }
    if (e.code === "KeyQ") {
      const p = document.getElementById("queue-panel");
      if (p) p.hidden = !p.hidden;
    }
    if (e.code === "KeyD") _toggleDanmaku();
    _showControls();
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", PlayerPage.init);
