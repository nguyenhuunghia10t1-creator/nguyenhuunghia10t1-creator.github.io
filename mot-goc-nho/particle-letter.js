const CONVERGE_MS = 1500;
const READ_MS = 3000;
const DISSOLVE_MS = 1700;
const FONT_FAMILY = 'Georgia, "Times New Roman", serif';
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

export function createParticleLetter({ canvas, onComplete = () => {}, onPhase = () => {} }) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required for the particle letter.');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('The particle letter canvas is unavailable.');
  const maskCanvas = document.createElement('canvas');
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskContext) throw new Error('The particle letter mask is unavailable.');
  const dotSprite = document.createElement('canvas');
  dotSprite.width = dotSprite.height = 20;
  const dotContext = dotSprite.getContext('2d');
  const dotGlow = dotContext.createRadialGradient(10, 10, 0, 10, 10, 10);
  dotGlow.addColorStop(0, 'rgba(255,247,253,1)');
  dotGlow.addColorStop(0.3, 'rgba(250,231,244,0.95)');
  dotGlow.addColorStop(0.63, 'rgba(235,168,215,0.3)');
  dotGlow.addColorStop(1, 'rgba(221,139,195,0)');
  dotContext.fillStyle = dotGlow;
  dotContext.fillRect(0, 0, 20, 20);
  const fallingDotSprite = document.createElement('canvas');
  fallingDotSprite.width = fallingDotSprite.height = 20;
  const fallingDotContext = fallingDotSprite.getContext('2d');
  fallingDotContext.drawImage(dotSprite, 0, 0);
  fallingDotContext.globalCompositeOperation = 'source-in';
  fallingDotContext.fillStyle = '#efb4d6';
  fallingDotContext.fillRect(0, 0, 20, 20);
  const petalSprite = document.createElement('canvas');
  petalSprite.width = 24;
  petalSprite.height = 36;
  const petalContext = petalSprite.getContext('2d');
  const petalGradient = petalContext.createLinearGradient(6, 3, 20, 33);
  petalGradient.addColorStop(0, '#fff2fc');
  petalGradient.addColorStop(0.4, '#f4bfdc');
  petalGradient.addColorStop(1, '#c66ca9');
  petalContext.fillStyle = petalGradient;
  petalContext.beginPath();
  petalContext.moveTo(12, 2);
  petalContext.bezierCurveTo(24, 9, 23, 26, 10, 34);
  petalContext.bezierCurveTo(2, 24, 2, 10, 12, 2);
  petalContext.fill();
  const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
  let width = 1;
  let height = 1;
  let mobile = false;
  let pixelRatio = 1;
  let fontSize = 25;
  let lineHeight = 34;
  let lines = [];
  let units = [];
  let unitIndex = 0;
  let particles = null;
  let phase = 'idle';
  let elapsed = 0;
  let lastTimestamp = null;
  let frame = 0;
  let generation = 0;
  let running = false;
  let disposed = false;
  let particleStride = 1;
  let slowFrames = 0;
  let renderInterval = 0;
  let lastPaintTimestamp = -Infinity;
  let repaintRequested = true;

  const graphemes = value => graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(value), part => part.segment)
    : value.match(/\P{M}\p{M}*|\p{M}+/gu) ?? [];

  function announce(next) {
    phase = next;
    repaintRequested = true;
    canvas.dataset.phase = next;
    canvas.dataset.unit = String(unitIndex);
    onPhase({ phase: next, unit: unitIndex, unitCount: units.length });
  }

  function wrap(text, maximumWidth) {
    const wrapped = [];
    let current = '';
    for (const word of text.trim().split(/\s+/u)) {
      const candidate = current ? `${current} ${word}` : word;
      if (maskContext.measureText(candidate).width <= maximumWidth) { current = candidate; continue; }
      if (current) { wrapped.push(current); current = ''; }
      if (maskContext.measureText(word).width <= maximumWidth) { current = word; continue; }
      for (const grapheme of graphemes(word)) {
        if (current && maskContext.measureText(current + grapheme).width > maximumWidth) {
          wrapped.push(current);
          current = '';
        }
        current += grapheme;
      }
    }
    if (current) wrapped.push(current);
    return wrapped;
  }

  function textLines(target, alpha = 1) {
    target.font = `${fontSize}px ${FONT_FAMILY}`;
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.fillStyle = `rgba(250,231,244,${alpha})`;
    const top = (height - lines.length * lineHeight) / 2 + lineHeight / 2;
    for (let index = 0; index < lines.length; index++) target.fillText(lines[index], width / 2, top + index * lineHeight);
  }

  function sampleCurrentUnit() {
    if (!units[unitIndex]) { particles = null; lines = []; return; }
    maskCanvas.width = Math.max(1, Math.round(width));
    maskCanvas.height = Math.max(1, Math.round(height));
    const maximumWidth = Math.max(30, Math.min(width - (mobile ? 40 : 112), mobile ? 560 : 900));
    fontSize = mobile ? 25 : 34;
    do {
      maskContext.font = `${fontSize}px ${FONT_FAMILY}`;
      lines = wrap(units[unitIndex], maximumWidth);
      lineHeight = fontSize * 1.4;
      if (lines.length * lineHeight <= Math.max(48, height - 56) || fontSize <= 17) break;
      fontSize--;
    } while (fontSize > 16);
    maskContext.clearRect(0, 0, width, height);
    textLines(maskContext);
    const raster = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const maximumParticles = mobile ? 5000 : 9000;
    const candidates = [];
    // Sample in CSS pixels once per unit/resize, never during an animation frame.
    for (let y = 0; y < raster.height; y += 2) {
      for (let x = 0; x < raster.width; x += 2) {
        const alpha = raster.data[(y * raster.width + x) * 4 + 3];
        if (alpha > 80) candidates.push(x, y, alpha / 255);
      }
    }
    const available = candidates.length / 3;
    const count = Math.min(maximumParticles, available);
    particles = {
      count, x: new Float32Array(count), y: new Float32Array(count),
      startX: new Float32Array(count), startY: new Float32Array(count),
      seed: new Float32Array(count), size: new Float32Array(count), alpha: new Float32Array(count),
    };
    for (let index = 0; index < count; index++) {
      const offset = Math.floor(index * available / count) * 3;
      const x = candidates[offset];
      const y = candidates[offset + 1];
      const angle = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * Math.min(width, height) * 0.55;
      particles.x[index] = x;
      particles.y[index] = y;
      particles.startX[index] = x + Math.cos(angle) * radius;
      particles.startY[index] = y + Math.sin(angle) * radius - 30;
      particles.seed[index] = Math.random();
      particles.size[index] = 0.8 + Math.random() * 1.15;
      particles.alpha[index] = candidates[offset + 2] * (0.6 + Math.random() * 0.4);
    }
  }

  function paint() {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!particles) return;
    if (phase === 'reading') {
      textLines(context, 1);
      return;
    }
    const forming = phase === 'converging';
    const progress = clamp(elapsed / (forming ? CONVERGE_MS : DISSOLVE_MS));
    const crispAlpha = forming ? smoothstep((progress - 0.55) / 0.4) : 1 - smoothstep(progress / 0.42);
    if (crispAlpha > 0) textLines(context, crispAlpha);
    for (let index = 0; index < particles.count; index += particleStride) {
      const seed = particles.seed[index];
      let x;
      let y;
      let alpha;
      if (forming) {
        const local = clamp((progress - seed * 0.15) / (1 - seed * 0.15));
        const convergence = easeOutCubic(local);
        const drift = (1 - convergence) * Math.sin(local * 7 + seed * 12) * 15;
        x = particles.startX[index] + (particles.x[index] - particles.startX[index]) * convergence + drift;
        y = particles.startY[index] + (particles.y[index] - particles.startY[index]) * convergence;
        alpha = smoothstep(local / 0.3) * (1 - crispAlpha * 0.67);
      } else {
        const released = clamp((progress - seed * 0.16) / (1 - seed * 0.16));
        x = particles.x[index] + Math.sin(released * 5 + seed * 12) * released * (25 + seed * 50) + (seed - 0.5) * released * 44;
        y = particles.y[index] + released * released * (70 + seed * Math.min(160, height * 0.45));
        alpha = (1 - smoothstep(released)) * (0.35 + smoothstep(progress / 0.25) * 0.65);
      }
      context.globalAlpha = alpha * particles.alpha[index];
      const radius = particles.size[index];
      const dotSize = radius * 3;
      if (!forming && seed < 0.065 && progress > 0.06) {
        // A sparse set of cached petals replaces glyph points as they release.
        // No per-particle blur or new rasterization is performed here.
        const petalHeight = (6 + radius * 2.5) * smoothstep(progress / 0.2);
        const petalWidth = petalHeight * (0.45 + Math.abs(Math.sin(progress * 6 + seed * 40)) * 0.24);
        context.save();
        context.translate(x, y);
        context.rotate(seed * 60 + progress * (2 + seed * 25));
        context.drawImage(petalSprite, -petalWidth / 2, -petalHeight / 2, petalWidth, petalHeight);
        context.restore();
      } else {
        context.drawImage(forming ? dotSprite : fallingDotSprite, x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
      }
    }
    context.globalAlpha = 1;
  }

  function schedule() {
    if (!running || disposed || document.hidden || frame) return;
    const token = generation;
    frame = requestAnimationFrame(timestamp => tick(timestamp, token));
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
          particles = null;
          lines = [];
          context.clearRect(0, 0, width, height);
          announce('complete');
          units = [];
          if (token === generation && !disposed) onComplete();
          return;
        }
        sampleCurrentUnit();
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
      if (slowFrames >= 10 && particleStride < 3) {
        particleStride++;
        renderInterval = 1000 / 30;
        slowFrames = 0;
      }
    }
    schedule();
  }

  function resize() {
    if (disposed) return;
    const rectangle = canvas.getBoundingClientRect();
    width = Math.max(1, rectangle.width || canvas.clientWidth || window.innerWidth);
    height = Math.max(1, rectangle.height || canvas.clientHeight || window.innerHeight);
    mobile = width < 600;
    renderInterval = mobile || particleStride > 1 ? 1000 / 30 : 1000 / 60;
    pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (running) { sampleCurrentUnit(); paint(); }
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
    particles = null;
    lines = [];
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!disposed) announce('idle');
  }

  function start(text) {
    if (disposed) return;
    stop();
    const token = generation;
    units = splitLetterUnits(text);
    unitIndex = 0;
    if (!units.length) {
      queueMicrotask(() => {
        if (token !== generation || disposed) return;
        announce('complete');
        onComplete();
      });
      return;
    }
    running = true;
    resize();
    announce('converging');
    paint();
    schedule();
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
