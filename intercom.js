/*
 * INTERCOM dos celulares da equipe — WebRTC de áudio em malha (cada um fala com todos),
 * só na rede local. O servidor só repassa a negociação (ic:join / ic:signal / ic:talk).
 * Usado por /movel (operador) e /cel (câmera de celular).
 *
 *   const ic = Intercom({ send, name, posto, onPeers, onMsg });
 *   ic.handle(msg)        // mensagens ic:* que chegarem no WebSocket
 *   await ic.join()       // pede o microfone e entra
 *   ic.talk(true/false)   // segure pra falar (com todo mundo)
 *   ic.talk(true, id)     // falar SÓ com essa pessoa (cada conexão tem a sua cópia do microfone)
 *   ic.leave(); ic.setVolume(0–1); ic.reconnected()
 *   await ic.devices()    // { mics, outs } (nomes aparecem depois de liberar o microfone)
 *   await ic.setMic(id)   // troca o microfone (na hora, mesmo conectado)
 *   await ic.setOutput(id)// onde ouvir (fone, alto-falante, Bluetooth…) — se o celular deixar
 *   ic.level()            // 0–1: volume do microfone agora (pro medidor)
 *
 * SEGUNDO PLANO: entrou no intercom → o celular trata como "mídia tocando" (notificação "Intercom
 * ligado" no Android): dá pra usar outros apps e continuar ouvindo. Saiu do app segurando o botão
 * → o microfone fecha (com "microfone aberto" ligado, continua aberto). Voltou pro app → confere
 * as conexões e refaz as que caíram.
 */
(() => {
  window.Intercom = function Intercom(o) {
    let myId = null;
    let mic = null;
    let talking = false;
    let talkTo = null; // id de quem ouve quando é conversa particular (null = todo mundo)
    let volume = 1;
    const KEY_MIC = 'aranas.ic.mic', KEY_OUT = 'aranas.ic.out';
    const load = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
    const store = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* */ } };
    let micId = load(KEY_MIC);
    let outId = load(KEY_OUT);
    let meter = null; // { ctx, an, buf }
    const pcs = new Map(); // id -> { pc, audio }
    let peers = [];
    const num = (id) => parseInt(String(id).slice(1), 36);

    function makePc(id) {
      const pc = new RTCPeerConnection({ iceServers: [] });
      // cada pessoa recebe uma CÓPIA do microfone: dá pra abrir só pra ela (conversa particular)
      const track = mic.getAudioTracks()[0].clone();
      track.enabled = talking && (!talkTo || talkTo === id);
      pc.addTrack(track, new MediaStream([track]));
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = volume;
      if (outId && audio.setSinkId) audio.setSinkId(outId).catch(() => {});
      document.body.appendChild(audio);
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => o.onMsg?.('toque na tela para ativar o som'));
      };
      pc.onicecandidate = (e) => { if (e.candidate) o.send({ type: 'ic:signal', to: id, data: { cand: e.candidate } }); };
      const x = { pc, audio, track };
      pcs.set(id, x);
      return x;
    }
    async function call(id) {
      const { pc } = makePc(id);
      await pc.setLocalDescription(await pc.createOffer());
      o.send({ type: 'ic:signal', to: id, data: { sdp: pc.localDescription } });
    }
    async function onSignal(from, data) {
      if (!mic) return;
      let x = pcs.get(from);
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!x) x = makePc(from);
          await x.pc.setRemoteDescription(data.sdp);
          await x.pc.setLocalDescription(await x.pc.createAnswer());
          o.send({ type: 'ic:signal', to: from, data: { sdp: x.pc.localDescription } });
        } else if (x) await x.pc.setRemoteDescription(data.sdp);
      } else if (data.cand && x) {
        try { await x.pc.addIceCandidate(data.cand); } catch { /* candidato velho */ }
      }
    }
    function onPeers(list) {
      peers = list;
      o.onPeers?.(list, myId);
      if (!mic || !myId) return;
      const ids = new Set(list.map((p) => p.id));
      for (const [id, x] of pcs) if (!ids.has(id)) { x.pc.close(); x.audio.remove(); x.track?.stop(); pcs.delete(id); }
      // quem chegou depois (id maior) liga pros que já estavam
      for (const p of list) if (p.id !== myId && !pcs.has(p.id) && num(myId) > num(p.id)) call(p.id);
    }
    async function openMic() {
      const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: micId ? { ...base, deviceId: { exact: micId } } : base });
      } catch (e) {
        if (!micId) throw e;
        micId = ''; // o escolhido sumiu (fone desconectado): volta pro padrão
        store(KEY_MIC, '');
        return navigator.mediaDevices.getUserMedia({ audio: base });
      }
    }
    function watchLevel() {
      try {
        meter?.ctx.close();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        // medidor ouve o microfone mesmo com o "segure pra falar" solto (cópia da trilha, sempre ligada)
        const t = mic.getAudioTracks()[0]?.clone();
        if (!t) return;
        ctx.createMediaStreamSource(new MediaStream([t])).connect(an);
        meter = { ctx, an, buf: new Uint8Array(an.fftSize), track: t };
      } catch { meter = null; }
    }
    /* ── segundo plano ── */
    let keep = null; // <audio> tocando um som inaudível em loop: segura o áudio do celular ligado
    function silentWav(sec = 10, rate = 8000) {
      const n = sec * rate;
      const b = new ArrayBuffer(44 + n * 2);
      const v = new DataView(b);
      const w = (o2, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o2 + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, n * 2, true);
      // ±1 de 32768: ninguém ouve, mas não é "silêncio digital" (o celular não desliga o áudio)
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, (i & 1) ? 1 : -1, true);
      return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    }
    function background(on) {
      if (on) {
        if (!keep) {
          keep = new Audio(silentWav());
          keep.loop = true;
          keep.volume = 0.01;
          keep.setAttribute('playsinline', '');
        }
        keep.play().catch(() => {});
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({ title: '🎧 Intercom ligado', artist: `Copa Aranãs · equipe${o.name ? ' · ' + o.name() : ''}`, album: 'volte no app e segure pra falar' });
            navigator.mediaSession.playbackState = 'playing';
            // "pausar" na notificação não derruba o intercom: continua tocando
            for (const a of ['pause', 'stop']) navigator.mediaSession.setActionHandler(a, () => { keep?.play().catch(() => {}); navigator.mediaSession.playbackState = 'playing'; });
            navigator.mediaSession.setActionHandler('play', () => keep?.play().catch(() => {}));
          } catch { /* navegador sem controle de mídia */ }
        }
      } else {
        keep?.pause();
        if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch { /* */ } }
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (!mic) return;
      if (document.hidden) {
        // saiu do app: "segure pra falar" solta (o microfone aberto, se ligado, continua)
        if (talking && (talkTo || !o.openMic?.())) {
          talkTo = null;
          talking = !!o.openMic?.();
          applyTalk();
          o.send({ type: 'ic:talk', on: talking });
          o.onTalk?.(talking);
        }
        keep?.play().catch(() => {});
      } else {
        // voltou: toca de novo o que o celular pausou e refaz as conexões que caíram
        pcs.forEach((x) => x.audio.paused && x.audio.play().catch(() => {}));
        keep?.play().catch(() => {});
        let broken = false;
        for (const [id, x] of pcs) if (['failed', 'closed', 'disconnected'].includes(x.pc.connectionState)) { x.pc.close(); x.audio.remove(); x.track?.stop(); pcs.delete(id); broken = true; }
        if (broken) o.send({ type: 'ic:join', name: o.name(), posto: o.posto?.() });
      }
    });

    /* ── consumo de rede (aba Rede do painel): o que este celular manda/recebe no intercom ── */
    let netLast = null;
    setInterval(async () => {
      if (!mic || !pcs.size) { netLast = null; return; }
      let tx = 0, rx = 0;
      for (const [, x] of pcs) {
        try {
          (await x.pc.getStats()).forEach((r) => {
            if (r.type === 'outbound-rtp' && r.kind === 'audio') tx += r.bytesSent || 0;
            if (r.type === 'inbound-rtp' && r.kind === 'audio') rx += r.bytesReceived || 0;
          });
        } catch { /* conexão fechando */ }
      }
      const t = performance.now();
      if (netLast && t > netLast.t) {
        const k = (b, a) => Math.max(0, Math.round(((b - a) * 8) / 1000 / ((t - netLast.t) / 1000)));
        fetch('/api/rede/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: myId || o.name(), kind: 'intercom', name: o.name(), tx: k(tx, netLast.tx), rx: k(rx, netLast.rx) }) }).catch(() => {});
      }
      netLast = { tx, rx, t };
    }, 3000);

    function closeAll() { for (const [, x] of pcs) { x.pc.close(); x.audio.remove(); x.track?.stop(); } pcs.clear(); }
    /** liga/desliga a cópia do microfone de cada conexão conforme quem deve ouvir */
    function applyTalk() { for (const [id, x] of pcs) if (x.track) x.track.enabled = talking && (!talkTo || talkTo === id); }
    document.addEventListener('click', () => pcs.forEach((x) => x.audio.paused && x.audio.play().catch(() => {})));

    return {
      handle(m) {
        if (m.type === 'ic:hello') myId = m.id;
        else if (m.type === 'ic:peers') onPeers(m.peers);
        else if (m.type === 'ic:signal') onSignal(m.from, m.data);
      },
      async join() {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('este navegador não libera o microfone aqui — abra pelo link seguro (https)');
        mic = await openMic();
        watchLevel();
        background(true);
        this.talk(false);
        o.send({ type: 'ic:join', name: o.name(), posto: o.posto?.() });
      },
      leave() {
        o.send({ type: 'ic:leave' });
        closeAll();
        mic?.getTracks().forEach((t) => t.stop());
        mic = null;
        try { meter?.track.stop(); meter?.ctx.close(); } catch { /* */ }
        meter = null;
        background(false);
      },
      talk(on, to = null) {
        talking = !!on;
        talkTo = on && to ? to : null;
        applyTalk();
        o.send({ type: 'ic:talk', on: talking, ...(talkTo ? { to: talkTo } : {}) });
      },
      setVolume(v) { volume = v; pcs.forEach((x) => (x.audio.volume = v)); },
      async devices() {
        const all = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) || [];
        const name = (d, i, w) => d.label || `${w} ${i + 1}`;
        const mics = all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: name(d, i, 'Microfone') }));
        const outs = all.filter((d) => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: name(d, i, 'Saída') }));
        return { mics, outs, canOut: 'setSinkId' in HTMLMediaElement.prototype, mic: micId, out: outId };
      },
      async setMic(id) {
        micId = id || '';
        store(KEY_MIC, micId);
        if (!mic) return;
        const fresh = await openMic();
        // troca a cópia do microfone em todas as conexões (sem derrubar ninguém)
        for (const [id, x] of pcs) {
          const nt = fresh.getAudioTracks()[0].clone();
          nt.enabled = talking && (!talkTo || talkTo === id);
          for (const sd of x.pc.getSenders()) if (sd.track?.kind === 'audio' || sd.track === null) await sd.replaceTrack(nt).catch(() => {});
          x.track?.stop();
          x.track = nt;
        }
        mic.getTracks().forEach((t) => t.stop());
        mic = fresh;
        try { meter?.track.stop(); } catch { /* */ }
        watchLevel();
      },
      async setOutput(id) {
        outId = id || '';
        store(KEY_OUT, outId);
        const all = [...pcs.values()].map((x) => x.audio);
        if (!all.length || !all[0].setSinkId) return 'setSinkId' in HTMLMediaElement.prototype;
        await Promise.all(all.map((a) => a.setSinkId(outId).catch(() => {})));
        return true;
      },
      level() {
        if (!meter) return 0;
        meter.an.getByteTimeDomainData(meter.buf);
        let m = 0;
        for (const v of meter.buf) m = Math.max(m, Math.abs(v - 128));
        return Math.min(1, m / 90);
      },
      /** toca um bipe na saída escolhida (pra conferir onde o som sai) */
      async testOutput() {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o2.frequency.value = 880;
        g.gain.value = 0.25;
        o2.connect(g).connect(dest);
        const a = new Audio();
        a.srcObject = dest.stream;
        if (outId && a.setSinkId) await a.setSinkId(outId).catch(() => {});
        o2.start();
        await a.play().catch(() => {});
        setTimeout(() => { o2.stop(); a.pause(); ctx.close(); }, 450);
      },
      /** o WebSocket caiu e voltou: entra de novo */
      reconnected() { myId = null; closeAll(); if (mic) o.send({ type: 'ic:join', name: o.name(), posto: o.posto?.() }); },
      get joined() { return !!mic; },
      get talking() { return talking; },
      get talkTo() { return talkTo; },
      pcs,
      peers: () => peers,
      id: () => myId,
    };
  };
})();
