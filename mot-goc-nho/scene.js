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
      uQuietZone: { value: new THREE.Vector4(-2, -2, -1, -1) },
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
      varying vec2 vScreen;
      void main() {
        vec3 p = position;
        float crown = smoothstep(1.4, 6.7, p.y);
        p.x += sin(uTime * 0.42 + p.y * 0.21) * 0.052 * crown * uMotion;
        p.z += cos(uTime * 0.32 + p.y * 0.17) * 0.022 * crown * uMotion;
        p.x += sin(uTime * 0.43 + aPhase + p.y * 0.19) * aSway * uMotion;
        p.z += cos(uTime * 0.31 + aPhase * 0.67) * aSway * 0.6 * uMotion;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vColor = color;
        vDepth = -mv.z;
        vPhase = aPhase;
        gl_Position = projectionMatrix * mv;
        vScreen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
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
      uniform vec4 uQuietZone;
      uniform float uEmission;
      varying vec3 vColor;
      varying float vDepth;
      varying float vPhase;
      varying vec2 vScreen;
      void main() {
        vec2 q = gl_PointCoord - vec2(0.5);
        if (uPetal > 0.5) {
          float angle = uTime * (0.72 + 0.20 * sin(vPhase)) * uMotion + vPhase;
          q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q;
          q.x *= 1.0 + abs(sin(angle * 0.67)) * 0.62;
          q.y *= 1.55;
        }
        float radius = length(q) * 2.0;
        if (radius > 1.0) discard;
        float alpha = (1.0 - smoothstep(0.16, 1.0, radius)) * uOpacity;
        if (uPetal > 0.5) {
          vec2 enter = smoothstep(uQuietZone.xy - vec2(0.018), uQuietZone.xy, vScreen);
          vec2 leave = 1.0 - smoothstep(uQuietZone.zw, uQuietZone.zw + vec2(0.018), vScreen);
          alpha *= 1.0 - 0.96 * enter.x * enter.y * leave.x * leave.y;
        }
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
  let fullReading = false;
  let lyricsLayout = false;
  let raf = 0;
  let frameTime = 0;
  let elapsed = 0;
  const orbitPeriodSeconds = 180;
  const orbitNominalRate = -Math.PI * 2 / orbitPeriodSeconds;
  const orbitResumeDelay = 2;
  const orbitResumeRamp = 1.4;
  const orbitAxis = new THREE.Vector3(0, 1, 0);
  const orbitOffset = new THREE.Vector3();
  const currentViewOffset = new THREE.Vector2();
  const desiredViewOffset = new THREE.Vector2();
  let orbitClock = 0;
  let lastInputAt = -10;
  let lastInputKind = 'none';
  let inputCount = 0;
  let controlInputActive = false;
  let manualViewDirty = false;
  let orbitCurrentRate = 0;
  let orbitTravelRadians = 0;
  let cameraTransition = null;
  let waveStarted = -100;
  let resizeObserver;
  let baseDistance = 23;
  let exploreDistance = 23;
  let treeWidth = 14;
  let treeCenterX = 0;
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;
  let hasSized = false;
  let framingKey = '';
  let safeSceneArea = null;
  let viewportResizeCount = 0;
  const framingBounds = new THREE.Box3();
  let framingProfile = [];
  const profileAnchor = new THREE.Vector2();
  let fitRevision = 0;
  let fitCache = null;
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
    setMode() {}, reset() {}, dispose() {}, setReducedMotion() {}, setReadingLayout() {}, setLyricsLayout() {},
    getProjectionTargets() { return null; },
    getAnimationState() { return null; },
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
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.autoRotate = false;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

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
  const petalMaterial = pointMaterial(uniforms, { opacity: 0.90, sizeMultiplier: 1.38, petal: true });
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
    vertexShader:`uniform float uTime;uniform float uMotion;void main(){vec3 p=position;float c=smoothstep(1.4,6.7,p.y);p.x+=sin(uTime*.42+p.y*.21)*.052*c*uMotion;p.z+=cos(uTime*.32+p.y*.17)*.022*c*uMotion;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
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
  const petalCount = lowQuality ? 96 : 160;
  const petalCloud = new PointCloud(random);
  const petalState = Array.from({ length: petalCount }, (_, i) => {
    petalCloud.point(0, -20, 0, PALETTE.flowers[2 + i % 4], 1.6 + random() * 1.2);
    return { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: petalCloud.phases[i], life: 0, layer: 'crown' };
  });
  const petals = addCloud(petalCloud, petalMaterial);
  petals.frustumCulled = false;
  const petalPositions = petals.geometry.getAttribute('position');
  petalPositions.setUsage(THREE.DynamicDrawUsage);
  let ambientTimer = 0;
  let nextPetal = 0;
  let ambientSpawned = 0;
  let petalQuietTimer = 0;
  const petalQuietZone = petalMaterial.uniforms.uQuietZone.value;
  function ambientInterval() {
    return (mode === 'explore' ? 0.19 : mode === 'letter' ? 0.30 : 0.62) * (lowQuality ? 1.65 : 1);
  }
  function updatePetalQuietZone() {
    petalQuietZone.set(-2, -2, -1, -1);
    if (mode !== 'letter' && !(mode === 'explore' && lyricsLayout)) return;
    const element = document.querySelector(mode === 'explore' ? '#lyrics-zone' : fullReading ? '#letter-scroll' : '#particle-stage');
    if (!element || !element.getClientRects().length) return;
    const rect = element.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    petalQuietZone.set((rect.left - view.left - 10) / view.width, 1 - (rect.bottom - view.top + 10) / view.height,
      (rect.right - view.left + 10) / view.width, 1 - (rect.top - view.top - 10) / view.height);
  }
  function releasePetal(origin, interaction = false, layer = 'crown') {
    const p = petalState[nextPetal];
    nextPetal = (nextPetal + 1) % petalCount;
    Object.assign(p, {
      active: true, x: origin.x + (random() - 0.5) * 0.45, y: origin.y + random() * 0.16,
      z: origin.z + (random() - 0.5) * 0.45,
      vx: (random() - 0.3) * (interaction ? 0.72 : 0.46),
      vy: -(0.46 + random() * 0.42) * (layer === 'near' ? 1.12 : 1), vz: (random() - 0.5) * 0.24,
      life: 16, layer,
    });
  }

  // One draw call, with four reusable streaks at three apparent depths. Test the
  // thin swept path itself: a diagonal's enclosing rectangle can cover empty sky.
  const meteorRandom = seeded(917273);
  const meteorSlots = Array.from({ length: 4 }, () => ({ active: false, age: 0, duration: 1, bounds: null, strength: 0 }));
  const meteorGeometry = new THREE.BufferGeometry();
  const meteorPositions = new THREE.Float32BufferAttribute(new Float32Array(72), 3);
  const meteorStrength = new THREE.Float32BufferAttribute(new Float32Array(24), 1);
  const meteorNear = new THREE.Float32BufferAttribute(new Float32Array(24), 1);
  meteorPositions.setUsage(THREE.DynamicDrawUsage);
  meteorStrength.setUsage(THREE.DynamicDrawUsage);
  meteorNear.setUsage(THREE.DynamicDrawUsage);
  meteorGeometry.setAttribute('position', meteorPositions);
  meteorGeometry.setAttribute('aStrength', meteorStrength);
  meteorGeometry.setAttribute('aNear', meteorNear);
  meteorGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1]).flat(), 2));
  geometries.push(meteorGeometry);
  const meteorMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aStrength;attribute float aNear;varying float vStrength;varying float vNear;varying vec2 vUv;void main(){vStrength=aStrength;vNear=aNear;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying float vStrength;varying float vNear;varying vec2 vUv;void main(){
      float crossDistance=(vUv.y-0.5)*3.8;
      float headDistance=(vUv.x-0.94)*24.0;
      float across=exp(-crossDistance*crossDistance)*(1.0-smoothstep(0.35,0.5,abs(vUv.y-0.5)));
      float trail=smoothstep(0.0,0.18,vUv.x)*pow(vUv.x,1.1)*(1.0-smoothstep(0.94,1.0,vUv.x));
      float head=exp(-headDistance*headDistance);
      vec3 color=mix(vec3(0.40,0.57,0.77),vec3(0.72,0.80,0.92),vNear);
      gl_FragColor=vec4(color,across*(trail*0.64+head*0.64)*vStrength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  materials.push(meteorMaterial);
  const meteors = new THREE.Mesh(meteorGeometry, meteorMaterial);
  meteors.frustumCulled = false;
  meteors.renderOrder = -10;
  meteors.visible = false;
  scene.add(meteors);
  blossoms.geometry.computeBoundingBox();
  const crownBox = blossoms.geometry.boundingBox;
  const crownCorners = [];
  for (const x of [crownBox.min.x, crownBox.max.x]) {
    for (const y of [crownBox.min.y, crownBox.max.y]) {
      for (const z of [crownBox.min.z, crownBox.max.z]) crownCorners.push(new THREE.Vector3(x, y, z));
    }
  }
  const meteorWorld = new THREE.Vector3();
  const meteorRight = new THREE.Vector3();
  const meteorUp = new THREE.Vector3();
  const meteorCenter = new THREE.Vector3();
  const meteorQuadCorners = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
  let meteorTimer = 0;
  let nextMeteorDelay = 1.7;
  let meteorSpawned = 0;
  let meteorLayerCursor = 0;
  let meteorSkipped = 0;
  let meteorPeakActive = 0;
  const meteorTimeline = [];
  let meteorSkyBounds = null;
  let meteorExclusionBounds = [];
  let meteorDomCache = { key: '', at: -1, boxes: [] };
  function segmentHitsBox(ax, ay, bx, by, box, gap) {
    let enter = 0;
    let leave = 1;
    for (const [origin, delta, min, max] of [[ax, bx - ax, box.left - gap, box.right + gap], [ay, by - ay, box.top - gap, box.bottom + gap]]) {
      if (Math.abs(delta) < 0.00001) {
        if (origin < min || origin > max) return false;
      } else {
        const a = (min - origin) / delta;
        const b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) return false;
      }
    }
    return true;
  }
  function meteorSpace(rect) {
    const width = rect.width;
    const height = rect.height;
    // Compact phones may only have sky beside the crown. Keep those narrow
    // corridors available instead of excluding a full-width horizontal band.
    const sky = { left: 7, right: width - 7, top: 8, bottom: height * (width < 900 ? 0.58 : 0.48) };
    const key = `${mode}:${fullReading}:${lyricsLayout}:${width}:${height}:${rect.left}:${rect.top}`;
    if (meteorDomCache.key !== key || elapsed - meteorDomCache.at > 0.2) {
      const boxes = [];
      for (const selector of ['.page-header .wordmark', '.page-header button', '#particle-stage', '#letter-scroll', '.letter-topline .eyebrow', '.letter-topline button', '#lyrics-zone', '.scene-actions', '#dialogue', '#music-root']) {
        const element = document.querySelector(selector);
        if (!element || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
        const box = element.getBoundingClientRect();
        boxes.push({ left: box.left - rect.left, right: box.right - rect.left, top: box.top - rect.top, bottom: box.bottom - rect.top });
      }
      meteorDomCache = { key, at: elapsed, boxes };
    }
    const blocked = [...meteorDomCache.boxes];
    tree.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const crown = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const corner of crownCorners) {
      meteorWorld.copy(corner).applyMatrix4(tree.matrixWorld).project(camera);
      const x = (meteorWorld.x + 1) * width / 2;
      const y = (1 - meteorWorld.y) * height / 2;
      crown.left = Math.min(crown.left, x); crown.right = Math.max(crown.right, x);
      crown.top = Math.min(crown.top, y); crown.bottom = Math.max(crown.bottom, y);
    }
    blocked.push(crown);
    meteorSkyBounds = sky;
    meteorExclusionBounds = blocked;
    return { sky, blocked, crown };
  }
  function updateMeteors(delta) {
    if (reducedMotion || mode === 'locked') {
      for (const slot of meteorSlots) { slot.active = false; slot.bounds = null; }
      meteors.visible = false;
      meteorTimer = 0;
      return;
    }
    meteorTimer += delta;
    const due = meteorTimer >= nextMeteorDelay;
    if (!due && !meteorSlots.some(slot => slot.active)) return;
    const rect = canvas.getBoundingClientRect();
    const { sky, blocked, crown } = meteorSpace(rect);
    const clear = (ax, ay, bx, by, margin = 7) => Math.min(ax, bx) >= sky.left + 2 && Math.max(ax, bx) <= sky.right - 2 && Math.min(ay, by) >= sky.top + 2 && Math.max(ay, by) <= sky.bottom - 2 && !blocked.some(box => segmentHitsBox(ax, ay, bx, by, box, margin));
    const cap = lowQuality || qualityDowngraded ? 3 : 4;
    if (due) {
      meteorTimer = 0;
      nextMeteorDelay = 2.4 + meteorRandom() * 1.8;
      const burst = cap > 3 && meteorSpawned > 0 && meteorRandom() < 0.26 ? 2 : 1;
      for (let burstIndex = 0; burstIndex < burst; burstIndex++) {
        const slot = meteorSlots.slice(0, cap).find(item => !item.active);
        if (!slot) break;
        // A temporarily unfittable layer must not prevent later layers spawning.
        const layer = meteorLayerCursor++ % 3;
        const compact = rect.width < 600;
        const near = layer / 2;
        const baseLength = compact ? 24 + near * 14 : Math.min(122, rect.width * (0.05 + near * 0.032));
        let accepted = false;
        for (let attempt = 0; attempt < 64; attempt++) {
          const sidePath = compact && attempt >= 8 && attempt < 32;
          const topPath = !compact && attempt >= 52;
          const shrink = attempt >= 52 ? 0.48 : attempt >= 40 ? 0.74 : 1;
          let length = baseLength * (0.9 + meteorRandom() * 0.16) * shrink;
          let travel = (compact ? 34 + near * 19 : 110 + near * 78) * shrink;
          const angle = sidePath ? 1.23 + meteorRandom() * 0.12 : 0.36 + meteorRandom() * 0.18;
          const directionX = Math.cos(angle);
          const directionY = Math.sin(angle);
          if (topPath) {
            // A close-up crown can leave only a thin strip at the top. Shorten
            // length and travel together, retaining the layer's width and glow.
            const heightAvailable = crown.top - sky.top - 18;
            if (heightAvailable < 12) continue;
            const fit = Math.min(1, heightAvailable / ((length + travel) * directionY));
            length *= fit;
            travel *= fit;
          }
          const spanX = (length + travel) * directionX;
          const spanY = (length + travel) * directionY;
          const left = sky.left + 3 + Math.max(0, -spanX);
          const right = sky.right - 3 - Math.max(0, spanX);
          const top = sky.top + 3;
          const bottom = sky.bottom - 3 - spanY;
          if (right < left || bottom < top) continue;
          const tailX = sidePath ? (attempt % 4 < 2 ? left : right) : left + meteorRandom() * (right - left);
          const tailY = topPath ? top : sidePath ? THREE.MathUtils.clamp(crown.top + (crown.bottom - crown.top) * (0.50 + meteorRandom() * 0.20), top, bottom) : attempt < 8 ? top + (attempt % 4) * 9 : top + meteorRandom() * (bottom - top);
          if (!clear(tailX, tailY, tailX + spanX, tailY + spanY)) continue;
          Object.assign(slot, {
            active: true, age: -burstIndex * 0.32, duration: 1.55 + near * 0.35 + meteorRandom() * 0.30,
            x: (tailX + directionX * length) / rect.width, y: (tailY + directionY * length) / rect.height,
            travelX: directionX * travel / rect.width, travelY: directionY * travel / rect.height,
            tailX: directionX * length / rect.width, tailY: directionY * length / rect.height,
            directionX, directionY, layer, near, width: 1.35 + near * 0.95,
            peakStrength: 0.64 + near * 0.14, depth: 144 - near * 54, strength: 0, bounds: null, segment: null,
          });
          meteorSpawned++;
          meteorTimeline.push({ time: elapsed + burstIndex * 0.32, layer, length, travel, angle, duration: slot.duration });
          if (meteorTimeline.length > 24) meteorTimeline.shift();
          accepted = true;
          break;
        }
        if (!accepted) meteorSkipped++;
      }
    }
    meteorRight.setFromMatrixColumn(camera.matrixWorld, 0);
    meteorUp.setFromMatrixColumn(camera.matrixWorld, 1);
    let visible = false;
    let activeCount = 0;
    meteorSlots.forEach((slot, slotIndex) => {
      slot.age += slot.active ? delta : 0;
      const progress = Math.max(0, slot.age / slot.duration);
      if (progress >= 1 || slotIndex >= cap) slot.active = false;
      // All three layers stay behind the crown even at the maximum orbit distance.
      const depth = Math.max(slot.depth || 144, camera.position.distanceTo(controls.target) + 25);
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
      camera.getWorldDirection(meteorCenter).multiplyScalar(depth).add(camera.position);
      const headX = (slot.x + slot.travelX * progress) * rect.width;
      const headY = (slot.y + slot.travelY * progress) * rect.height;
      const tailX = headX - slot.tailX * rect.width;
      const tailY = headY - slot.tailY * rect.height;
      const bounds = { left: Math.min(tailX, headX) - 2, right: Math.max(tailX, headX) + 2, top: Math.min(tailY, headY) - 2, bottom: Math.max(tailY, headY) + 2 };
      if (slot.active && !clear(tailX, tailY, headX, headY)) slot.active = false;
      slot.bounds = slot.active ? { left: bounds.left + rect.left, right: bounds.right + rect.left, top: bounds.top + rect.top, bottom: bounds.bottom + rect.top } : null;
      slot.segment = slot.active ? { tailX: tailX + rect.left, tailY: tailY + rect.top, headX: headX + rect.left, headY: headY + rect.top } : null;
      slot.strength = slot.active && slot.age >= 0 ? smoothStep(0, 0.14, progress) * (1 - smoothStep(0.68, 1, progress)) * slot.peakStrength : 0;
      visible ||= slot.strength > 0;
      if (slot.strength > 0) activeCount++;
      for (let vertex = 0; vertex < 6; vertex++) {
        const [end, side] = meteorQuadCorners[vertex];
        const x = tailX + (headX - tailX) * end - side * slot.directionY * slot.width * 0.5;
        const y = tailY + (headY - tailY) * end + side * slot.directionX * slot.width * 0.5;
        // Undo the off-axis projection when placing screen-space meteor quads.
        // Their tested exclusion rectangles therefore remain the actual rendered bounds.
        meteorWorld.copy(meteorCenter)
          .addScaledVector(meteorRight, (x / rect.width * 2 - 1 + currentViewOffset.x * 2) * halfHeight * camera.aspect)
          .addScaledVector(meteorUp, (1 - y / rect.height * 2 - currentViewOffset.y * 2) * halfHeight);
        const index = slotIndex * 6 + vertex;
        meteorPositions.setXYZ(index, slot.active ? meteorWorld.x : 0, slot.active ? meteorWorld.y : 0, slot.active ? meteorWorld.z : 0);
        meteorStrength.setX(index, slot.strength);
        meteorNear.setX(index, slot.near || 0);
      }
    });
    meteorPeakActive = Math.max(meteorPeakActive, activeCount);
    meteorPositions.needsUpdate = true;
    meteorStrength.needsUpdate = true;
    meteorNear.needsUpdate = true;
    meteors.visible = visible;
  }

  const initialCamera = new THREE.Vector3();
  const initialTarget = new THREE.Vector3(0, 4.17, 0);
  function applyViewOffset(offset) {
    currentViewOffset.copy(offset);
    if (Math.abs(offset.x) + Math.abs(offset.y) < 0.000001) camera.clearViewOffset();
    else camera.setViewOffset(viewportWidth, viewportHeight, offset.x * viewportWidth, offset.y * viewportHeight, viewportWidth, viewportHeight);
  }
  function reservedSceneArea(rect) {
    if (mode !== 'explore') return null;
    const landscape = window.matchMedia('(min-width:600px) and (max-width:899px) and (max-height:500px)').matches;
    const sideBySide = landscape || rect.width >= 900;
    let left = 12;
    const right = rect.width - 12;
    let top = 16;
    let bottom = Math.min(rect.height, window.innerHeight - rect.top) - 16;
    for (const selector of ['.page-header', '#lyrics-zone', '.scene-caption']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element);
      let box;
      if (selector === '#lyrics-zone' && lyricsLayout && !element.getClientRects().length) {
        // Instrumental gaps hide the glyphs, not their reserved sky. The fixed
        // CSS box remains stable when the next timed lyric becomes visible.
        // Measure an empty, nonpainting sibling so %, min() and calc() resolve
        // exactly like the visible box without briefly exposing its contents.
        const measure = element.cloneNode(false);
        measure.removeAttribute('id');
        measure.hidden = false;
        measure.setAttribute('aria-hidden', 'true');
        measure.style.setProperty('visibility', 'hidden', 'important');
        measure.style.setProperty('pointer-events', 'none', 'important');
        element.parentElement.appendChild(measure);
        try { box = measure.getBoundingClientRect(); } finally { measure.remove(); }
      } else {
        if (!element.getClientRects().length || style.visibility === 'hidden') continue;
        box = element.getBoundingClientRect();
      }
      if (selector !== '.page-header' && sideBySide) left = Math.max(left, box.right - rect.left + 18);
      else top = Math.max(top, box.bottom - rect.top + 12);
    }
    for (const selector of ['.explore-bottom', '#music-root']) {
      const element = document.querySelector(selector);
      if (!element?.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      if (box.right - rect.left <= left || box.left - rect.left >= right) continue;
      if (box.top < rect.bottom && box.bottom > rect.top) bottom = Math.min(bottom, box.top - rect.top - 14);
    }
    return { left, right, top, bottom };
  }
  function safeAreaKey(area) {
    return area ? [area.left, area.right, area.top, area.bottom].map(value => value.toFixed(1)).join(':') : '';
  }
  function buildFramingProfile() {
    // Cache a tight envelope by height. The wide crown must not invent an equally
    // wide cylinder at ground level, which would unnecessarily shrink the tree.
    profileAnchor.set(treeCenterX * 0.8 - treeWidth * 0.055, treeWidth * 0.025);
    const bins = Array.from({ length: 24 }, () => ({ minY: Infinity, maxY: -Infinity, radius: 0 }));
    const span = Math.max(1, framingBounds.max.y - framingBounds.min.y);
    const point = new THREE.Vector3();
    for (const root of [tree, figure, succulent]) {
      root.updateMatrixWorld(true);
      root.traverse(object => {
        const position = object.geometry?.getAttribute('position');
        if (!position) return;
        for (let index = 0; index < position.count; index++) {
          point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
          const bin = bins[THREE.MathUtils.clamp(Math.floor((point.y - framingBounds.min.y) / span * bins.length), 0, bins.length - 1)];
          bin.minY = Math.min(bin.minY, point.y);
          bin.maxY = Math.max(bin.maxY, point.y);
          bin.radius = Math.max(bin.radius, Math.hypot(point.x - profileAnchor.x, point.z - profileAnchor.y));
        }
      });
    }
    framingProfile = bins.filter(bin => Number.isFinite(bin.minY)).map(bin => ({ minY: bin.minY - 0.07, maxY: bin.maxY + 0.07, radius: bin.radius + 0.09 }));
  }
  function fitDistance(polar, target = initialTarget, offset = desiredViewOffset) {
    if (!safeSceneArea) return 0;
    if (fitCache?.revision === fitRevision && Math.abs(fitCache.polar - polar) < 0.000001 && fitCache.target.distanceToSquared(target) < 0.000000001 && fitCache.offset.distanceToSquared(offset) < 0.000000001) return fitCache.distance;
    // Each circular slice is invariant under azimuth. Its support distance fits
    // every turn, including the closest permitted pinch zoom and tilted views.
    const pivotX = (0.5 - offset.x) * viewportWidth;
    const pivotY = (0.5 - offset.y) * viewportHeight;
    const horizontal = Math.min(pivotX - safeSceneArea.left, safeSceneArea.right - pivotX) * 2 / viewportWidth;
    const vertical = [(pivotY - safeSceneArea.top) * 2 / viewportHeight, (safeSceneArea.bottom - pivotY) * 2 / viewportHeight];
    if (horizontal <= 0 || vertical.some(value => value <= 0)) return 0;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const sin = Math.sin(polar), cos = Math.cos(polar);
    const anchorShift = Math.hypot(profileAnchor.x - target.x, profileAnchor.y - target.z);
    let distance = 0;
    for (const bin of framingProfile) {
      const radius = bin.radius + anchorShift;
      for (const y of [bin.minY - target.y, bin.maxY - target.y]) {
        distance = Math.max(distance, y * cos + radius * Math.hypot(sin, 1 / (horizontal * tan * camera.aspect)));
        for (const [index, sign] of [[0, 1], [1, -1]]) {
          const scale = 1 / (vertical[index] * tan);
          distance = Math.max(distance, y * (cos + sign * sin * scale) + radius * Math.abs(sin - sign * cos * scale));
        }
      }
    }
    distance *= 1.015;
    fitCache = { revision: fitRevision, polar, target: target.clone(), offset: offset.clone(), distance };
    return distance;
  }
  function enforceSafeFit() {
    if (!safeSceneArea || cameraTransition) return;
    const distance = camera.position.distanceTo(controls.target);
    const required = fitDistance(controls.getPolarAngle(), controls.target, currentViewOffset);
    if (!required) return;
    controls.minDistance = required;
    controls.maxDistance = Math.max(baseDistance * 1.33, required * 1.18);
    if (distance < required) {
      camera.position.sub(controls.target).multiplyScalar(required / distance).add(controls.target);
      controls.update();
    }
  }
  function updateFraming() {
    fitRevision++;
    // A small physical offset gives a genuine orbit around an off-trunk anchor.
    // Composition uses an off-axis projection rather than a far-away orbit pivot,
    // so a complete revolution does not sweep the crown across the lyric column.
    const anchorX = treeCenterX * 0.8 - treeWidth * 0.055;
    const anchorZ = treeWidth * 0.025;
    safeSceneArea = reservedSceneArea(canvas.getBoundingClientRect());
    desiredViewOffset.set(0, 0);
    const introductionAtSide = (mode === 'locked' || mode === 'letter' || (mode === 'explore' && lyricsLayout)) && viewportWidth >= 900;
    if (introductionAtSide) {
      const visibleWidth = treeWidth * 1.34 / 0.61;
      baseDistance = Math.max(exploreDistance, visibleWidth / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      initialTarget.set(anchorX, 4.48, anchorZ);
      desiredViewOffset.set(-0.20, 0);
    } else if (mode === 'letter') {
      {
        baseDistance = exploreDistance * 1.35;
        const skyOffset = canvas.getBoundingClientRect().height < 680 ? 0.27 : 0.23;
        initialTarget.set(anchorX, 4.4, anchorZ);
        desiredViewOffset.set(0, skyOffset);
      }
    } else if (mode === 'explore' && safeSceneArea) {
      // Measure the actual lyric/control layout, including browser UI height and
      // a missing lyrics module, rather than assuming one portrait aspect ratio.
      initialTarget.set(anchorX, (framingBounds.min.y + framingBounds.max.y) / 2, anchorZ);
      desiredViewOffset.set(0.5 - (safeSceneArea.left + safeSceneArea.right) / (2 * viewportWidth), 0.5 - (safeSceneArea.top + safeSceneArea.bottom) / (2 * viewportHeight));
      baseDistance = Math.max(exploreDistance, fitDistance(Math.atan2(1, 0.095))) * 1.06;
    } else {
      baseDistance = exploreDistance;
      initialTarget.set(anchorX, isPortrait ? 4.70 : 4.26, anchorZ);
    }
    const elevation = mode === 'letter' && viewportWidth < 900 ? 0.17 : 0.095;
    initialCamera.set(initialTarget.x + (isPortrait ? 0.40 : 1.45), initialTarget.y + baseDistance * elevation, initialTarget.z + baseDistance);
    controls.minDistance = safeSceneArea ? fitDistance(Math.atan2(1, elevation)) : baseDistance * 0.63;
    controls.maxDistance = baseDistance * 1.33;
    framingKey = safeAreaKey(safeSceneArea);
  }
  function resize(forceLayout = false) {
    if (disposed || failed) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    const sizeChanged = !hasSized || Math.abs(width - viewportWidth) > 0.25 || Math.abs(height - viewportHeight) > 0.25;
    const reservedChanged = framingKey !== safeAreaKey(reservedSceneArea(rect));
    // Mobile browser toolbars can dispatch resize while a 100svh canvas is
    // unchanged. Do not reset its orbit, buffers, or camera in that case.
    if (!sizeChanged && !reservedChanged && forceLayout !== true) return;
    const oldBaseDistance = baseDistance;
    const oldOffset = camera.position.clone().sub(controls.target);
    const preserveView = hasSized && interactiveMode() && oldOffset.lengthSq() > 0;
    const wasPortrait = isPortrait;
    viewportWidth = width;
    viewportHeight = height;
    isPortrait = width / height < 0.82;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (sizeChanged) {
      const dpr = Math.min(window.devicePixelRatio || 1, qualityDowngraded ? 1 : lowQuality ? 1.15 : isPortrait ? 1.55 : 1.8);
      renderer.setPixelRatio(dpr);
      uniforms.pixelRatio.value = dpr;
      renderer.setSize(width, height, false);
      viewportResizeCount++;
    }
    tree.scale.set(isPortrait ? 0.84 : 1.13, isPortrait ? 1.03 : 0.92, 1);
    figure.scale.setScalar(isPortrait ? 1.02 : 0.85);
    succulent.scale.setScalar(isPortrait ? 0.91 : 0.77);
    tree.updateMatrixWorld(true);
    const treeBounds = new THREE.Box3().setFromObject(tree);
    framingBounds.copy(treeBounds);
    for (const root of [figure, succulent]) framingBounds.union(new THREE.Box3().setFromObject(root));
    const treeSize = treeBounds.getSize(new THREE.Vector3());
    const treeCenter = treeBounds.getCenter(new THREE.Vector3());
    treeWidth = treeSize.x;
    treeCenterX = treeCenter.x;
    if (!framingProfile.length || wasPortrait !== isPortrait) buildFramingProfile();
    // Fit the broad crown by width while preserving a recognizable foreground figure.
    const widthToFit = isPortrait ? treeSize.x * 1.12 : Math.max(15.0, treeSize.x * 1.06);
    const horizontalDistance = widthToFit / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    exploreDistance = Math.max(isPortrait ? 23 : 19.7, horizontalDistance + (isPortrait ? Math.max(0, treeBounds.max.z) * 0.60 : 0));
    updateFraming();
    controls.target.copy(initialTarget);
    if (preserveView) {
      const nextDistance = THREE.MathUtils.clamp(oldOffset.length() * baseDistance / oldBaseDistance, controls.minDistance, controls.maxDistance);
      camera.position.copy(initialTarget).add(oldOffset.normalize().multiplyScalar(nextDistance));
    } else camera.position.copy(initialCamera);
    applyViewOffset(desiredViewOffset);
    controls.update();
    cameraTransition = null;
    enforceSafeFit();
    hasSized = true;
  }

  function reset() {
    if (disposed || failed) return;
    manualViewDirty = false;
    lastInputAt = orbitClock;
    orbitCurrentRate = 0;
    const resetPolar = Math.acos((initialCamera.y - initialTarget.y) / initialCamera.distanceTo(initialTarget));
    // A tilted close-up can have a larger safety radius than the initial view.
    // Restore the initial bounds before controls update the reset transition.
    controls.minDistance = safeSceneArea ? fitDistance(resetPolar, initialTarget, desiredViewOffset) : baseDistance * 0.63;
    controls.maxDistance = Math.max(baseDistance * 1.33, controls.minDistance * 1.18);
    if (reducedMotion) {
      camera.position.copy(initialCamera);
      controls.target.copy(initialTarget);
      applyViewOffset(desiredViewOffset);
      controls.update();
    } else {
      cameraTransition = { start: elapsed, fromCamera: camera.position.clone(), fromTarget: controls.target.clone(), fromViewOffset: currentViewOffset.clone() };
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Set();
  let tap = null;
  function interactiveMode() { return mode === 'letter' || mode === 'explore'; }
  function registerInput(kind) {
    if (!interactiveMode() || failed || disposed) return;
    cameraTransition = null;
    orbitCurrentRate = 0;
    lastInputAt = orbitClock;
    lastInputKind = kind;
    inputCount++;
    manualViewDirty = true;
  }
  function controlsStart() { controlInputActive = true; registerInput('controls-start'); }
  function controlsEnd() { controlInputActive = false; registerInput('controls-end'); }
  controls.addEventListener('start', controlsStart);
  controls.addEventListener('end', controlsEnd);
  cleanup.push(() => { controls.removeEventListener('start', controlsStart); controls.removeEventListener('end', controlsEnd); });
  const figureCenter = new THREE.Vector3(0.03, 0.88, 0.22);
  const flowerCenters = treeData.tips.map(tip => tip.center.clone());
  function canvasToRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray;
  }
  function pointerDown(event) {
    if (!interactiveMode()) return;
    registerInput(event.pointerType === 'touch' ? 'touch-start' : 'pointer-start');
    pointers.add(event.pointerId);
    tap = pointers.size === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() } : null;
  }
  function pointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    // Once a gesture leaves the tap tolerance, returning to its start cannot re-arm it.
    if (tap && (pointers.size !== 1 || tap.id !== event.pointerId || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8)) tap = null;
    registerInput(event.pointerType === 'touch' ? 'touch-move' : 'pointer-move');
  }
  function pointerUp(event) {
    const wasTap = tap && tap.id === event.pointerId && pointers.size === 1 && performance.now() - tap.time < 650 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 8;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) controlInputActive = false;
    if (interactiveMode()) registerInput(event.pointerType === 'touch' ? 'touch-end' : 'pointer-end');
    tap = null;
    if (!wasTap || !interactiveMode() || failed) return;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
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
  function pointerCancel(event) { pointers.delete(event.pointerId); if (pointers.size === 0) controlInputActive = false; tap = null; registerInput('pointer-cancel'); }
  function wheelInput() { registerInput('wheel'); }
  // Capture runs before OrbitControls' handlers: auto motion and reset interpolation
  // stop at the existing camera pose before the gesture can move that pose.
  canvas.addEventListener('pointerdown', pointerDown, { passive: true, capture: true });
  canvas.addEventListener('pointermove', pointerMove, { passive: true, capture: true });
  canvas.addEventListener('pointerup', pointerUp, { passive: true, capture: true });
  canvas.addEventListener('pointercancel', pointerCancel, { passive: true, capture: true });
  canvas.addEventListener('wheel', wheelInput, { passive: true, capture: true });
  cleanup.push(() => {
    canvas.removeEventListener('pointerdown', pointerDown, true);
    canvas.removeEventListener('pointermove', pointerMove, true);
    canvas.removeEventListener('pointerup', pointerUp, true);
    canvas.removeEventListener('pointercancel', pointerCancel, true);
    canvas.removeEventListener('wheel', wheelInput, true);
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
    orbitCurrentRate = 0;
    lastInputAt = orbitClock;
    pointers.clear();
    tap = null;
    controlInputActive = false;
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
    for (const selector of ['.page-header', '#lyrics-zone', '.explore-bottom', '#music-root']) {
      const element = document.querySelector(selector);
      if (element) resizeObserver.observe(element);
    }
  }

  function animate(now) {
    if (disposed || failed || document.hidden) return;
    // Reading remains economical while idle; direct gestures and their short damping
    // tail render at full rate so letter-mode touch is as responsive as exploration.
    const activeReadingInput = mode === 'letter' && (controlInputActive || pointers.size > 0 || orbitClock - lastInputAt < 0.8);
    const minimumInterval = reducedMotion ? 100 : mode === 'explore' || activeReadingInput ? 0 : 1000 / 30;
    if (frameTime && now - frameTime < minimumInterval) {
      raf = requestAnimationFrame(animate);
      return;
    }
    const rawDelta = frameTime ? (now - frameTime) / 1000 : 0;
    const delta = rawDelta ? Math.min(rawDelta, reducedMotion ? 0.15 : 0.06) : 1 / 60;
    const orbitDelta = rawDelta ? Math.min(rawDelta, 0.25) : 1 / 60;
    orbitClock += orbitDelta;
    frameTime = now;
    elapsed += delta;
    uniforms.time.value = elapsed;
    const targetExposure = 1.07;
    uniforms.exposure.value = reducedMotion ? targetExposure : THREE.MathUtils.lerp(uniforms.exposure.value, targetExposure, 1 - Math.exp(-delta * 3.2));
    if (cameraTransition) {
      const t = smoothStep(0, 1.15, elapsed - cameraTransition.start);
      camera.position.lerpVectors(cameraTransition.fromCamera, initialCamera, t);
      controls.target.lerpVectors(cameraTransition.fromTarget, initialTarget, t);
      applyViewOffset(new THREE.Vector2().lerpVectors(cameraTransition.fromViewOffset, desiredViewOffset, t));
      if (t >= 1) cameraTransition = null;
    }
    const eligible = mode === 'explore' && !reducedMotion;
    const idleSeconds = Math.max(0, orbitClock - lastInputAt);
    orbitCurrentRate = eligible && !cameraTransition && !controlInputActive && pointers.size === 0
      ? orbitNominalRate * smoothStep(orbitResumeDelay, orbitResumeDelay + orbitResumeRamp, idleSeconds)
      : 0;
    if (orbitCurrentRate !== 0) {
      const angle = orbitCurrentRate * orbitDelta;
      orbitOffset.copy(camera.position).sub(controls.target).applyAxisAngle(orbitAxis, angle);
      camera.position.copy(controls.target).add(orbitOffset);
      orbitTravelRadians += angle;
    }
    controls.update();
    enforceSafeFit();
    // The camera makes the orbit. Geometry stays rooted; only its existing shader wind moves.
    tree.rotation.y = 0;
    const waveAge = elapsed - waveStarted;
    if (waveAge < 3.1) {
      const lift = smoothStep(0, 0.42, waveAge) * (1 - smoothStep(2.45, 3.1, waveAge));
      rightArm.rotation.z = lift * (1.88 + (reducedMotion ? 0 : Math.sin(waveAge * 8) * 0.13));
    } else rightArm.rotation.z = 0;
    figure.rotation.z = reducedMotion || mode !== 'explore' ? 0 : Math.sin(elapsed * 0.85) * 0.003;
    petalQuietTimer -= delta;
    if (petalQuietTimer <= 0) {
      updatePetalQuietZone();
      petalQuietTimer = 0.35;
    }
    if (!reducedMotion) {
      ambientTimer += delta;
      const interval = ambientInterval();
      if (ambientTimer > interval) {
        ambientTimer -= interval;
        const tip = treeData.tips[Math.floor(random() * treeData.tips.length)].center.clone();
        tree.updateMatrixWorld();
        tip.applyMatrix4(tree.matrixWorld);
        const depthRoll = random();
        let layer = 'crown';
        if (depthRoll < 0.18) {
          layer = 'near';
          tip.z += 3.5 + random() * 3;
          tip.x += (random() - 0.5) * 2;
        } else if (depthRoll > 0.78) {
          layer = 'far';
          tip.z -= 2.5 + random() * 2.5;
        }
        releasePetal(tip, false, layer);
        ambientSpawned++;
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
      p.vy = Math.max(-1.32, p.vy - delta * 0.060);
      p.x += (p.vx + Math.sin(elapsed * 0.95 + p.phase) * 0.23 + Math.sin(elapsed * 0.24) * 0.10) * delta;
      p.y += p.vy * delta;
      p.z += (p.vz + Math.cos(elapsed * 0.72 + p.phase) * 0.09) * delta;
      if (p.life <= 0 || p.y < 0.02) { p.active = false; p.y = -20; }
      petalPositions.setXYZ(i, p.x, p.y, p.z);
      changed = true;
    }
    if (changed) petalPositions.needsUpdate = true;
    updateMeteors(delta);
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

  function getOrbitState() {
    const eligible = mode === 'explore' && !reducedMotion && !document.hidden;
    return {
      eligible, active: eligible && orbitCurrentRate !== 0,
      direction: 'clockwise', periodSeconds: orbitPeriodSeconds,
      nominalRate: orbitNominalRate, currentRate: orbitCurrentRate,
      travelRadians: orbitTravelRadians, azimuth: controls.getAzimuthalAngle(),
      anchor: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      trunk: { x: tree.position.x, y: tree.position.y, z: tree.position.z },
      projectionOffset: { x: currentViewOffset.x, y: currentViewOffset.y },
      inputActive: controlInputActive || pointers.size > 0, pointerCount: pointers.size,
      inputCount, lastInputKind, idleSeconds: Math.max(0, orbitClock - lastInputAt),
      resumeDelaySeconds: orbitResumeDelay, resumeRampSeconds: orbitResumeRamp,
      transitioning: Boolean(cameraTransition),
      viewportResizeCount, safeSceneArea: safeSceneArea ? { ...safeSceneArea } : null,
      minDistance: controls.minDistance, maxDistance: controls.maxDistance, baseDistance,
    };
  }

  function getAnimationState() {
    if (failed || disposed) return null;
    const activePetals = petalState.filter(p => p.active);
    return {
      elapsed, mode, reducedMotion, lyricsLayout, hidden: document.hidden,
      treeRotationY: tree.rotation.y, maximumTreeDrift: 0,
      autoOrbit: getOrbitState(),
      swayAmplitude: reducedMotion ? 0 : 0.052,
      activePetals: activePetals.length,
      petalCapacity: petalCount, ambientSpawned, ambientInterval: ambientInterval(),
      petalQuietZone: petalQuietZone.toArray(),
      petalLayers: ['far', 'crown', 'near'].map(layer => ({ layer, count: activePetals.filter(p => p.layer === layer).length })),
      petalSamples: activePetals.slice(0, 8).map(p => ({ x: p.x, y: p.y, z: p.z, layer: p.layer, rotation: elapsed * (0.72 + 0.20 * Math.sin(p.phase)) + p.phase })),
      averagePetalFallSpeed: activePetals.reduce((sum, p) => sum - p.vy / activePetals.length, 0),
      meteorVisible: meteors.visible, meteorSpawned,
      meteorCapacity: lowQuality || qualityDowngraded ? 3 : 4,
      meteorPeakActive, meteorSkipped, meteorAttempted: meteorLayerCursor, meteorNextIn: Math.max(0, nextMeteorDelay - meteorTimer),
      meteorTimeline: meteorTimeline.map(item => ({ ...item })),
      meteorSkyBounds: meteorSkyBounds ? { ...meteorSkyBounds } : null,
      meteorExclusionBounds: meteorExclusionBounds.map(bounds => ({ ...bounds })),
      meteors: meteorSlots.filter(p => p.active).map(p => ({ age: p.age, duration: p.duration, layer: ['far', 'middle', 'near'][p.layer], depth: p.depth, width: p.width, strength: p.strength, segment: p.segment ? { ...p.segment } : null, bounds: p.bounds ? { ...p.bounds } : null })),
    };
  }

  resize();
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  canvas.dataset.scene = 'ready';
  onReady();
  raf = requestAnimationFrame(animate);

  return {
    getAnimationState,
    setLyricsLayout(value) {
      if (disposed || failed || lyricsLayout === Boolean(value)) return;
      lyricsLayout = Boolean(value);
      if (mode === 'explore') resize(true);
    },
    setReadingLayout(value) {
      if (disposed || failed || fullReading === Boolean(value)) return;
      fullReading = Boolean(value);
      if (mode === 'letter') { updateFraming(); if (!manualViewDirty) reset(); }
    },
    setMode(next) {
      if (!['locked', 'letter', 'explore'].includes(next) || disposed || failed) return;
      const previous = mode;
      if (previous === next) return;
      mode = next;
      manualViewDirty = false;
      pointers.clear();
      tap = null;
      controlInputActive = false;
      orbitCurrentRate = 0;
      lastInputAt = orbitClock;
      frameTime = 0;
      resetPerformanceWindow();
      controls.enabled = next === 'letter' || next === 'explore';
      canvas.style.touchAction = controls.enabled ? 'none' : 'auto';
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
      orbitCurrentRate = 0;
      lastInputAt = orbitClock;
      if (reducedMotion) cameraTransition = null;
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
      const bounds = new THREE.Box3().setFromObject(tree);
      const corners = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(screen(new THREE.Vector3(x, y, z)));
      const crown = crownCorners.map(point => screen(point.clone().applyMatrix4(tree.matrixWorld)));
      const projectedContent = root => {
        const result = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        const point = new THREE.Vector3();
        root.traverse(object => {
          const positions = object.geometry?.getAttribute('position');
          if (!positions) return;
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(camera);
            const x = rect.left + (point.x + 1) * rect.width / 2;
            const y = rect.top + (1 - point.y) * rect.height / 2;
            result.left = Math.min(result.left, x); result.right = Math.max(result.right, x);
            result.top = Math.min(result.top, y); result.bottom = Math.max(result.bottom, y);
          }
        });
        return { left: result.left - 4, right: result.right + 4, top: result.top - 4, bottom: result.bottom + 4 };
      };
      return {
        treeBounds: projectedContent(tree),
        crownBounds: projectedContent(blossoms),
        treeBoxBounds: {left: Math.min(...corners.map(p=>p.x)), right: Math.max(...corners.map(p=>p.x)), top: Math.min(...corners.map(p=>p.y)), bottom: Math.max(...corners.map(p=>p.y))},
        crownBoxBounds: {left: Math.min(...crown.map(p=>p.x)), right: Math.max(...crown.map(p=>p.x)), top: Math.min(...crown.map(p=>p.y)), bottom: Math.max(...crown.map(p=>p.y))},
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
        autoOrbit: getOrbitState(),
        animation: typeof getAnimationState === 'function' ? getAnimationState() : null,
        performance: {
          renderRateCap: reducedMotion ? 10 : mode === 'explore' || (mode === 'letter' && (controlInputActive || pointers.size > 0 || orbitClock - lastInputAt < 0.8)) ? null : 30,
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
