// Google Sign-In verification.
//
// The browser gets an ID token from Google and sends it here. We NEVER trust
// it as-is: a token is just a string a client can invent. We verify the RS256
// signature against Google's published keys, then check that the token was
// minted for THIS application and has not expired. Only then does the name on
// it mean anything.

import crypto from 'node:crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
let cache = { keys: null, until: 0 };

async function keys() {
  if (cache.keys && Date.now() < cache.until) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('could not fetch Google keys');
  const body = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  cache = { keys: body.keys, until: Date.now() + (maxAge ? +maxAge[1] : 3600) * 1000 };
  return cache.keys;
}

const b64 = s => Buffer.from(s, 'base64url');

export async function verifyGoogleToken(idToken, clientId) {
  if (!clientId) throw new Error('Google sign-in is not configured on this server');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;

  let header, payload;
  try { header = JSON.parse(b64(h).toString()); payload = JSON.parse(b64(p).toString()); }
  catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');

  const jwk = (await keys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');

  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), pub, b64(sig))) throw new Error('bad signature');

  if (payload.aud !== clientId) throw new Error('token was issued for another app');
  if (!ISSUERS.has(payload.iss)) throw new Error('wrong issuer');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error('token expired');
  if (payload.iat > now + 300) throw new Error('token issued in the future');
  if (payload.email && payload.email_verified === false) throw new Error('email not verified');

  return { sub: payload.sub, name: payload.name || payload.given_name || 'Player',
           email: payload.email || '', picture: payload.picture || '' };
}
