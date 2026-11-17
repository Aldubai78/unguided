// PBKDF2-HMAC-SHA256 (RFC 2898) in pure TS.
// Built on the project's verified SHA-256/HMAC (src/sha256.ts).
// Verified against Node crypto.pbkdf2Sync (iter 1/1000/100000, dk 32/64).
import { hmacSha256 } from "./sha256";

/**
 * pbkdf2(password, salt, iterations, dkLen) -> dkLen bytes.
 * Standard PBKDF2 (RFC 2898) with HMAC-SHA256 as the PRF.
 */
export function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const out = new Uint8Array(dkLen);
  const saltLen = salt.length;
  let offset = 0;
  for (let block = 1; offset < dkLen; block++) {
    const saltBlock = new Uint8Array(saltLen + 4);
    saltBlock.set(salt, 0);
    saltBlock[saltLen] = (block >>> 24) & 0xff;
    saltBlock[saltLen + 1] = (block >>> 16) & 0xff;
    saltBlock[saltLen + 2] = (block >>> 8) & 0xff;
    saltBlock[saltLen + 3] = block & 0xff;
    let U = hmacSha256(password, saltBlock);
    const T = new Uint8Array(32);
    T.set(U);
    for (let i = 1; i < iterations; i++) {
      U = hmacSha256(password, U);
      for (let j = 0; j < 32; j++) T[j] ^= U[j];
    }
    const take = Math.min(32, dkLen - offset);
    out.set(T.subarray(0, take), offset);
    offset += take;
  }
  return out;
}
