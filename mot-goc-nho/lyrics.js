import {parseLrc, parseTimestampedLyrics, lyricAtTime} from './lyrics-timing.js';

const clamp = value => Math.min(1, Math.max(0, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const FONT = '"Gift Noto Serif", serif';
const EMPTY = {index: -1, text: '', nextText: '', phase: 'empty', progress: 0, time: 0, start: null, end: null};

/** A second visual consumer of the existing audio, never a second player/clock. */
export function createLyrics({root, canvas, current, next, music, config = {}, reducedMotion = false, onAvailability = () => {}}) {
  let audio = null, timeline = null, status = 'idle', view = 'locked';
  let disposed = false, suspended = false, available = false, frame = 0;
  let state = {...EMPTY}, builtKey = '', points = new Float32Array(), lastMediaTime = NaN;
  let width = 1, height = 1, pixelRatio = 1, fontSize = 24, fontReady = false;
  let dirty = true, lastPaint = 0;
  const listeners = [], abort = new AbortController();
  const context = canvas?.getContext?.('2d', {alpha: true}) || null;
  const mask = document.createElement('canvas');
  const maskContext = mask.getContext('2d', {willReadFrequently: true});
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('vi', {granularity: 'grapheme'}) : null;
  const graphemes = text => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text.normalize('NFC'));
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 12;
  const spriteContext = sprite.getContext('2d');
  if (spriteContext) {
    const gradient = spriteContext.createRadialGradient(6, 6, 0, 6, 6, 6);
    gradient.addColorStop(0, '#fff8ec'); gradient.addColorStop(.35, '#fff8ec');
    gradient.addColorStop(.68, '#f5dfe980'); gradient.addColorStop(1, '#f5dfe900');
    spriteContext.fillStyle = gradient; spriteContext.fillRect(0, 0, 12, 12);
  }
  function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); }
  function sourceMatches() {
    if (!audio || audio.error || !config.expectedSourceUrl) return false;
    try {
      const expected = new URL(config.expectedSourceUrl, document.baseURI).href;
      // currentSrc may briefly retain the previous track while a new src loads.
      return new URL(audio.src, document.baseURI).href === expected
        && (!audio.currentSrc || new URL(audio.currentSrc, document.baseURI).href === expected);
    }
    catch { return false; }
  }
  function publishAvailability(value) {
    if (available === value) return;
    available = value;
    document.body.classList.toggle('has-lyrics', value);
    onAvailability(value);
  }
  function clear() {
    if (root.hidden && !builtKey && !points.length && !current.firstChild && !next.textContent) {
      root.dataset.phase = 'empty'; root.dataset.index = '-1'; return;
    }
    root.hidden = true;
    root.dataset.phase = 'empty'; root.dataset.index = '-1';
    current.replaceChildren(); next.textContent = '';
    context?.clearRect(0, 0, canvas.width, canvas.height);
    builtKey = ''; points = new Float32Array();
  }
  function wrap(text, maximumWidth) {
    const lines = []; let line = '';
    for (const word of text.trim().split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (maskContext.measureText(candidate).width <= maximumWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      if (maskContext.measureText(word).width <= maximumWidth) { line = word; continue; }
      for (const glyph of graphemes(word)) {
        if (line && maskContext.measureText(line + glyph).width > maximumWidth) { lines.push(line); line = ''; }
        line += glyph;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function build() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * pixelRatio); canvas.height = Math.ceil(height * pixelRatio);
    points = new Float32Array();
    current.replaceChildren();
    next.textContent = state.nextText;
    if (!maskContext) { current.textContent = state.text; return; }
    fontSize = width < 400 ? 21 : 27;
    let lines, lineHeight;
    do {
      maskContext.font = `400 ${fontSize}px ${FONT}`;
      lines = wrap(state.text.normalize('NFC'), width - 20);
      lineHeight = fontSize * 1.5;
      if (lines.length * lineHeight <= height * .62 || fontSize <= 17) break;
      fontSize--;
    } while (true);
    const top = 12;
    const ascent = maskContext.measureText('Ag Đặ').fontBoundingBoxAscent || fontSize * 1.1;
    const descent = maskContext.measureText('Ag Đặ').fontBoundingBoxDescent || fontSize * .3;
    const baseline = (lineHeight - ascent - descent) / 2 + ascent;
    current.style.height = `${top + lines.length * lineHeight}px`;
    next.style.top = `${top + lines.length * lineHeight + 13}px`;
    next.style.fontSize = `${Math.max(14, fontSize * .64)}px`;
    for (let index = 0; index < lines.length; index++) {
      const span = document.createElement('span'); span.textContent = lines[index];
      Object.assign(span.style, {position: 'absolute', top: `${top + index * lineHeight}px`, left: '8px',
        width: `${width - 16}px`, font: `400 ${fontSize}px/${lineHeight}px ${FONT}`,
        fontSynthesis: 'none', fontKerning: 'normal', letterSpacing: 'normal', whiteSpace: 'pre'});
      current.append(span);
    }
    if (!context || !fontReady || reducedMotion || !segmenter) return;
    // Sample fully shaped lines, preserving kerning and all Vietnamese marks.
    // Only line breaking splits grapheme clusters; glyphs/accents never animate separately.
    const scale = 2;
    mask.width = Math.ceil(width * scale); mask.height = Math.ceil(height * scale);
    maskContext.setTransform(scale, 0, 0, scale, 0, 0);
    maskContext.font = `400 ${fontSize}px ${FONT}`;
    maskContext.textAlign = 'left'; maskContext.textBaseline = 'alphabetic'; maskContext.fillStyle = '#fff';
    for (let index = 0; index < lines.length; index++) maskContext.fillText(lines[index], 8, top + baseline + index * lineHeight);
    const raster = maskContext.getImageData(0, 0, mask.width, mask.height);
    const positions = [];
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
      if (raster.data[(y * raster.width + x) * 4 + 3] > 74) positions.push((x + .5) / scale, (y + .5) / scale);
    }
    const constrained = navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4;
    const budget = constrained ? 2300 : width < 400 ? 3600 : 5600;
    const count = Math.min(positions.length / 2, budget);
    points = new Float32Array(count * 5);
    for (let index = 0; index < count; index++) {
      const sample = Math.min(positions.length / 2 - 1, Math.floor((index + .5) * positions.length / (2 * count)));
      // Deterministic paths: seeking or returning to the same cue reconstructs the same image.
      const seed = ((index * 16807 + (state.index + 1) * 48271) % 2147483647) / 2147483647;
      const varied = (Math.sin(index * 12.9898 + state.index * 78.233) * 43758.5453) % 1;
      const noise = Math.abs(varied);
      const offset = index * 5;
      points[offset] = positions[sample * 2]; points[offset + 1] = positions[sample * 2 + 1];
      points[offset + 2] = noise; points[offset + 3] = seed; points[offset + 4] = .58 + noise * .34;
    }
  }
  function paint() {
    if (context) { context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, width, height); }
    const staticText = reducedMotion || !points.length;
    const forming = state.phase === 'forming', dissolving = state.phase === 'dissolving';
    const p = state.progress;
    const nativeOpacity = staticText || state.phase === 'stable' ? 1 : forming ? smooth((p - .65) / .35) : 1 - smooth(p / .25);
    current.style.opacity = String(nativeOpacity);
    next.style.opacity = state.phase === 'stable' || staticText ? '.36' : String(nativeOpacity * .36);
    root.dataset.phase = staticText ? 'stable' : state.phase;
    root.dataset.index = String(state.index);
    if (!context || staticText || state.phase === 'stable') return;
    const pointOpacity = forming ? smooth(p / .15) * (1 - smooth((p - .60) / .35)) : smooth(p / .18) * (1 - smooth((p - .65) / .35));
    for (let index = 0; index < points.length; index += 5) {
      const x = points[index], y = points[index + 1], noise = points[index + 2], seed = points[index + 3];
      let px, py;
      if (forming) {
        const remaining = (1 - smooth(p)) ** 1.3;
        px = x + (noise - .5) * Math.min(width * .52, 155) * remaining + Math.sin(p * 3 + seed * 7) * remaining * 8;
        py = y - (20 + noise * 42) * remaining;
      } else if (dissolving) {
        const released = smooth((p - seed * .12) / .88);
        px = x + Math.sin(released * 2.2 + seed * 7) * released * (18 + noise * 26);
        py = y + released ** 1.75 * (height - y + 30) + (noise - .5) * released * 14;
      }
      context.globalAlpha = pointOpacity * (.55 + noise * .38);
      const size = points[index + 4] * 2.05;
      context.drawImage(sprite, px - size / 2, py - size / 2, size, size);
    }
    context.globalAlpha = 1;
  }
  function sync(force = false) {
    if (disposed) return;
    const matching = sourceMatches();
    publishAvailability(Boolean(timeline?.hasLyrics && matching));
    if (!available || view !== 'explore' || document.hidden || suspended) {
      state = {...EMPTY, time: audio?.currentTime || 0}; clear(); return;
    }
    state = lyricAtTime(timeline, audio.currentTime, {...config, mediaDuration: audio.duration, ended: audio.ended});
    if (!state.text) { clear(); return; }
    root.hidden = false;
    const key = `${state.index}:${state.nextText}:${root.clientWidth}:${root.clientHeight}:${fontReady}:${reducedMotion}`;
    if (key !== builtKey) { builtKey = key; build(); force = true; }
    if (force || dirty || lastMediaTime !== audio.currentTime) paint();
    lastMediaTime = audio.currentTime; dirty = false;
  }
  function stopFrame() { cancelAnimationFrame(frame); frame = 0; }
  function schedule() {
    if (frame || disposed || suspended || document.hidden || view !== 'explore' || !available || !audio || audio.paused || audio.ended) return;
    frame = requestAnimationFrame(timestamp => {
      frame = 0;
      // Limit drawing, never extrapolate time. Each image uses the real media position.
      if (timestamp - lastPaint >= 1000 / 30) { sync(); lastPaint = timestamp; }
      schedule();
    });
  }
  function refresh() { sync(true); if (audio?.paused || document.hidden) stopFrame(); schedule(); }
  function getState() {
    return Object.freeze({status: timeline?.hasLyrics && !sourceMatches() ? 'source-mismatch' : status,
      available, view, index: state.index, text: state.text, nextText: state.nextText,
      mediaTime: audio?.currentTime || 0, effectiveTime: state.time, paused: audio?.paused ?? true,
      muted: audio?.muted ?? false, phase: state.phase, renderedPhase: root.dataset.phase || 'empty',
      progress: state.progress, start: state.start, end: state.end, particleClock: state.time,
      particleCount: points.length / 5, fontReady, cueCount: timeline?.cues.length || 0,
      sourceMatched: sourceMatches(), offsetMs: (timeline?.offsetMs || 0) + (Number(config.offsetMs) || 0)});
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { dirty = true; builtKey = ''; refresh(); }) : null;
  observer?.observe(root);
  listen(document, 'visibilitychange', refresh);
  listen(window, 'pagehide', () => { suspended = true; stopFrame(); });
  listen(window, 'pageshow', () => { suspended = false; refresh(); });
  listen(document, 'gift:lyrics-probe', () => document.dispatchEvent(new CustomEvent('gift:lyrics-state', {detail: getState()})));
  return {
    async init() {
      if (disposed || status !== 'idle') return;
      audio = music.getMediaElement?.() || null;
      if (config.enabled === false || !config.sourceUrl || !audio) { status = 'disabled'; clear(); return; }
      for (const event of ['playing', 'play', 'pause', 'timeupdate', 'seeking', 'seeked', 'ended', 'loadedmetadata', 'ratechange', 'emptied', 'loadstart', 'error']) listen(audio, event, refresh);
      status = 'loading'; clear();
      try {
        const response = await fetch(new URL(config.sourceUrl, document.baseURI), {cache: 'no-cache', signal: abort.signal});
        if (!response.ok) throw new Error('LYRICS_LOAD');
        const data = await response.text();
        if (disposed) return;
        timeline = config.format === 'json' ? parseTimestampedLyrics(data) : parseLrc(data);
        status = timeline.hasLyrics ? 'ready' : 'empty';
        refresh();
        if (timeline.hasLyrics && document.fonts?.load) {
          let timer;
          try {
            const faces = await Promise.race([document.fonts.load('400 27px "Gift Noto Serif"', 'Ag Đđ Ắặ Ấềễệ Ốỡợ Ứữự Ỵỷỹ'), new Promise(resolve => { timer = setTimeout(() => resolve([]), 7000); })]);
            fontReady = faces.length > 0 && faces.every(face => face.status === 'loaded');
          } catch { fontReady = false; } finally { clearTimeout(timer); }
          if (!disposed) { builtKey = ''; refresh(); }
        }
      } catch (error) { if (!disposed && error.name !== 'AbortError') { status = 'error'; timeline = null; publishAvailability(false); clear(); } }
    },
    setView(value) { view = value; stopFrame(); refresh(); },
    setReducedMotion(value) { reducedMotion = Boolean(value); builtKey = ''; refresh(); },
    getState,
    dispose() { if (disposed) return; disposed = true; abort.abort(); stopFrame(); observer?.disconnect(); listeners.forEach(cleanup => cleanup()); clear(); publishAvailability(false); },
  };
}
