// Live captions for the IBSA Foundation Forum (Lugano, 6 November 2026).
//
// The control room's browser streams the microphone straight to Soniox; this
// function only decides who may do it. It checks the control-room password,
// hands out short single-use Soniox keys, and writes the captions the audience
// page reads. It runs in the same Supabase project as the Merge Film Festival
// captions and shares their tables, but only ever touches its own room, signs
// its own sessions and has its own password, so neither control room can open
// the other.
//
// Secrets (supabase secrets set):
//   IBSA_LIVE_PASSWORD   control-room password, at least 16 characters
//   SONIOX_API_KEY       the Soniox account key (already set for Merge)
//   IBSA_LIVE_ORIGINS    optional, comma-separated origins allowed to call this
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are injected.

// Pinned: a floating @2 once stopped bundling overnight (see the Merge repo).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.113.0';

const ROOM = 'ibsa';
const LANGUAGES = ['en', 'it'];
const SESSION_HOURS = 16; // one login covers the whole forum day
const MAX_BYTES = 16384;

const origins = (Deno.env.get('IBSA_LIVE_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
const allowed = [...origins, 'http://localhost:4323', 'http://127.0.0.1:4323'];

function headers(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  // Echo only a known origin; anything else gets one the browser will refuse.
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'origin',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(req) });
const fail = (req: Request, error: string, status = 400) => json(req, { ok: false, error }, status);

let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
  }
  return cached;
}

// Same persisted limiter as the Merge functions: per address and global.
async function limited(req: Request, scope: string, limit: number, globalLimit: number, seconds = 60) {
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',').at(-1)!.trim();
  const bytes = new TextEncoder().encode(`${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}:${ip.slice(0, 128)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const key = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await db().rpc('security_rate_limit', {
    p_scope: scope, p_key: key, p_limit: limit, p_global_limit: globalLimit, p_seconds: seconds,
  });
  if (error) return fail(req, 'service_unavailable', 503);
  return data === true ? null : fail(req, 'rate_limited', 429);
}

function same(given: unknown, expected: string) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Signed control-room session. Its own prefix and audience: a Merge session,
// even one signed with the same password, is not valid here.
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const hmac = (secret: string) => crypto.subtle.importKey('raw', enc.encode(`ibsa-live-session-v1:${secret}`),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
async function newSession(secret: string) {
  const payload = b64(enc.encode(JSON.stringify({ aud: 'ibsa-live', exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600, nonce: crypto.randomUUID() })));
  const signature = await crypto.subtle.sign('HMAC', await hmac(secret), enc.encode(payload));
  return `${payload}.${b64(new Uint8Array(signature))}`;
}
async function validSession(token: unknown, secret: string) {
  if (typeof token !== 'string' || token.length > 512) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra !== undefined || !payload || !signature) return false;
    if (!await crypto.subtle.verify('HMAC', await hmac(secret), unb64(signature), enc.encode(payload))) return false;
    const claim = JSON.parse(new TextDecoder().decode(unb64(payload)));
    const now = Math.floor(Date.now() / 1000);
    return claim.aud === 'ibsa-live' && Number.isSafeInteger(claim.exp) && claim.exp > now && claim.exp <= now + SESSION_HOURS * 3600;
  } catch { return false; }
}

// The room is this event's own row in the shared captions table. It is created
// the first time the control room signs in, so no migration is needed.
async function ensureRoom() {
  const { error } = await db().from('live_caption_rooms')
    .upsert({ id: ROOM, title: 'IBSA Foundation Forum · Lugano 2026', language: 'it' }, { onConflict: 'id', ignoreDuplicates: true });
  return !error;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handle(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(req, 'bad_request');

  // Public: where the audience page reads from. Read-only key, no secrets.
  if (body.action === 'config') {
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!publicKey) return fail(req, 'service_unavailable', 503);
    return json(req, { ok: true, url: Deno.env.get('SUPABASE_URL'), public_key: publicKey, room: ROOM });
  }

  const secret = Deno.env.get('IBSA_LIVE_PASSWORD') || '';
  if (secret.length < 16) return fail(req, 'not_configured', 503);

  if (body.action === 'login') {
    const blocked = await limited(req, 'ibsa-live-login', 8, 60, 300);
    if (blocked) return blocked;
    if (!same(body.password, secret)) return fail(req, 'unauthorised', 401);
    if (!await ensureRoom()) return fail(req, 'service_unavailable', 503);
    return json(req, { ok: true, session: await newSession(secret), configured: !!Deno.env.get('SONIOX_API_KEY') });
  }
  if (!await validSession(body.session, secret)) return fail(req, 'unauthorised', 401);
  if (body.action === 'check') return json(req, { ok: true, configured: !!Deno.env.get('SONIOX_API_KEY') });

  if (!['start', 'key', 'publish'].includes(body.action) || body.room !== ROOM ||
    typeof body.publisher !== 'string' || !uuid.test(body.publisher)) return fail(req, 'bad_request');

  if (body.action === 'start') {
    if (!Deno.env.get('SONIOX_API_KEY')) return fail(req, 'not_configured', 503);
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 ||
      !Number.isInteger(body.minutes) || body.minutes < 5 || body.minutes > 240 ||
      !LANGUAGES.includes(body.language)) return fail(req, 'bad_request');
    const blocked = await limited(req, 'ibsa-live-start', 12, 80, 60);
    if (blocked) return blocked;
    if (!await ensureRoom()) return fail(req, 'service_unavailable', 503);
    const { data, error } = await db().rpc('live_caption_claim', {
      p_room: ROOM, p_publisher: body.publisher, p_title: body.title.trim(), p_minutes: body.minutes, p_language: body.language,
    });
    if (error) return fail(req, 'service_unavailable', 503);
    return json(req, data, data?.ok ? 200 : 409);
  }

  if (body.action === 'publish') {
    if (!Number.isSafeInteger(body.sequence) || body.sequence < 1 || body.sequence > 10_000_000 ||
      !['connecting', 'live', 'reconnecting', 'idle'].includes(body.state) ||
      typeof body.original !== 'string' || body.original.length > 1500 ||
      typeof body.translated !== 'string' || body.translated.length > 1500) return fail(req, 'bad_request');
    const blocked = await limited(req, 'ibsa-live-publish', 150, 1000, 60);
    if (blocked) return blocked;
    const { data, error } = await db().rpc('live_caption_update', {
      p_room: ROOM, p_publisher: body.publisher, p_sequence: body.sequence,
      p_state: body.state, p_original: body.original, p_translated: body.translated,
    });
    if (error) return fail(req, 'service_unavailable', 503);
    return json(req, data, data?.ok ? 200 : 409);
  }

  // action === 'key': a Soniox key only for the control room holding the room.
  const blocked = await limited(req, 'ibsa-live-key', 8, 60, 60);
  if (blocked) return blocked;
  const { data: lease, error } = await db().from('live_caption_publishers')
    .select('publisher,lease_until,ends_at').eq('room', ROOM).maybeSingle();
  if (error) return fail(req, 'service_unavailable', 503);
  const seconds = Math.floor((Date.parse(lease?.ends_at) - Date.now()) / 1000);
  if (!lease || lease.publisher !== body.publisher || Date.parse(lease.lease_until) <= Date.now() || seconds < 1) {
    return fail(req, 'lease_lost', 409);
  }
  const apiKey = Deno.env.get('SONIOX_API_KEY');
  if (!apiKey) return fail(req, 'not_configured', 503);
  // Single use, valid one minute. The account key never leaves this function.
  const res = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60, single_use: true,
      max_session_duration_seconds: Math.min(seconds, 14400), client_reference_id: `ibsa:${ROOM}:${body.publisher}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return fail(req, res.status === 429 ? 'soniox_capacity' : 'soniox_unavailable', 503);
  const key = await res.json();
  if (typeof key.api_key !== 'string') return fail(req, 'soniox_unavailable', 503);
  return json(req, { ok: true, api_key: key.api_key, ends_at: lease.ends_at,
    websocket_url: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5' });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return fail(req, 'method_not_allowed', 405);
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return fail(req, 'payload_too_large', 413);
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return fail(req, 'payload_too_large', 413);
    return await handle(new Request(req, { body: text }));
  } catch {
    console.error('ibsa-live: unhandled failure');
    return fail(req, 'server_error', 500);
  }
});
