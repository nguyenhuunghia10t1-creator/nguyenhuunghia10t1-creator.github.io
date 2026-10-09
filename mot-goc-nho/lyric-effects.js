const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => {const t = clamp(value); return t * t * (3 - 2 * t);};
const noise = seed => {const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x);};

/** Optional, bounded dust: every position and opacity is a pure media-time sample. */
export function createLyricEffects(root, current, onInvalidate = () => {}) {
  const canvas = document.createElement('canvas');
  canvas.id = 'lyrics-dust'; canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d', {alpha: true});
  if (!ctx) return null;
  root.append(canvas);
  const masks = new Map();
  let width = 0, height = 0, scale = 1, count = 0, phase = 'empty', quality = 'full';
  let dirty = true, lastTime = NaN, lastKey = '', budget = 1400;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {dirty = true; onInvalidate();}) : null;
  observer?.observe(root);
  function resize() {
    width = root.clientWidth; height = root.clientHeight;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    const constrained = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    budget = constrained ? 500 : window.innerWidth < 900 ? 800 : 1400;
    quality = constrained ? 'economy' : window.innerWidth < 900 ? 'mobile' : 'full';
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    masks.clear(); dirty = false;
  }
  function shape(row, index) {
    if (masks.has(index)) return masks.get(index);
    const words = row.nodes.map(({node, word}, wordIndex) => {
      const style = getComputedStyle(node), fontSize = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.65;
      const stamp = document.createElement('canvas');
      const stampWidth = Math.ceil(node.offsetWidth) + 8;
      stamp.width = Math.max(1, stampWidth * 2); stamp.height = Math.ceil(lineHeight + 8) * 2;
      const pen = stamp.getContext('2d', {willReadFrequently: true});
      if (!pen) return {word, points: [], x: 0, y: 0};
      pen.scale(2, 2);
      pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = pen.measureText(word.text.normalize('NFC'));
      const ascent = metrics.fontBoundingBoxAscent || fontSize * 1.05;
      const descent = metrics.fontBoundingBoxDescent || fontSize * .35;
      const baseline = (lineHeight - ascent - descent) / 2 + ascent;
      pen.fillStyle = '#fff'; pen.fillText(word.text.normalize('NFC'), 4, baseline + 4);
      const pixels = pen.getImageData(0, 0, stamp.width, stamp.height).data;
      const candidates = [];
      // A whole shaped word mask keeps Vietnamese accents attached to their glyphs.
      for (let y = 0; y < stamp.height; y += 2) for (let x = 0; x < stamp.width; x += 2) {
        if (pixels[(y * stamp.width + x) * 4 + 3] > 96) candidates.push({x: x / 2 - 4, y: y / 2 - 4});
      }
      const limit = window.innerWidth < 900 ? 70 : 110;
      const points = candidates.length <= limit ? candidates : Array.from({length: limit}, (_, n) => candidates[Math.floor(n * candidates.length / limit)]);
      return {word, points, x: current.offsetLeft + node.offsetLeft, y: current.offsetTop + node.offsetTop,
        seed: (index + 1) * 743 + wordIndex * 53, ordinal: wordIndex};
    });
    masks.set(index, words);
    // Only the visible line and its short release need a cached glyph mask.
    while (masks.size > 4) masks.delete(masks.keys().next().value);
    return words;
  }
  function dot(x, y, radius, alpha, blush) {
    if (count >= budget || alpha < .015 || x < 0 || x > width || y < 0 || y > height) return;
    count++;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = blush ? '#efb6d3' : '#fff4e4';
    ctx.fillRect(x, y, radius, radius);
    if (radius > .9) {
      ctx.globalAlpha = alpha * .12;
      ctx.fillRect(x - 1, y - 1, radius + 2, radius + 2);
    }
  }
  function render(time, records, reducedMotion = false) {
    const key = records.map(item => `${item.index}:${item.release ?? '-'}`).join('|');
    if (!dirty && time === lastTime && key === lastKey) return;
    if (dirty) resize();
    lastTime = time; lastKey = key;
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
    count = 0; phase = 'stable';
    if (reducedMotion || !width || !height) {phase = 'native'; return;}
    // Give newly sung syllables first use of the budget during a line crossfade.
    const ordered = [...records].sort((a, b) => Number(a.release !== null) - Number(b.release !== null));
    for (const record of ordered) {
      const releaseAge = record.release === null ? -1 : time - record.release;
      const releasing = releaseAge >= 0 && releaseAge < 1.45;
      for (const shaped of shape(record.row, record.index)) {
        if (!shaped.points.length) continue;
        const age = time - shaped.word.start;
        // Never paint even a dust-shaped future syllable before its acoustic onset.
        if (age < 0) continue;
        const forming = !releasing && age < .58;
        if (!forming && !releasing) continue;
        phase = releasing ? 'releasing' : 'forming';
        for (let n = 0; n < shaped.points.length; n++) {
          const point = shaped.points[n], seed = shaped.seed + n * 1.17;
          const r = noise(seed), s = noise(seed + 18), q = noise(seed + 37);
          let x = shaped.x + point.x, y = shaped.y + point.y, alpha;
          if (forming) {
            const gather = 1 - Math.pow(1 - clamp(age / .42), 3);
            x += (1 - gather) * (22 + r * 85);
            y += (1 - gather) * ((s - .5) * 68 + Math.sin(gather * Math.PI) * 14);
            alpha = ease(age / .065) * (1 - ease((age - .30) / .28)) * (.3 + q * .65);
          } else {
            const t = releaseAge;
            const scatter = ease(t / .35);
            x += (r - .35) * 26 * scatter + t * (8 + r * 18) + Math.sin(t * 2.1 + s * 6.28) * t * 8;
            y += (s - .5) * 12 * scatter + t * (13 + q * 16) + t * t * 27;
            alpha = (1 - ease(t / 1.45)) * (.35 + q * .5);
          }
          dot(x, y, .46 + q * .60, alpha, r > .72);
          if (count >= budget) break;
        }
        if (releasing && count < budget && shaped.ordinal % 3 === 0) {
          // A handful of petal slivers curl through the finer dust, never a shower.
          for (let petal = 0; petal < 2; petal++) {
            if (count >= budget) break;
            const seed = shaped.seed + petal * 43, r = noise(seed), s = noise(seed + 9), t = releaseAge;
            const x = shaped.x + r * Math.max(4, shaped.points.at(-1)?.x || 15) + t * (14 + s * 12);
            const y = shaped.y + 12 + t * (22 + r * 19) + t * t * 28;
            const alpha = ease(t / .16) * (1 - ease((t - .2) / 1.25)) * .42;
            if (alpha < .02 || y > height) continue;
            ctx.save(); ctx.translate(x, y); ctx.rotate(s * 6.28 + t * (1.4 + r));
            ctx.globalAlpha = alpha; ctx.fillStyle = '#e9b3ca';
            ctx.beginPath(); ctx.ellipse(0, 0, .55, 1.7 + r, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); count++;
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  return {
    render,
    invalidate() {dirty = true;},
    clear() {ctx.clearRect(0, 0, canvas.width, canvas.height); count = 0; phase = 'empty'; lastTime = NaN;},
    getState: () => ({particleCount: count, effectPhase: phase, effectsQuality: quality, effectsReady: true}),
    dispose() {observer?.disconnect(); masks.clear(); canvas.remove();},
  };
}
