import { readFile, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read private comparison material at runtime. Never add it to this script.
const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const baseline = '255ea853';
const summary = { candidateFiles: 0, stagedBlobs: 0, newHistoryObjects: 0, sensitiveMatches: 0, forbiddenArtifacts: 0, unsafePaths: 0 };
const args = ['-c', `safe.directory=${root}`, '-C', root];

function within(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function git(arguments_, input) {
  const result = spawnSync('git', [...args, ...arguments_], { input, encoding: null, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Git inspection failed. Run in the project checkout with readable Git metadata.');
  return result.stdout;
}
function forbidden(name) {
  const normalized = name.replaceAll('\\', '/');
  return /(^|\/)(?:private|\.private|screenshots|playwright-report|test-results|traces)(\/|$)/iu.test(normalized)
    || /(?:^|\/)(?:credentials(?:\.[^/]*)?\.json|letter\.(?:txt|md)|\.env(?:\.[^/]*)?)$/iu.test(normalized)
    || /\.(?:map|har)$/iu.test(normalized);
}
function patternsFor(secrets) {
  const unique = new Map();
  for (const secret of secrets) {
    if (!secret) continue;
    const utf8 = Buffer.from(secret, 'utf8');
    const utf16 = Buffer.from(secret, 'utf16le');
    const forms = [utf8, utf16, Buffer.from(utf16).swap16()];
    const html = secret.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    const escapedUnicode = Array.from(secret).map(character => Array.from({ length: character.length }, (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, '0')}`).join('')).join('');
    for (const text of [JSON.stringify(secret).slice(1, -1), escapedUnicode, escapedUnicode.toUpperCase().replaceAll('\\U', '\\u'), html, encodeURIComponent(secret), utf8.toString('base64'), utf8.toString('base64url'), utf16.toString('base64')]) {
      forms.push(Buffer.from(text, 'utf8'));
    }
    for (const bytes of forms) unique.set(bytes.toString('hex'), bytes);
  }
  return [...unique.values()];
}
function scan(bytes, patterns) {
  if (patterns.some(pattern => bytes.includes(pattern))) summary.sensitiveMatches++;
}
function scanObjects(objectIds, patterns, counter) {
  const ids = [...new Set(objectIds)];
  for (let start = 0; start < ids.length; start += 24) {
    const chunk = ids.slice(start, start + 24);
    const output = git(['cat-file', '--batch'], `${chunk.join('\n')}\n`);
    let offset = 0;
    for (let index = 0; index < chunk.length; index++) {
      const boundary = output.indexOf(10, offset);
      if (boundary < 0) throw new Error('Git object inspection returned incomplete data.');
      const header = output.subarray(offset, boundary).toString('ascii').split(' ');
      const size = Number(header[2]);
      if (header.length !== 3 || !Number.isSafeInteger(size) || size < 0) throw new Error('Git object metadata was invalid.');
      offset = boundary + 1;
      if (header[1] === 'blob' || header[1] === 'commit') {
        scan(output.subarray(offset, offset + size), patterns);
        summary[counter]++;
      }
      offset += size + 1;
    }
  }
}

try {
  const [option, directory, ...extra] = process.argv.slice(2);
  if (option !== '--private-dir' || !directory || extra.length) throw new Error('Usage: node scripts/audit-gift.mjs --private-dir ../private');
  const privateRoot = realpathSync(path.resolve(process.cwd(), directory));
  if (within(privateRoot, root) || within(root, privateRoot)) throw new Error('Private comparison files must be outside and separate from the repository.');
  const readPrivate = async name => {
    const filename = realpathSync(path.join(privateRoot, name));
    if (!within(filename, privateRoot) || within(filename, root)) throw new Error('Private comparison path is invalid.');
    return readFile(filename, 'utf8');
  };
  const letter = await readPrivate('letter.txt');
  let credentials;
  try { credentials = JSON.parse(await readPrivate('credentials.json')); }
  catch { throw new Error('Private credentials could not be read.'); }
  if (typeof credentials?.password !== 'string' || typeof credentials?.account !== 'string') throw new Error('Private credentials have an invalid format.');
  const canonicalPassword = credentials.password.replace(/[\s-]/gu, '').toUpperCase();
  const secrets = [letter, letter.trimEnd(), ...letter.split(/\r?\n/u).filter(line => line.trim()), credentials.account, credentials.password, credentials.password.toLowerCase(), canonicalPassword, canonicalPassword.toLowerCase()];
  const patterns = patternsFor(secrets);
  const filenames = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const name of new Set(filenames)) {
    if (forbidden(name)) summary.forbiddenArtifacts++;
    const filename = path.resolve(root, name);
    if (!within(filename, root)) { summary.unsafePaths++; continue; }
    let metadata;
    try { metadata = await lstat(filename); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (metadata.isSymbolicLink() || !metadata.isFile() || !within(realpathSync(filename), root)) { summary.unsafePaths++; continue; }
    scan(await readFile(filename), patterns);
    summary.candidateFiles++;
  }

  const stagedEntries = git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
  const stagedIds = [];
  for (const entry of stagedEntries) {
    const tab = entry.indexOf('\t');
    const metadata = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    if (metadata[0] === '120000' || metadata[0] === '160000') summary.unsafePaths++;
    if (forbidden(name)) summary.forbiddenArtifacts++;
    stagedIds.push(metadata[1]);
  }
  scanObjects(stagedIds, patterns, 'stagedBlobs');
  git(['rev-parse', '--verify', `${baseline}^{commit}`]);
  const historical = git(['rev-list', '--objects', `${baseline}..HEAD`]).toString('utf8').trim().split('\n').filter(Boolean);
  const historyIds = [];
  for (const entry of historical) {
    const separator = entry.indexOf(' ');
    historyIds.push(separator < 0 ? entry : entry.slice(0, separator));
    if (separator >= 0 && forbidden(entry.slice(separator + 1))) summary.forbiddenArtifacts++;
  }
  scanObjects(historyIds, patterns, 'newHistoryObjects');
  const passed = summary.sensitiveMatches === 0 && summary.forbiddenArtifacts === 0 && summary.unsafePaths === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${JSON.stringify(summary)}`);
  if (!passed) process.exitCode = 1;
} catch (error) {
  // Never echo parser excerpts, source text, credentials, object contents or file data.
  console.error(`Audit could not complete: ${error.message.startsWith('Usage:') ? error.message : 'check repository and private input access.'}`);
  process.exitCode = 1;
}
