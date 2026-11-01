/* MODO TREINO do app da Copa Aranãs: a mesma tela do app da equipe, mas nada sai daqui.
   - as leituras (placar, escalações, patrocinadores, mascote…) vêm de demo-dados.js (uma foto do sistema)
   - os toques que no jogo mandariam algo pro PC só mostram um aviso do que aconteceria */
(function () {
  const D = window.__DEMO_DADOS || {};
  const PAINEL = !!window.__DEMO_PAINEL;
  // a raiz do site (onde está o demo.js): o painel monta foto/escudo como <servidor> + /logos/… → o "servidor" é o site
  const RAIZ = (document.currentScript && document.currentScript.src || location.href).replace(/\/demo\.js.*$/, '');
  window.__DEMO_RAIZ = RAIZ;
  try { localStorage.setItem('aranas.serverBase', RAIZ); } catch (e) { /* */ }
  // no painel os caminhos são absolutos (/logos/x.png), no app relativos (logos/x.png)
  const ABS = /^(logos|sponsors-arte|sponsors|marca|competition|mascote|ui|app-icon)\//;
  const absoluto = (o) => Array.isArray(o) ? o.map(absoluto) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, absoluto(v)])) : typeof o === 'string' && ABS.test(o) ? '/' + o
    // foto do jogador: só a versão pequena (rosto) está no site
    : typeof o === 'string' && /^\/?(players|coaches)\//.test(o) ? o.replace(/^\/?(players|coaches)\//, '/rostos/$1/') : o;
  let estado = window.__DEMO_ESTADO || {};

  // já entra como "Aprendiz" (pula o "Quem é você?") e não oferece instalar
  try {
    if (!localStorage.getItem('aranas.equipe.me')) localStorage.setItem('aranas.equipe.me', JSON.stringify({ name: 'Aprendiz' }));
    localStorage.setItem('aranas.install.no', '1');
  } catch (e) { /* */ }

  /* ── o que cada toque faria no jogo de verdade ── */
  const O_QUE = [
    [/replay\/phone\/now|replay\/phone$/, 'grava o replay dos últimos segundos e coloca no ar'],
    [/replay\/phone\/cancel/, 'cancela o replay'],
    [/replay\/phone\/air/, 'coloca esse replay no ar de novo'],
    [/match\/event/, 'atualiza o placar/cronômetro na transmissão'],
    [/penalties/, 'atualiza a disputa de pênaltis na tela'],
    [/telas\/air|cena/, 'troca a tela da transmissão'],
    [/musica/, 'mexe na música do PC'],
    [/lineup|rosters/, 'mostra a escalação na transmissão'],
    [/craque/, 'atualiza a votação do craque do jogo'],
    [/drone/, 'liga/desliga a imagem do drone'],
    [/patrocinio/, 'coloca a arte do patrocinador na tela'],
    [/locucao/, 'grava a locução do patrocinador'],
    [/tabela/, 'mostra a tabela na transmissão'],
    [/mascote\/atualizar/, 'procura vídeos novos na pasta do mascote'],
    [/elenco/, 'salva no elenco pros próximos jogos (aqui no treino não fica salvo)'],
    [/mascote/, 'coloca o mascote na tela'],
    [/efeitos\/tocar/, 'toca o efeito NA LIVE (aqui no treino ele toca só no seu celular)'],
    [/efeitos/, ''],
    [/virais/, 'salva o lance na pasta 15 - Virais (deitado e em pé)'],
    [/tarjas/, 'mostra a tarja na tela'],
    [/relogio/, 'acerta o cronômetro do placar'],
    [/ytela|ytchat/, 'mostra o vídeo / os comentários do YouTube'],
    [/temas|takes/, 'põe os takes do cinegrafista no ar'],
    [/bate/, 'monta o bate-papo / entrevista na tela'],
    [/dividida/, 'divide a tela (jogo + outra câmera)'],
    [/artilheiro/, 'mostra o autor do gol'],
    [/melhores/, 'passa os melhores momentos'],
    [/lances/, 'marca o lance pra replay'],
    [/cine/, 'mexe nos takes do cinegrafista'],
    [/equipe/, ''],
  ];
  const oQue = (p) => (O_QUE.find(([re]) => re.test(p)) || [, 'manda o comando pro PC'])[1];

  /* ── alguns toques mudam a tela, pra ficar parecido com o de verdade ── */
  let somTreino = null;
  function efeito(p, b) {
    if (p === '/api/mascote/atualizar') return { total: (D['/api/mascote']?.videos ?? []).length, novos: [] };
    const fx = D['/api/efeitos'];
    if (fx && p === '/api/efeitos/tocar') {
      // no treino o som toca AQUI no celular (no jogo ele vai pra live e pras caixas do PC)
      try { somTreino?.pause(); } catch (e) { /* */ }
      somTreino = new Audio(RAIZ + '/efeitos-som/' + encodeURIComponent(b.arquivo));
      somTreino.play().catch(() => {});
      const e = fx.efeitos.find((x) => x.arquivo === b.arquivo);
      if (e) { e.usos = (e.usos || 0) + 1; e.ultimo = Date.now(); }
      fx.tocando = b.arquivo; setTimeout(() => { if (fx.tocando === b.arquivo) fx.tocando = ''; }, 2500);
      fx.efeitos.sort((a, c) => Number(!!c.fixado) - Number(!!a.fixado) || c.usos - a.usos || (c.ultimo || 0) - (a.ultimo || 0) || a.nome.localeCompare(c.nome, 'pt'));
    }
    if (fx && p === '/api/efeitos/parar') { try { somTreino?.pause(); } catch (e) { /* */ } fx.tocando = ''; }
    if (fx && p === '/api/efeitos/fixar') {
      const e = fx.efeitos.find((x) => x.arquivo === b.arquivo);
      if (e) { e.fixado = !e.fixado; fx.efeitos.sort((a, c) => Number(!!c.fixado) - Number(!!a.fixado) || c.usos - a.usos || a.nome.localeCompare(c.nome, 'pt')); return { fixado: e.fixado }; }
    }
    if (fx && p === '/api/efeitos/editar') { const e = fx.efeitos.find((x) => x.arquivo === b.arquivo); if (e) { if (b.nome) e.nome = b.nome; if (b.emoji) e.emoji = b.emoji; if (b.setor) e.setor = b.setor; if (b.semFoto) delete e.img; } }
    if (fx && p === '/api/efeitos/volume') fx.volume = b.volume;
    if (fx && p === '/api/efeitos/setor' && b.acao === 'criar' && b.nome) { const id = 's' + Date.now().toString(36); fx.setores.splice(fx.setores.length - 1, 0, { id, nome: b.nome }); return { id }; }
    const tj = D['/api/tarjas'];
    if (tj && p === '/api/tarjas/salvar' && b.titulo) { const t = { id: b.id || 't' + Date.now().toString(36), tipo: b.tipo, titulo: b.titulo, sub: b.sub }; tj.lista = [t, ...tj.lista.filter((x) => x.id !== t.id)]; }
    if (tj && p === '/api/tarjas/apagar') tj.lista = tj.lista.filter((x) => x.id !== b.id);
    if (tj && p === '/api/tarjas/mostrar') { tj.noAr = b.id || 'avulsa'; setTimeout(() => { tj.noAr = ''; }, (b.segundos || 8) * 1000); }
    if (tj && p === '/api/tarjas/tirar') tj.noAr = '';
    const m = D['/api/mascote'];
    if (m && p === '/api/mascote/tocar') { m.tocando = b.id; setTimeout(() => { m.tocando = null; }, 10000); }
    if (m && p === '/api/mascote/parar') m.tocando = null;
    if (m && p === '/api/mascote/config') { Object.assign(m, b); m.proximoEm = b.aleatorio ? (m.minMin || 8) * 60000 : null; }
    if (m && p === '/api/mascote/sorteio') { const v = m.videos.find((x) => x.id === b.id); if (v) v.sorteio = !!b.on; }
    if (p === '/api/bate/tv/mostrar' && D['/api/bate/tv']) D['/api/bate/tv'].mostrando = b.id || null;
    if (p === '/api/match/event' && b && estado.score) {
      // gol / tira gol: o placar do app acompanha
      const lado = b.team || b.side;
      if (/goal/i.test(b.type || b.event || '') && lado && estado.score[lado] != null) {
        estado = { ...estado, score: { ...estado.score, [lado]: Math.max(0, estado.score[lado] + (/undo|minus|remove/i.test(b.type || '') ? -1 : 1)) } };
        manda();
      }
    }
  }

  /* ── fetch: /api/… responde daqui ── */
  let ultimoToque = 0;
  addEventListener('pointerdown', () => { ultimoToque = Date.now(); }, true);
  addEventListener('change', () => { ultimoToque = Date.now(); }, true);
  const fetchReal = window.fetch.bind(window);
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return fetchReal(input, init);
    const p = url.pathname.slice(i);
    const metodo = ((init && init.method) || 'GET').toUpperCase();
    let corpo = {};
    try { corpo = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { /* */ }
    let r;
    if (metodo === 'GET') r = D[p + url.search] || D[p] || { ok: true };
    else {
      const extra = efeito(p, corpo) || {};
      const t = oQue(p);
      // só avisa o que veio de um TOQUE (o app também manda coisas sozinho ao abrir)
      if (t && Date.now() - ultimoToque < 2500) aviso(`🎓 No jogo, isto ${t}.`);
      r = { ok: true, ...(D[p] || {}), ...extra };
    }
    if (PAINEL) r = absoluto(r);
    await espera(120);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  };

  /* ── WebSocket: entrega o estado do placar e não manda nada ── */
  const abertos = [];
  function manda() { const e = PAINEL ? absoluto(estado) : estado; for (const w of abertos) if (w.onmessage) w.onmessage({ data: JSON.stringify({ type: 'state:snapshot', state: e }) }); }
  class WSDemo {
    constructor() {
      this.readyState = 0;
      abertos.push(this);
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({}); manda(); }, 300);
      this.url = 'ws://treino';
    }
    send() { /* treino: não envia */ }
    close() { this.readyState = 3; }
    addEventListener(t, f) { this['on' + t] = f; }
    removeEventListener() { /* */ }
  }
  WSDemo.CONNECTING = 0; WSDemo.OPEN = 1; WSDemo.CLOSING = 2; WSDemo.CLOSED = 3;
  window.WebSocket = WSDemo;

  /* ── telas que no jogo abrem outra página ── */
  const TELAS = {
    'replay-mobile': ['⏪ Replay no celular', 'Abre a lista dos últimos lances. Você arrasta a "lupa" pra achar o momento exato, volta/avança 1, 5 ou 10 segundos e toca em NO AR — o replay entra na transmissão.'],
    cel: ['📱 Virar câmera', 'O celular vira uma câmera da transmissão: filma e manda a imagem pro PC (OBS). Tem zoom, GRAVAR (o PC corta o take) e mostra quando a sua câmera está NO AR.'],
    'editor-cine': ['🎬 Editor do cinegrafista', 'Lista os takes gravados pela câmera do celular: assistir, cortar, compartilhar e colocar no ar.'],
  };
  window.__demoIr = function (url) {
    const nome = (String(url).match(/\/([a-z-]+)/) || [])[1];
    const [t, d] = TELAS[nome] || ['Outra tela', 'No jogo, isto abre outra tela do sistema.'];
    caixa(`<b style="font-size:20px">${t}</b><p style="margin:12px 0 0;line-height:1.45">${d}</p><p style="margin:12px 0 0;color:#9fb3a8;font-size:13px">No treino essa tela não abre — ela precisa do PC da transmissão ligado.</p>`);
  };

  /* ── avisos ── */
  let tAviso = 0;
  function aviso(txt) {
    let el = document.getElementById('demoAviso');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demoAviso';
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:58px;z-index:99999;background:#13261c;color:#e8f5ec;border:1px solid #3ddc5a;border-radius:12px;padding:10px 14px;font:600 14px/1.35 Inter,system-ui,sans-serif;box-shadow:0 6px 24px #0008;transition:opacity .25s;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = txt;
    el.style.opacity = '1';
    clearTimeout(tAviso);
    tAviso = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }
  function caixa(html) {
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px';
    f.innerHTML = `<div style="background:#101b16;color:#e8f5ec;border:1px solid #2c4a3a;border-radius:16px;padding:22px;max-width:420px;font:15px/1.4 Inter,system-ui,sans-serif">${html}<button style="margin-top:18px;width:100%;min-height:48px;border-radius:12px;border:0;background:#3ddc5a;color:#052;font-weight:800;font-size:16px">Entendi</button></div>`;
    f.onclick = (e) => { if (e.target === f || e.target.tagName === 'BUTTON') f.remove(); };
    document.body.appendChild(f);
  }

  /* ── faixa fixa: deixa claro que é treino ── */
  document.addEventListener('DOMContentLoaded', () => {
    if (PAINEL) return; // dentro do app a faixa já aparece
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#f5c518;color:#1a1300;text-align:center;font:800 13px/1 Inter,system-ui,sans-serif;padding:12px 8px calc(12px + env(safe-area-inset-bottom));letter-spacing:.3px';
    f.innerHTML = '🎓 MODO TREINO — pode tocar em tudo, nada vai pra transmissão';
    document.body.appendChild(f);
    document.body.style.paddingBottom = '48px';
  });
})();
