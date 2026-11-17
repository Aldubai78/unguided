// Local credential hashing for offline sign-in (Phase 3.0 S7, Model B).
//
// The device stores a SALTED PBKDF2-HMAC-SHA256 hash of each known user's
// password in the local vault (credStore). Sign-in is 100% local:
// verifyPassword() recomputes the hash and compares in constant time — NO
// plaintext is ever stored, and sign-in NEVER touches the server.
//
// Why PBKDF2 (and not scrypt): the web build has no WebCrypto.scrypt and no
// node:crypto, and a hand-rolled scrypt (Salsa20/8) is error-prone to verify.
// PBKDF2-HMAC-SHA256 is built entirely from the project's already-VERIFIED
// SHA-256/HMAC (src/sha256.ts, proven against FIPS/RFC vectors and Node's
// crypto.pbkdf2Sync). 210,000 iterations is the OWASP interactive-credential
// recommendation for PBKDF2-SHA256 — the standard parameter. Same security
// class for a device-local credential cache. (The server keeps its own scrypt
// hash in the DB and re-verifies the password on register — the device hash is
// only the offline sign-in verifier.)
//
// Format stored: `pbkdf2$210000$32$saltHex$hashHex`
//   iterations, keyLen, 16-byte salt, 32-byte derived key.
import { pbkdf2 } from "./pbkdf2";

const ITERATIONS = 210000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const PREFIX = "pbkdf2";

function bufToHex(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, "0");
  return s;
}
function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      i++;
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** Compute the stored hash string for a password. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const dk = pbkdf2(utf8(password), salt, ITERATIONS, KEY_LEN);
  return `${PREFIX}$${ITERATIONS}$${KEY_LEN}$${bufToHex(salt)}$${bufToHex(dk)}`;
}

/** Constant-time compare of a derived key vs the expected hex. */
function ctEqualHex(a: Uint8Array, b: string): boolean {
  if (a.length * 2 !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const hi = parseInt(b.slice(i * 2, i * 2 + 1), 16);
    const lo = parseInt(b.slice(i * 2 + 1, i * 2 + 2), 16);
    diff |= a[i] ^ (hi << 4 | lo);
  }
  return diff === 0;
}

/**
 * Verify a password against a stored `pbkdf2$...` hash string.
 * Returns false on any malformed input (never throws).
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    // [pbkdf2, iter, keyLen, saltHex, hashHex]
    if (parts.length !== 5 || parts[0] !== PREFIX) return false;
    const iter = parseInt(parts[1], 10);
    const keyLen = parseInt(parts[2], 10);
    const salt = hexToBuf(parts[3]);
    const expected = parts[4];
    if (!iter || !keyLen) return false;
    const dk = pbkdf2(utf8(password), salt, iter, keyLen);
    return ctEqualHex(dk, expected);
  } catch {
    return false;
  }
}
