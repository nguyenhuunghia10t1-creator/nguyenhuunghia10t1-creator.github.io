const CONVERGE_MS = 1500;
const READ_MS = 3000;
const DISSOLVE_MS = 2200;
const FONT_FAMILY = '"Gift Noto Serif", serif';
const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const easeOutCubic = value => 1 - (1 - value) ** 3;
const smoothstep = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Every returned slice retains its original punctuation and whitespace. Joining
// the units reconstructs the original nonblank input without Unicode rewriting.
export function splitLetterUnits(text) {
  if (typeof text !== 'string') throw new TypeError('Particle letter input must be text.');
  if (!text.trim()) return [];
  const paragraphs = [];
  const paragraphBreak = /\r?\n[\t ]*\r?\n/gu;
  let cursor = 0;
  for (const match of text.matchAll(paragraphBreak)) {
    paragraphs.push(text.slice(cursor, match.index + match[0].length));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) paragraphs.push(text.slice(cursor));
  const units = [];
  let pendingWhitespace = '';
  const append = unit => {
    if (unit.trim()) { units.push(pendingWhitespace + unit); pendingWhitespace = ''; }
    else if (units.length) units[units.length - 1] += unit;
    else pendingWhitespace += unit;
  };
  for (const paragraph of paragraphs) {
    let start = 0;
    const stops = /[.!?]+["'”’»)\]]*(?:[\t ]+|(?=\r?\n|$))/gu;
    for (const match of paragraph.matchAll(stops)) {
      const terminal = /^[.!?]+/u.exec(match[0])[0];
      const previousWord = /([\p{L}.]+)$/u.exec(paragraph.slice(0, match.index))?.[1] ?? '';
      const after = match.index + match[0].length;
      const next = paragraph.slice(after).trimStart();
      // Keep ellipses, initials and common abbreviated titles in their sentence.
      if (/^\.{2,}$/u.test(terminal) || (terminal === '.' && (/^[\p{Lu}]$/u.test(previousWord) || /^(?:TS|ThS|PGS|GS|TP|Q|P|Dr|Mr|Mrs|Ms|Prof|v\.v)$/iu.test(previousWord)))) continue;
      if (next && !/^[\p{Lu}\p{N}"“‘]/u.test(next)) continue;
      const unit = paragraph.slice(start, after);
      append(unit);
      start = after;
    }
    const remainder = paragraph.slice(start);
    append(remainder);
  }
  return units;
}

export function createParticleLetter({ canvas, copy, onComplete = () => {}, onPhase = () => {}, onError = () => {} }) {
  if (!canvas || typeof canvas.getContext !== 'function' || !copy) throw new TypeError('The particle letter needs a canvas and a text layer.');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('PARTICLE_CANVAS_UNAVAILABLE');
  if (typeof Intl.Segmenter !== 'function') throw new Error('GRAPHEME_SEGMENTATION_UNAVAILABLE');
  const segmenter = new Intl.Segmenter('vi', { granularity: 'grapheme' });
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d', { willReadFrequently: true });
  if (!measureContext) throw new Error('PARTICLE_MASK_UNAVAILABLE');
  // Keep the text on a stable compositing layer so fading does not switch its
  // glyph antialiasing between LCD and grayscale at the readable handoff.
  copy.style.transform = 'translateZ(0)';
  const makeSprite = pink => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 16;
    const target = sprite.getContext('2d');
    const gradient = target.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, pink ? 'rgba(247,197,225,1)' : 'rgba(255,246,252,1)');
    gradient.addColorStop(0.4, pink ? 'rgba(235,169,212,0.8)' : 'rgba(251,234,246,0.82)');
    gradient.addColorStop(1, 'rgba(218,147,193,0)');
    target.fillStyle = gradient;
    target.fillRect(0, 0, 16, 16);
    return sprite;
  };
  const pointSprite = makeSprite(false);
  const fallingSprite = makeSprite(true);
  const petalSprite = document.createElement('canvas');
  petalSprite.width = 20;
  petalSprite.height = 32;
  const petalContext = petalSprite.getContext('2d');
  const petalGradient = petalContext.createLinearGradient(3, 3, 17, 29);
  petalGradient.addColorStop(0, '#fff0f9');
  petalGradient.addColorStop(0.45, '#eeb8d7');
  petalGradient.addColorStop(1, '#b878a1');
  petalContext.fillStyle = petalGradient;
  petalContext.beginPath();
  petalContext.moveTo(10, 1);
  petalContext.bezierCurveTo(21, 8, 19, 22, 9, 31);
  petalContext.bezierCurveTo(1, 23, 1, 9, 10, 1);
  petalContext.fill();

  let width = 1, height = 1, pixelRatio = 1, fontSize = 26, lineHeight = 37.7;
  let mobile = true, units = [], groups = [], lines = [], unitIndex = 0;
  let phase = 'idle', elapsed = 0, lastTimestamp = null, frame = 0, generation = 0;
  let running = false, disposed = false, fontPromise = null;
  let particleStride = 1, slowFrames = 0, renderInterval = 1000 / 30;
  let lastPaintTimestamp = -Infinity, repaintRequested = true;
  const graphemes = value => Array.from(segmenter.segment(value), part => part.segment);
  const setCopyOpacity = value => { copy.style.opacity = String(clamp(value)); };

  function announce(next) {
    phase = next;
    repaintRequested = true;
    canvas.dataset.phase = next;
    canvas.dataset.unit = String(unitIndex);
    onPhase({ phase: next, unit: unitIndex, unitCount: units.length });
  }

  async function waitForFont() {
    if (!document.fonts?.load) throw new Error('FONT_LOADING_UNAVAILABLE');
    if (!fontPromise) {
      fontPromise = (async () => {
        let timer;
        try {
          const faces = await Promise.race([
            document.fonts.load('400 32px "Gift Noto Serif"', 'Ag Đđ Ắằẵặ Ấềễệ Ốỡợ Ứữự Ỵỷỹ'),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FONT_LOADING_TIMEOUT')), 7000); }),
          ]);
          if (!faces.length || faces.some(face => face.status !== 'loaded')) throw new Error('FONT_NOT_LOADED');
        } finally { clearTimeout(timer); }
      })().catch(error => { fontPromise = null; throw error; });
    }
    return fontPromise;
  }

  function wrap(text, maximumWidth) {
    const result = [];
    let current = '';
    for (const word of text.trim().split(/\s+/u)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureContext.measureText(candidate).width <= maximumWidth) { current = candidate; continue; }
      if (current) { result.push(current); current = ''; }
      if (measureContext.measureText(word).width <= maximumWidth) { current = word; continue; }
      for (const glyph of graphemes(word)) {
        if (current && measureContext.measureText(current + glyph).width > maximumWidth) { result.push(current); current = ''; }
        current += glyph;
      }
    }
    if (current) result.push(current);
    return result;
  }

  function glyphPoints(glyph) {
    const font = `400 ${fontSize}px ${FONT_FAMILY}`;
    measureContext.font = font;
    const metrics = measureContext.measureText(glyph);
    const padding = 3;
    const originX = padding + Math.max(0, metrics.actualBoundingBoxLeft || 0);
    const originY = padding + Math.max(0, metrics.actualBoundingBoxAscent || fontSize);
    measureCanvas.width = Math.max(1, Math.ceil(originX + Math.max(metrics.actualBoundingBoxRight || 0, metrics.width) + padding));
    measureCanvas.height = Math.max(1, Math.ceil(originY + Math.max(0, metrics.actualBoundingBoxDescent || 0) + padding));
    measureContext.font = font;
    measureContext.textAlign = 'left';
    measureContext.textBaseline = 'alphabetic';
    measureContext.fillStyle = '#ffffff';
    measureContext.fillText(glyph, originX, originY);
    const raster = measureContext.getImageData(0, 0, measureCanvas.width, measureCanvas.height);
    const coordinates = [];
    for (let y = 0; y < raster.height; y += 2) for (let x = 0; x < raster.width; x += 2) {
      if (raster.data[(y * raster.width + x) * 4 + 3] > 96) coordinates.push(x, y);
    }
    return { coordinates, originX, originY, fontAscent: metrics.fontBoundingBoxAscent || fontSize * 1.08 };
  }

  function buildCurrentUnit() {
    if (!units[unitIndex]) return;
    // NFC is a rendering-only copy. The original input and unit slices are never
    // normalized or rewritten. This avoids system-font fallback for NFD marks
    // absent from upstream WOFF2 subsets while preserving canonical spelling.
    const displayText = units[unitIndex].normalize('NFC');
    const maximumWidth = Math.max(40, Math.min(width - (mobile ? 24 : 64), mobile ? 560 : 820));
    fontSize = mobile ? 26 : 32;
    do {
      measureContext.font = `400 ${fontSize}px ${FONT_FAMILY}`;
      lines = wrap(displayText, maximumWidth);
      lineHeight = fontSize * 1.45;
      if (lines.length * lineHeight <= Math.max(60, height - 28) || fontSize <= 18) break;
      fontSize--;
    } while (fontSize >= 18);
    copy.replaceChildren();
    const top = (height - lines.length * lineHeight) / 2;
    const fragment = document.createDocumentFragment();
    const lineElements = lines.map((text, index) => {
      const line = document.createElement('span');
      line.className = 'particle-copy-line';
      line.textContent = text;
      Object.assign(line.style, {
        position: 'absolute', left: '0', top: `${top + index * lineHeight}px`, width: '100%',
        display: 'block', margin: '0', padding: '0', height: `${lineHeight}px`,
        font: `400 ${fontSize}px/${lineHeight}px ${FONT_FAMILY}`, fontSynthesis: 'none',
        fontKerning: 'normal', letterSpacing: 'normal', textAlign: 'center', whiteSpace: 'pre',
        color: '#fae7f4', textShadow: 'none', background: 'transparent',
      });
      fragment.append(line);
      return line;
    });
    copy.append(fragment);
    const canvasRectangle = canvas.getBoundingClientRect();
    const range = document.createRange();
    const prepared = [];
    let totalPoints = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const node = lineElements[lineIndex].firstChild;
      let offset = 0;
      for (const glyph of graphemes(lines[lineIndex])) {
        const end = offset + glyph.length;
        if (glyph.trim()) {
          range.setStart(node, offset);
          range.setEnd(node, end);
          const rectangle = range.getBoundingClientRect();
          const sampled = glyphPoints(glyph);
          const seed = Math.random();
          const pointCount = sampled.coordinates.length / 2;
          prepared.push({
            x: rectangle.left - canvasRectangle.left - sampled.originX,
            y: rectangle.top - canvasRectangle.top + sampled.fontAscent - sampled.originY,
            coordinates: sampled.coordinates, seed,
            startX: (seed - 0.5) * Math.min(width * 0.7, 260),
            startY: -35 - Math.random() * Math.min(height * 0.28, 90),
          });
          totalPoints += pointCount;
        }
        offset = end;
      }
    }
    range.detach();
    const cap = mobile ? 5000 : 9000;
    const samplingStride = Math.max(1, Math.ceil(totalPoints / cap));
    let maskPointIndex = 0;
    groups = prepared.map(group => {
      const selected = [];
      for (let index = 0; index < group.coordinates.length; index += 2) {
        if (maskPointIndex++ % samplingStride === 0) selected.push(group.coordinates[index], group.coordinates[index + 1]);
      }
      const points = new Float32Array(selected);
      const { coordinates, ...placement } = group;
      return { ...placement, points };
    });
  }

  function paint() {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!groups.length) { setCopyOpacity(phase === 'reading' ? 1 : 0); return; }
    if (phase === 'reading') { setCopyOpacity(1); return; }
    const forming = phase === 'converging';
    const progress = clamp(elapsed / (forming ? CONVERGE_MS : DISSOLVE_MS));
    // There is no glyph/particle overlap: the point layer is fully transparent
    // before native DOM text appears, and vice versa during dissolution.
    const copyOpacity = forming ? smoothstep((progress - 0.78) / 0.22) : 1 - smoothstep((progress - 0.08) / 0.16);
    const pointOpacity = forming ? smoothstep(progress / 0.12) * (1 - smoothstep((progress - 0.45) / 0.3)) : smoothstep((progress - 0.25) / 0.1);
    setCopyOpacity(copyOpacity);
    if (pointOpacity <= 0) return;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const seed = group.seed;
      let translateX, translateY, scatter = 0, alpha = pointOpacity, released = 0;
      if (forming) {
        const convergence = easeOutCubic(clamp((progress - seed * 0.08) / 0.7));
        translateX = group.x + group.startX * (1 - convergence);
        translateY = group.y + group.startY * (1 - convergence);
      } else {
        released = clamp((progress - 0.32 - seed * 0.035) / (0.68 - seed * 0.035));
        const fall = released ** 1.45;
        translateX = group.x + Math.sin(released * 3 + seed * 7) * released * (12 + seed * 32);
        translateY = group.y + fall * Math.max(80, height - group.y + 34);
        scatter = smoothstep((released - 0.3) / 0.7) * (5 + seed * 14);
        alpha *= 1 - smoothstep((released - 0.68) / 0.32);
      }
      context.globalAlpha = alpha * (0.74 + seed * 0.2);
      for (let point = 0; point < group.points.length / 2; point += particleStride) {
        const x = translateX + group.points[point * 2] + Math.sin(point * 2.4 + seed * 8) * scatter;
        const y = translateY + group.points[point * 2 + 1] + Math.cos(point * 1.7 + seed * 6) * scatter * 0.45;
        if (!forming && released > 0.12 && (point + groupIndex) % 23 === 0) {
          const petalHeight = 5 + seed * 5;
          const petalWidth = petalHeight * (0.42 + Math.abs(Math.sin(released * 5 + point)) * 0.25);
          context.save();
          context.translate(x, y);
          context.rotate(seed * 7 + released * (2 + seed * 4));
          context.drawImage(petalSprite, -petalWidth / 2, -petalHeight / 2, petalWidth, petalHeight);
          context.restore();
        } else {
          const size = 2.2 + seed * 0.8;
          context.drawImage(forming ? pointSprite : fallingSprite, x - size / 2, y - size / 2, size, size);
        }
      }
    }
    context.globalAlpha = 1;
  }

  function fail(error, token) {
    if (token !== generation || disposed) return;
    stop();
    onError(error instanceof Error ? error : new Error('PARTICLE_RENDER_FAILED'));
  }
  function schedule() {
    if (!running || disposed || document.hidden || frame) return;
    const token = generation;
    frame = requestAnimationFrame(timestamp => {
      try { tick(timestamp, token); } catch (error) { fail(error, token); }
    });
  }
  function tick(timestamp, token) {
    frame = 0;
    if (disposed || !running || token !== generation) return;
    if (document.hidden) { lastTimestamp = null; return; }
    const delta = lastTimestamp === null ? 0 : Math.max(0, timestamp - lastTimestamp);
    if (lastTimestamp !== null) elapsed += Math.min(50, delta);
    lastTimestamp = timestamp;
    const duration = phase === 'converging' ? CONVERGE_MS : phase === 'reading' ? READ_MS : DISSOLVE_MS;
    if (elapsed >= duration) {
      elapsed = 0;
      if (phase === 'converging') announce('reading');
      else if (phase === 'reading') announce('dissolving');
      else {
        unitIndex++;
        if (unitIndex >= units.length) {
          running = false;
          groups = [];
          lines = [];
          context.clearRect(0, 0, width, height);
          setCopyOpacity(0);
          copy.replaceChildren();
          announce('complete');
          if (token !== generation || disposed) return;
          units = [];
          onComplete();
          return;
        }
        buildCurrentUnit();
        announce('converging');
      }
    }
    if (token !== generation || !running || disposed) return;
    if (repaintRequested || (phase !== 'reading' && timestamp - lastPaintTimestamp >= renderInterval)) {
      const started = performance.now();
      paint();
      const cost = performance.now() - started;
      lastPaintTimestamp = timestamp;
      repaintRequested = false;
      slowFrames = cost > 11 || delta > 30 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames >= 10 && particleStride < 3) { particleStride++; renderInterval = 1000 / 30; slowFrames = 0; }
    }
    schedule();
  }
  function resize() {
    if (disposed) return;
    const rectangle = canvas.getBoundingClientRect();
    width = Math.max(1, rectangle.width || canvas.clientWidth || window.innerWidth);
    height = Math.max(1, rectangle.height || canvas.clientHeight || window.innerHeight);
    mobile = width < 600;
    pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
    renderInterval = mobile || particleStride > 1 ? 1000 / 30 : 1000 / 60;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (running) {
      try { buildCurrentUnit(); paint(); } catch (error) { fail(error, generation); }
    }
  }
  function stop() {
    generation++;
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
    lastTimestamp = null;
    elapsed = 0;
    lastPaintTimestamp = -Infinity;
    repaintRequested = true;
    units = [];
    groups = [];
    lines = [];
    setCopyOpacity(0);
    copy.replaceChildren();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!disposed) announce('idle');
  }
  async function start(text) {
    if (disposed) return false;
    stop();
    const token = generation;
    units = splitLetterUnits(text);
    unitIndex = 0;
    if (!units.length) {
      await Promise.resolve();
      if (token !== generation || disposed) return false;
      announce('complete');
      if (token === generation && !disposed) onComplete();
      return true;
    }
    announce('loading');
    try {
      await waitForFont();
      if (token !== generation || disposed) return false;
      running = true;
      resize();
      if (token !== generation || !running || disposed) return false;
      announce('converging');
      paint();
      schedule();
      return true;
    } catch (error) { fail(error, token); return false; }
  }
  function visibilityChanged() {
    if (disposed || !running) return;
    lastTimestamp = null;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibilityChanged);
  resize();
  announce('idle');
  return {
    start, stop, resize,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
