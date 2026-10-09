// This module contains algorithms and public envelope handling only.
// Never put a real letter, password or derived key in this file.
const VERSION = 1;
const ITERATIONS = 600_000;
const MAX_CIPHERTEXT_BYTES = 128 * 1024;
const encoder = new TextEncoder();

function failure(message, code) {
  return Object.assign(new Error(message), { code });
}

function cryptoProvider() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw failure('Trình duyệt này chưa hỗ trợ mở lá thư. Em thử một trình duyệt mới hơn nhé.', 'CRYPTO_UNAVAILABLE');
  }
  return globalThis.crypto;
}

export function normalizeAccount(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizePassword(value) {
  return String(value ?? '').replace(/[\s-]/gu, '').toUpperCase();
}

function toBase64(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value, maximumLength) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximumLength / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw failure('Dữ liệu lá thư chưa hợp lệ. Em thử tải lại trang nhé.', 'INVALID_ENVELOPE');
  }
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (toBase64(decoded) !== value || decoded.byteLength > maximumLength) {
    throw failure('Dữ liệu lá thư chưa hợp lệ. Em thử tải lại trang nhé.', 'INVALID_ENVELOPE');
  }
  return decoded;
}

export function validateEnvelope(envelope) {
  if (!envelope || envelope.version !== VERSION || envelope.kdf?.name !== 'PBKDF2' || envelope.kdf.hash !== 'SHA-256' || envelope.kdf.iterations !== ITERATIONS || envelope.cipher?.name !== 'AES-GCM' || envelope.cipher.tagLength !== 128) {
    throw failure('Dữ liệu lá thư chưa hợp lệ. Em thử tải lại trang nhé.', 'INVALID_ENVELOPE');
  }
  const salt = fromBase64(envelope.kdf.salt, 16);
  const iv = fromBase64(envelope.cipher.iv, 12);
  const ciphertext = fromBase64(envelope.ciphertext, MAX_CIPHERTEXT_BYTES);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw failure('Dữ liệu lá thư chưa hợp lệ. Em thử tải lại trang nhé.', 'INVALID_ENVELOPE');
  }
  return { salt, iv, ciphertext };
}

function associatedData(account) {
  const normalized = normalizeAccount(account);
  if (!normalized || normalized.length > 128) {
    throw failure('Thông tin mở thư chưa đúng. Em kiểm tra lại nhé.', 'OPEN_FAILED');
  }
  return encoder.encode(`mot-goc-nho:v${VERSION}:${normalized}`);
}

async function deriveKey(password, salt, usage) {
  const canonical = normalizePassword(password);
  if (!canonical || canonical.length > 256) {
    throw failure('Thông tin mở thư chưa đúng. Em kiểm tra lại nhé.', 'OPEN_FAILED');
  }
  const provider = cryptoProvider();
  const passwordBytes = encoder.encode(canonical);
  let baseKey;
  try {
    baseKey = await provider.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
  } finally {
    passwordBytes.fill(0);
  }
  return provider.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function encryptLetter(plaintext, account, password) {
  if (typeof plaintext !== 'string') throw new TypeError('Letter input must be text.');
  const plaintextBytes = encoder.encode(plaintext);
  if (!plaintextBytes.byteLength || plaintextBytes.byteLength > MAX_CIPHERTEXT_BYTES - 16) {
    throw new RangeError('Letter input must contain between 1 and 131056 UTF-8 bytes.');
  }
  const provider = cryptoProvider();
  const salt = provider.getRandomValues(new Uint8Array(16));
  const iv = provider.getRandomValues(new Uint8Array(12));
  const additionalData = associatedData(account);
  const key = await deriveKey(password, salt, 'encrypt');
  let ciphertext;
  try {
    ciphertext = await provider.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintextBytes);
  } finally {
    plaintextBytes.fill(0);
  }
  return {
    version: VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), tagLength: 128 },
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptLetter(envelope, account, password) {
  const { salt, iv, ciphertext } = validateEnvelope(envelope);
  const additionalData = associatedData(account);
  const provider = cryptoProvider();
  const key = await deriveKey(password, salt, 'decrypt');
  let plaintextBytes;
  try {
    plaintextBytes = new Uint8Array(await provider.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
      key,
      ciphertext,
    ));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintextBytes);
  } catch {
    throw failure('Thông tin mở thư chưa đúng. Em kiểm tra lại nhé.', 'OPEN_FAILED');
  } finally {
    plaintextBytes?.fill(0);
  }
}
