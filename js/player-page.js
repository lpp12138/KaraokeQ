/**
 * Display / Player page logic
 *
 * For web-based content (YouTube, Bilibili, NicoNico, generic URLs) we open the
 * ACTUAL webpage inside an Electron <webview> element instead of an embed/iframe.
 * This bypasses X-Frame-Options and lets the user's login session handle
 * member-restricted content.  CSS + JS are injected after page load to
 * auto-play the video and collapse the page chrome so only the player is visible.
 *
 * Local files (video/audio extensions) still use HTML5 <video>/<audio>.
 */
const PlayerPage = (() => {

  // ─── State ───────────────────────────────────────────────────────────────────
  let _playlist = [];
  let _state = {};
  let _currentSong = null;
  let _currentType = null;
  let _controlsTimeout = null;
  let _panelOpen = false;

  // Webview state
  let _webviewToken = 0;       // incremented on every new load; stale callbacks check this
  let _endPollInterval = null;

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
    if (DB.conflict) {
      const ind = document.getElementById("mode-indicator");
      if (ind) { ind.textContent = "⚠️ 房间冲突"; ind.title = "该房间码已被另一台主控设备占用，当前以单机模式运行"; ind.style.display = ""; }
      Utils.toast("⚠️ 该房间码已被另一台主控设备占用，请确认是否有重复启动", "warn", 8000);
    } else if (DB.mode === "broadcast") {
      const ind = document.getElementById("mode-indicator");
      if (ind) { ind.textContent = "⚡ 单机模式"; ind.title = "PeerJS 不可用，仅同浏览器标签同步"; }
    }

    Utils.saveRecentRoom(roomCode, "", "display");
    DB.onPlaylistChange(_onPlaylistChange);
    DB.onStateChange(_onStateChange);

    document.addEventListener("mousemove", _showFab);
    document.addEventListener("touchstart", _showFab, { passive: true });
    document.addEventListener("keydown", _onKeyDown);

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

  // ─── Webview management ───────────────────────────────────────────────────────

  /**
   * Build the webview src URL for a given song type.
   * We always open the NATIVE watch page, not an embed.
   */
  function _getWebviewUrl(song, type) {
    switch (type) {
      case "youtube": {
        const vid = Utils.getYouTubeId(song.url);
        return vid ? `https://www.youtube.com/watch?v=${vid}&autoplay=1` : null;
      }
      case "bilibili": {
        const id = Utils.getBilibiliId(song.url);
        if (!id) return null;
        let base = `https://www.bilibili.com/video/${id}/`;
        try {
          const p = new URL(song.url).searchParams.get("p");
          if (p && p !== "1") base += `?p=${p}`;
        } catch {}
        return base;
      }
      case "nicovideo": {
        const id = Utils.getNicovideoId(song.url);
        return id ? `https://www.nicovideo.jp/watch/${id}` : null;
      }
      default:
        return song.url || null;
    }
  }

  // Injected into the webview page: autoplay only.
  // Fullscreen is triggered by _startFKeyTrigger (trusted sendInputEvent via IPC).
  const _INJECT_JS = `
    ;(function kqAutoPlay() {
      var n = 0;
      var t = setInterval(function() {
        var v = document.querySelector('video');
        if (v) { clearInterval(t); v.play().catch(function(){}); }
        if (++n > 60) clearInterval(t);
      }, 500);
    })();
  `;


  /**
   * Poll from the renderer side until the webview has a <video> element,
   * then send a trusted F-key event via the main process so Bilibili's
   * web-fullscreen mode activates (isTrusted=true, unlike dispatchEvent).
   */
  function _startFKeyTrigger(wv, token) {
    if (!window.electronAPI?.sendWebviewKey) return;
    let n = 0;
    const t = setInterval(async () => {
      if (_webviewToken !== token || !wv.isConnected) { clearInterval(t); return; }
      try {
        const hasVideo = await wv.executeJavaScript('!!document.querySelector("video")');
        if (hasVideo) {
          clearInterval(t);
          // Focus the player first so the key event reaches the player's shortcut handler.
          setTimeout(async () => {
            if (_webviewToken !== token || !wv.isConnected) return;
            await wv.executeJavaScript(`
              ;(function(){
                var p = document.querySelector(
                  '#movie_player, .bpx-player-container, #bilibili-player, video'
                );
                if (p) { p.focus(); }
              })();
            `).catch(() => {});
            window.electronAPI.sendWebviewKey(wv.getWebContentsId(), 'f');
          }, 500);
        }
      } catch { /* webview still loading */ }
      if (++n > 30) clearInterval(t);
    }, 500);
  }

  /**
   * Create a fresh <webview> in the #webview-slot and configure it.
   * Returns the new webview element.
   */
  function _makeWebview() {
    const slot = document.getElementById("webview-slot");
    if (!slot) return null;

    // Remove any existing webview
    const old = slot.querySelector("webview");
    if (old) old.remove();

    const wv = document.createElement("webview");
    wv.setAttribute("partition", "persist:karaokeq");
    wv.setAttribute("allowpopups", "");
    wv.style.cssText = "width:100%;height:100%;border:none;display:block;";
    slot.appendChild(wv);
    return wv;
  }

  function _loadWebview(song, type) {
    const url = _getWebviewUrl(song, type);
    if (!url) { _handleInvalidSong(); return; }

    const token = ++_webviewToken;
    const slot = document.getElementById("webview-slot");
    if (!slot) { _handleInvalidSong(); return; }
    slot.hidden = false;

    const wv = _makeWebview();
    if (!wv) { _handleInvalidSong(); return; }

    wv.addEventListener("dom-ready", function onReady() {
      if (_webviewToken !== token) return;
      wv.executeJavaScript(_INJECT_JS).catch(() => {});
      _startEndPoll(wv, token);
      _startFKeyTrigger(wv, token);
    });

    // Bilibili uses History API navigation; re-inject autoplay JS on each in-page nav.
    wv.addEventListener("did-navigate-in-page", function() {
      if (_webviewToken !== token) return;
      wv.executeJavaScript(_INJECT_JS).catch(() => {});
    });

    wv.src = url;
  }

  /**
   * Poll every 3 s: check if the page's <video> element has ended.
   * When it has, advance the queue.
   */
  function _startEndPoll(wv, token) {
    if (_endPollInterval) clearInterval(_endPollInterval);
    _endPollInterval = setInterval(async () => {
      if (_webviewToken !== token || !wv.isConnected) {
        clearInterval(_endPollInterval);
        _endPollInterval = null;
        return;
      }
      try {
        const ended = await wv.executeJavaScript(
          "(function(){var v=document.querySelector('video');return v?v.ended:false;})()"
        );
        if (ended) {
          clearInterval(_endPollInterval);
          _endPollInterval = null;
          _onSongEnded();
        }
      } catch {}
    }, 3000);
  }

  // ─── Player cleanup ───────────────────────────────────────────────────────────

  function _cleanupCurrentPlayer() {
    // Stop end-poll and invalidate any in-flight webview
    if (_endPollInterval) { clearInterval(_endPollInterval); _endPollInterval = null; }
    _webviewToken++;

    // Destroy webview
    const slot = document.getElementById("webview-slot");
    if (slot) {
      slot.hidden = true;
      const wv = slot.querySelector("webview");
      if (wv) wv.remove();
    }

    // Stop video
    const vid = document.getElementById("player-video");
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); vid.hidden = true; }

    // Stop audio
    const aud = document.getElementById("player-audio");
    if (aud) { aud.pause(); aud.removeAttribute("src"); aud.load(); aud.hidden = true; }
    const audioBg = document.getElementById("audio-bg");
    if (audioBg) audioBg.hidden = true;

    _currentType = null;
    _updateControlsForType(null);
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

    if (type === "video") {
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

    } else {
      // youtube / bilibili / nicovideo / generic URL → open native page in webview
      _loadWebview(song, type);
    }

    DB.setState({ playerState: "playing" });
  }

  // ─── Playback control ─────────────────────────────────────────────────────────

  function _onSongEnded() {
    if (!_currentSong) return;
    DB.removeSong(_currentSong.id).catch(() => {});
    _currentSong = null;
  }

  function _setVolumeAll(vol) {
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.volume = vol / 100;
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.volume = vol / 100;

    const wv = document.querySelector("#webview-slot webview");
    if (wv) {
      wv.executeJavaScript(
        `(function(){var v=document.querySelector('video');if(v)v.volume=${vol / 100};})()`
      ).catch(() => {});
    }
  }

  function _pauseAll() {
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.pause();
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.pause();

    const wv = document.querySelector("#webview-slot webview");
    if (wv) {
      wv.executeJavaScript(
        "(function(){var v=document.querySelector('video');if(v)v.pause();})()"
      ).catch(() => {});
    }
  }

  function _playAll() {
    const vid = document.getElementById("player-video");
    if (vid && !vid.hidden) vid.play().catch(() => {});
    const aud = document.getElementById("player-audio");
    if (aud && !aud.hidden) aud.play().catch(() => {});

    const wv = document.querySelector("#webview-slot webview");
    if (wv) {
      wv.executeJavaScript(
        "(function(){var v=document.querySelector('video');if(v)v.play().catch(function(){});})()"
      ).catch(() => {});
    }
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
      _setVolumeAll(state.volume);
    }

    if (state.playerState && state.playerState !== prev.playerState) {
      if (state.playerState === "paused") _pauseAll();
      else if (state.playerState === "playing") _playAll();
    }
  }

  // ─── Controls per content type ────────────────────────────────────────────────

  function _updateControlsForType(type) {
    // With native-page webview, there's no danmaku toggle or separate "open native" action
    const danmakuBtn = document.getElementById("btn-danmaku");
    if (danmakuBtn) danmakuBtn.hidden = true;
    const nativeBtn = document.getElementById("btn-native");
    if (nativeBtn) nativeBtn.hidden = true;
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
        const W = window.innerWidth;
        const fw = fab.offsetWidth;
        const cur = parseFloat(fab.style.left);
        const snapped = cur + fw / 2 < W / 2 ? 12 : W - fw - 12;
        fab.style.left = snapped + "px";
        localStorage.setItem("kq_fab_pos", JSON.stringify({
          left: fab.style.left,
          top: fab.style.top
        }));
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

  function _handleInvalidSong() {
    Utils.toast("无效链接，跳过", "error");
    setTimeout(_onSongEnded, 1500);
  }

  function _onKeyDown(e) {
    if (e.code === "KeyQ") _togglePanel();
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
