// D6: passkeys (WebAuthn) for remote access's paired devices, checked with node:crypto alone. Pure: no core import, so
// test/passkey.test.ts runs it with a software key. ES256 (alg -7, P-256) only, user verification required.
//
// Registration reads the public key from the browser's getPublicKey() (SPKI DER) and getPublicKeyAlgorithm(), with
// attestation 'none', instead of decoding the attestation object's CBOR here. The trade-off: nothing ties that key to
// the authenticator's own statement (the COSE key inside attestationObject) but the page that sent both; a page of
// Laki's own, and a registration only a just-paired device may make (remote.ts' regUntil), with the challenge, origin
// and rpIdHash checked. Every unlock after it is checked in full: a signature by that key over what the
// authenticator signed, so a wrong key only locks its own device out.
import { createHash, createPublicKey, type webcrypto, verify } from 'node:crypto'

type JsonWebKey = webcrypto.JsonWebKey

export const ES256 = -7
export type Passkey = { id: string; jwk: JsonWebKey; count: number } // id: the credential's id, base64url
export const b64u = (b: Buffer) => b.toString('base64url')
const bytes = (s: unknown, what: string, max = 4096) => {
  if (typeof s !== 'string' || !/^[\w-]*$/.test(s) || s.length > max) throw new Error(`passkey: ${what} isn't base64url`)
  return Buffer.from(s, 'base64url')
}
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest()

// authenticatorData: rpIdHash (32), flags (1), signCount (4, big-endian); with AT (0x40), the attested credential:
// aaguid (16), its id's length (2), the id, then its COSE key (not read: see above). Bounds checked at each step
export const UP = 0x01
export const UV = 0x04
export const AT = 0x40
export function authData(b: Buffer) {
  if (b.length < 37) throw new Error('passkey: authenticator data too short')
  const out: { rpIdHash: Buffer; flags: number; count: number; credId?: Buffer } = { rpIdHash: b.subarray(0, 32), flags: b[32], count: b.readUInt32BE(33) }
  if (out.flags & AT) {
    if (b.length < 55) throw new Error('passkey: no attested credential')
    const n = b.readUInt16BE(53)
    if (n < 16 || n > 1023 || b.length < 55 + n) throw new Error('passkey: a bad credential id')
    out.credId = b.subarray(55, 55 + n)
  }
  return out
}

// what the browser says it signed: its type, our challenge, the page's origin (a cross-origin frame never)
function clientData(raw: Buffer, type: string, challenge: string, origin: string) {
  let c: any
  try {
    c = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error("passkey: the browser's data isn't JSON")
  }
  if (c?.type !== type) throw new Error(`passkey: not a ${type}`)
  if (typeof c.challenge !== 'string' || c.challenge !== challenge) throw new Error('passkey: not the challenge Laki gave')
  if (c.origin !== origin) throw new Error(`passkey: from ${String(c.origin)}, not ${origin}`)
  if (c.crossOrigin === true) throw new Error('passkey: from a frame')
}
// the authenticator's data for this site: its rpIdHash, the user there (UP) and verified (UV: Face ID, Touch ID, the
// device's code)
function forSite(a: ReturnType<typeof authData>, rpId: string) {
  if (!a.rpIdHash.equals(sha256(rpId))) throw new Error(`passkey: not for ${rpId}`)
  if (!(a.flags & UP) || !(a.flags & UV)) throw new Error('passkey: the user wasn\'t verified')
}

// navigator.credentials.create's answer: { id, clientDataJSON, authenticatorData, publicKey (SPKI DER), alg }, each
// base64url (alg a number). The passkey to keep, or a throw
export function register(r: any, o: { challenge: string; origin: string; rpId: string }): Passkey {
  if (r?.alg !== ES256) throw new Error('passkey: ES256 (P-256) only')
  const id = bytes(r.id, 'its id', 1400)
  clientData(bytes(r.clientDataJSON, 'its client data'), 'webauthn.create', o.challenge, o.origin)
  const a = authData(bytes(r.authenticatorData, 'its authenticator data'))
  forSite(a, o.rpId)
  if (!a.credId || !a.credId.equals(id)) throw new Error("passkey: the id isn't the authenticator's")
  let jwk: JsonWebKey
  try {
    jwk = createPublicKey({ key: bytes(r.publicKey, 'its public key'), format: 'der', type: 'spki' }).export({ format: 'jwk' })
  } catch {
    throw new Error("passkey: its public key doesn't read")
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('passkey: a P-256 key only')
  return { id: b64u(id), jwk, count: a.count }
}

// navigator.credentials.get's answer: { id, clientDataJSON, authenticatorData, signature }, each base64url. Checked:
// the passkey's id, the challenge (its caller's: single use), origin, rpIdHash, UV, the signature over authenticatorData
// || SHA-256(clientDataJSON) with the kept key (DER-encoded ECDSA, as WebAuthn's), the counter never back (0 and 0: an
// authenticator that keeps none, Apple's). The new count, or a throw
export function verifyGet(r: any, o: { challenge: string; origin: string; rpId: string; key: Passkey }): number {
  if (typeof r?.id !== 'string' || r.id !== o.key.id) throw new Error('passkey: not this device\'s')
  const raw = bytes(r.clientDataJSON, 'its client data')
  clientData(raw, 'webauthn.get', o.challenge, o.origin)
  const ad = bytes(r.authenticatorData, 'its authenticator data')
  const a = authData(ad)
  forSite(a, o.rpId)
  const sig = bytes(r.signature, 'its signature', 200)
  const ok = verify('sha256', Buffer.concat([ad, sha256(raw)]), { key: createPublicKey({ key: o.key.jwk, format: 'jwk' }), dsaEncoding: 'der' }, sig)
  if (!ok) throw new Error("passkey: the signature isn't its key's")
  if ((a.count > 0 || o.key.count > 0) && a.count <= o.key.count) throw new Error('passkey: its counter went back (a copied key?)')
  return a.count
}
