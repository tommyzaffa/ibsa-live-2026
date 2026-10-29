(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { request, errorText, tail, CaptionBuffer } = window.IBSALive;
  const PROGRAMME = window.IBSA_PROGRAMME || { event: { general: [], terms: [], glossary: [] }, sessions: [] };
  const ROOM = (window.IBSA_LIVE && window.IBSA_LIVE.room) || 'ibsa';
  let session = ''; let run = null; let wakeLock = null; let discovering = false;
  try { session = sessionStorage.getItem('ibsa-live-session') || ''; } catch (_) { /* memory-only login */ }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fields = ['session', 'title', 'direction', 'device', 'minutes', 'context', 'terms', 'glossary'];
  const directions = { 'en-it': { source: 'en', target: 'it' }, 'it-en': { source: 'it', target: 'en' } };
  let currentDirection = 'en-it';
  const direction = () => directions[$('direction').value] || directions['en-it'];
  function status(text, state = '') { $('status').textContent = text; $('status').dataset.state = state; }
  function controls(active) {
    for (const id of fields) $(id).disabled = active;
    $('start').disabled = active || discovering; $('stop').disabled = !active;
    $('logout').disabled = active; $('devices').disabled = active || discovering;
  }
  function remember(value) {
    session = value;
    try { if (value) sessionStorage.setItem('ibsa-live-session', value); else sessionStorage.removeItem('ibsa-live-session'); } catch (_) { /* memory only */ }
  }
  function showControl(configured) {
    $('login-panel').hidden = true; $('control-panel').hidden = false;
    if (!configured) $('error').textContent = errorText({ code: 'not_configured' });
    share(); relabel();
  }

  // ---- The programme --------------------------------------------------------
  const lines = list => list.join('\n');
  const pairs = list => list.map(([a, b]) => a + ' = ' + b).join('\n');
  const flip = text => text.split('\n').map(line => {
    const i = line.indexOf('=');
    return i > 0 ? line.slice(i + 1).trim() + ' = ' + line.slice(0, i).trim() : line;
  }).join('\n');
  function fillProgramme() {
    const select = $('session');
    select.replaceChildren(new Option('— Intervento libero (campi vuoti) —', ''));
    for (const s of PROGRAMME.sessions) select.append(new Option(s.time + ' · ' + s.label, s.id));
    $('event-hint').textContent = 'A ogni avvio si aggiungono anche ' + PROGRAMME.event.terms.length +
      ' nomi e ' + PROGRAMME.event.glossary.length + ' traduzioni comuni a tutto il forum (dal sito dell’evento).';
    // Open on the talk that is about to start, or the first one.
    const now = new Date(); const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const next = PROGRAMME.sessions.filter(s => s.time <= hhmm).pop() || PROGRAMME.sessions[0];
    if (next) { select.value = next.id; load(next.id); }
  }
  function load(id) {
    const s = PROGRAMME.sessions.find(item => item.id === id);
    if (!s) { $('title').value = ''; $('context').value = ''; $('terms').value = ''; $('glossary').value = ''; return; }
    $('title').value = s.title;
    $('direction').value = s.direction || 'en-it';
    $('context').value = (s.speaker ? 'Speaker: ' + s.speaker + '\n' : '') + s.context;
    $('terms').value = lines(s.terms);
    // The glossary is written English = Italian; an Italian talk reads it the other way.
    $('glossary').value = $('direction').value === 'it-en' ? flip(pairs(s.glossary)) : pairs(s.glossary);
    currentDirection = $('direction').value; relabel();
  }
  $('session').addEventListener('change', () => load($('session').value));

  // The control room reads the spoken language, the audience the caption one.
  function relabel() {
    const { source, target } = direction();
    const names = { it: ['ITALIANO', 'italiano'], en: ['INGLESE', 'inglese'] };
    const example = { it: 'gemello digitale', en: 'digital twin' };
    $('direction-label').textContent = names[source][0] + ' → ' + names[target][0];
    $('glossary-label').textContent = 'Traduzioni preferite · ' + names[source][1] + ' = ' + names[target][1];
    $('glossary').placeholder = example[source] + ' = ' + example[target];
    $('translation-label').textContent = names[target][0] + ' · QUELLO CHE LEGGE IL PUBBLICO';
    $('original-label').textContent = 'TRASCRIZIONE ' + names[source][0];
    $('translation').lang = $('draft').lang = target; $('original').lang = source;
  }
  $('direction').addEventListener('change', () => {
    if ($('direction').value !== currentDirection) $('glossary').value = flip($('glossary').value);
    currentDirection = $('direction').value; relabel();
  });

  // ---- Audience link and QR -------------------------------------------------
  function share() {
    const url = new URL('../', location.href);
    $('audience-link').href = url.href;
    const qr = new URL(url.href); qr.searchParams.set('qr', '1'); $('qr-link').href = qr.href;
    $('qr').replaceChildren();
    if (window.QrCreator) QrCreator.render({ text: url.href, size: 232, ecLevel: 'M', fill: '#0b2c3d', background: '#ffffff' }, $('qr'));
  }
  $('copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText($('audience-link').href); $('copy-link').textContent = 'Link copiato'; }
    catch (_) { $('notice').textContent = 'Apri la pagina del pubblico e copia l’indirizzo dal browser.'; }
  };
  // A print-quality QR as a file, for the slides or the printed cards.
  $('qr-download').onclick = () => {
    const holder = document.createElement('div');
    QrCreator.render({ text: $('audience-link').href, size: 1600, ecLevel: 'M', fill: '#0b2c3d', background: '#ffffff' }, holder);
    const canvas = holder.querySelector('canvas');
    const framed = document.createElement('canvas'); const pad = 120;
    framed.width = framed.height = canvas.width + pad * 2;
    const ctx = framed.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, framed.width, framed.height);
    ctx.drawImage(canvas, pad, pad);
    const a = document.createElement('a');
    a.download = 'qr-sottotitoli-ibsa-forum.png'; a.href = framed.toDataURL('image/png'); a.click();
  };

  // ---- Login ----------------------------------------------------------------
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; $('login-error').textContent = '';
    try {
      const data = await request({ action: 'login', password: $('password').value });
      remember(data.session); $('password').value = ''; showControl(data.configured);
    } catch (error) { $('login-error').textContent = errorText(error); }
    finally { button.disabled = false; }
  });
  $('logout').onclick = () => {
    remember(''); $('control-panel').hidden = true; $('login-panel').hidden = false; $('password').focus();
  };

  // ---- Audio input ----------------------------------------------------------
  async function listDevices() {
    const selected = $('device').value;
    const devices = await navigator.mediaDevices.enumerateDevices();
    $('device').replaceChildren(new Option('Ingresso predefinito', ''));
    for (const device of devices.filter(d => d.kind === 'audioinput')) {
      $('device').append(new Option(device.label || 'Ingresso audio', device.deviceId));
    }
    if (Array.from($('device').options).some(option => option.value === selected)) $('device').value = selected;
  }
  $('devices').onclick = async () => {
    discovering = true; controls(false); $('error').textContent = '';
    let stream;
    try {
      if (!navigator.mediaDevices) throw new Error('Apri questa pagina in HTTPS o su localhost per usare il microfono.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await listDevices();
    } catch (error) { $('error').textContent = errorText(error); }
    finally { if (stream) stream.getTracks().forEach(t => t.stop()); discovering = false; controls(!!run); }
  };
  async function keepAwake() {
    try { if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => { if (run && !run.stopping) void keepAwake(); });

  // ---- The live session -----------------------------------------------------
  function render(r) {
    $('translation').textContent = tail(r.buffer.translated) || 'I sottotitoli appariranno qui.';
    $('draft').textContent = r.buffer.draft ? 'In elaborazione: ' + r.buffer.draft : '';
    $('original').textContent = tail(r.buffer.original, 400) || 'In attesa dell’audio.';
  }
  function message(r, state) {
    return { action: 'publish', session, room: r.room, publisher: r.publisher, sequence: ++r.sequence,
      state, original: r.buffer.original, translated: r.buffer.translated };
  }
  // Only one publish in flight; retry the SAME sequence after a lost response.
  // The database lease and sequence check protect against other tabs too.
  async function publish(r, force = false) {
    if (r.publishing) return r.publishing;
    if (!r.claimed || (!force && r.stopping)) return;
    if (!r.pending) {
      if (!force && !r.dirty && Date.now() - r.lastPublish < 8000) return;
      r.pending = message(r, r.state); r.dirty = false;
    }
    const payload = r.pending;
    r.publishing = (async () => {
      try {
        await request(payload); r.pending = null; r.lastPublish = Date.now();
      } catch (error) {
        if (run === r && !r.stopping) {
          $('notice').textContent = 'L’invio al pubblico si è interrotto. La regia sta provando a ricollegarsi.';
          if (['unauthorised', 'lease_lost'].includes(error.code) || Date.now() - r.lastPublish > 25000) {
            void stop(errorText(error)); // not awaited: stop drains this very promise
          }
        }
      } finally { r.publishing = null; }
    })();
    return r.publishing;
  }
  // Stopping hands the room to the next talk: the audience page goes back to
  // waiting instead of sitting on the last line of a finished talk.
  const closing = r => ({ ...message(r, 'idle'), original: '', translated: '' });
  async function release(r) {
    if (!r.claimed) return;
    if (r.publishing) await r.publishing;
    r.pending = null;
    try { await request(closing(r), { keepalive: true }); }
    catch (_) { if (run === r) $('notice').textContent = 'Audio fermato, ma la pagina del pubblico non si è svuotata: lo farà da sola entro tre minuti.'; }
    r.claimed = false;
  }
  // What Soniox is told about the talk: the talk's own fields first, then the
  // forum-wide names and translations, trimmed to Soniox's context budget.
  function context(source, target) {
    const s = PROGRAMME.sessions.find(item => item.id === $('session').value);
    const unique = (list, key) => { const seen = new Set(); return list.filter(item => { const k = key(item).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const ownTerms = $('terms').value.split('\n').map(t => t.trim()).filter(Boolean);
    const ownGlossary = $('glossary').value.split('\n').map(line => {
      const i = line.indexOf('=');
      return i > 0 ? { source: line.slice(0, i).trim(), target: line.slice(i + 1).trim() } : null;
    }).filter(term => term && term.source && term.target);
    const eventGlossary = PROGRAMME.event.glossary.map(([en, it]) => source === 'en' ? { source: en, target: it } : { source: it, target: en });
    const ctx = {
      general: [...PROGRAMME.event.general, { key: 'topic', value: $('title').value.trim() },
        ...(s && s.speaker ? [{ key: 'speaker', value: s.speaker }] : [])],
      text: $('context').value.trim(),
      terms: unique([...ownTerms, ...PROGRAMME.event.terms], t => t).slice(0, 120),
      translation_terms: unique([...ownGlossary, ...eventGlossary], t => t.source).slice(0, 90),
    };
    // Soniox accepts about 10 000 characters of context: drop forum-wide items first.
    while (JSON.stringify(ctx).length > 9500 && (ctx.translation_terms.length > ownGlossary.length || ctx.terms.length > ownTerms.length)) {
      if (ctx.translation_terms.length > ownGlossary.length) ctx.translation_terms.pop(); else ctx.terms.pop();
    }
    if (JSON.stringify(ctx).length > 9500) ctx.text = ctx.text.slice(0, Math.max(0, ctx.text.length - (JSON.stringify(ctx).length - 9500)));
    return ctx;
  }
  function closeAudio(r) {
    if (r.node) { r.node.port.onmessage = null; r.node.disconnect(); }
    if (r.source) r.source.disconnect();
    if (r.stream) r.stream.getTracks().forEach(track => track.stop());
    if (r.audio) void r.audio.close().catch(() => {});
    $('level').value = 0;
  }
  async function connect(r) {
    if (run !== r || r.stopping) return;
    r.state = r.attempts ? 'reconnecting' : 'connecting'; r.dirty = true;
    status(r.attempts ? 'Riconnessione…' : 'Collegamento…', r.state);
    const key = await request({ action: 'key', session, room: r.room, publisher: r.publisher });
    if (run !== r || r.stopping) return;
    const ws = new WebSocket(key.websocket_url); r.ws = ws; r.ready = false;
    r.lastResponse = Date.now();
    ws.onopen = () => {
      if (run !== r || r.stopping) { ws.close(); return; }
      ws.send(JSON.stringify({ api_key: key.api_key, model: key.model, audio_format: 'pcm_s16le',
        sample_rate: r.audio.sampleRate, num_channels: 1, language_hints: [r.langFrom, r.langTo],
        enable_language_identification: true, enable_endpoint_detection: true, max_endpoint_delay_ms: 1000,
        translation: { type: 'one_way', target_language: r.langTo }, context: r.context }));
      // Audio may only follow the configuration: readyState turns OPEN just
      // before this handler runs, so a frame could otherwise overtake it.
      key.api_key = ''; r.ready = true; r.socketOpened = Date.now();
    };
    ws.onmessage = event => {
      if (run !== r || ws !== r.ws) return;
      let data;
      try { data = JSON.parse(event.data); } catch (_) { ws.close(); return; }
      r.lastResponse = Date.now();
      if (data.error_code) {
        const detail = typeof data.error_message === 'string' ? data.error_message.slice(0, 180) : '';
        r.fatal = ![408, 429, 500, 502, 503, 504].includes(Number(data.error_code));
        // Soniox explains itself better than we can guess: show its own words.
        r.failure = 'Soniox ha fermato la traduzione (' + data.error_code + ')' + (detail ? ': ' + detail : '.');
        ws.close(); return;
      }
      // The audience only sees final text, so only new final text is worth a
      // round trip — and it should leave now, not on the next tick.
      const settled = r.buffer.translated + '\v' + r.buffer.original;
      r.buffer.accept(data); render(r);
      if (settled !== r.buffer.translated + '\v' + r.buffer.original) { r.dirty = true; void publish(r); }
      if (!r.stopping) {
        r.state = 'live'; status('In diretta', 'live');
        if (Date.now() - r.socketOpened > 30000) r.attempts = 0;
      }
      if (data.finished && r.finish) r.finish();
    };
    ws.onerror = () => { /* onclose handles retries */ };
    ws.onclose = () => {
      r.ready = false;
      if (r.finish) r.finish();
      if (run !== r || r.stopping || ws !== r.ws) return;
      r.buffer.clearDraft(); render(r);
      if (r.fatal) { void stop(r.failure); return; }
      scheduleReconnect(r);
    };
  }
  function scheduleReconnect(r) {
    if (run !== r || r.stopping) return;
    if (++r.attempts > 3) { void stop('Collegamento perso dopo tre tentativi. Controlla la rete e riavvia.'); return; }
    r.state = 'reconnecting'; r.dirty = true; status('Riconnessione…', r.state);
    $('notice').textContent = 'Collegamento caduto: quello che viene detto in questo intervallo non sarà recuperato.';
    r.retry = setTimeout(() => { void connect(r).catch(error => {
      if (['lease_lost', 'unauthorised'].includes(error.code)) void stop(errorText(error));
      else scheduleReconnect(r);
    }); }, Math.min(1000 * 2 ** (r.attempts - 1), 4000));
  }
  async function start() {
    if (run || discovering) return;
    $('error').textContent = ''; $('notice').textContent = '';
    if (!$('title').value.trim()) { $('title').focus(); $('error').textContent = 'Inserisci il titolo dell’intervento.'; return; }
    if (!window.isSecureContext || !navigator.mediaDevices || !window.AudioWorkletNode) {
      $('error').textContent = 'Usa un browser aggiornato, in HTTPS o su localhost, per avviare l’audio.'; return;
    }
    const { source, target } = direction();
    // Not `source`/`target`: r.source is already the MediaStreamAudioSourceNode.
    const r = { publisher: crypto.randomUUID(), room: ROOM, buffer: new CaptionBuffer(target), sequence: 0,
      state: 'connecting', stopping: false, claimed: false, dirty: true, attempts: 0, audioSeconds: 0,
      lastPublish: Date.now(), context: context(source, target), langFrom: source, langTo: target };
    run = r; controls(true); render(r); status('Apertura del microfono…');
    try {
      // Resume during the user's gesture (important on Safari).
      r.audio = new AudioContext(); await r.audio.resume();
      if (run !== r || r.stopping) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: $('device').value ? { exact: $('device').value } : undefined,
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      } });
      if (run !== r || r.stopping) { stream.getTracks().forEach(track => track.stop()); return; }
      r.stream = stream;
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (run === r && !r.stopping) void stop('Ingresso audio scollegato. Ricollega il mixer e riavvia.'); });
      await r.audio.audioWorklet.addModule('../assets/js/live-audio-worklet.js?v=1');
      if (run !== r || r.stopping) return;
      const claim = await request({ action: 'start', session, room: r.room, publisher: r.publisher,
        title: $('title').value.trim().slice(0, 120), minutes: Number($('minutes').value), language: r.langTo });
      r.claimed = true; r.endsAt = Date.parse(claim.ends_at); r.startedAt = Date.now();
      if (run !== r || r.stopping) { await release(r); return; }
      r.source = r.audio.createMediaStreamSource(stream);
      r.node = new AudioWorkletNode(r.audio, 'live-capture');
      r.source.connect(r.node); r.node.connect(r.audio.destination);
      r.node.port.onmessage = event => {
        if (run !== r || r.stopping) return;
        const { audio, level } = event.data; $('level').value = Math.min(1, level * 4);
        if (level > 0.002) r.lastSound = Date.now();
        if (r.ready && r.ws && r.ws.readyState === WebSocket.OPEN) {
          if (r.ws.bufferedAmount > r.audio.sampleRate * 2 * 3) { r.ws.close(); return; }
          r.ws.send(audio); r.audioSeconds += audio.byteLength / 2 / r.audio.sampleRate;
        }
      };
      // Backstop only: text that arrived while a request was in flight, and the
      // heartbeat that keeps the room's lease alive during silence.
      r.pump = setInterval(() => { void publish(r); }, 500);
      r.tick = setInterval(() => {
        const elapsed = Math.floor((Date.now() - r.startedAt) / 1000);
        $('elapsed').textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
        $('cost').textContent = '$' + (r.audioSeconds / 3600 * 0.18).toFixed(2);
        if (Date.now() >= r.endsAt) { void stop('Durata massima raggiunta. Avvia una nuova sessione per continuare.'); return; }
        if (r.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(r.ws.readyState) && Date.now() - r.lastResponse > 20000) r.ws.close();
        if (r.state === 'live' && Date.now() - (r.lastSound || r.startedAt) > 15000) {
          $('notice').textContent = 'Nessun audio da 15 secondi. Controlla il mixer e l’ingresso scelto.';
        }
      }, 1000);
      void keepAwake();
      await connect(r);
    } catch (error) { if (run === r) await stop(errorText(error)); }
    finally { if (run !== r || r.stopping) closeAudio(r); }
  }
  async function stop(reason = '') {
    const r = run;
    if (!r || r.stopping) return;
    r.stopping = true; controls(true); $('stop').disabled = true; status('Chiusura…');
    $('notice').textContent = ''; // a warning about the talk that just ended
    clearInterval(r.pump); clearInterval(r.tick); clearTimeout(r.retry);
    // Stop capture now, then let Soniox finalise the last words.
    closeAudio(r);
    if (r.ready && r.ws && r.ws.readyState === WebSocket.OPEN) {
      const drained = new Promise(resolve => { r.finish = resolve; });
      r.ws.send(''); await Promise.race([drained, delay(3500)]);
    }
    if (r.ws) { r.ws.onclose = null; r.ws.close(); }
    r.state = 'idle'; r.buffer.clearDraft(); r.dirty = true; render(r);
    await release(r);
    if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
    if (run === r) {
      run = null; controls(false); status('Fermo');
      $('error').textContent = reason;
    }
  }
  $('start').onclick = () => { void start(); };
  $('stop').onclick = () => { void stop(); };
  window.addEventListener('beforeunload', event => { if (run && !run.stopping) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => {
    if (!run) return;
    const r = run; r.stopping = true;
    clearInterval(r.pump); clearInterval(r.tick); clearTimeout(r.retry);
    closeAudio(r); if (r.ws) r.ws.close();
    if (r.claimed) void request(closing(r), { keepalive: true }).catch(() => {});
    run = null; controls(false); status('Fermo');
  });

  fillProgramme(); relabel();
  if (session) request({ action: 'check', session }).then(data => showControl(data.configured)).catch(error => {
    if (error.code === 'unauthorised') remember('');
    $('login-error').textContent = errorText(error);
  });
})();
