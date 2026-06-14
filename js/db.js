/**
 * Database / Sync Layer
 *
 * Storage:  localStorage (all playlist & state data stays in the browser)
 * Sync:     PeerJS WebRTC data channels (P2P, no data stored externally)
 * Fallback: BroadcastChannel (same browser, multiple tabs)
 *
 * Roles:
 *   'display' — source of truth, accepts connections from remotes
 *   'remote'  — connects to display, sends commands
 *
 * Public API:
 *   DB.init(roomCode, role)      → Promise<void>
 *   DB.addSong(song)             → Promise
 *   DB.removeSong(id)            → Promise
 *   DB.reorderPlaylist(ids)      → Promise
 *   DB.setState(patch)           → Promise
 *   DB.onPlaylistChange(cb)      → unsubscribe fn
 *   DB.onStateChange(cb)         → unsubscribe fn
 *   DB.onStatusChange(cb)        → unsubscribe fn  ('connecting'|'connected'|'disconnected'|'waiting')
 *   DB.roomExists(code)          → boolean
 *   DB.mode                      → 'peerjs' | 'broadcast'
 */
const DB = (() => {

  let _role = null;
  let _room = null;
  let _mode = null;

  // PeerJS
  let _peer = null;
  let _displayConn = null;    // remote → display connection
  let _remoteConns = [];      // display's connections to remotes

  // BroadcastChannel fallback
  let _bc = null;

  // Local state (display is authoritative)
  let _playlist = [];
  let _state = {};

  // Callbacks
  let _playlistCbs = [];
  let _stateCbs = [];
  let _statusCbs = [];

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init(roomCode, role = 'remote') {
    _role = role;
    _room = roomCode.toUpperCase();

    if (_role === 'display') {
      _loadFromStorage();
    }

    if (typeof Peer !== 'undefined') {
      try {
        await _initPeerJS();
        _mode = 'peerjs';
        return;
      } catch (e) {
        console.warn('[DB] PeerJS init failed, falling back to BroadcastChannel:', e);
      }
    }

    _mode = 'broadcast';
    _initBroadcastChannel();
  }

  // ─── PeerJS ───────────────────────────────────────────────────────────────

  function _initPeerJS() {
    return new Promise((resolve, reject) => {
      const peerId = _role === 'display'
        ? APP_SETTINGS.peerPrefix + _room
        : undefined; // anonymous ID for remotes

      _peer = new Peer(peerId, { debug: 0 });

      const timeout = setTimeout(() => {
        reject(new Error('PeerJS connection timeout'));
      }, 12000);

      _peer.on('open', () => {
        clearTimeout(timeout);
        if (_role === 'display') {
          _setupDisplayListeners();
          _notifyStatus('connected');
        } else {
          _connectToDisplay();
        }
        resolve();
      });

      _peer.on('error', err => {
        clearTimeout(timeout);
        console.warn('[DB] PeerJS error:', err.type, err.message);
        if (err.type === 'unavailable-id') {
          // Another display is already using this room code — still ok, join as observer
          console.info('[DB] Room already has a display; operating in read-only peer mode');
        }
        reject(err);
      });

      _peer.on('disconnected', () => {
        _notifyStatus('disconnected');
        // Auto-reconnect
        setTimeout(() => {
          if (_peer && !_peer.destroyed) _peer.reconnect();
        }, 3000);
      });
    });
  }

  // ── Display peer ────────────────────────────────────────────────────────────

  function _setupDisplayListeners() {
    _peer.on('connection', conn => {
      conn.on('open', () => {
        _remoteConns.push(conn);
        // Send full state to newly connected remote
        _send(conn, { type: 'FULL_SYNC', playlist: _playlist, state: _state });
      });

      conn.on('data', msg => _handleRemoteCommand(msg, conn));

      conn.on('close', () => {
        _remoteConns = _remoteConns.filter(c => c !== conn);
      });

      conn.on('error', () => {
        _remoteConns = _remoteConns.filter(c => c !== conn);
      });
    });
  }

  function _handleRemoteCommand(msg, fromConn) {
    switch (msg.type) {
      case 'ADD_SONG':    _execAddSong(msg.song); break;
      case 'REMOVE_SONG': _execRemoveSong(msg.id); break;
      case 'REORDER':     _execReorder(msg.ids); break;
      case 'SET_STATE':   _execSetState(msg.state); break;
      case 'REQUEST_SYNC':
        _send(fromConn, { type: 'FULL_SYNC', playlist: _playlist, state: _state });
        break;
    }
  }

  // ── Remote peer ─────────────────────────────────────────────────────────────

  function _connectToDisplay() {
    _notifyStatus('connecting');

    const displayId = APP_SETTINGS.peerPrefix + _room;
    _displayConn = _peer.connect(displayId, { reliable: true, serialization: 'json' });

    _displayConn.on('open', () => {
      _notifyStatus('connected');
      _send(_displayConn, { type: 'REQUEST_SYNC' });
    });

    _displayConn.on('data', msg => _handleDisplayUpdate(msg));

    _displayConn.on('close', () => {
      _notifyStatus('disconnected');
      setTimeout(_connectToDisplay, 3000);
    });

    _displayConn.on('error', err => {
      console.warn('[DB] Display conn error:', err);
      _notifyStatus('waiting');
      setTimeout(_connectToDisplay, 4000);
    });
  }

  function _handleDisplayUpdate(msg) {
    if (msg.playlist !== undefined) {
      _playlist = msg.playlist || [];
      _notifyPlaylist(_playlist.slice());
    }
    if (msg.state !== undefined) {
      _state = msg.state || {};
      _notifyState({ ..._state });
    }
  }

  // ─── BroadcastChannel fallback ────────────────────────────────────────────

  function _initBroadcastChannel() {
    _bc = new BroadcastChannel('kq_' + _room);

    if (_role === 'display') {
      _bc.onmessage = e => {
        const msg = e.data;
        if (msg.type === 'REQUEST_SYNC') {
          _bc.postMessage({ type: 'FULL_SYNC', playlist: _playlist, state: _state });
        } else {
          _handleRemoteCommand(msg, null);
        }
      };
      setTimeout(() => {
        _notifyPlaylist(_playlist.slice());
        _notifyState({ ..._state });
        _notifyStatus('connected');
      }, 0);
    } else {
      _bc.onmessage = e => _handleDisplayUpdate(e.data);
      _bc.postMessage({ type: 'REQUEST_SYNC' });
      _notifyStatus('connected');
    }
  }

  // ─── State mutations (display executes these) ─────────────────────────────

  function _execAddSong(song) {
    const maxOrder = _playlist.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
    const item = { ...song, order: maxOrder + 1 };
    _playlist.push(item);
    _afterMutation();
  }

  function _execRemoveSong(id) {
    _playlist = _playlist.filter(s => s.id !== id);
    _playlist.forEach((s, i) => { s.order = i; });
    _afterMutation();
  }

  function _execReorder(ids) {
    const map = {};
    _playlist.forEach(s => { map[s.id] = s; });
    _playlist = ids.map((id, i) => map[id] ? { ...map[id], order: i } : null).filter(Boolean);
    _afterMutation();
  }

  function _execSetState(patch) {
    _state = { ..._state, ...patch };
    _saveToStorage();
    _notifyState({ ..._state });
    _broadcast({ type: 'FULL_SYNC', playlist: _playlist, state: _state });
  }

  function _afterMutation() {
    _saveToStorage();
    _notifyPlaylist(_playlist.slice());
    _broadcast({ type: 'FULL_SYNC', playlist: _playlist, state: _state });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async function addSong(song) {
    if (_role === 'display') { _execAddSong(song); }
    else { _sendToDisplay({ type: 'ADD_SONG', song }); }
  }

  async function removeSong(id) {
    if (_role === 'display') { _execRemoveSong(id); }
    else { _sendToDisplay({ type: 'REMOVE_SONG', id }); }
  }

  async function reorderPlaylist(ids) {
    if (_role === 'display') { _execReorder(ids); }
    else { _sendToDisplay({ type: 'REORDER', ids }); }
  }

  async function setState(patch) {
    if (_role === 'display') { _execSetState(patch); }
    else { _sendToDisplay({ type: 'SET_STATE', state: patch }); }
  }

  function onPlaylistChange(cb) {
    _playlistCbs.push(cb);
    cb(_playlist.slice());
    return () => { _playlistCbs = _playlistCbs.filter(f => f !== cb); };
  }

  function onStateChange(cb) {
    _stateCbs.push(cb);
    cb({ ..._state });
    return () => { _stateCbs = _stateCbs.filter(f => f !== cb); };
  }

  function onStatusChange(cb) {
    _statusCbs.push(cb);
    return () => { _statusCbs = _statusCbs.filter(f => f !== cb); };
  }

  function roomExists(code) {
    return !!localStorage.getItem('kq_room_' + code.toUpperCase());
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  function _send(conn, msg) {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch (e) {
      console.warn('[DB] send error:', e);
    }
  }

  function _broadcast(msg) {
    // To all PeerJS remotes
    _remoteConns.forEach(c => _send(c, msg));
    // To same-device tabs via BroadcastChannel
    if (_bc && _role === 'display') {
      try { _bc.postMessage(msg); } catch {}
    }
  }

  function _sendToDisplay(msg) {
    if (_displayConn && _displayConn.open) {
      _send(_displayConn, msg);
    } else if (_bc) {
      try { _bc.postMessage(msg); } catch {}
    }
  }

  function _notifyPlaylist(songs) { _playlistCbs.forEach(cb => cb(songs)); }
  function _notifyState(state)   { _stateCbs.forEach(cb => cb(state)); }
  function _notifyStatus(status) { _statusCbs.forEach(cb => cb(status)); }

  // ─── localStorage ─────────────────────────────────────────────────────────

  function _saveToStorage() {
    try {
      localStorage.setItem('kq_room_' + _room, JSON.stringify({
        playlist: _playlist,
        state: _state,
        ts: Date.now()
      }));
    } catch {}
  }

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem('kq_room_' + _room);
      if (raw) {
        const saved = JSON.parse(raw);
        _playlist = saved.playlist || [];
        _state    = saved.state    || { playerState: 'idle', volume: APP_SETTINGS.defaultVolume };
      } else {
        _playlist = [];
        _state = { playerState: 'idle', volume: APP_SETTINGS.defaultVolume };
      }
    } catch {
      _playlist = [];
      _state = { playerState: 'idle', volume: APP_SETTINGS.defaultVolume };
    }
  }

  // Called from index.html to reset room data
  function createRoom() {
    _playlist = [];
    _state = { playerState: 'idle', volume: APP_SETTINGS.defaultVolume };
    try {
      localStorage.setItem('kq_room_' + _room, JSON.stringify({
        playlist: [], state: _state, ts: Date.now()
      }));
    } catch {}
  }

  return {
    get mode() { return _mode; },
    get role() { return _role; },
    get roomCode() { return _room; },
    init,
    addSong,
    removeSong,
    reorderPlaylist,
    setState,
    onPlaylistChange,
    onStateChange,
    onStatusChange,
    roomExists,
    createRoom
  };
})();
