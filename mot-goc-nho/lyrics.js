import {parseLrc, parseTimestampedLyrics, parseWordLyrics, lyricAtTime, wordLyricAtTime} from './lyrics-timing.js?v=20261009-word1';

const EMPTY = {index: -1, text: '', nextText: '', words: [], layers: [], phase: 'empty', progress: 0, time: 0, start: null, end: null};
const smooth = value => {const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t);};

/** Readable native typography with optional fine dust, sampled from MP3 time. */
export function createLyrics({root, current, next, music, config = {}, reducedMotion = false, onAvailability = () => {}}) {
  let audio = null, timeline = null, status = 'idle', view = 'locked';
  let disposed = false, suspended = false, available = false, frame = 0;
  let state = {...EMPTY}, lastPaint = 0;
  let effects = null, effectsStatus = 'idle', fontTimeout = 0;
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
  function disableEffects() {
    const failed = effects; effects = null; effectsStatus = 'unavailable';
    try {failed?.dispose();} catch { /* A lost canvas must not stop native text. */ }
    root.querySelector('#lyrics-dust')?.remove();
  }
  function effectsCall(method, ...args) {
    if (!effects) return;
    try {return effects[method](...args);} catch {disableEffects();}
  }
  function clear() {
    if (root.hidden && !rows.size && root.dataset.phase === 'empty') return;
    root.hidden = true;
    root.dataset.phase = 'empty'; root.dataset.index = '-1';
    if (rows.size) {current.replaceChildren(); rows.clear();}
    current.removeAttribute('aria-label');
    effectsCall('clear');
  }
  function effectLayers() {
    if (!effects || reducedMotion || !timeline?.wordLevel || audio?.ended) return [];
    const fade = Math.max(.02, (config.crossfadeMs ?? 180) / 1000);
    const hold = Math.max(0, (config.lineHoldMs ?? 900) / 1000);
    const duration = Math.min(timeline.duration ?? Infinity, Number.isFinite(audio.duration) ? audio.duration : Infinity);
    const layers = [];
    timeline.cues.forEach((cue, index) => {
      const end = Math.min(cue.displayEnd ?? cue.end + hold, timeline.cues[index + 1]?.time + fade || Infinity, duration);
      const release = end - fade;
      if (state.time >= release && state.time < release + 1.45 && cue.time <= state.time) layers.push({index, cue, release});
    });
    return layers;
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
  function paint(releases = []) {
    const active = new Set([...state.layers, ...releases].map(layer => layer.index));
    for (const [index, row] of rows) if (!active.has(index)) {row.row.remove(); rows.delete(index);}
    const reveal = Math.max(.02, (config.wordRevealMs ?? 110) / 1000);
    const nativeLayers = new Map(state.layers.map(layer => [layer.index, layer]));
    const records = new Map(releases.map(layer => [layer.index, layer]));
    for (const layer of state.layers) if (!records.has(layer.index)) records.set(layer.index, {...layer, release: null});
    for (const layer of records.values()) {
      const row = rows.get(layer.index) || buildRow(layer);
      const native = nativeLayers.get(layer.index);
      const opacity = native ? reducedMotion ? (layer.index === state.index ? 1 : 0) : native.opacity : 0;
      const translateY = reducedMotion ? 0 : native?.translateY || 0;
      if (row.opacity !== opacity) {row.row.style.opacity = String(opacity); row.opacity = opacity;}
      if (row.translateY !== translateY) {row.row.style.transform = `translateY(${translateY}px)`; row.translateY = translateY;}
      for (const item of row.nodes) {
        const progress = state.time < item.word.start ? 0 : reducedMotion ? 1 : smooth((state.time - item.word.start) / reveal);
        const singing = state.time >= item.word.start && state.time < (item.word.end ?? item.word.start + .4);
        if (item.node.dataset.singing !== String(singing)) item.node.dataset.singing = String(singing);
        const revealed = String(state.time >= item.word.start);
        if (item.node.dataset.revealed !== revealed) item.node.dataset.revealed = revealed;
        if (progress !== item.progress) {
          item.node.style.opacity = String(progress);
          item.node.style.transform = `translateY(${reducedMotion ? 0 : (1 - progress) * 2}px)`;
          item.progress = progress;
        }
      }
      layer.row = row;
    }
    const revealedText = state.words.filter(word => word.start <= state.time).map((word, index) => `${index && word.spaceBefore !== false ? ' ' : ''}${word.text}`).join('');
    if (current.getAttribute('aria-label') !== revealedText) current.setAttribute('aria-label', revealedText);
    effectsCall('render', state.time, [...records.values()], reducedMotion);
    root.dataset.effects = effectsCall('getState')?.effectPhase || 'native';
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
    const releases = effectLayers();
    if (!state.layers.length && !releases.length) {clear(); return;}
    if (root.hidden) root.hidden = false;
    paint(releases);
  }
  function stopFrame() {cancelAnimationFrame(frame); frame = 0;}
  function schedule() {
    if (frame || disposed || suspended || document.hidden || view !== 'explore' || !available || !audio || audio.paused || audio.ended) return;
    frame = requestAnimationFrame(timestamp => {
      frame = 0;
      // RAF schedules observation, never advances lyric time or predicts audio position.
      if (timestamp - lastPaint >= 1000 / (effects ? 60 : 30)) {sync(); lastPaint = timestamp;}
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
      particleClock: state.time, particleCount: 0, effectPhase: 'native', effectsReady: false, effectsStatus,
      ...effectsCall('getState'), cueCount: timeline?.cues.length || 0,
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
      effectsStatus = 'loading';
      // A failed optional effect or font never prevents the letter or native lyrics.
      const font = '400 24px "Gift Noto Serif"', sample = 'Nắng nghiêng mình trên bến đò';
      const fontReady = document.fonts ? Promise.race([
        Promise.resolve().then(() => document.fonts.load(font, sample)).then(() => document.fonts.check(font, sample)),
        new Promise(resolve => {fontTimeout = setTimeout(() => resolve(false), 7000);}),
      ]) : Promise.resolve(true);
      Promise.all([import('./lyric-effects.js?v=20261009-dust1'), fontReady])
        .then(([module, ready]) => {
          if (disposed) return;
          if (!ready) {effectsStatus = 'font-unavailable'; return;}
          effects = module.createLyricEffects(root, current, refresh);
          effectsStatus = effects ? 'ready' : 'canvas-unavailable'; refresh();
        }).catch(() => {disableEffects();}).finally(() => clearTimeout(fontTimeout));
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
    setReducedMotion(value) {reducedMotion = Boolean(value); effectsCall('invalidate'); refresh();},
    getState,
    dispose() {if (disposed) return; disposed = true; abort.abort(); clearTimeout(fontTimeout); stopFrame(); listeners.forEach(cleanup => cleanup()); clear(); effectsCall('dispose'); publishAvailability(false);},
  };
}
