/**
 * Remote control page logic
 * Allows users on phones/other devices to manage the karaoke queue.
 */
const RemotePage = (() => {

  let _playlist = [];
  let _state = {};
  let _deviceName = "";
  let _sortable = null;
  let _addFormOpen = false;

  // ─── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    const roomCode = Utils.getRoomCodeFromURL();
    if (!roomCode) {
      window.location.href = "index.html";
      return;
    }

    await I18n.init();

    // Restore device name
    _deviceName = localStorage.getItem("kq_device_name") || "";
    const nameInput = document.getElementById("device-name");
    if (nameInput) nameInput.value = _deviceName;

    // Display room code
    document.querySelectorAll(".room-code-display").forEach(el => {
      el.textContent = roomCode;
    });

    _showStatus("connecting");
    _bindEvents();

    await DB.init(roomCode, 'remote');
    Utils.saveRecentRoom(roomCode);

    if (DB.mode === "broadcast") {
      const badge = document.getElementById("sync-badge");
      if (badge) {
        badge.textContent = "单机";
        badge.title = "PeerJS 不可用，仅支持同一浏览器内的标签同步";
        badge.style.display = "";
        badge.classList.add("badge--demo");
      }
    }

    // Listen for connection status changes from PeerJS
    DB.onStatusChange(_showStatus);

    DB.onPlaylistChange(_onPlaylistChange);
    DB.onStateChange(_onStateChange);
  }

  // ─── DB event handlers ────────────────────────────────────────────────────────

  function _onPlaylistChange(songs) {
    _playlist = songs;
    _renderQueue();
    _renderNowPlaying();
  }

  function _onStateChange(state) {
    _state = state;
    _renderNowPlaying();
    _updatePlayPauseBtn();

    const volSlider = document.getElementById("volume-slider");
    if (volSlider && state.volume !== undefined) {
      volSlider.value = state.volume;
      document.getElementById("volume-value").textContent = state.volume + "%";
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────────

  function _renderNowPlaying() {
    const current = _playlist[0] || null;
    const titleEl = document.getElementById("now-playing-title");
    const typeEl = document.getElementById("now-playing-type");
    const section = document.getElementById("now-playing-section");
    const empty = document.getElementById("now-playing-empty");

    if (current) {
      if (section) section.hidden = false;
      if (empty) empty.hidden = true;
      if (titleEl) titleEl.textContent = current.title || current.url;
      if (typeEl) typeEl.textContent = I18n.t(`remote.${current.type}`) || current.type;
    } else {
      if (section) section.hidden = true;
      if (empty) empty.hidden = false;
    }
  }

  function _renderQueue() {
    const list = document.getElementById("queue-list");
    const emptyEl = document.getElementById("queue-empty");
    const countEl = document.getElementById("queue-count");
    if (!list) return;

    if (countEl) countEl.textContent = _playlist.length;

    // Exclude first song (now playing) from the "queue" display
    const queued = _playlist.slice(1);

    if (queued.length === 0) {
      list.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    // Re-render while preserving DOM for smooth drag
    const existing = {};
    list.querySelectorAll("[data-id]").forEach(el => { existing[el.dataset.id] = el; });

    const fragment = document.createDocumentFragment();
    queued.forEach((song, i) => {
      let item = existing[song.id];
      if (!item) {
        item = _createQueueItem(song, i + 1);
      } else {
        // Update position number
        const numEl = item.querySelector(".queue-num");
        if (numEl) numEl.textContent = i + 2; // +2 because index 0 is "now playing"
      }
      fragment.appendChild(item);
    });
    list.innerHTML = "";
    list.appendChild(fragment);

    _initSortable();
  }

  function _createQueueItem(song, pos) {
    const li = document.createElement("li");
    li.className = "queue-item";
    li.dataset.id = song.id;
    li.innerHTML = `
      <span class="queue-drag" title="${I18n.t("remote.dragToReorder")}">⠿</span>
      <span class="queue-num">${pos}</span>
      <div class="queue-info">
        <span class="queue-title">${_esc(song.title || song.url)}</span>
        ${song.addedBy ? `<span class="queue-by">${_esc(song.addedBy)}</span>` : ""}
      </div>
      <span class="queue-type badge badge--${song.type}">${I18n.t(`remote.${song.type}`) || song.type}</span>
      <button class="btn-icon btn-remove" data-id="${song.id}" aria-label="${I18n.t("common.remove")}">✕</button>
    `;
    li.querySelector(".btn-remove").addEventListener("click", e => {
      e.stopPropagation();
      _removeSong(song.id);
    });
    return li;
  }

  function _updatePlayPauseBtn() {
    const btn = document.getElementById("btn-play-pause");
    if (!btn) return;
    const isPlaying = _state.playerState === "playing";
    btn.textContent = isPlaying ? "⏸" : "▶";
    btn.setAttribute("aria-label", I18n.t(isPlaying ? "common.pause" : "common.play"));
    btn.classList.toggle("btn--playing", isPlaying);
  }

  // ─── Queue actions ────────────────────────────────────────────────────────────

  function _removeSong(id) {
    DB.removeSong(id)
      .then(() => Utils.toast(I18n.t("remote.songRemoved"), "info"))
      .catch(() => Utils.toast(I18n.t("common.error"), "error"));
  }

  function _initSortable() {
    const list = document.getElementById("queue-list");
    if (!list || typeof Sortable === "undefined") return;
    if (_sortable) _sortable.destroy();
    _sortable = Sortable.create(list, {
      handle: ".queue-drag",
      animation: 150,
      onEnd: () => {
        const allItems = list.querySelectorAll("[data-id]");
        // First song (index 0 in _playlist) is "now playing" — prepend its ID
        const nowPlayingId = _playlist[0]?.id;
        const newOrder = [];
        if (nowPlayingId) newOrder.push(nowPlayingId);
        allItems.forEach(el => newOrder.push(el.dataset.id));
        DB.reorderPlaylist(newOrder).catch(() => Utils.toast(I18n.t("common.error"), "error"));
      }
    });
  }

  // ─── Add Song form ────────────────────────────────────────────────────────────

  function _openAddForm() {
    _addFormOpen = true;
    const panel = document.getElementById("add-song-panel");
    if (panel) {
      panel.hidden = false;
      panel.classList.add("panel--open");
    }
    const input = document.getElementById("song-url");
    if (input) input.focus();
    const fab = document.getElementById("fab-add");
    if (fab) fab.setAttribute("aria-expanded", "true");
  }

  function _closeAddForm() {
    _addFormOpen = false;
    const panel = document.getElementById("add-song-panel");
    if (panel) {
      panel.classList.remove("panel--open");
      panel.hidden = true;
    }
    const fab = document.getElementById("fab-add");
    if (fab) fab.setAttribute("aria-expanded", "false");
    document.getElementById("song-url").value = "";
    document.getElementById("song-title").value = "";
    document.getElementById("url-type-badge").hidden = true;
    document.getElementById("add-error").hidden = true;
  }

  async function _handleAddSong(e) {
    e?.preventDefault();
    const urlInput = document.getElementById("song-url");
    const titleInput = document.getElementById("song-title");
    const submitBtn = document.getElementById("btn-add-song");
    const errorEl = document.getElementById("add-error");

    if (errorEl) errorEl.hidden = true;

    const url = (urlInput?.value || "").trim();
    if (!url) {
      if (errorEl) {
        errorEl.textContent = I18n.t("remote.invalidUrl");
        errorEl.hidden = false;
      }
      return;
    }

    let title = (titleInput?.value || "").trim();
    const type = Utils.detectUrlType(url);

    if (type === "unknown") {
      if (errorEl) {
        errorEl.textContent = I18n.t("remote.invalidUrl");
        errorEl.hidden = false;
      }
      return;
    }

    // Check queue limit
    if (_playlist.length >= APP_SETTINGS.maxQueueLength) {
      if (errorEl) {
        errorEl.textContent = `Queue is full (max ${APP_SETTINGS.maxQueueLength})`;
        errorEl.hidden = false;
      }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = I18n.t("remote.adding"); }

    // Auto-fetch title for YouTube
    if (!title && type === "youtube") {
      const vid = Utils.getYouTubeId(url);
      if (vid) title = await Utils.fetchYouTubeTitle(vid) || "";
    }

    const song = {
      id: Utils.uid(),
      url,
      title: title || url,
      type,
      thumbnail: type === "youtube" ? Utils.getYouTubeThumbnail(Utils.getYouTubeId(url)) : "",
      addedBy: _deviceName
    };

    try {
      await DB.addSong(song);
      Utils.toast(I18n.t("remote.songAdded"), "success");
      _closeAddForm();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = I18n.t("common.error") + ": " + (err.message || err);
        errorEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = I18n.t("remote.addToQueue"); }
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  function _bindEvents() {
    // Add song — FAB (mobile) + wide-screen inline button both open the same sheet
    const _toggleAdd = () => _addFormOpen ? _closeAddForm() : _openAddForm();
    document.getElementById("fab-add")?.addEventListener("click", _toggleAdd);
    document.getElementById("btn-add-wide")?.addEventListener("click", _toggleAdd);
    document.getElementById("btn-close-add")?.addEventListener("click", _closeAddForm);

    // URL input → auto-detect type
    document.getElementById("song-url")?.addEventListener("input", _onUrlInput);
    document.getElementById("song-url")?.addEventListener("paste", e => {
      setTimeout(_onUrlInput.bind(null, e), 0);
    });

    // Form submit
    document.getElementById("add-song-form")?.addEventListener("submit", _handleAddSong);
    document.getElementById("btn-add-song")?.addEventListener("click", _handleAddSong);

    // Controls
    document.getElementById("btn-play-pause")?.addEventListener("click", _togglePlayPause);
    document.getElementById("btn-next")?.addEventListener("click", _skipNext);

    // Volume
    const volSlider = document.getElementById("volume-slider");
    if (volSlider) {
      volSlider.addEventListener("input", e => {
        const val = parseInt(e.target.value);
        const label = document.getElementById("volume-value");
        if (label) label.textContent = val + "%";
        DB.setState({ volume: val });
      });
    }

    // Device name
    const nameInput = document.getElementById("device-name");
    if (nameInput) {
      nameInput.addEventListener("change", () => {
        _deviceName = nameInput.value.trim();
        localStorage.setItem("kq_device_name", _deviceName);
      });
    }

    // Escape key closes add form
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && _addFormOpen) _closeAddForm();
    });
  }

  function _onUrlInput() {
    const url = (document.getElementById("song-url")?.value || "").trim();
    const badge = document.getElementById("url-type-badge");
    if (!badge) return;
    if (!url) { badge.hidden = true; return; }
    const type = Utils.detectUrlType(url);
    if (type === "unknown") { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = I18n.t(`remote.${type}`);
    badge.className = `badge badge--${type}`;
  }

  function _togglePlayPause() {
    const next = _state.playerState === "playing" ? "paused" : "playing";
    DB.setState({ playerState: next });
  }

  function _skipNext() {
    const current = _playlist[0];
    if (current) DB.removeSong(current.id);
  }

  function _showStatus(status) {
    const el = document.getElementById("connection-status");
    if (!el) return;
    el.textContent = I18n.t(`remote.${status}`);
    el.className = `status status--${status}`;
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

document.addEventListener("DOMContentLoaded", RemotePage.init);
