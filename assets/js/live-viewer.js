/* The audience page after the forum (6 November 2026).

   The live connection is gone: the control room and its server were shut down
   on 7 November, so this page talks to nothing. Without parameters it thanks
   the audience (that is the markup itself, no script needed). ?demo=1 replays
   IBSA's own Italian abstract through the same painting code the room saw;
   ?screen=1 is the large-text version for a screen in a hall. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  if (params.get('screen') === '1') { document.body.classList.add('screen-mode'); document.body.dataset.size = 'large'; $('text-size').value = 'large'; }
  if (params.get('demo') !== '1') return;

  // ---- Controls ---------------------------------------------------------------
  $('ended-note').hidden = true;
  $('audience-note').hidden = false; $('viewer-controls').hidden = false;
  $('stage-label').textContent = 'SOTTOTITOLI IN ITALIANO · IN TEMPO REALE';
  $('talk-title').textContent = 'Giovanna Guidoboni · Quando la fisica incontra i dati: gemelli digitali per la medicina personalizzata';
  const status = $('viewer-status');
  status.textContent = 'Anteprima'; status.dataset.state = 'live'; status.hidden = false;

  $('text-size').onchange = () => {
    document.body.dataset.size = $('text-size').value;
    const frame = $('caption-window'); frame.scrollTop = frame.scrollHeight;
  };
  // iPhone Safari cannot put a page in full screen: hide what it cannot do.
  if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* the browser said no; the page still works */ }
  };

  // A phone that dims in the middle of the preview loses the reader. Ask the
  // browser to keep the screen on while the page is open; it may refuse.
  let wake = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && !wake && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } } catch (_) { /* not supported or not allowed */ }
  }
  document.addEventListener('pointerdown', () => { void keepAwake(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void keepAwake(); });

  // ---- Painting -------------------------------------------------------------
  // Append only what is new: rewriting the paragraph re-wraps every line and
  // the reader loses their place. New words fade in, then the window glides up.
  let painted = '';
  const glide = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The room received a rolling window of the last 1400 characters, so after a
  // couple of minutes a new reading no longer *starts* with what is on screen:
  // it is the same text shifted left plus a short tail. Find that tail.
  function appended(text) {
    if (!painted) return null;
    if (text.startsWith(painted)) return text.slice(painted.length);
    for (let keep = Math.min(painted.length, text.length); keep >= 40; keep--) {
      if (painted.endsWith(text.slice(0, keep))) return text.slice(keep);
    }
    return null; // the preview started over
  }
  // Keep whole words at the start of the rolling text.
  function tail(text, limit) {
    text = text.trim();
    if (text.length <= limit) return text;
    const cut = text.slice(-limit);
    const space = cut.indexOf(' ');
    return space >= 0 && space < 40 ? cut.slice(space + 1) : cut;
  }
  function paint(text) {
    const caption = $('captions'); const frame = $('caption-window');
    const grown = appended(text);
    // The paragraph restarts now and then so the browser is never re-laying
    // out an essay on every word: one jump, not one per update.
    if (grown === null || painted.length > 24000) { caption.textContent = text; painted = text; }
    else if (grown) {
      const fresh = document.createElement('span');
      fresh.className = 'fresh'; fresh.textContent = grown;
      caption.append(fresh); painted += grown;
    }
    const bottom = frame.scrollHeight - frame.clientHeight;
    // A new line glides up; a jump of more than one window snaps instead. A
    // hidden tab cannot animate, so never queue a glide there.
    const far = document.hidden || bottom - frame.scrollTop > frame.clientHeight;
    frame.scrollTo({ top: bottom, behavior: glide && !far ? 'smooth' : 'instant' });
  }
  // On phones the window takes whatever height the page leaves it, and that
  // moves when the browser's bars come and go: keep the newest line in view.
  if (window.ResizeObserver) new ResizeObserver(() => {
    const frame = $('caption-window'); frame.scrollTop = frame.scrollHeight;
  }).observe($('caption-window'));

  // ---- The preview ------------------------------------------------------------
  const script = [
    'I gemelli digitali possono trasformare la medicina da strumento di reazione a metodo per la previsione della malattia, a condizione che siano interpretabili, generalizzabili e considerati affidabili dai medici.',
    'L’intervento presenta gemelli digitali che combinano una modellazione meccanicistica basata sulla fisica con metodi basati sui dati propri dell’apprendimento automatico e dell’intelligenza artificiale.',
    'Nel caso del glaucoma, un gemello digitale dell’emodinamica oculare ha identificato profili di circolazione sanguigna correlati a un maggiore rischio di progressione della malattia, con risultati significativi in coorti indipendenti da Singapore e Salonicco.',
    'In ambito cardiovascolare, modelli meccanicistici interpretano i segnali di battito cardiaco provenienti da sensori incorporati in materassi e poltrone reclinabili, eliminando la necessità di indossare dispositivi ad hoc.',
    'Già impiegate nelle strutture di residenza assistita, tali tecnologie aiutano migliaia di anziani a vivere in sicurezza, pur conservando la propria autonomia.',
    'Concluderemo parlando delle sfide rappresentate dalla traduzione dei gemelli digitali da prototipi di ricerca a pratica clinica.',
  ].join(' ');
  const tokens = script.split(/(?<= )/);
  let said = ''; let at = 0;
  // Soniox settles two to four words at a time. At this pace the preview runs
  // at about 130 words a minute, a speaker's pace, with a breath after each
  // sentence.
  const step = () => {
    if (at >= tokens.length) { at = 0; said = ''; }
    const burst = 2 + Math.floor(Math.random() * 3);
    const chunk = tokens.slice(at, at + burst).join('');
    said += chunk; at += burst;
    paint(tail(said, 1400));
    setTimeout(step, /[.!?]\s*$/.test(chunk) ? 2100 : 1300);
  };
  step();
  void keepAwake();
})();
