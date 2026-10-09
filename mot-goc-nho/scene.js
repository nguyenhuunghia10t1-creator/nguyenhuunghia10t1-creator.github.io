import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

// All geometry is original, deterministic point geometry. No image of a tree is used.
const PALETTE = {
  bark: ['#15556c', '#1d819b', '#269ece', '#38b8e0', '#6ad8ef'],
  leaves: ['#442c4d', '#643251', '#864264', '#a04d7b', '#bc6b9b'],
  flowers: ['#752653', '#a12c72', '#c4438a', '#de559e', '#de72ae', '#f4abcd'],
  man: ['#aebbc9', '#d4cdda', '#f2e1de'],
  pot: ['#5a3f52', '#895769', '#bd8a9a'],
  succulent: ['#356b67', '#589084', '#95b3a1', '#b9cfbe'],
};

function seeded(seed = 917226) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothStep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

class PointCloud {
  constructor(random) {
    this.random = random;
    this.positions = [];
    this.colors = [];
    this.sizes = [];
    this.sways = [];
    this.phases = [];
    this.colorCache = new Map();
  }

  point(x, y, z, color, size = 1, sway = 0, phase = 0) {
    let c = this.colorCache.get(color);
    if (!c) {
      c = new THREE.Color(color);
      this.colorCache.set(color, c);
    }
    this.positions.push(x, y, z);
    this.colors.push(c.r, c.g, c.b);
    this.sizes.push(size);
    this.sways.push(sway);
    this.phases.push(phase || this.random() * Math.PI * 2);
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sways, 1));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phases, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function pointMaterial(uniforms, { opacity = 1, glow = false, sizeMultiplier = 1, petal = false, emission = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.time,
      uPixelRatio: uniforms.pixelRatio,
      uMotion: uniforms.motion,
      uExposure: uniforms.exposure,
      uOpacity: { value: opacity },
      uSizeMultiplier: { value: sizeMultiplier },
      uGlow: { value: glow ? 1 : 0 },
      uPetal: { value: petal ? 1 : 0 },
      uEmission: { value: emission },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `
      attribute float aSize;
      attribute float aSway;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uMotion;
      uniform float uSizeMultiplier;
      varying vec3 vColor;
      varying float vDepth;
      varying float vPhase;
      void main() {
        vec3 p = position;
        float crown = smoothstep(1.4, 6.7, p.y);
        p.x += sin(uTime * 0.48 + p.y * 0.21) * 0.039 * crown * uMotion;
        p.z += cos(uTime * 0.37 + p.y * 0.17) * 0.017 * crown * uMotion;
        p.x += sin(uTime * 0.43 + aPhase + p.y * 0.19) * aSway * uMotion;
        p.z += cos(uTime * 0.31 + aPhase * 0.67) * aSway * 0.6 * uMotion;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vColor = color;
        vDepth = -mv.z;
        vPhase = aPhase;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uSizeMultiplier * uPixelRatio * 43.0 / max(1.0, -mv.z), 0.8 * uPixelRatio, (uSizeMultiplier > 2.0 ? 24.0 : 8.0) * uPixelRatio);
      }
    `,
    fragmentShader: `
      uniform float uExposure;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uMotion;
      uniform float uGlow;
      uniform float uPetal;
      uniform float uEmission;
      varying vec3 vColor;
      varying float vDepth;
      varying float vPhase;
      void main() {
        vec2 q = gl_PointCoord - vec2(0.5);
        if (uPetal > 0.5) {
          float angle = uTime * 0.575 * uMotion + vPhase;
          q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q;
          q.x *= 1.0 + abs(sin(angle * 0.67)) * 0.62;
          q.y *= 1.55;
        }
        float radius = length(q) * 2.0;
        if (radius > 1.0) discard;
        float alpha = (1.0 - smoothstep(0.16, 1.0, radius)) * uOpacity;
        if (uGlow > 0.5) alpha = exp(-radius * radius * 4.4) * (1.0 - smoothstep(0.72, 1.0, radius)) * uOpacity;
        float center = 1.0 - smoothstep(0.0, 0.4, radius);
        vec3 c = vColor * (0.87 + center * 0.28) * uExposure * uEmission;
        float fog = smoothstep(33.0, 85.0, vDepth);
        c = mix(c, vec3(0.003, 0.007, 0.017), fog * 0.54);
        gl_FragColor = vec4(c, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function addTube(cloud, controls, baseRadius, endRadius, count, colors, options = {}) {
  const curve = new THREE.CatmullRomCurve3(controls.map(p => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(120, false);
  const random = cloud.random;
  for (let i = 0; i < count; i++) {
    // Quasi-regular rings retain a legible branch silhouette with organic variation.
    const t = (i + random() * 0.85) / count;
    const center = curve.getPoint(t);
    const frame = Math.min(119, Math.floor(t * 120));
    const theta = i * 2.3999632297 + random() * 0.16;
    const radius = THREE.MathUtils.lerp(baseRadius, endRadius, t) * (0.80 + random() * 0.22);
    center.addScaledVector(frames.normals[frame], Math.cos(theta) * radius);
    center.addScaledVector(frames.binormals[frame], Math.sin(theta) * radius);
    const colorIndex = Math.min(colors.length - 1, Math.floor(random() * colors.length));
    const size = (options.size || 1.1) * (0.72 + random() * 0.55);
    cloud.point(center.x, center.y, center.z, colors[colorIndex], size, (options.sway || 0) * t, theta);
  }
  return curve;
}

function buildTree(random, density) {
  const wood = new PointCloud(random);
  const foliage = new PointCloud(random);
  const flowers = new PointCloud(random);
  const tips = [];
  const clouds = [];
  const filaments = [];
  function illuminate(curve) {
    const count=Math.max(12,Math.ceil(curve.getLength()*14));
    let previous=curve.getPoint(0);
    for(let i=1;i<=count;i++){
      const next=curve.getPoint(i/count);
      filaments.push(previous.x,previous.y,previous.z,next.x,next.y,next.z);
      previous=next;
    }
  }
  const n = value => Math.max(12, Math.round(value * density));
  // A short, rooted trunk opens into a crown that begins just above the ground.
  addTube(wood, [[0, 0, 0], [-0.05, 0.54, 0], [0.06, 1.24, -0.02], [-0.06, 2.05, -0.08]], 0.40, 0.18, n(4200), PALETTE.bark, { size: 1.03 });
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7 + 0.2;
    addTube(wood, [[0, 0.32, 0], [Math.cos(a) * 0.37, 0.09, Math.sin(a) * 0.34], [Math.cos(a) * (0.75 + random() * 0.35), 0.015, Math.sin(a) * 0.73]], 0.13, 0.012, n(190), PALETTE.bark, { size: 0.84 });
  }
  // Each major limb has its own curved path through the crown, not a bare Y shape.
  const limbs = [
    [[0, 1.04, 0], [-1.28, 2.08, 0.22], [-3.60, 2.78, 0.65], [-5.58, 2.93, 0.88]],
    [[0, 1.28, 0], [-1.59, 2.64, 0.05], [-3.72, 4.07, 0.33], [-5.75, 5.26, 0.65]],
    [[0, 1.18, 0.10], [-1.42, 2.43, 0.12], [-3.68, 3.38, 0.53], [-5.95, 4.10, 0.95]],
    [[0, 1.43, -0.05], [-1.26, 3.10, -0.42], [-2.65, 5.13, -0.50], [-4.13, 7.14, -0.87]],
    [[0, 1.70, -0.04], [-0.72, 3.95, -0.05], [-1.47, 6.02, -0.32], [-1.18, 7.98, -0.47]],
    [[0, 1.67, -0.06], [0.38, 3.68, -0.32], [0.60, 6.01, 0.02], [0.23, 8.13, -0.05]],
    [[0.02, 1.55, -0.03], [1.31, 3.28, -0.49], [2.85, 5.54, -0.72], [3.66, 7.41, -0.95]],
    [[0.02, 1.30, 0.03], [1.86, 2.96, 0.21], [3.86, 4.31, 0.54], [5.76, 5.66, 0.34]],
    [[0.01, 1.04, 0.06], [1.38, 2.07, 0.63], [3.63, 2.67, 1.10], [5.75, 3.28, 1.44]],
    [[0.02, 1.14, 0.14], [1.49, 2.37, 0.48], [3.76, 3.37, 0.92], [5.96, 4.32, 1.32]],
    [[0, 1.27, 0.09], [-1.17, 2.60, 1.52], [-2.55, 4.10, 2.72], [-3.69, 5.68, 3.09]],
    [[0, 1.30, 0.10], [1.19, 2.68, 1.55], [2.26, 4.38, 2.87], [3.61, 5.38, 3.05]],
    [[0.03, 1.45, 0.14], [0.31, 3.34, 1.68], [-0.39, 5.48, 2.66], [0.36, 7.04, 2.79]],
    [[-0.02, 1.38, -0.13], [-1.33, 2.82, -1.71], [-2.65, 4.69, -2.65], [-3.90, 6.41, -3.04]],
    [[0.02, 1.44, -0.10], [1.16, 3.03, -1.44], [2.27, 4.73, -2.54], [3.67, 6.25, -2.94]],
    [[0, 1.62, -0.09], [-0.19, 3.63, -1.69], [0.71, 5.55, -2.74], [0.83, 7.30, -2.80]],
    [[0.01, 1.13, 0.08], [-0.44, 2.12, 1.87], [-1.56, 2.89, 3.05], [-2.19, 3.28, 3.40]],
    [[0.02, 1.10, -0.07], [0.50, 2.23, -1.73], [1.75, 3.07, -3.11], [2.36, 3.64, -3.54]],
  ];
  function cloud(center, radius, phase, weight = 1) {
    clouds.push({ center, radius, phase, weight });
    tips.push({ center: center.clone(), angle: phase, flowerAmount: weight });
  }
  limbs.forEach((points, limbIndex) => {
    const main = addTube(wood, points, 0.18 + (limbIndex < 8 ? 0.045 : 0), 0.012, n(760), PALETTE.bark, { size: 0.98 });
    illuminate(main);
    const outward = new THREE.Vector3(points[3][0], 0, points[3][2]).normalize();
    const sideways = new THREE.Vector3(-outward.z, 0, outward.x);
    for (let j = 0; j < 6; j++) {
      const t = 0.30 + j * 0.123;
      const joint = main.getPoint(t);
      const side = j % 2 ? 1 : -1;
      const reach = 0.59 + random() * 0.59;
      const lowSkirt = points[3][1] < 4.5;
      const end = joint.clone().addScaledVector(outward, reach).addScaledVector(sideways, side * (0.38 + random() * 0.62));
      end.y += lowSkirt ? 0.16 + random() * 0.48 : 0.42 + random() * 0.77;
      const bend = joint.clone().lerp(end, 0.56).add(new THREE.Vector3(0, 0.17, 0));
      const secondary = addTube(wood, [joint.toArray(), bend.toArray(), end.toArray()], 0.043 - j * 0.0036, 0.005, n(205), PALETTE.bark, { size: 0.78, sway: 0.009 });
      illuminate(secondary);
      // Blossoms also occupy the interior of each supported branch, connecting tiers.
      cloud(secondary.getPoint(0.69), 0.73 + random() * 0.18, limbIndex + j, 0.73);
      for (let k = 0; k < 3; k++) {
        const origin = secondary.getPoint(0.45 + k * 0.245);
        const angle = limbIndex * 0.73 + j * 1.91 + k * 2.09;
        const tip = origin.clone().add(new THREE.Vector3(Math.cos(angle) * (0.43 + random() * 0.42), (lowSkirt ? -0.10 : 0.12) + random() * 0.35, Math.sin(angle) * (0.42 + random() * 0.38)));
        illuminate(addTube(wood, [origin.toArray(), origin.clone().lerp(tip, 0.53).add(new THREE.Vector3(0, 0.10, 0)).toArray(), tip.toArray()], 0.014, 0.002, n(87), PALETTE.bark, { size: 0.69, sway: 0.013 }));
        cloud(tip, 0.74 + random() * 0.34, angle, lowSkirt ? 0.90 : 1);
      }
    }
    cloud(new THREE.Vector3(...points[3]), 1.0, limbIndex, 1);
  });
  // Overlapping anisotropic, feather-edged clusters form one continuous volumetric
  // crown. Fine particles follow branch lobes; they are never a single sphere.
  for (const { center, radius, phase, weight } of clouds) {
    const amount = n(385 * weight);
    for (let i = 0; i < amount; i++) {
      const angle = random() * Math.PI * 2;
      const r = Math.min(1.42, Math.sqrt(-Math.log(Math.max(0.00001, random()))) * 0.60);
      const x = Math.cos(angle) * r * radius;
      const z = Math.sin(angle) * r * radius * 0.83;
      const vertical = (random() + random() + random() - 1.45) * radius * 0.89;
      const y = vertical + Math.sin(angle * 2.0 + phase) * 0.10 - r * 0.09;
      const destination = i % 4 === 0 ? foliage : flowers;
      const palette = destination === foliage ? PALETTE.leaves : PALETTE.flowers;
      const shade = destination === flowers && random() > 0.99 ? 5 : Math.floor(random() * Math.min(5, palette.length));
      destination.point(center.x + x, center.y + y, center.z + z, palette[shade], 0.97 + random() * 0.55, 0.026 + r * 0.020, phase);
    }
  }
  return { wood, foliage, flowers, tips, filaments };
}
function buildFigure(random, density) {
  const body = new PointCloud(random);
  const arm = new PointCloud(random);
  const n = value => Math.round(value * Math.max(0.75, density));
  const skin = ['#748ea3', '#a7bac8', '#d1d8e0'];
  const clothing = ['#536779', '#7894ab', '#acb9cd'];
  const line = (points, radius = 0.026, count = 200, colors = skin) => addTube(body, points, radius, radius * 0.77, n(count), colors, { size: 0.94 });
  // A faceless, slightly tilted oval head; the smaller proportions avoid a stickman icon.
  for (let i = 0; i < n(340); i++) {
    const y = 1 - 2 * (i + 0.5) / n(340);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * 2.399963;
    const color = y > 0.58 && Math.sin(angle) < 0.3 ? '#576f86' : skin[Math.floor(random() * skin.length)];
    body.point(-0.074 + Math.cos(angle) * r * 0.122, 1.414 + y * 0.165, 0.01 + Math.sin(angle) * r * 0.111, color, 0.75 + random() * 0.25);
  }
  line([[-0.064, 1.27, 0.015], [-0.03, 1.14, 0.01]], 0.037, 150);
  // A gently leaning, filled slim torso with shoulder and waist contours.
  for (let i = 0; i < n(1050); i++) {
    const t = random();
    const angle = random() * Math.PI * 2;
    const width = 0.095 + 0.067 * Math.sin(t * Math.PI * 0.87);
    const depth = 0.073 + 0.015 * Math.sin(t * Math.PI);
    const fill = 0.74 + random() * 0.26;
    body.point(0.035 - t * 0.075 + Math.cos(angle) * width * fill, 0.57 + t * 0.58, 0.02 + Math.sin(angle) * depth * fill, clothing[Math.floor(random() * clothing.length)], 0.73 + random() * 0.22);
  }
  // Seated naturally, both legs rest forward rather than forming a symmetrical X.
  line([[0.075, 0.59, 0.035], [0.45, 0.66, 0.23], [0.58, 0.12, 0.65]], 0.045, 570, clothing);
  line([[-0.055, 0.56, 0.04], [-0.09, 0.24, 0.44], [0.33, 0.075, 0.87]], 0.043, 530, clothing);
  line([[0.58, 0.12, 0.65], [0.64, 0.065, 0.83], [0.75, 0.06, 0.89]], 0.038, 160, clothing);
  line([[0.33, 0.075, 0.87], [0.43, 0.052, 1.02]], 0.036, 130, clothing);
  // The left hand rests beside the hip; the right forearm rests on the raised knee.
  line([[-0.15, 1.10, 0.01], [-0.29, 0.84, 0.075], [-0.13, 0.57, 0.08]], 0.027, 390);
  addTube(arm, [[0, 0, 0], [0.17, -0.23, 0.11], [0.30, -0.40, 0.24]], 0.028, 0.021, n(380), skin, { size: 0.96 });
  for (let i = 0; i < n(50); i++) {
    arm.point(0.30 + (random() - 0.5) * 0.066, -0.40 + (random() - 0.5) * 0.085, 0.24 + (random() - 0.5) * 0.045, skin[1 + i % 2], 0.83);
  }
  // A small, quiet stone gives the seated pose physical support.
  for (let i = 0; i < n(600); i++) {
    const y = random();
    const angle = i * 2.399963;
    const radius = Math.sqrt(1 - (y - 0.18) * (y - 0.18)) * 0.31;
    body.point(-0.06 + Math.cos(angle) * radius, 0.04 + y * 0.46, -0.025 + Math.sin(angle) * radius * 0.75, i % 4 ? '#263f54' : '#3d5870', 0.74 + random() * 0.23);
  }
  return { body, arm };
}
function buildSucculent(random, density) {
  const pot = new PointCloud(random);
  const leaves = new PointCloud(random);
  const n = x => Math.round(x * Math.max(0.8, density));
  for (let i = 0; i < n(1050); i++) {
    const t = random();
    const theta = i * 2.399963;
    const radius = 0.22 + t * 0.08;
    pot.point(Math.cos(theta) * radius, 0.06 + t * 0.39, Math.sin(theta) * radius, PALETTE.pot[Math.floor(random() * 3)], 1.08 + random() * 0.3);
  }
  for (let i = 0; i < n(270); i++) {
    const theta = i * Math.PI * 2 / n(270);
    const r = 0.30 + random() * 0.016;
    pot.point(Math.cos(theta) * r, 0.44 + random() * 0.029, Math.sin(theta) * r, '#c595a5', 1.29);
  }
  const layers = [{ number: 9, length: 0.49, rise: 0.14, base: 0.47 }, { number: 7, length: 0.34, rise: 0.28, base: 0.50 }, { number: 5, length: 0.20, rise: 0.34, base: 0.54 }];
  layers.forEach((layer, layerIndex) => {
    for (let leaf = 0; leaf < layer.number; leaf++) {
      const phi = leaf * Math.PI * 2 / layer.number + layerIndex * 0.46;
      for (let i = 0; i < n(160); i++) {
        const t = random();
        const across = (random() - 0.5) * 2;
        const halfWidth = Math.pow(Math.sin(Math.PI * t), 0.7) * (0.115 - layerIndex * 0.021);
        const r = t * layer.length;
        const thickness = (1 - across * across) * Math.sin(Math.PI * t) * 0.065;
        const x = Math.cos(phi) * r - Math.sin(phi) * halfWidth * across;
        const z = Math.sin(phi) * r + Math.cos(phi) * halfWidth * across;
        const y = layer.base + t * layer.rise + Math.sin(Math.PI * t) * 0.08 + thickness;
        const color = t > 0.86 ? '#cfb8c6' : PALETTE.succulent[Math.floor(random() * 4)];
        leaves.point(x, y, z, color, 1.14 + random() * 0.25);
      }
    }
  });
  return { pot, leaves };
}

function buildGround(random, density) {
  const ground = new PointCloud(random);
  for (let i = 0; i < Math.round(10400 * density); i++) {
    const theta = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * 11.5;
    const fade = Math.max(0, 1 - r / 11.5);
    if (random() > fade * 0.85 + 0.03) continue;
    let color = '#263440';
    const chance = random();
    if (r < 6.7 && chance < 0.29) color = PALETTE.flowers[Math.floor(random() * 4)];
    else if (chance < 0.40) color = '#64435d';
    else if (chance < 0.69) color = '#243f53';
    ground.point(Math.cos(theta) * r, -0.018 + random() * 0.028, Math.sin(theta) * r * 0.72, color, 0.63 + random() * 0.76);
  }
  const distance = new PointCloud(random);
  for (let i = 0; i < Math.round(390 * density); i++) {
    distance.point((random() - 0.5) * 35, random() * 15 + 0.2, -6 - random() * 19, random() > 0.82 ? '#bca2bf' : '#49627d', 0.46 + random() * 0.84, 0.025, random() * 6);
  }
  // A few soft nearer points give parallax without turning the scene into fireworks.
  for (let i = 0; i < 23; i++) {
    distance.point((random() - 0.5) * 27, random() * 13 + 0.3, 4 + random() * 8, i % 3 ? '#5a365a' : '#3d647e', 1.4 + random() * 2.0, 0.08, random() * 6);
  }
  return { ground, distance };
}

function createHalo(pink = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, pink ? 'rgba(101,34,95,0.26)' : 'rgba(33,67,119,0.28)');
  gradient.addColorStop(0.43, pink ? 'rgba(60,26,67,0.17)' : 'rgba(15,42,82,0.20)');
  gradient.addColorStop(1, 'rgba(4,12,26,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One persistent scene for the locked, letter and explore views.
 * Failure never prevents the surrounding application from opening the letter.
 */
export async function createScene({ canvas, onReady = () => {}, onFallback = () => {}, onDialogue = () => {}, reducedMotion = false }) {
  let renderer;
  let disposed = false;
  let failed = false;
  let mode = 'locked';
  let raf = 0;
  let frameTime = 0;
  let elapsed = 0;
  let cameraTransition = null;
  let waveStarted = -100;
  let resizeObserver;
  let baseDistance = 23;
  let exploreDistance = 23;
  let treeWidth = 14;
  let treeCenterX = 0;
  let viewportWidth = window.innerWidth;
  let isPortrait = false;
  let lowQuality = false;
  let qualityDowngraded = false;
  let measuredFrames = 0;
  let measuredTime = 0;
  let slowFrames = 0;
  let verySlowFrames = 0;
  let lastMeasuredFrameMs = null;
  const cleanup = [];
  const geometries = [];
  const materials = [];
  const textures = [];

  const fallbackController = {
    setMode() {}, reset() {}, dispose() {}, setReducedMotion() {},
    getProjectionTargets() { return null; },
  };
  function fail() {
    if (failed || disposed) return;
    failed = true;
    cancelAnimationFrame(raf);
    canvas.dataset.scene = 'fallback';
    onFallback();
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x030611, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
  } catch {
    fail();
    return fallbackController;
  }

  const random = seeded();
  const constrained = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const density = constrained ? 0.58 : window.innerWidth < 640 ? 0.76 : 1;
  lowQuality = Boolean(constrained);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.47;
  controls.zoomSpeed = 0.68;
  controls.minPolarAngle = Math.PI * 0.26;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minAzimuthAngle = -Math.PI * 0.78;
  controls.maxAzimuthAngle = Math.PI * 0.78;

  const uniforms = {
    time: { value: 0 }, pixelRatio: { value: 1 },
    motion: { value: reducedMotion ? 0 : 1 }, exposure: { value: 1.07 },
  };
  const mainMaterial = pointMaterial(uniforms);
  const flowerMaterial = pointMaterial(uniforms, { opacity: 0.91 });
  const branchMaterial = pointMaterial(uniforms, { opacity: 0.98, emission: 1.15 });
  branchMaterial.depthWrite = false;
  const branchGlowMaterial = pointMaterial(uniforms, { opacity: 0.10, glow: true, sizeMultiplier: 4.0, emission: 1.15 });
  const blossomGlowMaterial = pointMaterial(uniforms, { opacity: 0.026, glow: true, sizeMultiplier: 7.2 });
  const petalMaterial = pointMaterial(uniforms, { opacity: 0.86, sizeMultiplier: 1.30, petal: true });
  const starMaterial = pointMaterial(uniforms, { opacity: 0.58, glow: true });
  materials.push(mainMaterial, flowerMaterial, branchMaterial, branchGlowMaterial, blossomGlowMaterial, petalMaterial, starMaterial);
  function addCloud(cloud, material, parent = scene) {
    const geometry = cloud.geometry();
    geometries.push(geometry);
    const points = new THREE.Points(geometry, material);
    parent.add(points);
    return points;
  }
  function addGlow(source, material, stride, parent) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
      const count = Math.ceil(attribute.count / stride);
      const values = new Float32Array(count * attribute.itemSize);
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < attribute.itemSize; j++) {
          values[i * attribute.itemSize + j] = attribute.array[i * stride * attribute.itemSize + j];
        }
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    geometry.computeBoundingSphere();
    geometries.push(geometry);
    const glow = new THREE.Points(geometry, material);
    parent.add(glow);
    return glow;
  }

  // Yield once so the opening form can paint before creating the detailed crown.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (disposed) return fallbackController;

  const tree = new THREE.Group();
  scene.add(tree);
  const treeData = buildTree(random, density);
  const branches = addCloud(treeData.wood, branchMaterial, tree);
  branches.renderOrder = 1;
  addCloud(treeData.foliage, mainMaterial, tree);
  const blossoms = addCloud(treeData.flowers, flowerMaterial, tree);
  const cyanGlow = addGlow(branches, branchGlowMaterial, lowQuality ? 8 : 5, tree);
  const pinkGlow = addGlow(blossoms, blossomGlowMaterial, lowQuality ? 12 : 8, tree);
  cyanGlow.renderOrder = 2;
  pinkGlow.renderOrder = 2;
  // Continuous cyan light inside the point branches retains fine topology even
  // when the crown is viewed at phone size. It shares the same gentle wind.
  const filamentGeometry=new THREE.BufferGeometry();
  filamentGeometry.setAttribute('position',new THREE.Float32BufferAttribute(treeData.filaments,3));
  geometries.push(filamentGeometry);
  const filamentMaterial=new THREE.ShaderMaterial({
    uniforms:{uTime:uniforms.time,uMotion:uniforms.motion,uExposure:uniforms.exposure},
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float uTime;uniform float uMotion;void main(){vec3 p=position;float c=smoothstep(1.4,6.7,p.y);p.x+=sin(uTime*.48+p.y*.21)*.039*c*uMotion;p.z+=cos(uTime*.37+p.y*.17)*.017*c*uMotion;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:`uniform float uExposure;void main(){gl_FragColor=vec4(vec3(.02,.40,.94)*uExposure,.32);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  materials.push(filamentMaterial);
  const filaments=new THREE.LineSegments(filamentGeometry,filamentMaterial);
  filaments.renderOrder=3;
  tree.add(filaments);

  const figure = new THREE.Group();
  figure.position.set(-3.03, 0.02, 2.88);
  figure.rotation.y = -0.30;
  scene.add(figure);
  const figureData = buildFigure(random, density);
  addCloud(figureData.body, mainMaterial, figure);
  const rightArm = new THREE.Group();
  rightArm.position.set(0.12, 1.12, 0.01);
  figure.add(rightArm);
  addCloud(figureData.arm, mainMaterial, rightArm);

  const succulent = new THREE.Group();
  succulent.position.set(-1.75, 0.015, 3.00);
  scene.add(succulent);
  const plantData = buildSucculent(random, density);
  addCloud(plantData.pot, mainMaterial, succulent);
  addCloud(plantData.leaves, mainMaterial, succulent);

  const groundData = buildGround(random, density);
  const groundPoints = addCloud(groundData.ground, mainMaterial);
  const groundGlowMaterial = pointMaterial(uniforms, { opacity: 0.14, glow: true, sizeMultiplier: 5.8 });
  materials.push(groundGlowMaterial);
  addGlow(groundPoints, groundGlowMaterial, lowQuality ? 6 : 4, scene);
  addCloud(groundData.distance, starMaterial);
  const haloTexture = createHalo();
  if (haloTexture) {
    textures.push(haloTexture);
    const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, depthWrite: false, opacity: 0.70, blending: THREE.AdditiveBlending });
    materials.push(haloMaterial);
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.set(0, 3.8, -8);
    halo.scale.set(28, 19, 1);
    scene.add(halo);
  }
  const pinkHaloTexture = createHalo(true);
  if (pinkHaloTexture) {
    textures.push(pinkHaloTexture);
    const hazeMaterial = new THREE.SpriteMaterial({ map: pinkHaloTexture, transparent: true, depthWrite: false, opacity: 0.78, blending: THREE.AdditiveBlending });
    materials.push(hazeMaterial);
    const haze = new THREE.Sprite(hazeMaterial);
    haze.position.set(0.3, 6.9, -4.5);
    haze.scale.set(20, 12, 1);
    scene.add(haze);
  }

  const floorGeometry = new THREE.PlaneGeometry(29, 21);
  geometries.push(floorGeometry);
  const floorMaterial = new THREE.ShaderMaterial({
    uniforms: { uExposure: uniforms.exposure }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform float uExposure; void main(){float r=length((vUv-0.5)*2.0);float a=(1.0-smoothstep(0.03,1.0,r))*0.48;vec3 c=mix(vec3(0.028,0.045,0.10),vec3(0.17,0.035,0.13),1.0-smoothstep(0.0,0.80,r));gl_FragColor=vec4(c*uExposure,a);}',
  });
  materials.push(floorMaterial);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.04;
  scene.add(floor);

  // One reusable falling-petal buffer, shared by ambient petals and the flower tap.
  const petalCount = lowQuality ? 48 : 90;
  const petalCloud = new PointCloud(random);
  const petalState = Array.from({ length: petalCount }, (_, i) => {
    petalCloud.point(0, -20, 0, PALETTE.flowers[2 + i % 3], 1.8 + random() * 0.8);
    return { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: random() * Math.PI * 2, life: 0 };
  });
  const petals = addCloud(petalCloud, petalMaterial);
  petals.frustumCulled = false;
  const petalPositions = petals.geometry.getAttribute('position');
  petalPositions.setUsage(THREE.DynamicDrawUsage);
  let ambientTimer = 0;
  let nextPetal = 0;
  function releasePetal(origin, interaction = false) {
    const p = petalState[nextPetal];
    nextPetal = (nextPetal + 1) % petalCount;
    Object.assign(p, {
      active: true, x: origin.x + (random() - 0.5) * 0.45, y: origin.y + random() * 0.16,
      z: origin.z + (random() - 0.5) * 0.45,
      vx: (random() - 0.4) * (interaction ? 0.56 : 0.2),
      vy: -(0.15 + random() * 0.22) * 1.25, vz: (random() - 0.5) * 0.325,
      life: interaction ? 11 : 18,
    });
  }

  const initialCamera = new THREE.Vector3();
  const initialTarget = new THREE.Vector3(0, 4.17, 0);
  function updateFraming() {
    const introductionAtSide = mode === 'locked' && viewportWidth >= 900;
    if (introductionAtSide) {
      const visibleWidth = treeWidth * 1.24 / 0.61;
      baseDistance = Math.max(exploreDistance, visibleWidth / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      initialTarget.set(treeCenterX - visibleWidth * 0.185, 4.48, 0);
    } else if (mode === 'letter') {
      baseDistance = exploreDistance * (isPortrait ? 1.01 : 1.25);
      initialTarget.set(isPortrait ? treeCenterX * 0.8 : 0, isPortrait ? 1.55 : 2.35, 0);
    } else {
      baseDistance = exploreDistance;
      initialTarget.set(isPortrait ? treeCenterX * 0.8 : 0, isPortrait ? 4.70 : 4.26, 0);
    }
    initialCamera.set(initialTarget.x + (isPortrait ? 0.40 : 1.45), initialTarget.y + baseDistance * 0.095, baseDistance);
    controls.minDistance = baseDistance * 0.63;
    controls.maxDistance = baseDistance * 1.33;
  }
  function resize() {
    if (disposed || failed) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    viewportWidth = width;
    isPortrait = width / height < 0.82;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, qualityDowngraded ? 1 : lowQuality ? 1.15 : isPortrait ? 1.55 : 1.8);
    renderer.setPixelRatio(dpr);
    uniforms.pixelRatio.value = dpr;
    renderer.setSize(width, height, false);
    tree.scale.set(isPortrait ? 0.84 : 1.13, isPortrait ? 1.03 : 0.92, 1);
    figure.scale.setScalar(isPortrait ? 1.02 : 0.85);
    succulent.scale.setScalar(isPortrait ? 0.91 : 0.77);
    tree.updateMatrixWorld(true);
    const treeBounds = new THREE.Box3().setFromObject(tree);
    const treeSize = treeBounds.getSize(new THREE.Vector3());
    const treeCenter = treeBounds.getCenter(new THREE.Vector3());
    treeWidth = treeSize.x;
    treeCenterX = treeCenter.x;
    // Fit the broad crown by width while preserving a recognizable foreground figure.
    const widthToFit = isPortrait ? treeSize.x * 1.12 : Math.max(15.0, treeSize.x * 1.06);
    const horizontalDistance = widthToFit / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    exploreDistance = Math.max(isPortrait ? 23 : 19.7, horizontalDistance + (isPortrait ? Math.max(0, treeBounds.max.z) * 0.60 : 0));
    updateFraming();
    camera.position.copy(initialCamera);
    controls.target.copy(initialTarget);
    controls.update();
    cameraTransition = null;
  }

  function reset() {
    if (disposed || failed) return;
    if (reducedMotion) {
      camera.position.copy(initialCamera);
      controls.target.copy(initialTarget);
      controls.update();
    } else {
      cameraTransition = { start: elapsed, fromCamera: camera.position.clone(), fromTarget: controls.target.clone() };
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Set();
  let tap = null;
  const figureCenter = new THREE.Vector3(0.03, 0.88, 0.22);
  const flowerCenters = treeData.tips.map(tip => tip.center.clone());
  function canvasToRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray;
  }
  function pointerDown(event) {
    if (mode !== 'explore') return;
    pointers.add(event.pointerId);
    tap = pointers.size === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() } : null;
    cameraTransition = null;
  }
  function pointerUp(event) {
    const wasTap = tap && tap.id === event.pointerId && pointers.size === 1 && performance.now() - tap.time < 650 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 8;
    pointers.delete(event.pointerId);
    tap = null;
    if (!wasTap || mode !== 'explore' || failed) return;
    scene.updateMatrixWorld(true);
    const ray = canvasToRay(event.clientX, event.clientY);
    const manSphere = new THREE.Sphere(figureCenter.clone().applyMatrix4(figure.matrixWorld), 0.90);
    if (ray.intersectsSphere(manSphere)) {
      waveStarted = elapsed;
      onDialogue('Cái người hơi ngơ dưới gốc cây là anh :))');
      return;
    }
    let nearest = null;
    let closest = Infinity;
    for (const c of flowerCenters) {
      const world = c.clone().applyMatrix4(tree.matrixWorld);
      const hit = ray.intersectSphere(new THREE.Sphere(world, 0.89), new THREE.Vector3());
      if (hit) {
        const distance = ray.origin.distanceToSquared(hit);
        if (distance < closest) { closest = distance; nearest = world; }
      }
    }
    if (nearest && !reducedMotion) {
      for (let i = 0; i < 18; i++) releasePetal(nearest, true);
    }
  }
  function pointerCancel(event) { pointers.delete(event.pointerId); tap = null; }
  canvas.addEventListener('pointerdown', pointerDown, { passive: true });
  canvas.addEventListener('pointerup', pointerUp, { passive: true });
  canvas.addEventListener('pointercancel', pointerCancel, { passive: true });
  cleanup.push(() => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
  });

  function onContextLost(event) { event.preventDefault(); fail(); }
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  cleanup.push(() => canvas.removeEventListener('webglcontextlost', onContextLost));

  function resetPerformanceWindow() {
    measuredFrames = 0;
    measuredTime = 0;
    slowFrames = 0;
    verySlowFrames = 0;
  }

  function visibility() {
    cancelAnimationFrame(raf);
    frameTime = 0;
    resetPerformanceWindow();
    if (!document.hidden && !disposed && !failed) raf = requestAnimationFrame(animate);
  }
  document.addEventListener('visibilitychange', visibility);
  cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
  window.addEventListener('resize', resize, { passive: true });
  cleanup.push(() => window.removeEventListener('resize', resize));
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }

  function animate(now) {
    if (disposed || failed || document.hidden) return;
    // Limit GPU work while opening/reading; only exploration requests the full frame rate.
    const minimumInterval = reducedMotion ? 100 : mode === 'explore' ? 0 : 1000 / 30;
    if (frameTime && now - frameTime < minimumInterval) {
      raf = requestAnimationFrame(animate);
      return;
    }
    const rawDelta = frameTime ? (now - frameTime) / 1000 : 0;
    const delta = rawDelta ? Math.min(rawDelta, reducedMotion ? 0.15 : 0.06) : 1 / 60;
    frameTime = now;
    elapsed += delta;
    uniforms.time.value = elapsed;
    const targetExposure = 1.07;
    uniforms.exposure.value = reducedMotion ? targetExposure : THREE.MathUtils.lerp(uniforms.exposure.value, targetExposure, 1 - Math.exp(-delta * 3.2));
    if (cameraTransition) {
      const t = smoothStep(0, 1.15, elapsed - cameraTransition.start);
      camera.position.lerpVectors(cameraTransition.fromCamera, initialCamera, t);
      controls.target.lerpVectors(cameraTransition.fromTarget, initialTarget, t);
      if (t >= 1) cameraTransition = null;
    }
    controls.update();
    const waveAge = elapsed - waveStarted;
    if (waveAge < 3.1) {
      const lift = smoothStep(0, 0.42, waveAge) * (1 - smoothStep(2.45, 3.1, waveAge));
      rightArm.rotation.z = lift * (1.88 + (reducedMotion ? 0 : Math.sin(waveAge * 8) * 0.13));
    } else rightArm.rotation.z = 0;
    figure.rotation.z = reducedMotion || mode !== 'explore' ? 0 : Math.sin(elapsed * 0.85) * 0.003;
    if (!reducedMotion) {
      ambientTimer += delta;
      const interval = mode === 'explore' ? 1.8 : mode === 'letter' ? 3.8 : 2.8;
      if (ambientTimer > interval) {
        ambientTimer = 0;
        const tip = treeData.tips[Math.floor(random() * treeData.tips.length)].center.clone();
        tree.updateMatrixWorld();
        tip.applyMatrix4(tree.matrixWorld);
        if (random() < 0.22) {
          tip.z += 4.5 + random() * 4;
          tip.x += (random() - 0.5) * 4;
        }
        releasePetal(tip);
      }
    }
    let changed = false;
    for (let i = 0; i < petalCount; i++) {
      const p = petalState[i];
      if (!p.active) continue;
      if (reducedMotion) {
        p.active = false; petalPositions.setXYZ(i, 0, -20, 0); changed = true; continue;
      }
      p.life -= delta;
      p.vy -= delta * 0.044;
      p.x += (p.vx + Math.sin(elapsed * 1.35 + p.phase) * 0.15) * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      if (p.life <= 0 || p.y < 0.02) { p.active = false; p.y = -20; }
      petalPositions.setXYZ(i, p.x, p.y, p.z);
      changed = true;
    }
    if (changed) petalPositions.needsUpdate = true;
    try { renderer.render(scene, camera); } catch { fail(); return; }

    // Use raw frame intervals, not the simulation delta. Require a sustained majority
    // of slow frames so one stall or a return from another tab cannot trigger fallback.
    if (rawDelta > 0 && mode === 'explore' && !reducedMotion && !cameraTransition) {
      measuredFrames++;
      measuredTime += rawDelta;
      if (rawDelta > 0.042) slowFrames++;
      if (rawDelta > 1 / 12) verySlowFrames++;
      const windowSeconds = qualityDowngraded ? 6 : 4;
      if (measuredFrames >= 45 && measuredTime >= windowSeconds) {
        const average = measuredTime / measuredFrames;
        lastMeasuredFrameMs = average * 1000;
        if (!qualityDowngraded && average > 0.043 && slowFrames / measuredFrames >= 0.65) {
          qualityDowngraded = true;
          lowQuality = true;
          const dpr = Math.min(window.devicePixelRatio || 1, 1);
          renderer.setPixelRatio(dpr);
          uniforms.pixelRatio.value = dpr;
        } else if (qualityDowngraded && average > 0.10 && verySlowFrames / measuredFrames >= 0.75) {
          fail();
          return;
        }
        resetPerformanceWindow();
      }
    }
    raf = requestAnimationFrame(animate);
  }

  resize();
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  canvas.dataset.scene = 'ready';
  onReady();
  raf = requestAnimationFrame(animate);

  return {
    setMode(next) {
      if (!['locked', 'letter', 'explore'].includes(next) || disposed || failed) return;
      const previous = mode;
      mode = next;
      frameTime = 0;
      resetPerformanceWindow();
      controls.enabled = next === 'explore';
      canvas.style.touchAction = next === 'explore' ? 'none' : 'auto';
      updateFraming();
      if (previous !== next && next !== 'locked' && !reducedMotion) {
        tree.updateMatrixWorld(true);
        for (let i = 0; i < (next === 'explore' ? 18 : 12); i++) {
          const center = treeData.tips[Math.floor(random() * treeData.tips.length)].center.clone().applyMatrix4(tree.matrixWorld);
          releasePetal(center, true);
        }
      }
      if (next !== 'explore' || previous !== 'explore') reset();
    },
    reset,
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      uniforms.motion.value = reducedMotion ? 0 : 1;
      frameTime = 0;
      resetPerformanceWindow();
    },
    getProjectionTargets() {
      if (failed || disposed) return null;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const rect = canvas.getBoundingClientRect();
      const screen = world => {
        const p = world.project(camera);
        return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      };
      // Select a frontal, right-hand cluster that is distinct from the trunk and figure.
      const flower = flowerCenters.find(p => p.x > 2 && p.z > -0.2) || flowerCenters[0];
      return {
        figure: screen(figureCenter.clone().applyMatrix4(figure.matrixWorld)),
        flower: screen(flower.clone().applyMatrix4(tree.matrixWorld)),
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        distance: camera.position.distanceTo(controls.target),
        activePetals: petalState.filter(p => p.active).length,
        waving: elapsed - waveStarted >= 0 && elapsed - waveStarted < 3.1,
        waveProgress: THREE.MathUtils.clamp((elapsed - waveStarted) / 3.1, 0, 1),
        wavingArmAngle: rightArm.rotation.z,
        hand: screen(new THREE.Vector3(0.30, -0.40, 0.24).applyMatrix4(rightArm.matrixWorld)),
        pointCount: geometries.reduce((sum, geometry) => sum + (geometry.getAttribute('aSize')?.count || 0), 0),
        performance: {
          renderRateCap: reducedMotion ? 10 : mode === 'explore' ? null : 30,
          downgraded: qualityDowngraded,
          lastAverageFrameMs: lastMeasuredFrameMs,
          windowSamples: measuredFrames,
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      cleanup.forEach(fn => fn());
      controls.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    },
  };
}
