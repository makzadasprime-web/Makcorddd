/* =========================================================
   APP.js — orquestra as telas e liga a UI ao CallManager
   ========================================================= */
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const screens = {
    welcome: $('#screen-welcome'),
    lobby: $('#screen-lobby'),
    room: $('#screen-room'),
  };
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  let chosenName = '';
  let myAvatar = null;       // dataURL ou null
  let micStates = {};        // id -> muted bool
  let voiceRosters = {};     // channelId -> [ids]
  let screenStreams = {};    // id -> {stream, name}
  let audioEls = {};         // id -> <audio> element for remote voice
  let micIsMuted = false;
  let activeTextChannel = null;
  let chatHistory = {};      // channelId -> array of render-jobs {kind:'msg'|'sys', ...}
  let wantScreenAudio = true;
  let sharingScreen = false;
  const SERVERS_KEY = 'makcord:servers';

  /* ---------- avatar helpers ---------- */
  function colorFor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360} 62% 46%)`;
  }
  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }
  function avatarHtml(id, name, avatar, sizeClass) {
    if (avatar) return `<img class="${sizeClass}" src="${avatar}" alt="">`;
    return `<div class="${sizeClass}" style="background:${colorFor(id)}">${initials(name)}</div>`;
  }

  /* ===================== TELA 1: BOAS-VINDAS ===================== */
  async function initWelcome() {
    const { name, ip } = await Identity.getRememberedName();
    const hint = $('#ip-hint');
    const input = $('#input-name');
    if (name) {
      input.value = name;
      hint.textContent = `Lembramos você como "${name}" neste endereço de rede. Pode trocar se quiser.`;
    } else if (ip) {
      hint.textContent = 'Vamos lembrar esse nome pra você neste navegador/rede da próxima vez.';
    } else {
      hint.textContent = '';
    }
    myAvatar = await Identity.getRememberedAvatar();
    input.focus();
  }

  $('#btn-continue').addEventListener('click', continueFromWelcome);
  $('#input-name').addEventListener('keydown', e => { if (e.key === 'Enter') continueFromWelcome(); });

  async function continueFromWelcome() {
    const name = $('#input-name').value.trim();
    if (!name) { $('#input-name').focus(); return; }
    chosenName = name;
    await Identity.rememberName(name);
    CallManager.setAvatar(myAvatar);
    $('#lobby-username').textContent = name;
    $('#settings-name').value = name;
    renderServerRail();
    showScreen('lobby');

    // se veio de um link de convite (?room=CODIGO), já preenche e vai pra aba "entrar"
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      switchTab('join');
      $('#input-room-code').value = roomParam.toUpperCase();
    }
  }

  $('#btn-not-you').addEventListener('click', async () => {
    await Identity.forget();
    showScreen('welcome');
    $('#input-name').value = '';
    $('#ip-hint').textContent = '';
    $('#input-name').focus();
  });

  /* ===================== TELA 2: LOBBY ===================== */
  function switchTab(tab) {
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-create').classList.toggle('hidden', tab !== 'create');
    $('#tab-join').classList.toggle('hidden', tab !== 'join');
    $('#lobby-error').textContent = '';
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#btn-create-room').addEventListener('click', async () => {
    setLobbyLoading(true);
    try {
      const svName = $('#input-server-name').value.trim();
      const { roomCode, serverName } = await CallManager.createRoom(chosenName, svName);
      saveServerToRail(roomCode, serverName);
      enterRoom(roomCode);
    } catch (err) {
      $('#lobby-error').textContent = err.message || 'Não foi possível criar o servidor.';
    }
    setLobbyLoading(false);
  });

  $('#btn-join-room').addEventListener('click', async () => {
    const code = $('#input-room-code').value.trim();
    if (!code) return;
    setLobbyLoading(true);
    try {
      const { roomCode, serverName } = await CallManager.joinRoom(code, chosenName);
      saveServerToRail(roomCode, serverName);
      enterRoom(roomCode);
    } catch (err) {
      $('#lobby-error').textContent = err.message || 'Não foi possível entrar no servidor.';
    }
    setLobbyLoading(false);
  });
  $('#input-room-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join-room').click(); });

  function setLobbyLoading(loading) {
    $('#btn-create-room').disabled = loading;
    $('#btn-join-room').disabled = loading;
  }

  /* ===================== ABA DE SERVIDORES (rail) ===================== */
  function getSavedServers() {
    try { return JSON.parse(localStorage.getItem(SERVERS_KEY)) || []; } catch (e) { return []; }
  }
  function saveServerToRail(code, name) {
    let list = getSavedServers().filter(s => s.code !== code);
    list.unshift({ code, name: name || code });
    list = list.slice(0, 12);
    try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)); } catch (e) {}
    renderServerRail();
  }
  function renderServerRail() {
    const rail = $('#server-rail-list');
    if (!rail) return;
    rail.innerHTML = '';
    getSavedServers().forEach(s => {
      const btn = document.createElement('button');
      const active = CallManager.roomCode === s.code;
      btn.className = 'rail-server' + (active ? ' active' : '');
      btn.title = s.name;
      btn.textContent = initials(s.name || s.code);
      btn.addEventListener('click', () => switchServer(s.code));
      rail.appendChild(btn);
    });
  }
  async function switchServer(code) {
    if (CallManager.roomCode === code) return;
    if (CallManager.roomCode) CallManager.leaveRoom();
    resetRoomUiState();
    try {
      const { roomCode, serverName } = await CallManager.joinRoom(code, chosenName);
      saveServerToRail(roomCode, serverName);
      enterRoom(roomCode);
    } catch (err) {
      showScreen('lobby');
      renderServerRail();
      $('#lobby-error').textContent = err.message || 'Não foi possível entrar nesse servidor.';
    }
  }
  $('#btn-rail-add').addEventListener('click', () => {
    if (CallManager.roomCode) CallManager.leaveRoom();
    resetRoomUiState();
    renderServerRail();
    showScreen('lobby');
    switchTab('create');
  });

  function resetRoomUiState() {
    micStates = {}; voiceRosters = {}; screenStreams = {}; audioEls = {};
    micIsMuted = false; sharingScreen = false; chatHistory = {}; activeTextChannel = null;
  }

  /* ===================== TELA 3: SALA/SERVIDOR ===================== */
  function enterRoom(roomCode) {
    $('#server-name-display').textContent = CallManager.serverName || roomCode;
    $('#room-code-display').textContent = roomCode;
    $('#mini-name').textContent = chosenName;
    $('#mini-avatar-wrap').innerHTML = avatarHtml(CallManager.myId, chosenName, myAvatar, 'mini-avatar');
    $('#mini-status').textContent = CallManager.isHost ? 'Você criou este servidor' : 'Conectado';
    history.replaceState(null, '', location.pathname); // limpa ?room= da URL
    showScreen('room');
    renderServerRail();
    renderMembers();
    renderChannels();
    loadDeviceLists();
  }

  CallManager.on({
    roster: () => renderMembers(),
    channels: list => renderChannels(list),
    chatMessage: renderChatMessage,
    systemMessage: text => renderSystemMessage(text, activeTextChannel),
    connectionState: state => {
      const pill = $('#connection-pill');
      pill.textContent = state === 'connected' ? 'conectado' : 'desconectado';
      pill.classList.toggle('live', state === 'connected');
    },
    voiceRoster: (channelId, ids) => { voiceRosters[channelId] = ids; renderChannels(); if (channelId === CallManager.myVoiceChannel) renderCallStrip(); },
    voiceJoined: channelId => onVoiceJoined(channelId),
    voiceLeft: () => onVoiceLeft(),
    voiceDenied: () => renderSystemMessage('Esse canal de voz está cheio no momento.', activeTextChannel),
    micState: (id, muted) => { micStates[id] = muted; renderCallStrip(); renderMembers(); },
    speaking: (id, isSpeaking) => setSpeakingUI(id, isSpeaking),
    remoteStream: (id, stream, kind, name) => {
      if (kind === 'call') attachRemoteAudio(id, stream);
      else if (kind === 'screen') addScreenShareBanner(id, stream, name || (CallManager.getMemberList().find(m => m.id === id) || {}).name || 'Alguém');
    },
    remoteStreamEnded: (id, kind) => {
      if (kind === 'call') detachRemoteAudio(id);
      else if (kind === 'screen') removeScreenShareBanner(id);
    },
  });

  function renderMembers() {
    const list = CallManager.getMemberList();
    const el = $('#member-list');
    el.innerHTML = '';
    list.forEach(m => {
      const inVoiceChannelId = Object.keys(voiceRosters).find(cid => (voiceRosters[cid] || []).includes(m.id));
      const ch = inVoiceChannelId ? CallManager.getChannelList().find(c => c.id === inVoiceChannelId) : null;
      const muted = !!micStates[m.id];
      const row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML = `
        <div class="member-avatar-wrap" data-speaker="${m.id}">
          ${avatarHtml(m.id, m.name, m.avatar, 'member-avatar')}
          <div class="mic-badge ${ch ? (muted ? 'muted' : '') : 'hidden-badge'}">${muted ? '🔇' : (ch ? '🎤' : '')}</div>
        </div>
        <div>
          <div class="member-name">${escapeHtml(m.name)}${m.id === CallManager.myId ? ' (você)' : ''}</div>
          <div class="member-tag">${m.id === CallManager.myId && CallManager.isHost ? 'dono do servidor' : ''}${ch ? ' 🔊 ' + escapeHtml(ch.name) : ''}</div>
        </div>`;
      el.appendChild(row);
    });
  }

  function renderCallStrip() {
    const strip = $('#call-strip');
    strip.innerHTML = '';
    const chId = CallManager.myVoiceChannel;
    if (!chId) return;
    const list = CallManager.getMemberList();
    (voiceRosters[chId] || []).forEach(id => {
      const m = list.find(x => x.id === id) || { id, name: '...' };
      const tile = document.createElement('div');
      tile.className = 'call-tile';
      tile.dataset.speaker = id;
      const muted = !!micStates[id];
      tile.innerHTML = `
        ${muted ? '<span class="tile-mic">🔇</span>' : ''}
        ${avatarHtml(id, m.name, m.avatar, 'tile-avatar')}
        <div class="tile-name">${escapeHtml(m.name)}${id === CallManager.myId ? ' (você)' : ''}</div>`;
      strip.appendChild(tile);
    });
  }

  function setSpeakingUI(id, speaking) {
    $$(`[data-speaker="${CSS.escape(id)}"]`).forEach(elWrap => {
      elWrap.classList.toggle('speaking', speaking);
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ---------- canais ---------- */
  function renderChannels(list) {
    const channels = list || CallManager.getChannelList();
    const textChannels = channels.filter(c => c.type === 'text');
    const voiceChannels = channels.filter(c => c.type === 'voice');

    if (!activeTextChannel || !textChannels.find(c => c.id === activeTextChannel)) {
      activeTextChannel = textChannels[0] ? textChannels[0].id : null;
      renderChatForActiveChannel();
    }

    const textBox = $('#channel-list-text');
    textBox.innerHTML = '';
    textChannels.forEach(c => {
      const row = document.createElement('button');
      row.className = 'channel-row' + (c.id === activeTextChannel ? ' active' : '');
      row.innerHTML = `<span class="channel-hash">#</span><span class="channel-name">${escapeHtml(c.name)}</span>`;
      row.addEventListener('click', () => selectTextChannel(c.id));
      textBox.appendChild(row);
    });

    const voiceBox = $('#channel-list-voice');
    voiceBox.innerHTML = '';
    voiceChannels.forEach(c => {
      const roster = voiceRosters[c.id] || [];
      const iAmIn = CallManager.myVoiceChannel === c.id;
      const row = document.createElement('button');
      row.className = 'channel-row voice-row' + (iAmIn ? ' active' : '');
      row.innerHTML = `<span class="channel-hash">🔊</span><span class="channel-name">${escapeHtml(c.name)}</span><span class="channel-cap">${roster.length}/${c.cap}</span>`;
      row.addEventListener('click', () => toggleVoiceChannel(c.id));
      voiceBox.appendChild(row);
    });

    $('#btn-add-voice-channel').classList.toggle('hidden', !CallManager.isHost);
    $('#btn-add-text-channel').classList.toggle('hidden', !CallManager.isHost);
  }

  function selectTextChannel(id) {
    activeTextChannel = id;
    renderChannels();
    renderChatForActiveChannel();
    const ch = CallManager.getChannelList().find(c => c.id === id);
    $('#main-header-title').textContent = '💬 #' + (ch ? ch.name : '');
    $('#chat-input').placeholder = 'Conversar em #' + (ch ? ch.name : '');
  }

  async function toggleVoiceChannel(id) {
    if (CallManager.myVoiceChannel === id) {
      CallManager.leaveVoiceChannel();
      return;
    }
    try {
      await CallManager.joinVoiceChannel(id);
    } catch (err) {
      renderSystemMessage('Não foi possível acessar o microfone: ' + err.message, activeTextChannel);
    }
  }

  function onVoiceJoined(channelId) {
    const ch = CallManager.getChannelList().find(c => c.id === channelId);
    $('#call-bar-info').textContent = '🔊 ' + (ch ? ch.name : 'canal de voz');
    $('#btn-leave-call').classList.remove('hidden');
    $('#btn-toggle-mic').disabled = false;
    $('#btn-toggle-screen').disabled = false;
    $('#btn-toggle-screen-audio').disabled = false;
    renderChannels();
    renderCallStrip();
  }
  function onVoiceLeft() {
    micIsMuted = false;
    $('#call-bar-info').textContent = 'Não conectado a nenhum canal de voz';
    $('#btn-leave-call').classList.add('hidden');
    $('#btn-toggle-mic').disabled = true;
    $('#btn-toggle-mic').classList.remove('active-off');
    $('#btn-toggle-screen').disabled = true;
    $('#btn-toggle-screen-audio').disabled = true;
    stopScreenShareUI();
    $('#call-strip').innerHTML = '';
    renderChannels();
  }
  $('#btn-leave-call').addEventListener('click', () => CallManager.leaveVoiceChannel());
  $('#btn-toggle-mic').addEventListener('click', () => {
    micIsMuted = CallManager.toggleMic();
    $('#btn-toggle-mic').classList.toggle('active-off', micIsMuted);
    $('#btn-toggle-mic').textContent = micIsMuted ? '🔇' : '🎤';
  });

  /* ---------- criar canal (modal) ---------- */
  let newChannelType = 'text';
  function openNewChannelModal(type) {
    newChannelType = type;
    $('#new-channel-title').textContent = type === 'voice' ? 'Criar canal de voz' : 'Criar canal de texto';
    $('#new-channel-name').value = '';
    $('#new-channel-cap-row').classList.toggle('hidden', type !== 'voice');
    $('#new-channel-cap').value = 10;
    $('#modal-new-channel').classList.remove('hidden');
    $('#new-channel-name').focus();
  }
  $('#btn-add-text-channel').addEventListener('click', () => openNewChannelModal('text'));
  $('#btn-add-voice-channel').addEventListener('click', () => openNewChannelModal('voice'));
  $('#btn-close-new-channel').addEventListener('click', () => $('#modal-new-channel').classList.add('hidden'));
  $('#btn-create-channel').addEventListener('click', () => {
    const name = $('#new-channel-name').value.trim();
    if (!name) { $('#new-channel-name').focus(); return; }
    const cap = $('#new-channel-cap').value;
    CallManager.createChannel(name, newChannelType, cap);
    $('#modal-new-channel').classList.add('hidden');
  });

  /* ---------- chat ---------- */
  function renderChatForActiveChannel() {
    const box = $('#chat-messages');
    box.innerHTML = '';
    (chatHistory[activeTextChannel] || []).forEach(job => job.kind === 'msg' ? paintChatMessage(job.msg) : paintSystemMessage(job.text));
    box.scrollTop = box.scrollHeight;
    const ch = CallManager.getChannelList().find(c => c.id === activeTextChannel);
    if (ch) {
      $('#main-header-title').textContent = '💬 #' + ch.name;
      $('#chat-input').placeholder = 'Conversar em #' + ch.name;
    }
  }
  function renderChatMessage(msg) {
    const cid = msg.channelId || activeTextChannel;
    if (!chatHistory[cid]) chatHistory[cid] = [];
    chatHistory[cid].push({ kind: 'msg', msg });
    if (cid === activeTextChannel) paintChatMessage(msg);
  }
  function paintChatMessage(msg) {
    const box = $('#chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row';
    const time = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const m = CallManager.getMemberList().find(x => x.id === msg.id);
    row.innerHTML = `
      ${avatarHtml(msg.id, msg.name, m && m.avatar, 'msg-avatar')}
      <div class="msg-body">
        <div class="msg-head"><span class="msg-author">${escapeHtml(msg.name)}</span><span class="msg-time">${time}</span></div>
        <div class="msg-text"></div>
      </div>`;
    row.querySelector('.msg-text').textContent = msg.text;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }
  function renderSystemMessage(text, cid) {
    const channelId = cid || activeTextChannel;
    if (!chatHistory[channelId]) chatHistory[channelId] = [];
    chatHistory[channelId].push({ kind: 'sys', text });
    if (channelId === activeTextChannel) paintSystemMessage(text);
  }
  function paintSystemMessage(text) {
    const box = $('#chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-system';
    row.textContent = text;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  $('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !activeTextChannel) return;
    CallManager.sendChat(text, activeTextChannel);
    input.value = '';
  });

  /* ---------- compartilhamento de tela ---------- */
  $('#btn-toggle-screen-audio').addEventListener('click', () => {
    wantScreenAudio = !wantScreenAudio;
    $('#btn-toggle-screen-audio').classList.toggle('active-on', wantScreenAudio);
    $('#btn-toggle-screen-audio').title = wantScreenAudio ? 'Áudio da tela: ativado (clique pra desativar)' : 'Áudio da tela: desativado (clique pra ativar)';
  });

  $('#btn-toggle-screen').addEventListener('click', async () => {
    if (sharingScreen) { stopScreenShareUI(); return; }
    try {
      const { hasAudio } = await CallManager.startScreenShare(wantScreenAudio);
      sharingScreen = true;
      $('#btn-toggle-screen').classList.add('active-on');
      renderSystemMessage('Você começou a compartilhar sua tela (720p · 30fps)' + (hasAudio ? ', com áudio.' : '.'), activeTextChannel);
    } catch (err) {
      // usuário cancelou o picker de tela, ou navegador sem suporte
    }
  });
  function stopScreenShareUI() {
    if (!sharingScreen) return;
    CallManager.stopScreenShare();
    sharingScreen = false;
    $('#btn-toggle-screen').classList.remove('active-on');
    renderSystemMessage('Você parou de compartilhar a tela.', activeTextChannel);
  }

  /* ---------- áudio remoto (mic dos outros) ---------- */
  function attachRemoteAudio(id, stream) {
    detachRemoteAudio(id);
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = stream;
    if (CallManager.currentSpeakerDeviceId && audio.setSinkId) {
      audio.setSinkId(CallManager.currentSpeakerDeviceId).catch(() => {});
    }
    $('#audio-sinks').appendChild(audio);
    audioEls[id] = audio;
  }
  function detachRemoteAudio(id) {
    if (audioEls[id]) { audioEls[id].remove(); delete audioEls[id]; }
  }

  CallManager.on({
    speakerDeviceChanged: deviceId => {
      Object.values(audioEls).forEach(el => { if (el.setSinkId) el.setSinkId(deviceId).catch(() => {}); });
      const viewerVideo = $('#screen-viewer-video');
      if (viewerVideo.setSinkId) viewerVideo.setSinkId(deviceId).catch(() => {});
    },
  });

  /* ---------- compartilhamento de tela: notificação permanente ---------- */
  function addScreenShareBanner(id, stream, name) {
    screenStreams[id] = { stream, name };
    renderScreenBanners();
  }
  function removeScreenShareBanner(id) {
    delete screenStreams[id];
    renderScreenBanners();
    const viewer = $('#screen-viewer');
    if (viewer.dataset.activeId === id) closeViewer();
  }
  function renderScreenBanners() {
    const container = $('#screenshare-banners');
    container.innerHTML = '';
    Object.entries(screenStreams).forEach(([id, { name }]) => {
      const banner = document.createElement('div');
      banner.className = 'screenshare-banner';
      banner.innerHTML = `
        <span>🖥️ <strong>${escapeHtml(name)}</strong> está compartilhando a tela agora</span>
        <button class="btn btn-small btn-primary" data-watch="${id}">Assistir</button>`;
      container.appendChild(banner);
    });
    container.querySelectorAll('[data-watch]').forEach(btn => {
      btn.addEventListener('click', () => openViewer(btn.dataset.watch));
    });
  }
  function openViewer(id) {
    const entry = screenStreams[id];
    if (!entry) return;
    const viewer = $('#screen-viewer');
    const video = $('#screen-viewer-video');
    video.srcObject = entry.stream;
    viewer.dataset.activeId = id;
    viewer.classList.remove('hidden');
    viewer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function closeViewer() {
    const viewer = $('#screen-viewer');
    const video = $('#screen-viewer-video');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    video.srcObject = null;
    viewer.classList.add('hidden');
    delete viewer.dataset.activeId;
  }
  $('#btn-close-viewer').addEventListener('click', closeViewer);

  /* ---------- tela cheia ---------- */
  $('#btn-fullscreen-viewer').addEventListener('click', () => {
    const video = $('#screen-viewer-video');
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
  });
  $('#screen-viewer-video').addEventListener('dblclick', () => $('#btn-fullscreen-viewer').click());

  /* ---------- convite ---------- */
  $('#btn-copy-invite').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${CallManager.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      renderSystemMessage('Link de convite copiado! Envie para quem você quiser chamar.', activeTextChannel);
    } catch (e) {
      prompt('Copie o link do servidor:', url);
    }
  });

  /* ===================== CONFIGURAÇÕES ===================== */
  $('#btn-open-settings').addEventListener('click', () => {
    $('#avatar-preview-wrap').innerHTML = avatarHtml(CallManager.myId || 'me', chosenName, myAvatar, 'avatar-preview');
    $('#modal-settings').classList.remove('hidden');
  });
  $('#btn-close-settings').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));

  /* ---------- foto de perfil ---------- */
  $('#btn-choose-avatar').addEventListener('click', () => $('#input-avatar-file').click());
  $('#input-avatar-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 128);
      myAvatar = dataUrl;
      $('#avatar-preview-wrap').innerHTML = avatarHtml(CallManager.myId || 'me', chosenName, myAvatar, 'avatar-preview');
    } catch (err) {
      renderSystemMessage('Não foi possível carregar essa imagem.', activeTextChannel);
    }
    e.target.value = '';
  });
  $('#btn-remove-avatar').addEventListener('click', () => {
    myAvatar = null;
    $('#avatar-preview-wrap').innerHTML = avatarHtml(CallManager.myId || 'me', chosenName, myAvatar, 'avatar-preview');
  });

  function resizeImageToDataUrl(file, size) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('leitura falhou'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagem inválida'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadDeviceLists() {
    const { mics, speakers } = await CallManager.listDevices();
    const micSelect = $('#select-mic');
    const speakerSelect = $('#select-speaker');
    micSelect.innerHTML = mics.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Microfone ' + (i + 1)}</option>`).join('');
    if (CallManager.speakerSupported()) {
      speakerSelect.innerHTML = speakers.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Saída ' + (i + 1)}</option>`).join('');
      speakerSelect.disabled = false;
      $('#speaker-support-hint').textContent = '';
    } else {
      speakerSelect.innerHTML = '<option>Padrão do sistema</option>';
      speakerSelect.disabled = true;
      $('#speaker-support-hint').textContent = 'Seu navegador não permite trocar a saída de áudio por aqui (funciona no Chrome/Edge desktop). O som sai pelo dispositivo padrão do sistema.';
    }
  }

  $('#btn-save-settings').addEventListener('click', async () => {
    const micId = $('#select-mic').value;
    const speakerId = $('#select-speaker').value;
    const newName = $('#settings-name').value.trim();

    if (micId) await CallManager.setMicDevice(micId);
    if (speakerId && CallManager.speakerSupported()) CallManager.setSpeakerDevice(speakerId);
    if (newName && newName !== chosenName) {
      chosenName = newName;
      await Identity.rememberName(newName);
      CallManager.changeName(newName);
      $('#mini-name').textContent = newName;
    }
    if (myAvatar !== CallManager.myAvatar) {
      CallManager.changeAvatar(myAvatar);
      await Identity.rememberAvatar(myAvatar);
    }
    $('#mini-avatar-wrap').innerHTML = avatarHtml(CallManager.myId, chosenName, myAvatar, 'mini-avatar');
    renderMembers();
    $('#modal-settings').classList.add('hidden');
  });

  $('#btn-leave-room').addEventListener('click', () => {
    CallManager.leaveRoom();
    location.href = location.pathname;
  });

  /* ===================== START ===================== */
  initWelcome();
})();
