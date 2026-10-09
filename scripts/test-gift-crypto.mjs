import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptLetter, encryptLetter, normalizeAccount, normalizePassword, validateEnvelope } from '../mot-goc-nho/crypto.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

// Synthetic test material only. This is unrelated to the private gift letter.
const account = 'la-thu-test';
const password = 'ABCDE-FGHJK-MNPQR-STVW2';
const source = 'Dữ liệu kiểm thử: ă â đ ê ô ơ ư.\n\nMột đoạn thử khác — không phải nội dung riêng.\n';
const fixture = await encryptLetter(source, account, password);

test('normalizes the account and grouped password consistently', () => {
  assert.equal(normalizeAccount('  LA-THU-TEST  '), account);
  assert.equal(normalizePassword(' abcde fghjk-mnpqr\nstvw2 '), 'ABCDEFGHJKMNPQRSTVW2');
});

test('preserves exact Vietnamese UTF-8 content, newlines and punctuation', async () => {
  assert.equal(await decryptLetter(fixture, account, password), source);
});

test('opens with lower-case, pasted whitespace or omitted password separators', async () => {
  assert.equal(await decryptLetter(fixture, ' LA-THU-TEST ', 'abcde fghjk mnpqr stvw2'), source);
});

test('rejects both a wrong password and a wrong account through authentication', async () => {
  await assert.rejects(decryptLetter(fixture, account, 'WRONG-PASSW-ORD00-00000'), { code: 'OPEN_FAILED' });
  await assert.rejects(decryptLetter(fixture, 'la-thu-another', password), { code: 'OPEN_FAILED' });
});

test('rejects modified ciphertext and authentication tag', async () => {
  for (const position of [0, -1]) {
    const changed = structuredClone(fixture);
    const bytes = Buffer.from(changed.ciphertext, 'base64');
    const index = position === -1 ? bytes.length - 1 : position;
    bytes[index] ^= 1;
    changed.ciphertext = bytes.toString('base64');
    await assert.rejects(decryptLetter(changed, account, password), { code: 'OPEN_FAILED' });
  }
});

test('rejects unsupported or malformed public envelope metadata', () => {
  const variants = [
    { ...fixture, version: 2 },
    { ...fixture, kdf: { ...fixture.kdf, iterations: 1 } },
    { ...fixture, kdf: { ...fixture.kdf, salt: 'AAAA' } },
    { ...fixture, cipher: { ...fixture.cipher, iv: 'not base64!' } },
    { ...fixture, cipher: { ...fixture.cipher, tagLength: 32 } },
    { ...fixture, ciphertext: 'AAAA' },
  ];
  for (const envelope of variants) assert.throws(() => validateEnvelope(envelope), { code: 'INVALID_ENVELOPE' });
});

test('fresh encryption uses independent salt, IV and ciphertext', async () => {
  const next = await encryptLetter(source, account, password);
  assert.notEqual(next.kdf.salt, fixture.kdf.salt);
  assert.notEqual(next.cipher.iv, fixture.cipher.iv);
  assert.notEqual(next.ciphertext, fixture.ciphertext);
  assert.equal(await decryptLetter(next, account, password), source);
});

test('does not place the source, password or account in the public envelope', () => {
  const serialized = JSON.stringify(fixture);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(normalizePassword(password)), false);
  assert.equal(serialized.includes(account), false);
});

test('preserves a UTF-8 byte order mark when present in the private source', async () => {
  const marked = `\uFEFF${source}`;
  const envelope = await encryptLetter(marked, account, password);
  assert.equal(await decryptLetter(envelope, account, password), marked);
});

test('CLI init, verify, editing and rekeying keep source and credentials outside its repository', async () => {
  const execute = promisify(execFile);
  const temporaryParent = realpathSync(process.env.GIFT_TEST_TEMP_ROOT ?? tmpdir());
  const fixtureRoot = await mkdtemp(path.join(temporaryParent, 'gift-crypto-test-'));
  const fixtureRepository = path.join(fixtureRoot, 'site');
  const privateDirectory = path.join(fixtureRoot, 'private');
  const actualRepository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await mkdir(path.join(fixtureRepository, 'scripts'), { recursive: true });
    await mkdir(path.join(fixtureRepository, 'mot-goc-nho'), { recursive: true });
    await mkdir(privateDirectory);
    for (const relative of ['scripts/gift-tools.mjs', 'mot-goc-nho/crypto.js']) {
      await copyFile(path.join(actualRepository, relative), path.join(fixtureRepository, relative));
    }
    await writeFile(path.join(fixtureRepository, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(privateDirectory, 'letter.txt'), source);
    const run = (command, privatePath = '../private') => execute(process.execPath, ['scripts/gift-tools.mjs', command, '--private-dir', privatePath], { cwd: fixtureRepository });
    const initialized = await run('init');
    const credentialsPath = path.join(privateDirectory, 'credentials.json');
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    assert.match(credentials.password, /^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/u);
    assert.equal(initialized.stdout.includes(credentials.password), false);
    assert.equal(initialized.stdout.includes(source), false);
    assert.match((await run('verify')).stdout, /PASS/u);
    await assert.rejects(run('init'), (error) => error.stderr.includes('already exists'));
    await assert.rejects(run('encrypt', 'mot-goc-nho'), (error) => error.stderr.includes('must be outside'));
    await assert.rejects(run('encrypt', '..'), (error) => error.stderr.includes('not inside it or its parent'));

    await writeFile(path.join(privateDirectory, 'letter.txt'), `${source}Thay đổi phục vụ kiểm thử.\n`);
    await run('encrypt');
    assert.match((await run('verify')).stdout, /PASS/u);
    await run('rekey');
    const rekeyed = JSON.parse(await readFile(credentialsPath, 'utf8'));
    assert.equal(rekeyed.account, credentials.account);
    assert.notEqual(rekeyed.password, credentials.password);
    assert.match(rekeyed.password, /^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/u);
    assert.match((await run('verify')).stdout, /PASS/u);
    const publicEnvelope = JSON.parse(await readFile(path.join(fixtureRepository, 'mot-goc-nho', 'letter.enc.json'), 'utf8'));
    await assert.rejects(decryptLetter(publicEnvelope, credentials.account, credentials.password), { code: 'OPEN_FAILED' });
    assert.equal(JSON.stringify(publicEnvelope).includes(source), false);
    assert.equal(JSON.stringify(publicEnvelope).includes(rekeyed.password), false);
    // Owner-selected values are private inputs, never a hard-coded login check.
    const custom = {version:1,account:'OWNER-EXAMPLE',password:'24681357'};
    await writeFile(credentialsPath, JSON.stringify(custom));
    await run('encrypt');
    assert.match((await run('verify')).stdout, /PASS/u);
    const customEnvelope = JSON.parse(await readFile(path.join(fixtureRepository, 'mot-goc-nho', 'letter.enc.json'), 'utf8'));
    assert.equal(await decryptLetter(customEnvelope, ' owner-example ', ' 2468 1357\n'), `${source}Thay đổi phục vụ kiểm thử.\n`);
    await assert.rejects(decryptLetter(customEnvelope, rekeyed.account, rekeyed.password), {code:'OPEN_FAILED'});
    await writeFile(credentialsPath, JSON.stringify({...custom,password:'1234567'}));
    await assert.rejects(run('encrypt'), error => error.stderr.includes('invalid format') && !error.stderr.includes('1234567'));
    await writeFile(credentialsPath, JSON.stringify(custom));
    await run('rekey');
    const regenerated = JSON.parse(await readFile(credentialsPath, 'utf8'));
    assert.equal(regenerated.account, custom.account);
    assert.match(regenerated.password, /^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/u);
    assert.match((await run('verify')).stdout, /PASS/u);
    await writeFile(credentialsPath, '{"password":"SYNTHETIC-SECRET-NEVER-PRINT"');
    await assert.rejects(run('verify'), (error) => error.stderr.includes('cannot be read or parsed') && !error.stderr.includes('SYNTHETIC-SECRET-NEVER-PRINT'));
  } finally {
    const verified = realpathSync(fixtureRoot);
    assert.equal(path.dirname(verified), temporaryParent);
    assert.equal(path.basename(verified).startsWith('gift-crypto-test-'), true);
    await rm(verified, { recursive: true, force: true });
  }
});
