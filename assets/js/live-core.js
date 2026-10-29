/* Shared caption logic. No credentials, DOM writes, or network side effects
   beyond the one `request` helper. */
(function (root) {
  'use strict';
  class CaptionBuffer {
    constructor(target = 'it') { this.target = target; this.original = ''; this.translated = ''; this.draft = ''; }
    accept(event) {
      if (!Array.isArray(event.tokens)) return;
      this.draft = '';
      for (const token of event.tokens) {
        if (typeof token.text !== 'string' || /^<[^>]+>$/.test(token.text)) continue;
        const translation = token.translation_status === 'translation';
        if (token.is_final) {
          if (translation) this.translated = (this.translated + token.text).slice(-1400);
          else {
            this.original = (this.original + token.text).slice(-1400);
            // In one-way mode speech already in the target language is never
            // translated: someone asking a question in Italian is shown as is.
            const spoken = typeof token.language === 'string' ? token.language.slice(0, 2).toLowerCase() : '';
            if (spoken === this.target) this.translated = (this.translated + token.text).slice(-1400);
          }
        } else if (translation) this.draft += token.text;
      }
      this.draft = this.draft.slice(-500);
    }
    clearDraft() { this.draft = ''; }
  }
  // Keep whole words at the start of the rolling text. Only final text reaches
  // the audience; provisional hypotheses stay in the control-room preview.
  function tail(text, limit = 320) {
    text = String(text || '').trim();
    if (text.length <= limit) return text;
    const cut = text.slice(-limit);
    const space = cut.indexOf(' ');
    return space >= 0 && space < 40 ? cut.slice(space + 1) : cut;
  }
  const errors = {
    unauthorised: 'Sessione scaduta o password errata. Accedi di nuovo.',
    room_busy: 'C’è già una regia in diretta. Fermala prima di avviarne un’altra.',
    lease_lost: 'Il collegamento con la sala è scaduto. Ferma e riavvia la diretta.',
    room_not_found: 'Sala non configurata.',
    not_configured: 'Soniox o la password della regia non sono ancora configurati sul server.',
    service_unavailable: 'Servizio momentaneamente non disponibile. Riprova tra poco.',
    soniox_unavailable: 'Soniox non è disponibile. Controlla la chiave e il credito nel suo pannello.',
    soniox_capacity: 'Soniox ha raggiunto il limite di connessioni. Riprova tra poco.',
    rate_limited: 'Troppe richieste. Attendi un minuto prima di riprovare.',
    bad_request: 'Richiesta non valida. Controlla titolo e durata.',
    NotAllowedError: 'Accesso al microfono negato. Consentilo nelle impostazioni del browser.',
    NotFoundError: 'Nessun ingresso audio disponibile. Collega il mixer o un microfono.',
    NotReadableError: 'L’ingresso audio è occupato o non disponibile.',
    OverconstrainedError: 'L’ingresso audio scelto non è più disponibile. Premi «Rileva ingressi».',
    AbortError: 'La richiesta ha impiegato troppo tempo. Controlla la connessione.',
  };
  function errorText(error) { return errors[error.code || error.name] || error.message || 'Collegamento interrotto. Riprova.'; }
  async function request(body, { keepalive = false } = {}) {
    const config = root.IBSA_LIVE;
    if (!config || !config.url) throw new Error('Configurazione del sito non disponibile.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(config.url + '/functions/v1/' + config.fn, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), cache: 'no-store', signal: controller.signal, keepalive,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const error = new Error(errors[data.error] || 'Servizio non disponibile. Riprova.');
        error.code = data.error; throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  root.IBSALive = { CaptionBuffer, tail, errorText, request };
})(typeof window === 'undefined' ? globalThis : window);
