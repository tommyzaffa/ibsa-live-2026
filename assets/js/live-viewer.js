(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { request, tail } = window.IBSALive;
  const params = new URLSearchParams(location.search);
  const room = (window.IBSA_LIVE && window.IBSA_LIVE.room) || 'ibsa';
  let client; let channel; let snapshot; let connected = false; let fetching = false;
  let stopped = false; let booting = false; let poll; let tick; let bootTimer; let shown = '';
  // The audience reads the page in the language the talk is translated into.
  const copy = {
    it: { label: 'SOTTOTITOLI IN ITALIANO · IN TEMPO REALE', event: 'Intelligenza artificiale in biomedicina',
      eventLine: 'IBSA Foundation Forum · Lugano, 6 novembre 2026',
      source: 'Traduzione automatica in tempo reale.', accuracy: 'Nomi ed espressioni possono contenere errori.',
      size: 'Dimensione del testo', standard: 'Testo standard', large: 'Testo grande', fullscreen: 'Schermo intero',
      ended: 'Intervento terminato', reconnecting: 'Riconnessione…',
      connecting: 'Avvio…', live: 'In diretta', preview: 'Anteprima',
      waiting: 'I sottotitoli appariranno quando inizia l’intervento.',
      thanks: 'Grazie per aver seguito l’intervento.',
      interrupted: 'Il collegamento si è interrotto. Il testo qui sopra è l’ultimo ricevuto.',
      unavailable: 'I sottotitoli non sono ancora disponibili. Nuovo tentativo tra poco…',
      notConnected: 'Non collegato' },
    en: { label: 'LIVE ENGLISH CAPTIONS', event: 'Artificial Intelligence in Biomedicine',
      eventLine: 'IBSA Foundation Forum · Lugano, 6 November 2026',
      source: 'Automatically translated in real time.', accuracy: 'Names and expressions may contain errors.',
      size: 'Caption size', standard: 'Standard text', large: 'Large text', fullscreen: 'Full screen',
      ended: 'Talk ended', reconnecting: 'Reconnecting…',
      connecting: 'Starting…', live: 'Live', preview: 'Preview',
      waiting: 'Captions will appear when the talk begins.',
      thanks: 'Thank you for joining us.',
      interrupted: 'The live connection was interrupted. The text above is the last caption received.',
      unavailable: 'Live captions are not available yet. Retrying shortly…',
      notConnected: 'Not connected' },
  };
  let words = copy.it;
  function speak(language) {
    if (language === shown) return;
    shown = language; words = copy[language] || copy.it;
    document.documentElement.lang = language;
    $('captions').lang = language; $('stage-label').textContent = words.label;
    $('source-note').textContent = words.source; $('accuracy-note').textContent = words.accuracy;
    $('size-label').textContent = words.size; $('fullscreen').textContent = words.fullscreen;
    $('text-size').options[0].textContent = words.standard; $('text-size').options[1].textContent = words.large;
    $('event-line').textContent = words.eventLine;
  }

  // ---- The projected QR slide (?qr=1) -------------------------------------
  if (params.get('qr') === '1') {
    const target = location.origin + location.pathname;
    $('audience').hidden = true; $('qr-slide').hidden = false;
    document.body.classList.add('qr-mode');
    $('qr-slide-url').textContent = target.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const script = document.createElement('script');
    script.src = 'assets/js/vendor/qr-creator-1.0.0.min.js';
    script.onload = () => window.QrCreator.render({ text: target, size: 720, ecLevel: 'M', fill: '#0b2c3d', background: '#ffffff', radius: 0 }, $('qr-slide-code'));
    document.head.append(script);
    return;
  }

  if (params.get('screen') === '1') { document.body.classList.add('screen-mode'); document.body.dataset.size = 'large'; $('text-size').value = 'large'; }
  $('text-size').onchange = () => { document.body.dataset.size = $('text-size').value; render(); };
  // iPhone Safari cannot put a page in full screen: hide what it cannot do.
  if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* the browser said no; the page still works */ }
  };

  // A phone that dims during a forty-minute talk loses the reader. Ask the
  // browser to keep the screen on while the page is open; it may refuse.
  let wake = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && !wake && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } } catch (_) { /* not supported or not allowed */ }
  }
  document.addEventListener('pointerdown', () => { void keepAwake(); }, { passive: true });

  // ---- Painting -------------------------------------------------------------
  // Append only what is new: rewriting the paragraph re-wraps every line and
  // the reader loses their place. New words fade in, then the window glides up.
  let painted = '';
  const glide = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The room publishes a rolling window of the last 1400 characters, so after a
  // couple of minutes a new reading no longer *starts* with what is on screen:
  // it is the same text shifted left plus a short tail. Find that tail.
  function appended(text) {
    if (!painted) return null;
    if (text.startsWith(painted)) return text.slice(painted.length);
    for (let keep = Math.min(painted.length, text.length); keep >= 40; keep--) {
      if (painted.endsWith(text.slice(0, keep))) return text.slice(keep);
    }
    return null; // a different talk, or a gap too long to bridge
  }
  function paint(text, placeholder) {
    const caption = $('captions'); const frame = $('caption-window');
    const grown = text ? appended(text) : null;
    if (!text) { caption.textContent = placeholder; painted = ''; }
    // The paragraph restarts about twice an hour so the browser is never
    // re-laying out an essay on every word: one jump, not one per update.
    else if (grown === null || painted.length > 24000) { caption.textContent = text; painted = text; }
    else if (grown) {
      const fresh = document.createElement('span');
      fresh.className = 'fresh'; fresh.textContent = grown;
      caption.append(fresh); painted += grown;
    }
    const bottom = frame.scrollHeight - frame.clientHeight;
    // A new line glides up; a jump of more than one window (a new talk, a phone
    // waking up) snaps instead. A hidden tab cannot animate, so never queue a
    // glide there: it would simply never arrive.
    const far = document.hidden || bottom - frame.scrollTop > frame.clientHeight;
    frame.scrollTo({ top: bottom, behavior: glide && !far ? 'smooth' : 'instant' });
  }
  function render() {
    if (!snapshot) return;
    speak(copy[snapshot.language] ? snapshot.language : 'it');
    const age = Date.now() - Date.parse(snapshot.updated_at);
    const stale = age > 30000;
    // The lease lives 45 seconds, so a room nobody has written to in three
    // minutes has no control room behind it: it is waiting, not showing a talk.
    const state = age > 180000 ? 'idle' : snapshot.state;
    const active = ['connecting', 'live', 'reconnecting'].includes(state);
    const waiting = active && (stale || !connected || state === 'reconnecting');
    const label = state === 'ended' ? words.ended :
      waiting ? words.reconnecting : state === 'connecting' ? words.connecting : words.live;
    $('talk-title').textContent = state === 'idle' ? words.event : snapshot.title;
    // Between talks the page says nothing about itself: the placeholder line is enough.
    if (state === 'idle') $('viewer-status').hidden = true;
    else pill(label, waiting ? 'reconnecting' : state);
    paint(state === 'idle' ? '' : tail(snapshot.translated, 1400), state === 'ended' ? words.thanks : words.waiting);
    $('viewer-message').textContent = waiting ? words.interrupted : '';
  }
  function pill(text, state = '') {
    const status = $('viewer-status');
    status.textContent = text; status.dataset.state = state; status.hidden = false;
  }
  function accept(value) {
    if (!value || value.id !== room || (snapshot && Number(value.revision) < Number(snapshot.revision))) return;
    snapshot = value; render();
  }

  // ---- Preview without a live talk (?demo=1) ------------------------------
  // Plays IBSA's own Italian abstract through the real painting code, at the
  // pace the captions arrive in the room, so the page can be judged before 6
  // November. Clearly labelled as a preview.
  if (params.get('demo') === '1') {
    const script = [
      'I gemelli digitali possono trasformare la medicina da strumento di reazione a metodo per la previsione della malattia, a condizione che siano interpretabili, generalizzabili e considerati affidabili dai medici.',
      'L’intervento presenta gemelli digitali che combinano una modellazione meccanicistica basata sulla fisica con metodi basati sui dati propri dell’apprendimento automatico e dell’intelligenza artificiale.',
      'Nel caso del glaucoma, un gemello digitale dell’emodinamica oculare ha identificato profili di circolazione sanguigna correlati a un maggiore rischio di progressione della malattia, con risultati significativi in coorti indipendenti da Singapore e Salonicco.',
      'In ambito cardiovascolare, modelli meccanicistici interpretano i segnali di battito cardiaco provenienti da sensori incorporati in materassi e poltrone reclinabili, eliminando la necessità di indossare dispositivi ad hoc.',
      'Già impiegate nelle strutture di residenza assistita, tali tecnologie aiutano migliaia di anziani a vivere in sicurezza, pur conservando la propria autonomia.',
      'Concluderemo parlando delle sfide rappresentate dalla traduzione dei gemelli digitali da prototipi di ricerca a pratica clinica.',
    ].join(' ');
    const tokens = script.split(/(?<= )/);
    let said = ''; let at = 0; let revision = 1;
    connected = true;
    const step = () => {
      if (at >= tokens.length) { at = 0; said = ''; }
      // Soniox settles a few words at a time, roughly once a second.
      const burst = 3 + Math.floor(Math.random() * 5);
      said += tokens.slice(at, at + burst).join(''); at += burst;
      accept({ id: room, revision: ++revision, state: 'live', language: 'it', updated_at: new Date().toISOString(),
        title: 'Giovanna Guidoboni · Quando la fisica incontra i dati: gemelli digitali per la medicina personalizzata',
        translated: said.slice(-1400) });
      pill(words.preview, 'live');
    };
    step(); setInterval(step, 1100);
    void keepAwake();
    return;
  }

  // ---- Live ----------------------------------------------------------------
  async function read() {
    if (!client || fetching || stopped) return;
    fetching = true;
    try {
      const { data, error } = await client.from('live_caption_rooms').select('*').eq('id', room).maybeSingle();
      if (error) throw error;
      // No row yet means the control room has never signed in: simply waiting.
      accept(data || { id: room, revision: 0, state: 'idle', language: 'it', title: '', translated: '', updated_at: new Date().toISOString() });
    } catch (_) { pill(words.reconnecting, 'reconnecting'); }
    finally { fetching = false; }
  }
  async function boot() {
    if (booting || stopped) return;
    booting = true;
    try {
      const config = await request({ action: 'config' });
      if (stopped) return;
      if (!window.supabase) throw new Error('Viewer unavailable');
      client = window.supabase.createClient(config.url, config.public_key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async (input, options) => {
          const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
          try { return await fetch(input, { ...options, signal: controller.signal, cache: 'no-store' }); }
          finally { clearTimeout(timer); }
        } },
      });
      channel = client.channel('live-captions-' + room)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_caption_rooms', filter: 'id=eq.' + room }, payload => accept(payload.new))
        .subscribe(state => {
          connected = state === 'SUBSCRIBED'; render();
          if (connected) void read(); // repairs missed updates after every reconnect
        });
      await read();
      poll = setInterval(() => { if (!connected || (snapshot && Date.now() - Date.parse(snapshot.updated_at) > 30000)) void read(); }, 10000);
      tick = setInterval(render, 2000);
    } catch (_) {
      pill(words.notConnected);
      $('viewer-message').textContent = words.unavailable;
      bootTimer = setTimeout(boot, 5000);
    } finally { booting = false; }
  }
  window.addEventListener('online', () => { if (client) void read(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void keepAwake(); void read();
  });
  window.addEventListener('pagehide', () => {
    stopped = true; clearInterval(poll); clearInterval(tick); clearTimeout(bootTimer);
    if (client && channel) void client.removeChannel(channel);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; connected = false; void boot(); } });
  void keepAwake();
  void boot();
})();
