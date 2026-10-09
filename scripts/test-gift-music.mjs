import assert from 'node:assert/strict';
import { parseMusicSource, createMusic } from '../mot-goc-nho/music.js';

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`PASS ${name}`);
}
const base = 'https://verdefsoft.me/mot-goc-nho/';
const mp3 = (sourceUrl, extra = {}) => parseMusicSource({ sourceType: 'mp3', sourceUrl, ...extra }, base);
const youtube = (sourceUrl) => parseMusicSource({ sourceType: 'youtube', sourceUrl }, base);

check('empty and disabled sources make no active source', () => {
  assert.equal(mp3('').status, 'empty');
  assert.equal(mp3('   ').status, 'empty');
  assert.equal(mp3('https://example.com/song.mp3', { enabled: false }).status, 'disabled');
});
check('relative MP3 stays inside the deployed gift URL', () => {
  assert.equal(mp3('./assets/music.mp3').sourceUrl, `${base}assets/music.mp3`);
  assert.equal(mp3('assets/Bài hát.MP3').status, 'ready');
});
check('local development allows relative files on HTTP', () => {
  assert.equal(parseMusicSource({ sourceType: 'mp3', sourceUrl: './assets/music.mp3' }, 'http://localhost:4186/mot-goc-nho/').status, 'ready');
});
check('direct HTTPS and signed extensionless audio endpoints are accepted', () => {
  assert.equal(mp3('https://audio.example.com/song.mp3?token=example').status, 'ready');
  assert.equal(mp3('https://audio.example.com/media/123?format=mp3').status, 'ready');
});
check('unsafe schemes, userinfo, protocol-relative and control characters rejected', () => {
  for (const link of ['http://example.com/song.mp3', '//example.com/song.mp3', 'javascript:alert(1)', 'data:audio/mp3;base64,x', 'file:///song.mp3', 'https://user:pass@example.com/song.mp3', 'assets\\song.mp3', 'https://example.com/\nsong.mp3']) {
    assert.equal(mp3(link).status, 'invalid', link);
  }
});
check('sharing and preview pages are not treated as MP3 sources', () => {
  for (const link of ['https://drive.google.com/file/d/123/view', 'https://www.dropbox.com/s/123/song.mp3?dl=0', 'https://1drv.ms/u/123', 'https://onedrive.live.com/123', 'https://example.com/share/123', 'https://example.com/player.html', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', './preview']) {
    assert.equal(mp3(link).status, 'invalid', link);
  }
});
check('YouTube watch and short links resolve to the same video', () => {
  for (const link of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&list=ignored', 'https://youtube.com/watch?v=M7lc1UVf-VE', 'https://m.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE?si=ignored']) {
    assert.equal(youtube(link).videoId, 'M7lc1UVf-VE', link);
  }
});
check('YouTube rejects deceptive hosts, invalid IDs and unsupported forms', () => {
  for (const link of ['https://youtube.com.evil.example/watch?v=M7lc1UVf-VE', 'https://evil.example/youtu.be/M7lc1UVf-VE', 'https://youtu.be/short', 'http://youtu.be/M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE/extra', 'https://www.youtube.com/watch?v=M7lc1UVf-VE!', 'https://www.youtube.com:444/watch?v=M7lc1UVf-VE']) {
    assert.equal(youtube(link).status, 'invalid', link);
  }
});
check('volume defaults, clamping and loop settings are deterministic', () => {
  assert.equal(mp3('./assets/music.mp3').volume, 0.25);
  assert.equal(mp3('./assets/music.mp3', { volume: NaN }).volume, 0.25);
  assert.equal(mp3('./assets/music.mp3', { volume: -3 }).volume, 0);
  assert.equal(mp3('./assets/music.mp3', { volume: 7 }).volume, 1);
  assert.equal(mp3('./assets/music.mp3').loop, true);
  assert.equal(mp3('./assets/music.mp3', { loop: false }).loop, false);
});

// These simulations verify controller ordering and intent handling. They are
// not evidence of audible playback or real mobile-browser autoplay behavior.
class FakeNode extends EventTarget {
  constructor(tag) {
    super(); this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this.attributes = {}; this.textContent = ''; this.hidden = false; this.isConnected = true;
    this.classList = { add() {}, remove() {} };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelector(selector) {
    return this.children.find((child) => `.${child.className}` === selector)
      || this.children.map((child) => child.querySelector?.(selector)).find(Boolean);
  }
  getBoundingClientRect() { return { ...playerBounds }; }
}
let playerBounds = { left: 10, top: 10, right: 370, bottom: 220, width: 360, height: 210 };
let playMode = 'blocked';
let mediaCalls = 0;
let lastAudio;
class FakeAudio extends FakeNode {
  constructor() {
    super('audio'); this.volume = 1; this.paused = true; this.ended = false;
    this.readyState = 4; this.error = null; this.muted = false;
  }
  play() {
    mediaCalls += 1;
    if (playMode === 'blocked') return Promise.reject(Object.assign(new Error('policy'), { name: 'NotAllowedError' }));
    if (playMode === 'broken') return Promise.reject(Object.assign(new Error('decode'), { name: 'NotSupportedError' }));
    this.paused = false;
    return Promise.resolve().then(() => { if (!this.paused) this.dispatchEvent(new Event('playing')); });
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load() {}
}
const originalGlobals = new Map();
function install(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const fakeDocument = Object.assign(new EventTarget(), {
  baseURI: base, hidden: false, body: new FakeNode('body'),
  createElement: (tag) => tag === 'audio' ? (lastAudio = new FakeAudio()) : new FakeNode(tag),
  createTextNode: (text) => Object.assign(new FakeNode('#text'), { textContent: text }),
});
install('document', fakeDocument);
install('navigator', { userAgent: 'music-controller-unit-simulation' });
install('requestAnimationFrame', () => 1);
install('cancelAnimationFrame', () => {});
const flush = () => new Promise((resolve) => setImmediate(resolve));

try {
  const root = new FakeNode('div');
  const controller = createMusic({ sourceType: 'mp3', sourceUrl: './assets/music.mp3', title: 'Test audio' }, { root });
  controller.init();
  await flush();
  check('blocked autoplay has truthful state and one initial attempt', () => {
    assert.equal(mediaCalls, 1);
    assert.equal(controller.getState().status, 'blocked');
    assert.equal(controller.getState().playing, false);
    assert.equal(root.querySelector('.music-play').textContent, 'Bật nhạc');
  });
  playMode = 'success';
  controller.onOpenGesture();
  check('open gesture invokes media.play synchronously before asynchronous work', () => {
    assert.equal(mediaCalls, 2);
    assert.equal(controller.getState().playing, false);
  });
  await flush();
  check('playing event updates controls only after successful start', () => {
    assert.equal(controller.getState().playing, true);
    assert.equal(root.querySelector('.music-play').textContent, 'Tạm dừng');
  });
  const persistentAudio = lastAudio;
  controller.onOpenGesture();
  check('repeat opening/view changes neither recreate nor restart playback', () => {
    assert.equal(mediaCalls, 2);
    assert.equal(lastAudio, persistentAudio);
  });
  root.querySelector('.music-mute').dispatchEvent(new Event('click'));
  check('mute preserves playback and records explicit silence', () => {
    assert.equal(controller.getState().muted, true);
    assert.equal(controller.getState().userMuted, true);
    assert.equal(lastAudio.muted, true);
  });
  root.querySelector('.music-play').dispatchEvent(new Event('click'));
  controller.onOpenGesture();
  await flush();
  check('explicit pause is immediate and never undone by other opening gestures', () => {
    assert.equal(lastAudio.paused, true);
    assert.equal(controller.getState().userPaused, true);
    assert.equal(controller.getState().playing, false);
    assert.equal(mediaCalls, 2);
  });
  playMode = 'broken';
  root.querySelector('.music-play').dispatchEvent(new Event('click'));
  await flush();
  check('source error becomes a quiet manual retry state', () => {
    assert.equal(controller.getState().status, 'error');
    assert.equal(controller.getState().playing, false);
    assert.equal(root.querySelector('.music-play').textContent, 'Thử lại');
  });
  controller.dispose();
  check('dispose hides controls and leaves no playing element', () => {
    assert.equal(root.hidden, true);
    assert.equal(root.children.length, 0);
    assert.equal(lastAudio.paused, true);
  });
  const callsBeforeEmpty = mediaCalls;
  const emptyRoot = new FakeNode('div');
  const empty = createMusic({ sourceType: 'youtube', sourceUrl: '' }, { root: emptyRoot });
  empty.init(); empty.onOpenGesture();
  check('empty configuration does not create a player or expose a useless control', () => {
    assert.equal(emptyRoot.hidden, true);
    assert.equal(emptyRoot.children.length, 0);
    assert.equal(mediaCalls, callsBeforeEmpty);
    assert.equal(empty.getState().status, 'empty');
  });
  empty.dispose();

  playMode = 'success';
  const pausedRoot = new FakeNode('div');
  const pausedBeforeOpen = createMusic({ sourceType: 'mp3', sourceUrl: './assets/music.mp3' }, { root: pausedRoot });
  pausedBeforeOpen.init();
  await flush();
  pausedRoot.querySelector('.music-play').dispatchEvent(new Event('click'));
  const callsBeforeFirstOpening = mediaCalls;
  pausedBeforeOpen.onOpenGesture();
  check('pause before the first letter opening suppresses its automatic retry', () => {
    assert.equal(mediaCalls, callsBeforeFirstOpening);
    assert.equal(pausedBeforeOpen.getState().userPaused, true);
  });
  pausedBeforeOpen.dispose();
  playMode = 'blocked';
  const mutedRoot = new FakeNode('div');
  const mutedBeforeOpen = createMusic({ sourceType: 'mp3', sourceUrl: './assets/music.mp3' }, { root: mutedRoot });
  mutedBeforeOpen.init();
  await flush();
  mutedRoot.querySelector('.music-mute').dispatchEvent(new Event('click'));
  const callsBeforeMutedOpening = mediaCalls;
  mutedBeforeOpen.onOpenGesture();
  check('mute after blocked autoplay suppresses the first opening retry', () => {
    assert.equal(mediaCalls, callsBeforeMutedOpening);
    assert.equal(mutedBeforeOpen.getState().userMuted, true);
  });
  mutedBeforeOpen.dispose();

  let youtubeMode = 'blocked';
  let youtubePlays = 0;
  let youtubePauses = 0;
  let playerCreations = 0;
  let livePlayer;
  const intervalCallbacks = new Map();
  let intervalId = 0;
  install('setInterval', (callback) => { intervalCallbacks.set(++intervalId, callback); return intervalId; });
  install('clearInterval', (id) => intervalCallbacks.delete(id));
  class FakeYouTubePlayer {
    constructor(node, { events }) {
      this.node = node; this.events = events; this.volume = 100; this.muted = false;
      livePlayer = this; playerCreations += 1;
      queueMicrotask(() => events.onReady({ target: this }));
    }
    playVideo() {
      youtubePlays += 1;
      queueMicrotask(() => {
        if (youtubeMode === 'blocked') this.events.onAutoplayBlocked({ target: this });
        else this.events.onStateChange({ data: 1, target: this });
      });
    }
    pauseVideo() {
      youtubePauses += 1;
      queueMicrotask(() => this.events.onStateChange({ data: 2, target: this }));
    }
    setVolume(value) { this.volume = value; }
    getVolume() { return this.volume; }
    isMuted() { return this.muted; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    destroy() { this.destroyed = true; }
  }
  install('window', Object.assign(new EventTarget(), {
    YT: { Player: FakeYouTubePlayer }, innerWidth: 390, innerHeight: 844,
    location: { origin: 'https://verdefsoft.me' },
  }));
  const youtubeRoot = new FakeNode('div');
  const youtubeController = createMusic({ sourceType: 'youtube', sourceUrl: 'https://youtu.be/M7lc1UVf-VE' }, { root: youtubeRoot });
  youtubeController.init();
  await flush();
  check('YouTube waits for readiness, attempts autoplay once and handles blocked event', () => {
    assert.equal(playerCreations, 1);
    assert.equal(youtubePlays, 1);
    assert.equal(youtubeController.getState().ready, true);
    assert.equal(youtubeController.getState().status, 'blocked');
    assert.equal(livePlayer.node.referrerPolicy, 'strict-origin-when-cross-origin');
    assert.equal(livePlayer.node.style.minHeight, '200px');
    assert.ok(livePlayer.node.src.includes('playlist=M7lc1UVf-VE'));
  });
  youtubeMode = 'success';
  youtubeController.onOpenGesture();
  check('YouTube opening gesture issues play command without awaiting decryption', () => {
    assert.equal(youtubePlays, 2);
    assert.equal(youtubeController.getState().playing, false);
  });
  await flush();
  check('YouTube playing state comes from actual player state event', () => {
    assert.equal(youtubeController.getState().playing, true);
    assert.equal(youtubeRoot.querySelector('.music-play').textContent, 'Tạm dừng');
  });
  fakeDocument.hidden = true;
  fakeDocument.dispatchEvent(new Event('visibilitychange'));
  await flush();
  fakeDocument.hidden = false;
  fakeDocument.dispatchEvent(new Event('visibilitychange'));
  await flush();
  check('hidden YouTube is paused and never automatically resumes on return', () => {
    assert.equal(youtubePauses, 1);
    assert.equal(youtubePlays, 2);
    assert.equal(youtubeController.getState().status, 'paused');
    assert.equal(playerCreations, 1);
  });
  youtubeRoot.querySelector('.music-play').dispatchEvent(new Event('click'));
  await flush();
  livePlayer.mute();
  for (const callback of intervalCallbacks.values()) callback();
  check('native YouTube mute controls synchronize host UI and preserve intent', () => {
    assert.equal(youtubeController.getState().muted, true);
    assert.equal(youtubeController.getState().userMuted, true);
    assert.equal(youtubeRoot.querySelector('.music-mute').textContent, 'Bật tiếng');
  });
  playerBounds = { left: 10, top: 10, right: 370, bottom: 140, width: 360, height: 130 };
  window.dispatchEvent(new Event('resize'));
  await flush();
  check('YouTube pauses when player cannot retain required 200px viewport height', () => {
    assert.equal(youtubePauses, 2);
    assert.equal(youtubeController.getState().playing, false);
  });
  playerBounds = { left: 10, top: 10, right: 370, bottom: 220, width: 360, height: 210 };
  window.dispatchEvent(new Event('resize'));
  youtubeRoot.querySelector('.music-play').dispatchEvent(new Event('click'));
  await flush();
  livePlayer.events.onError({ data: 150, target: livePlayer });
  check('YouTube embed-denied errors remain separate from the letter flow', () => {
    assert.equal(youtubeController.getState().status, 'error');
    assert.equal(youtubeController.getState().error, 'youtube-150');
    assert.equal(youtubeRoot.querySelector('.music-play').textContent, 'Thử lại');
  });
  youtubeRoot.querySelector('.music-play').dispatchEvent(new Event('click'));
  youtubeRoot.querySelector('.music-play').dispatchEvent(new Event('click'));
  livePlayer.events.onStateChange({ data: 3, target: livePlayer });
  check('late YouTube buffering after user stop cannot restore pending playback UI', () => {
    assert.equal(youtubeController.getState().pending, false);
    assert.equal(youtubeController.getState().userPaused, true);
    assert.equal(youtubeController.getState().status, 'paused');
  });
  await flush();
  youtubeController.dispose();
  check('YouTube cleanup destroys the sole player and cancels control polling', () => {
    assert.equal(livePlayer.destroyed, true);
    assert.equal(intervalCallbacks.size, 0);
    assert.equal(youtubeRoot.hidden, true);
  });
} finally {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log(`\n${checks} music checks passed (parsing and simulated controller behavior).`);
