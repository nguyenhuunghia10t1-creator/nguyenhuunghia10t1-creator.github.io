import {parseLrc, parseTimestampedLyrics, parseWordLyrics, lyricAtTime, wordLyricAtTime} from './lyrics-timing.js?v=20261009-word1';

const EMPTY = {index: -1, text: '', nextText: '', words: [], layers: [], phase: 'empty', progress: 0, time: 0, start: null, end: null};
const smooth = value => {const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t);};

/** Lightweight HTML typography driven only by the existing MP3's currentTime. */
export function createLyrics({root, current, next, music, config = {}, reducedMotion = false, onAvailability = () => {}}) {
  let audio = null, timeline = null, status = 'idle', view = 'locked';
  let disposed = false, suspended = false, available = false, frame = 0;
  let state = {...EMPTY}, lastPaint = 0;
  const rows = new Map(), listeners = [], abort = new AbortController();
  if (next) next.hidden = true;
  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }
  function sourceMatches() {
    if (!audio || audio.error || !config.expectedSourceUrl) return false;
    try {
      const expected = new URL(config.expectedSourceUrl, document.baseURI).href;
      return new URL(audio.src, document.baseURI).href === expected
        && (!audio.currentSrc || new URL(audio.currentSrc, document.baseURI).href === expected);
    } catch {return false;}
  }
  function publishAvailability(value) {
    if (available === value) return;
    available = value;
    document.body.classList.toggle('has-lyrics', value);
    onAvailability(value);
  }
  function clear() {
    if (root.hidden && !rows.size && root.dataset.phase === 'empty') return;
    root.hidden = true;
    root.dataset.phase = 'empty'; root.dataset.index = '-1';
    if (rows.size) {current.replaceChildren(); rows.clear();}
    current.removeAttribute('aria-label');
  }
  function buildRow(layer) {
    const row = document.createElement('div');
    row.className = 'lyric-line';
    row.dataset.lineIndex = String(layer.index);
    row.setAttribute('aria-hidden', 'true');
    const nodes = layer.cue.words.map((word, index) => {
      if (index && word.spaceBefore !== false) row.append(document.createTextNode(' '));
      const node = document.createElement('span');
      node.className = 'lyric-word';
      node.textContent = word.text;
      node.dataset.wordId = String(word.id ?? index);
      row.append(node);
      return {node, word, progress: -1};
    });
    current.append(row);
    const result = {row, nodes, opacity: -1, translateY: NaN};
    rows.set(layer.index, result);
    return result;
  }
  function paint() {
    const active = new Set(state.layers.map(layer => layer.index));
    for (const [index, row] of rows) if (!active.has(index)) {row.row.remove(); rows.delete(index);}
    const reveal = Math.max(.02, (config.wordRevealMs ?? 110) / 1000);
    for (const layer of state.layers) {
      const row = rows.get(layer.index) || buildRow(layer);
      const opacity = reducedMotion ? (layer.index === state.index ? 1 : 0) : layer.opacity;
      const translateY = reducedMotion ? 0 : layer.translateY;
      if (row.opacity !== opacity) {row.row.style.opacity = String(opacity); row.opacity = opacity;}
      if (row.translateY !== translateY) {row.row.style.transform = `translateY(${translateY}px)`; row.translateY = translateY;}
      for (const item of row.nodes) {
        const progress = state.time < item.word.start ? 0 : reducedMotion ? 1 : smooth((state.time - item.word.start) / reveal);
        if (progress === item.progress) continue;
        item.node.style.opacity = String(progress);
        item.node.style.transform = `translateY(${(1 - progress) * 4}px)`;
        item.node.dataset.revealed = String(state.time >= item.word.start);
        item.progress = progress;
      }
    }
    if (current.getAttribute('aria-label') !== state.text) current.setAttribute('aria-label', state.text);
    if (root.dataset.phase !== state.phase) root.dataset.phase = state.phase;
    if (root.dataset.index !== String(state.index)) root.dataset.index = String(state.index);
  }
  function sync() {
    if (disposed) return;
    publishAvailability(Boolean(timeline?.hasLyrics && sourceMatches()));
    if (!available || view !== 'explore' || document.hidden || suspended) {
      state = {...EMPTY, time: audio?.currentTime || 0}; clear(); return;
    }
    const options = {...config, mediaDuration: audio.duration, ended: audio.ended};
    if (timeline.wordLevel) state = wordLyricAtTime(timeline, audio.currentTime, options);
    else {
      // Legacy line timestamps are supported without inventing per-word timing.
      state = lyricAtTime(timeline, audio.currentTime, {...options, formationMs: 0, dissolveMs: 0});
      state.words = state.text ? [{text: state.text, start: state.start}] : [];
      state.layers = state.text ? [{index: state.index, cue: {words: state.words}, opacity: 1, translateY: 0}] : [];
    }
    if (!state.layers.length) {clear(); return;}
    if (root.hidden) root.hidden = false;
    paint();
  }
  function stopFrame() {cancelAnimationFrame(frame); frame = 0;}
  function schedule() {
    if (frame || disposed || suspended || document.hidden || view !== 'explore' || !available || !audio || audio.paused || audio.ended) return;
    frame = requestAnimationFrame(timestamp => {
      frame = 0;
      // RAF schedules observation, never advances lyric time or predicts audio position.
      if (timestamp - lastPaint >= 1000 / 30) {sync(); lastPaint = timestamp;}
      schedule();
    });
  }
  function refresh() {sync(); if (audio?.paused || document.hidden) stopFrame(); schedule();}
  function getState() {
    return Object.freeze({status: timeline?.hasLyrics && !sourceMatches() ? 'source-mismatch' : status,
      available, view, index: state.index, text: state.text, nextText: '',
      mediaTime: audio?.currentTime || 0, effectiveTime: state.time, paused: audio?.paused ?? true,
      muted: audio?.muted ?? false, phase: state.phase, renderedPhase: root.dataset.phase || 'empty',
      progress: state.progress, start: state.start, end: state.end,
      revealedWords: state.words.filter(word => word.start <= state.time).map(word => word.text),
      particleClock: state.time, particleCount: 0, cueCount: timeline?.cues.length || 0,
      fontReady: document.fonts?.check?.('400 24px "Gift Noto Serif"') ?? true,
      sourceMatched: sourceMatches(), offsetMs: (timeline?.offsetMs || 0) + (Number(config.offsetMs) || 0)});
  }
  listen(document, 'visibilitychange', refresh);
  listen(window, 'pagehide', () => {suspended = true; stopFrame();});
  listen(window, 'pageshow', () => {suspended = false; refresh();});
  listen(document, 'gift:lyrics-probe', () => document.dispatchEvent(new CustomEvent('gift:lyrics-state', {detail: getState()})));
  return {
    async init() {
      if (disposed || status !== 'idle') return;
      audio = music.getMediaElement?.() || null;
      if (config.enabled === false || !config.sourceUrl || !audio) {status = 'disabled'; clear(); return;}
      for (const event of ['playing', 'play', 'pause', 'timeupdate', 'seeking', 'seeked', 'ended', 'loadedmetadata', 'ratechange', 'emptied', 'loadstart', 'error']) listen(audio, event, refresh);
      status = 'loading'; clear();
      try {
        const response = await fetch(new URL(config.sourceUrl, document.baseURI), {cache: 'no-cache', signal: abort.signal});
        if (!response.ok) throw new Error('LYRICS_LOAD');
        const data = await response.text();
        if (disposed) return;
        timeline = config.format === 'words' ? parseWordLyrics(data)
          : config.format === 'json' ? parseTimestampedLyrics(data) : parseLrc(data);
        status = timeline.hasLyrics ? 'ready' : 'empty';
        refresh();
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') {status = 'error'; timeline = null; publishAvailability(false); clear();}
      }
    },
    setView(value) {view = value; stopFrame(); refresh();},
    setReducedMotion(value) {reducedMotion = Boolean(value); refresh();},
    getState,
    dispose() {if (disposed) return; disposed = true; abort.abort(); stopFrame(); listeners.forEach(cleanup => cleanup()); clear(); publishAvailability(false);},
  };
}
