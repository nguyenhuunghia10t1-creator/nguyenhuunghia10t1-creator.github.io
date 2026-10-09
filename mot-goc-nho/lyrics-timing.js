const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/gu;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function timestampSeconds(minutes, seconds, fraction = '') {
  const secs = Number(seconds);
  if (secs >= 60) return null;
  return Number(minutes) * 60 + secs + (fraction ? Number(fraction) / 10 ** fraction.length : 0);
}

/** Standard LRC. A timestamp with no text deliberately clears an instrumental. */
export function parseLrc(input) {
  if (typeof input !== 'string') throw new TypeError('LRC must be UTF-8 text.');
  const rows = [];
  let offsetMs = 0;
  let duration = null;
  const metadata = {};
  for (const raw of input.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const offset = /^\[offset:\s*([+-]?\d+)\s*\]$/iu.exec(line);
    if (offset) { offsetMs = Number(offset[1]); continue; }
    const length = /^\[length:(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]$/iu.exec(line);
    if (length) { duration = timestampSeconds(length[1], length[2], length[3]); continue; }
    const tag = /^\[([a-z]+):([^\]]*)\]$/iu.exec(line);
    if (tag) { metadata[tag[1].toLowerCase()] = tag[2].trim(); continue; }
    const matches = [...line.matchAll(STAMP)];
    if (!matches.length || matches[0].index !== 0) continue;
    let end = 0;
    const times = [];
    for (const match of matches) {
      // Multiple timestamps must precede the lyric, never be extracted from it.
      if (line.slice(end, match.index).trim()) break;
      const time = timestampSeconds(match[1], match[2], match[3]);
      if (time !== null) times.push(time);
      end = match.index + match[0].length;
    }
    const text = line.slice(end).trim().normalize('NFC');
    for (const time of times) rows.push({ time, text, end: null });
  }
  return prepareTimeline(rows, { offsetMs, duration, metadata });
}

/** Optional JSON: {offsetMs, duration, cues:[{time:seconds, text, end?:seconds}]}. */
export function parseTimestampedLyrics(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const cues = Array.isArray(data) ? data : data?.cues;
  if (!Array.isArray(cues)) throw new TypeError('Lyrics need timestamped cues.');
  const rows = [];
  for (const cue of cues) {
    if (!finite(cue?.time) || cue.time < 0 || typeof cue.text !== 'string') continue;
    const end = finite(cue.end) && cue.end > cue.time ? cue.end : null;
    rows.push({ time: cue.time, text: cue.text.trim().normalize('NFC'), end });
  }
  return prepareTimeline(rows, {
    offsetMs: finite(data?.offsetMs) ? data.offsetMs : 0,
    duration: finite(data?.duration) && data.duration >= 0 ? data.duration : null,
    metadata: {},
  });
}

function prepareTimeline(rows, { offsetMs, duration, metadata }) {
  rows.sort((a, b) => a.time - b.time);
  // The final entry at an identical timestamp wins, including an empty clear cue.
  const cues = [];
  for (const row of rows) {
    if (cues.length && cues[cues.length - 1].time === row.time) cues[cues.length - 1] = row;
    else cues.push(row);
  }
  return { cues, offsetMs, duration, metadata, hasLyrics: cues.some(cue => cue.text) };
}

export function lyricAtTime(timeline, mediaTime, options = {}) {
  const time = mediaTime + ((timeline?.offsetMs || 0) + (finite(options.offsetMs) ? options.offsetMs : 0)) / 1000;
  const cues = timeline?.cues || [];
  const empty = { index: -1, text: '', nextText: '', time, start: null, end: null, phase: 'empty', progress: 0 };
  if (!finite(time) || !cues.length) return empty;
  let low = 0, high = cues.length - 1, index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].time <= time) { index = middle; low = middle + 1; } else high = middle - 1;
  }
  if (index < 0) return empty;
  const cue = cues[index];
  const next = cues[index + 1];
  const maxDisplay = finite(options.maxDisplayMs) && options.maxDisplayMs > 0 ? options.maxDisplayMs / 1000 : Infinity;
  const mediaDuration = finite(options.mediaDuration) && options.mediaDuration > 0 ? options.mediaDuration : Infinity;
  const end = Math.min(cue.end ?? Infinity, next?.time ?? Infinity, timeline.duration ?? Infinity, mediaDuration, cue.time + maxDisplay);
  if (!cue.text || time >= end || options.ended) return { ...empty, index, start: cue.time, end };
  const duration = end - cue.time;
  const formingDuration = Math.min(Math.max(0, options.formationMs ?? 850) / 1000, duration * 0.22);
  const dissolveDuration = Math.min(Math.max(0, options.dissolveMs ?? 1050) / 1000, duration * 0.27);
  const age = time - cue.time;
  let phase = 'stable', progress = 0;
  if (age < formingDuration) { phase = 'forming'; progress = formingDuration ? age / formingDuration : 1; }
  else if (time >= end - dissolveDuration) { phase = 'dissolving'; progress = dissolveDuration ? (time - end + dissolveDuration) / dissolveDuration : 1; }
  const nextLimit = Math.max(0, options.nextPreviewMs ?? 8000) / 1000;
  const nextText = options.showNext !== false && next?.text && next.time - time <= nextLimit ? next.text : '';
  return { index, text: cue.text, nextText, time, start: cue.time, end, phase, progress: Math.min(1, Math.max(0, progress)) };
}

/** Acoustic word/syllable timestamps. Untimed ad-libs stay in the source data. */
export function parseWordLyrics(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(data?.lines)) throw new TypeError('Lyrics need timed word lines.');
  const cues = [];
  let previousStart = -1;
  for (const line of data.lines) {
    if (!Array.isArray(line?.words)) throw new TypeError('A lyric line needs words.');
    const words = [];
    for (const word of line.words) {
      if (word?.start === null && word?.end === null && word?.needsReview) continue;
      if (!finite(word?.start) || !finite(word?.end) || word.start < 0 || word.end <= word.start || typeof word.text !== 'string') throw new TypeError('Invalid word timestamp.');
      if (word.start < previousStart) throw new TypeError('Word starts must follow the audio order.');
      previousStart = word.start;
      words.push({...word, text: word.text.normalize('NFC')});
    }
    if (!words.length) continue;
    const text = words.map((word, index) => `${index && word.spaceBefore !== false ? ' ' : ''}${word.text}`).join('');
    cues.push({time: words[0].start, end: Math.max(...words.map(word => word.end)),
      displayEnd: finite(line.displayEnd) ? line.displayEnd : null, text, words, sourceLineId: line.id});
  }
  const duration = finite(data.audio?.duration) ? data.audio.duration : null;
  if (duration !== null && cues.some(cue => cue.end > duration)) throw new TypeError('Lyrics exceed the MP3 duration.');
  return {cues, duration, offsetMs: finite(data.offsetSeconds) ? data.offsetSeconds * 1000 : 0,
    metadata: data.alignment || {}, hasLyrics: cues.length > 0, wordLevel: true};
}

/** Pure media-clock selection; seeking, looping and pausing need no lyric timer. */
export function wordLyricAtTime(timeline, mediaTime, options = {}) {
  const time = mediaTime + ((timeline?.offsetMs || 0) + (finite(options.offsetMs) ? options.offsetMs : 0)) / 1000;
  const empty = {index: -1, text: '', nextText: '', words: [], layers: [], time, start: null, end: null, phase: 'empty', progress: 0};
  const cues = timeline?.cues || [];
  const duration = Math.min(timeline?.duration ?? Infinity,
    finite(options.mediaDuration) && options.mediaDuration > 0 ? options.mediaDuration : Infinity);
  if (!finite(time) || !cues.length || options.ended || time >= duration) return empty;
  let low = 0, high = cues.length - 1, index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].time <= time) {index = middle; low = middle + 1;}
    else high = middle - 1;
  }
  if (index < 0) return empty;
  const fade = Math.max(0.02, (options.crossfadeMs ?? 180) / 1000);
  const hold = Math.max(0, (options.lineHoldMs ?? 900) / 1000);
  const ease = value => {const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t);};
  const endFor = n => Math.min(cues[n].displayEnd ?? cues[n].end + hold,
    cues[n + 1] ? cues[n + 1].time + fade : Infinity, duration);
  const layers = [];
  for (const n of [index - 1, index]) {
    if (n < 0) continue;
    const cue = cues[n], end = endFor(n);
    if (time >= end) continue;
    const fading = ease((time - (end - fade)) / fade);
    layers.push({index: n, cue, opacity: 1 - fading, translateY: -4 * fading});
  }
  if (!layers.length) return {...empty, index};
  const cue = cues[index], end = endFor(index);
  return {index, text: cue.text, nextText: '', words: cue.words, layers, time, start: cue.time, end,
    phase: layers.length > 1 ? 'crossfading' : time >= end - fade ? 'dissolving' : 'stable',
    progress: Math.min(1, Math.max(0, (time - cue.time) / Math.max(.001, end - cue.time)))};
}
