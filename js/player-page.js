/**
 * Display / Player page logic
 * Controls YouTube IFrame, HTML5 media, and iframe embeds.
 * Syncs state with Firebase/BroadcastChannel via DB module.
 */
const PlayerPage = (() => {

  // ─── State ───────────────────────────────────────────────────────────────────
  let _playlist = [];
  let _state = {};
  let _currentSong = null;
  let _ytPlayer = null;
  let _ytReady = false;
  let _ytPendingLoad = null;
  let _controlsTimeout = null;

  // ─── DOM refs (populated in init) ────────────────────────────────────────────
  const dom = {};

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async function init() {
    const roomCode = Utils.getRoomCodeFromURL();
    if (!roomCode) {
      window.location.href = "index.html";
      return;
    }

    _cacheDom();
    _bindControls();

    // Show room code + QR
    dom.roomCode.textContent = roomCode;
    const remoteUrl = Utils.buildURL("remote.html", roomCode);
    Utils.renderQRCode("qr-code", remoteUrl);
    dom.remoteUrl.textContent = remoteUrl;
    dom.remoteUrl.href = remoteUrl;

    await I18n.init();
    showScreen("idle");

    await DB.init(roomCode, 'display');
    if (DB.mode === "broadcast") {
      dom.modeIndicator.textContent = "⚡ 单机模式";
      dom.modeIndicator.title = "PeerJS 不可用，仅支持同一浏览器内的多标签同步";
    }

    Utils.saveRecentRoom(roomCode);

    // Subscribe to DB
    DB.onPlaylistChange(_onPlaylistChange);
    DB.onStateChange(_onStateChange);

    // Init YouTube IFrame API
    _loadYouTubeAPI();

    // Show/hide controls on pointer activity
    document.addEventListener("mousemove", _showControls);
    document.addEventListener("touchstart", _showControls, { passive: true });
    document.addEventListener("keydown", _onKeyDown);

    _showControls();
  }

  function _cacheDom() {
    const ids = [
      "screen-idle", "screen-player", "screen-queue",
      "player-iframe", "player-video", "player-audio",
      "yt-container", "now-playing-title", "now-playing-by",
      "up-next-title", "queue-list", "queue-count",
      "btn-play-pause", "btn-next", "volume-slider",
      "room-code", "remote-url", "qr-code",
      "overlay-controls", "overlay-info",
      "mode-indicator", "connection-status"
    ];
    ids.forEach(id => { dom[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

    // Shorthand aliases
    dom.roomCode = document.getElementById("room-code");
    dom.remoteUrl = document.getElementById("remote-url");
  }

  // ─── Screen management ────────────────────────────────────────────────────────

  function showScreen(name) {
    ["idle", "player"].forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.hidden = (s !== name);
    });
  }

  // ─── YouTube IFrame API ───────────────────────────────────────────────────────

  function _loadYouTubeAPI() {
    window.onYouTubeIframeAPIReady = _onYtAPIReady;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  function _onYtAPIReady() {
    _ytReady = true;
    if (_ytPendingLoad) {
      _loadYouTube(_ytPendingLoad);
      _ytPendingLoad = null;
    }
  }

  function _loadYouTube(videoId) {
    if (!_ytReady) {
      _ytPendingLoad = videoId;
      return;
    }
    const container = document.getElementById("yt-container");
    if (!container) return;
    container.innerHTML = '<div id="yt-player"></div>';

    if (_ytPlayer) {
      try { _ytPlayer.destroy(); } catch {}
    }

    _ytPlayer = new YT.Player("yt-player", {
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        rel: 0,
        playsinline: 1
      },
      events: {
        onReady: e => {
          e.target.setVolume(_state.volume ?? APP_SETTINGS.defaultVolume);
          e.target.playVideo();
          DB.setState({ playerState: "playing" });
        },
        onStateChange: e => {
          if (e.data === YT.PlayerState.ENDED) _onSongEnded();
          if (e.data === YT.PlayerState.PLAYING) {
            DB.setState({ playerState: "playing" });
          }
          if (e.data === YT.PlayerState.PAUSED) {
            // Only sync if it wasn't us who paused it
          }
        },
        onError: () => {
          Utils.toast(I18n.t("display.noMoreSongs"), "error");
          setTimeout(_onSongEnded, 2000);
        }
      }
    });
  }

  // ─── Media loading ────────────────────────────────────────────────────────────

  function _loadSong(song) {
    if (!song) { showScreen("idle"); return; }
    _currentSong = song;
    showScreen("player");
    _updateNowPlaying(song);
    _updateUpNext();

    // Hide all sub-players
    document.querySelectorAll(".sub-player").forEach(el => el.hidden = true);

    const type = song.type || Utils.detectUrlType(song.url);

    if (type === "youtube") {
      const vid = Utils.getYouTubeId(song.url);
      if (!vid) { _handleInvalidSong(); return; }
      document.getElementById("yt-container").hidden = false;
      _loadYouTube(vid);

    } else if (type === "video") {
      const vid = document.getElementById("player-video");
      vid.hidden = false;
      vid.src = song.url;
      vid.volume = (_state.volume ?? APP_SETTINGS.defaultVolume) / 100;
      vid.play().catch(() => {});
      vid.onended = _onSongEnded;

    } else if (type === "audio") {
      const aud = document.getElementById("player-audio");
      const audioBg = document.getElementById("audio-bg");
      aud.hidden = false;
      if (audioBg) {
        audioBg.hidden = false;
        const audioTitle = document.getElementById("audio-title");
        if (audioTitle) audioTitle.textContent = song.title || song.url;
      }
      aud.src = song.url;
      aud.volume = (_state.volume ?? APP_SETTINGS.defaultVolume) / 100;
      aud.play().catch(() => {});
      aud.onended = _onSongEnded;

    } else if (type === "bilibili") {
      const embedUrl = Utils.getBilibiliEmbedUrl(song.url);
      if (!embedUrl) { _handleInvalidSong(); return; }
      const frame = document.getElementById("player-iframe");
      frame.hidden = false;
      frame.src = embedUrl;
      // No end detection for Bilibili; show manual advance hint

    } else {
      // Generic iframe
      const frame = document.getElementById("player-iframe");
      frame.hidden = false;
      frame.src = song.url;
    }

    DB.setState({ playerState: "playing" });
  }

  function _handleInvalidSong() {
    Utils.toast("Invalid or unsupported URL", "error");
    setTimeout(_onSongEnded, 1500);
  }

  // ─── Playback events ──────────────────────────────────────────────────────────

  function _onSongEnded() {
    if (!_currentSong) return;
    // Remove the finished song from the playlist
    DB.removeSong(_currentSong.id).catch(() => {});
    _currentSong = null;
  }

  function _pauseAll() {
    if (_ytPlayer && _ytPlayer.pauseVideo) _ytPlayer.pauseVideo();
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.pause();
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.pause();
  }

  function _playAll() {
    if (_ytPlayer && _ytPlayer.playVideo) _ytPlayer.playVideo();
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.play().catch(() => {});
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.play().catch(() => {});
  }

  function _setVolumeAll(vol) {
    if (_ytPlayer && _ytPlayer.setVolume) _ytPlayer.setVolume(vol);
    const vid = document.getElementById("player-video");
    if (vid) vid.volume = vol / 100;
    const aud = document.getElementById("player-audio");
    if (aud) aud.volume = vol / 100;
  }

  // ─── DB event handlers ────────────────────────────────────────────────────────

  function _onPlaylistChange(songs) {
    _playlist = songs;
    _updateQueueList();

    const first = songs[0] || null;

    if (!first) {
      // Queue emptied
      _currentSong = null;
      showScreen("idle");
      return;
    }

    // If current song changed (different ID, or no current), load new first song
    if (!_currentSong || _currentSong.id !== first.id) {
      _loadSong(first);
    }

    _updateUpNext();
  }

  function _onStateChange(state) {
    const prev = _state;
    _state = state;

    // Volume change
    if (state.volume !== undefined && state.volume !== prev.volume) {
      const slider = document.getElementById("volume-slider");
      if (slider) slider.value = state.volume;
      _setVolumeAll(state.volume);
    }

    // Play/pause from remote
    if (state.playerState && state.playerState !== prev.playerState) {
      if (state.playerState === "paused") _pauseAll();
      else if (state.playerState === "playing") _playAll();
    }
  }

  // ─── UI updates ───────────────────────────────────────────────────────────────

  function _updateNowPlaying(song) {
    const titleEl = document.getElementById("now-playing-title");
    const byEl = document.getElementById("now-playing-by");
    if (titleEl) titleEl.textContent = song.title || song.url;
    if (byEl) {
      byEl.textContent = song.addedBy ? `${I18n.t("display.by")} ${song.addedBy}` : "";
    }
  }

  function _updateUpNext() {
    const upNext = _playlist[1];
    const el = document.getElementById("up-next-title");
    if (el) el.textContent = upNext ? upNext.title || upNext.url : "";
    const section = document.getElementById("up-next-section");
    if (section) section.hidden = !upNext;
  }

  function _updateQueueList() {
    const list = document.getElementById("queue-list");
    if (!list) return;
    // Update both count badges (overlay button + queue panel header)
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
    document.getElementById("btn-queue")?.addEventListener("click", _toggleQueue);
    document.getElementById("btn-qr")?.addEventListener("click", _toggleQR);

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
    const next = _state.playerState === "playing" ? "paused" : "playing";
    if (next === "paused") _pauseAll();
    else _playAll();
    DB.setState({ playerState: next });
  }

  function _skipNext() {
    if (_currentSong) DB.removeSong(_currentSong.id);
  }

  function _toggleQueue() {
    const panel = document.getElementById("queue-panel");
    if (panel) panel.hidden = !panel.hidden;
  }

  function _toggleQR() {
    const panel = document.getElementById("qr-panel");
    if (panel) panel.hidden = !panel.hidden;
  }

  function _showControls() {
    const overlay = document.getElementById("overlay-controls");
    if (overlay) overlay.classList.add("visible");
    clearTimeout(_controlsTimeout);
    _controlsTimeout = setTimeout(() => {
      if (overlay) overlay.classList.remove("visible");
    }, 4000);
  }

  function _onKeyDown(e) {
    if (e.code === "Space") { e.preventDefault(); _togglePlayPause(); }
    if (e.code === "ArrowRight") _skipNext();
    if (e.code === "ArrowUp") {
      const s = document.getElementById("volume-slider");
      if (s) { s.value = Math.min(100, +s.value + 5); s.dispatchEvent(new Event("input")); }
    }
    if (e.code === "ArrowDown") {
      const s = document.getElementById("volume-slider");
      if (s) { s.value = Math.max(0, +s.value - 5); s.dispatchEvent(new Event("input")); }
    }
    if (e.code === "KeyQ") _toggleQueue();
    _showControls();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function _esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init };
})();

// Bootstrap
document.addEventListener("DOMContentLoaded", PlayerPage.init);
