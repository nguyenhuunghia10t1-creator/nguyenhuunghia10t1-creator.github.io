import { webcrypto } from 'node:crypto';
import { readFile, writeFile, rename, lstat, mkdir, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptLetter, encryptLetter, normalizeAccount, normalizePassword } from '../mot-goc-nho/crypto.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const repositoryRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const publicEnvelopePath = path.join(repositoryRoot, 'mot-goc-nho', 'letter.enc.json');
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const usage = 'Usage: node scripts/gift-tools.mjs <init|encrypt|rekey|verify> --private-dir ../private';

function isWithin(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function exists(filename) {
  try { await access(filename); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function privateFile(privateDirectory, filename, required = true) {
  const destination = path.join(privateDirectory, filename);
  if (!(await exists(destination))) {
    if (required) throw new Error(`Missing private file: ${filename}`);
    return destination;
  }
  const metadata = await lstat(destination);
  const resolved = realpathSync(destination);
  if (metadata.isSymbolicLink() || !metadata.isFile() || !isWithin(resolved, privateDirectory) || isWithin(resolved, repositoryRoot)) {
    throw new Error(`Private file must be a regular file outside the repository: ${filename}`);
  }
  return resolved;
}

async function readCredentials(filename) {
  let credentials;
  try { credentials = JSON.parse(await readFile(filename, 'utf8')); }
  catch { throw new Error('The private credentials file cannot be read or parsed.'); }
  if (credentials?.version !== 1 || typeof credentials.account !== 'string' || typeof credentials.password !== 'string' || !/^la-thu-[0-9a-hjkmnp-tv-z]{8}$/u.test(normalizeAccount(credentials.account)) || !/^[0-9A-HJKMNP-TV-Z]{20}$/u.test(normalizePassword(credentials.password))) {
    throw new Error('The private credentials file has an invalid format.');
  }
  return credentials;
}

function randomCharacters(length) {
  return Array.from(webcrypto.getRandomValues(new Uint8Array(length)), (byte) => alphabet[byte & 31]).join('');
}

function newCredentials(previous) {
  const ungroupedPassword = randomCharacters(20);
  return {
    version: 1,
    account: previous?.account ?? `la-thu-${randomCharacters(8).toLowerCase()}`,
    password: ungroupedPassword.match(/.{5}/gu).join('-'),
    createdAt: new Date().toISOString(),
  };
}

async function atomicWrite(filename, contents, mode = 0o600) {
  const temporary = `${filename}.tmp-${webcrypto.randomUUID()}`;
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', mode, flag: 'wx' });
    await rename(temporary, filename);
  } catch (error) {
    // The temporary file is left in its original directory for recovery.
    throw new Error(`Could not save ${path.basename(filename)} (${error.code ?? 'write failed'}).`);
  }
}

async function run() {
  const [command, option, privateArgument, ...extra] = process.argv.slice(2);
  if (!['init', 'encrypt', 'rekey', 'verify'].includes(command) || option !== '--private-dir' || !privateArgument || extra.length) {
    throw new Error(usage);
  }
  const requestedDirectory = path.resolve(process.cwd(), privateArgument);
  if (isWithin(requestedDirectory, repositoryRoot)) throw new Error('The private directory must be outside the repository and static server root.');
  const privateDirectory = realpathSync(requestedDirectory);
  if (isWithin(privateDirectory, repositoryRoot) || isWithin(repositoryRoot, privateDirectory)) {
    throw new Error('The private directory must be separate from the repository, not inside it or its parent.');
  }
  const letterPath = await privateFile(privateDirectory, 'letter.txt');
  const credentialsPath = await privateFile(privateDirectory, 'credentials.json', command !== 'init');
  const originalBytes = await readFile(letterPath);
  let plaintext;
  try { plaintext = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(originalBytes); }
  catch { throw new Error('letter.txt must contain valid UTF-8 text.'); }
  if (!plaintext.trim()) throw new Error('letter.txt is empty.');
  const previousCredentials = command === 'init' ? undefined : await readCredentials(credentialsPath);
  if (command === 'init' && await exists(credentialsPath)) throw new Error('credentials.json already exists; use encrypt or rekey.');
  const credentials = command === 'init' || command === 'rekey' ? newCredentials(previousCredentials) : previousCredentials;

  if (command === 'verify') {
    let envelope;
    try { envelope = JSON.parse(await readFile(publicEnvelopePath, 'utf8')); }
    catch { throw new Error('The public encrypted letter cannot be read or parsed.'); }
    const opened = await decryptLetter(envelope, credentials.account, credentials.password);
    if (!Buffer.from(opened, 'utf8').equals(originalBytes)) throw new Error('Verification failed: decrypted UTF-8 bytes differ from the private source.');
    console.log('PASS: encrypted letter matches the private source exactly. No plaintext was printed.');
    return;
  }

  const envelope = await encryptLetter(plaintext, credentials.account, credentials.password);
  if (!Buffer.from(await decryptLetter(envelope, credentials.account, credentials.password), 'utf8').equals(originalBytes)) {
    throw new Error('Round-trip validation failed; no files were changed.');
  }
  await mkdir(path.dirname(publicEnvelopePath), { recursive: true });
  if (command === 'rekey') {
    const backupPath = await privateFile(privateDirectory, 'credentials.previous.json', false);
    await atomicWrite(backupPath, `${JSON.stringify(previousCredentials, null, 2)}\n`);
  }
  if (command === 'init' || command === 'rekey') {
    // Preserve a recoverable candidate before replacing either active file.
    const candidatePath = await privateFile(privateDirectory, 'credentials.pending.json', false);
    await atomicWrite(candidatePath, `${JSON.stringify(credentials, null, 2)}\n`);
    await atomicWrite(publicEnvelopePath, `${JSON.stringify(envelope, null, 2)}\n`, 0o644);
    await rename(candidatePath, credentialsPath);
  } else {
    await atomicWrite(publicEnvelopePath, `${JSON.stringify(envelope, null, 2)}\n`, 0o644);
  }
  console.log(`PASS: saved ${path.relative(repositoryRoot, publicEnvelopePath)}.`);
  console.log('Private source and opening details remain outside the repository. No credentials were printed.');
}

try { await run(); }
catch (error) {
  // Errors from JSON parsers or crypto must never print private source fragments.
  const message = error.code === 'OPEN_FAILED' ? 'Verification failed: account/password do not match the encrypted letter.' : error.message;
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}
