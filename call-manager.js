/* =========================================================
   CALL-MANAGER.js

   Arquitetura de rede (importante entender, já que GitHub Pages
   não tem servidor próprio):

   - A sinalização (troca inicial de "endereços" pra conexão P2P)
     usa o broker público e gratuito do PeerJS. Ele só ajuda dois
     navegadores a se encontrarem; depois disso o áudio/vídeo vai
     direto entre os navegadores (WebRTC).
   - Quem CRIA o servidor vira o "dono": o ID dele no PeerJS é o
     próprio código do servidor. Quem entra usa um ID aleatório e
     se conecta ao dono por um canal de dados.
   - Chat e lista de membros: topologia "estrela" — todo mundo
     fala com o dono, e o dono retransmite pra todo mundo.
   - Canais: um servidor tem N canais de texto e N canais de voz.
     O dono cria os canais (nome + tipo; canais de voz também têm
     um limite de 1 a 50 pessoas). Todo mundo no servidor vê todos
     os canais.
   - Chamada de voz e compartilhamento de tela: topologia "malha"
     (mesh) só entre quem está DENTRO DO MESMO CANAL DE VOZ — cada
     participante se conecta diretamente com cada outro participante
     daquele canal.
   - Entrar num canal de voz passa pelo dono, que valida o limite
     de vagas do canal antes de admitir.
   - Limite de 40 pessoas no servidor (texto/geral) é controlado
     pelo dono; cada canal de voz tem seu próprio limite (1–50).
   - Se o dono sair, o servidor se encerra (sem eleição de novo
     dono nesta versão) — os outros precisam entrar em outro.
   ========================================================= */

const CallManager = (() => {
  const MAX_MEMBERS = 40;
  const SPEAKING_THRESHOLD = 0.045;

  let peer = null;
  let myId = null;
  let myName = null;
  let myAvatar = null;    // dataURL ou null
  let isHost = false;
  let roomCode = null;
  let serverName = null;

  let members = {};        // id -> {id, name, avatar}
  let micMuted = false;

  let channels = {};        // id -> {id, name, type:'text'|'voice', cap}
  let channelMembers = {};  // channelId -> Set(ids) — só canais de voz
  let myVoiceChannel = null;

  let hostDataConns = {};  // (host only) id -> DataConnection
  let hostConn = null;     // (non-host) DataConnection to host

  let localStream = null;      // mic stream (audio)
  let localScreenStream = null;
  let mediaCalls = {};          // peerId -> MediaConnection (voice)
  let screenCallsOut = {};      // peerId -> MediaConnection (screen, outgoing)
  let currentMicDeviceId = null;
  let currentSpeakerDeviceId = null;

  let audioCtx = null;
  const analysers = {}; // id -> {analyser, raf}

  let handlers = {}; // set by app.js via CallManager.on(...)

  function on(eventMap) { handlers = { ...handlers, ...eventMap }; }
  function fire(name, ...args) { if (handlers[name]) handlers[name](...args); }

  function genCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function genChannelId() { return 'ch-' + Math.random().toString(36).slice(2, 10); }

  function peerIdForRoom(code) { return 'makcord-room-' + code; }

  function defaultChannels() {
    const textId = genChannelId();
    const voiceId = genChannelId();
    return {
      [textId]: { id: textId, name: 'geral', type: 'text' },
      [voiceId]: { id: voiceId, name: 'Geral', type: 'voice', cap: 6 },
    };
  }

  /* ---------------- creating / joining a room ---------------- */

  function createRoom(name, svName) {
    return new Promise((resolve, reject) => {
      myName = name;
      roomCode = genCode();
      serverName = (svName || '').trim() || `Servidor de ${name}`;
      isHost = true;
      channels = defaultChannels();
      channelMembers = {};
      Object.values(channels).forEach(c => { if (c.type === 'voice') channelMembers[c.id] = new Set(); });
      peer = new Peer(peerIdForRoom(roomCode), { debug: 1 });

      peer.on('open', id => {
        myId = id;
        members[myId] = { id: myId, name: myName, avatar: myAvatar };
        setupIncomingCallHandling();
        setupHostConnectionHandling();
        fire('roster', getMemberList());
        fire('channels', getChannelList());
        fire('connectionState', 'connected');
        resolve({ roomCode, serverName });
      });
      peer.on('error', err => handlePeerError(err, reject));
    });
  }

  function joinRoom(code, name) {
    return new Promise((resolve, reject) => {
      myName = name;
      roomCode = code.trim().toUpperCase();
      isHost = false;
      peer = new Peer({ debug: 1 });

      peer.on('open', id => {
        myId = id;
        setupIncomingCallHandling();

        const conn = peer.connect(peerIdForRoom(roomCode), { reliable: true });
        hostConn = conn;

        const failTimer = setTimeout(() => {
          reject(new Error('Não foi possível encontrar esse servidor. Confira o código.'));
        }, 9000);

        conn.on('open', () => {
          conn.send({ type: 'join', id: myId, name: myName, avatar: myAvatar });
        });

        conn.on('data', msg => {
          if (msg.type === 'roster') {
            clearTimeout(failTimer);
            members = {};
            msg.members.forEach(m => (members[m.id] = m));
            members[myId] = { id: myId, name: myName, avatar: myAvatar };
            serverName = msg.serverName;
            channels = msg.channels || {};
            channelMembers = {};
            Object.entries(msg.channelMembers || {}).forEach(([cid, ids]) => { channelMembers[cid] = new Set(ids); });
            fire('roster', getMemberList());
            fire('channels', getChannelList());
            fire('connectionState', 'connected');
            resolve({ roomCode, serverName });
          } else if (msg.type === 'room-full') {
            clearTimeout(failTimer);
            reject(new Error('Esse servidor já está cheio.'));
          } else {
            handleIncomingMessage(msg);
          }
        });

        conn.on('close', () => {
          fire('connectionState', 'disconnected');
          fire('systemMessage', 'A conexão com o servidor foi perdida.');
        });
      });

      peer.on('error', err => handlePeerError(err, reject));
    });
  }

  function handlePeerError(err, reject) {
    console.error('Makcord peer error:', err);
    if (err.type === 'unavailable-id') {
      reject(new Error('Não foi possível criar o servidor agora, tente novamente.'));
    } else if (err.type === 'peer-unavailable') {
      reject(new Error('Servidor não encontrado. Confira o código com quem te convidou.'));
    } else {
      fire('systemMessage', 'Erro de rede: ' + err.type);
    }
  }

  /* ---------------- host: accepting data connections ---------------- */

  function setupHostConnectionHandling() {
    peer.on('connection', conn => {
      conn.on('open', () => {
        // wait for the 'join' message before admitting
      });
      conn.on('data', msg => {
        if (msg.type === 'join') {
          if (Object.keys(members).length >= MAX_MEMBERS) {
            conn.send({ type: 'room-full' });
            setTimeout(() => conn.close(), 500);
            return;
          }
          hostDataConns[msg.id] = conn;
          members[msg.id] = { id: msg.id, name: msg.name, avatar: msg.avatar || null };

          conn.send({
            type: 'roster',
            members: getMemberList(),
            serverName,
            channels,
            channelMembers: serializeChannelMembers(),
          });

          hostBroadcast({ type: 'member-joined', id: msg.id, name: msg.name, avatar: msg.avatar || null }, msg.id);
          fire('roster', getMemberList());
          fire('systemMessage', `${msg.name} entrou no servidor.`);
        } else {
          handleIncomingMessage(msg, conn.peer);
        }
      });
      conn.on('close', () => {
        const leavingId = conn.peer;
        if (members[leavingId]) {
          const name = members[leavingId].name;
          delete members[leavingId];
          delete hostDataConns[leavingId];
          removeFromAllVoiceChannels(leavingId);
          hostBroadcast({ type: 'member-left', id: leavingId });
          fire('roster', getMemberList());
          fire('systemMessage', `${name} saiu do servidor.`);
          fire('remoteStreamEnded', leavingId, 'call');
        }
      });
    });
  }

  function hostBroadcast(msg, excludeId = null) {
    Object.entries(hostDataConns).forEach(([id, conn]) => {
      if (id !== excludeId && conn.open) conn.send(msg);
    });
  }
  function hostSendTo(id, msg) {
    const conn = hostDataConns[id];
    if (conn && conn.open) conn.send(msg);
  }

  function serializeChannelMembers() {
    const out = {};
    Object.entries(channelMembers).forEach(([cid, set]) => { out[cid] = Array.from(set); });
    return out;
  }
  function removeFromAllVoiceChannels(id) {
    Object.entries(channelMembers).forEach(([cid, set]) => {
      if (set.delete(id)) fire('voiceRoster', cid, Array.from(set));
    });
  }

  /* ---------------- unified message handling ---------------- */

  function handleIncomingMessage(msg, fromId = null) {
    switch (msg.type) {
      case 'chat':
        fire('chatMessage', msg);
        if (isHost) hostBroadcast(msg, fromId);
        break;
      case 'member-joined':
        members[msg.id] = { id: msg.id, name: msg.name, avatar: msg.avatar || null };
        fire('roster', getMemberList());
        fire('systemMessage', `${msg.name} entrou no servidor.`);
        break;
      case 'member-left':
        if (members[msg.id]) {
          fire('systemMessage', `${members[msg.id].name} saiu do servidor.`);
          delete members[msg.id];
        }
        removeFromAllVoiceChannels(msg.id);
        fire('roster', getMemberList());
        fire('remoteStreamEnded', msg.id, 'call');
        break;
      case 'name-changed':
        if (members[msg.id]) members[msg.id].name = msg.name;
        fire('roster', getMemberList());
        if (isHost) hostBroadcast(msg, fromId);
        break;
      case 'avatar-changed':
        if (members[msg.id]) members[msg.id].avatar = msg.avatar;
        fire('roster', getMemberList());
        if (isHost) hostBroadcast(msg, fromId);
        break;

      /* ---- canais ---- */
      case 'channel-create':
        channels[msg.channel.id] = msg.channel;
        if (msg.channel.type === 'voice' && !channelMembers[msg.channel.id]) channelMembers[msg.channel.id] = new Set();
        fire('channels', getChannelList());
        fire('systemMessage', `Canal "${msg.channel.name}" foi criado.`);
        break;

      /* ---- entrar em canal de voz (só o dono decide) ---- */
      case 'call-join-request':
        if (isHost) {
          const ok = hostAdmitVoice(msg.id, msg.channelId);
          if (ok) {
            hostBroadcast({ type: 'call-join', id: msg.id, channelId: msg.channelId });
            if (msg.id !== myId) hostSendTo(msg.id, { type: 'call-join', id: msg.id, channelId: msg.channelId });
          } else {
            hostSendTo(msg.id, { type: 'call-join-denied', id: msg.id, channelId: msg.channelId });
          }
        }
        break;
      case 'call-join':
        if (!channelMembers[msg.channelId]) channelMembers[msg.channelId] = new Set();
        channelMembers[msg.channelId].add(msg.id);
        fire('voiceRoster', msg.channelId, Array.from(channelMembers[msg.channelId]));
        if (msg.id === myId) applyLocalVoiceJoin(msg.channelId);
        else if (myVoiceChannel === msg.channelId && localStream) connectVoicePeer(msg.id);
        break;
      case 'call-join-denied':
        if (msg.id === myId) fire('voiceDenied', msg.channelId);
        break;
      case 'call-left':
        if (channelMembers[msg.channelId]) channelMembers[msg.channelId].delete(msg.id);
        fire('voiceRoster', msg.channelId, Array.from(channelMembers[msg.channelId] || []));
        fire('remoteStreamEnded', msg.id, 'call');
        cleanupMediaCall(msg.id);
        if (isHost) hostBroadcast(msg, fromId);
        break;
      case 'mic-state':
        fire('micState', msg.id, msg.muted);
        if (isHost) hostBroadcast(msg, fromId);
        break;
    }
  }

  function send(msg) {
    if (isHost) {
      // dono aplica ao próprio estado; cada case de handleIncomingMessage
      // já retransmite pros outros membros quando isHost === true.
      handleIncomingMessage(msg, null);
    } else if (hostConn && hostConn.open) {
      hostConn.send(msg);
    }
  }

  function getMemberList() {
    return Object.values(members);
  }
  function getChannelList() {
    return Object.values(channels);
  }
  function getVoiceRoster(channelId) {
    return Array.from(channelMembers[channelId] || []);
  }

  /* ---------------- chat ---------------- */

  function sendChat(text, channelId) {
    const msg = { type: 'chat', channelId, id: myId, name: myName, text, ts: Date.now() };
    fire('chatMessage', msg); // echo local imediato
    if (isHost) hostBroadcast(msg);
    else if (hostConn && hostConn.open) hostConn.send(msg);
  }

  function changeName(newName) {
    myName = newName;
    if (members[myId]) members[myId].name = newName;
    send({ type: 'name-changed', id: myId, name: newName });
  }

  function setAvatar(dataUrl) {
    myAvatar = dataUrl;
  }

  function changeAvatar(dataUrl) {
    myAvatar = dataUrl;
    if (members[myId]) members[myId].avatar = dataUrl;
    send({ type: 'avatar-changed', id: myId, avatar: dataUrl });
  }

  /* ---------------- canais ---------------- */

  function createChannel(name, type, cap) {
    if (!isHost) return null;
    const id = genChannelId();
    const channel = { id, name: name.trim().slice(0, 30) || (type === 'voice' ? 'Canal de voz' : 'canal-de-texto'), type };
    if (type === 'voice') {
      channel.cap = Math.min(50, Math.max(1, parseInt(cap, 10) || 10));
      channelMembers[id] = new Set();
    }
    channels[id] = channel;
    fire('channels', getChannelList());
    hostBroadcast({ type: 'channel-create', channel });
    return channel;
  }

  function hostAdmitVoice(id, channelId) {
    const ch = channels[channelId];
    if (!ch || ch.type !== 'voice') return false;
    if (!channelMembers[channelId]) channelMembers[channelId] = new Set();
    if (channelMembers[channelId].has(id)) return true;
    if (channelMembers[channelId].size >= (ch.cap || 50)) return false;
    return true; // a adição de fato acontece em handleIncomingMessage's 'call-join'
  }

  /* ---------------- voice call (mesh, por canal) ---------------- */

  function setupIncomingCallHandling() {
    peer.on('call', call => {
      const meta = call.metadata || {};
      if (meta.kind === 'screen') {
        call.answer(); // só recebendo, não manda stream de volta
        call.on('stream', stream => {
          fire('remoteStream', call.peer, stream, 'screen', meta.name);
        });
        call.on('close', () => fire('remoteStreamEnded', call.peer, 'screen'));
        return;
      }
      // chamada de voz
      if (!localStream) {
        call.close();
        return;
      }
      call.answer(localStream);
      mediaCalls[call.peer] = call;
      call.on('stream', stream => {
        fire('remoteStream', call.peer, stream, 'call');
        attachSpeakingDetector(call.peer, stream);
      });
      call.on('close', () => cleanupMediaCall(call.peer));
    });
  }

  function connectVoicePeer(id) {
    if (mediaCalls[id] || !localStream) return;
    const call = peer.call(id, localStream, { metadata: { name: myName, kind: 'call' } });
    mediaCalls[id] = call;
    call.on('stream', stream => {
      fire('remoteStream', id, stream, 'call');
      attachSpeakingDetector(id, stream);
    });
    call.on('close', () => cleanupMediaCall(id));
  }

  async function joinVoiceChannel(channelId) {
    if (myVoiceChannel === channelId) return;
    if (!channels[channelId] || channels[channelId].type !== 'voice') return;
    if (myVoiceChannel) leaveVoiceChannel();

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: currentMicDeviceId ? { deviceId: { exact: currentMicDeviceId } } : true,
      });
      attachSpeakingDetector(myId, localStream, true);
    }

    send({ type: 'call-join-request', id: myId, channelId });
  }

  function applyLocalVoiceJoin(channelId) {
    myVoiceChannel = channelId;
    fire('voiceJoined', channelId);
    getVoiceRoster(channelId).forEach(id => { if (id !== myId) connectVoicePeer(id); });
  }

  function leaveVoiceChannel() {
    if (!myVoiceChannel) return;
    const channelId = myVoiceChannel;
    Object.values(mediaCalls).forEach(c => c.close());
    mediaCalls = {};
    stopScreenShare();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    detachSpeakingDetector(myId);
    myVoiceChannel = null;
    send({ type: 'call-left', id: myId, channelId });
    fire('voiceLeft', channelId);
  }

  function cleanupMediaCall(id) {
    delete mediaCalls[id];
    detachSpeakingDetector(id);
  }

  function toggleMic() {
    if (!localStream) return micMuted;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach(t => (t.enabled = !micMuted));
    send({ type: 'mic-state', id: myId, muted: micMuted });
    return micMuted;
  }

  /* ---------------- screen share ---------------- */

  async function startScreenShare(withAudio) {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    });
    localScreenStream.getVideoTracks()[0].addEventListener('ended', () => stopScreenShare());

    getVoiceRoster(myVoiceChannel).forEach(id => {
      if (id === myId) return;
      const call = peer.call(id, localScreenStream, { metadata: { name: myName, kind: 'screen' } });
      screenCallsOut[id] = call;
    });
    return { stream: localScreenStream, hasAudio: localScreenStream.getAudioTracks().length > 0 };
  }

  function stopScreenShare() {
    Object.values(screenCallsOut).forEach(c => c.close());
    screenCallsOut = {};
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(t => t.stop());
      localScreenStream = null;
    }
  }

  /* ---------------- devices ---------------- */

  async function listDevices() {
    // pede permissão primeiro pra enumerateDevices trazer labels
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (e) { /* usuário pode negar; segue mesmo assim */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter(d => d.kind === 'audioinput'),
      speakers: devices.filter(d => d.kind === 'audiooutput'),
    };
  }

  async function setMicDevice(deviceId) {
    currentMicDeviceId = deviceId;
    if (!localStream) return;
    const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    const newTrack = newStream.getAudioTracks()[0];
    newTrack.enabled = !micMuted;

    Object.values(mediaCalls).forEach(call => {
      const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(newTrack);
    });

    localStream.getAudioTracks().forEach(t => t.stop());
    localStream = newStream;
    attachSpeakingDetector(myId, localStream, true);
  }

  function setSpeakerDevice(deviceId) {
    currentSpeakerDeviceId = deviceId;
    fire('speakerDeviceChanged', deviceId);
  }

  function speakerSupported() {
    const el = document.createElement('audio');
    return typeof el.setSinkId === 'function';
  }

  /* ---------------- speaking detector (assinatura visual) ---------------- */

  function attachSpeakingDetector(id, stream, isLocal = false) {
    detachSpeakingDetector(id);
    if (!stream.getAudioTracks().length) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let speaking = false;
    function loop() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = rms > SPEAKING_THRESHOLD;
      if (now !== speaking) {
        speaking = now;
        fire('speaking', id, speaking);
      }
      analysers[id].raf = requestAnimationFrame(loop);
    }
    analysers[id] = { analyser, source, raf: null };
    loop();
  }

  function detachSpeakingDetector(id) {
    const a = analysers[id];
    if (a) {
      if (a.raf) cancelAnimationFrame(a.raf);
      try { a.source.disconnect(); } catch (e) {}
      delete analysers[id];
    }
  }

  /* ---------------- teardown ---------------- */

  function leaveRoom() {
    leaveVoiceChannel();
    if (isHost) {
      Object.values(hostDataConns).forEach(c => c.close());
    } else if (hostConn) {
      hostConn.close();
    }
    if (peer) peer.destroy();
    peer = null; members = {}; hostDataConns = {}; hostConn = null;
    channels = {}; channelMembers = {}; myVoiceChannel = null;
  }

  return {
    on,
    createRoom, joinRoom, leaveRoom,
    sendChat, changeName, changeAvatar, setAvatar,
    createChannel, getChannelList, getVoiceRoster,
    joinVoiceChannel, leaveVoiceChannel, toggleMic,
    startScreenShare, stopScreenShare,
    listDevices, setMicDevice, setSpeakerDevice, speakerSupported,
    getMemberList,
    get myId() { return myId; },
    get myName() { return myName; },
    get myAvatar() { return myAvatar; },
    get isHost() { return isHost; },
    get roomCode() { return roomCode; },
    get serverName() { return serverName; },
    get myVoiceChannel() { return myVoiceChannel; },
    get currentSpeakerDeviceId() { return currentSpeakerDeviceId; },
  };
})();
