const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const PREVIEW_HOSTS = new Set([
  'drive.google.com', 'docs.google.com', 'dropbox.com', 'www.dropbox.com',
  '1drv.ms', 'onedrive.live.com', 'mega.nz', 'www.mega.nz',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Parse configuration only; this function never contacts a music service. */
export function parseMusicSource(config = {}, baseUrl = 'https://example.com/mot-goc-nho/') {
  const common = {
    title: typeof config.title === 'string' ? config.title.trim() : '',
    volume: typeof config.volume === 'number' && Number.isFinite(config.volume)
      ? Math.max(0, Math.min(1, config.volume)) : 0.25,
    loop: config.loop !== false,
  };
  if (config.enabled === false) return { ...common, status: 'disabled' };
  const raw = typeof config.sourceUrl === 'string' ? config.sourceUrl.trim() : '';
  if (!raw) return { ...common, status: 'empty' };
  const invalid = () => ({ ...common, status: 'invalid' });
  if (!['mp3', 'youtube'].includes(config.sourceType)) return invalid();
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.includes('\\') || raw.startsWith('//')) return invalid();
  let url;
  try { url = new URL(raw, baseUrl); } catch { return invalid(); }
  if (url.username || url.password) return invalid();
  const explicitScheme = /^[A-Za-z][A-Za-z\d+.-]*:/.test(raw);
  if (config.sourceType === 'youtube') {
    if (!explicitScheme || url.protocol !== 'https:') return invalid();
    let videoId = '';
    if (YOUTUBE_HOSTS.has(url.hostname) && url.pathname === '/watch') {
      videoId = url.searchParams.get('v') || '';
    } else if (url.hostname === 'youtu.be' && /^\/[^/]+\/?$/.test(url.pathname)) {
      videoId = url.pathname.split('/')[1];
    }
    if (!VIDEO_ID.test(videoId) || (url.port && url.port !== '443')) return invalid();
    return { ...common, status: 'ready', sourceType: 'youtube', videoId, sourceUrl: url.href };
  }
  if (explicitScheme && url.protocol !== 'https:') return invalid();
  // Relative assets remain usable on a local HTTP development server.
  if (!explicitScheme && !['http:', 'https:'].includes(url.protocol)) return invalid();
  if (YOUTUBE_HOSTS.has(url.hostname) || url.hostname === 'youtu.be'
    || PREVIEW_HOSTS.has(url.hostname) || url.hostname.endsWith('.sharepoint.com')) return invalid();
  if (/\.(?:html?|php|aspx?)$/i.test(url.pathname)
    || /\/(?:preview|view|watch|share)(?:\/|$)/i.test(url.pathname)) return invalid();
  if (!explicitScheme && !/\.mp3$/i.test(url.pathname)) return invalid();
  url.hash = '';
  // An HTTPS endpoint can serve MP3 without a filename extension. The media
  // element, not a cross-origin HEAD request, verifies that it is playable.
  return { ...common, status: 'ready', sourceType: 'mp3', sourceUrl: url.href };
}

let youtubeApiPromise;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(window.YT);
    };
    window.onYouTubeIframeAPIReady = () => {
      try { if (typeof previous === 'function') previous(); } finally { finish(); }
    };
    const timeout = setTimeout(() => finish(new Error('youtube-timeout')), 12000);
    let script = document.querySelector('script[data-gift-youtube-api]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.giftYoutubeApi = 'true';
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.addEventListener('error', () => finish(new Error('youtube-network')), { once: true });
      document.head.append(script);
    }
  }).catch((error) => {
    youtubeApiPromise = undefined;
    document.querySelector('script[data-gift-youtube-api]')?.remove();
    throw error;
  });
  return youtubeApiPromise;
}

/** A single, persistent controller independent of letter/scene presentation. */
export function createMusic(config, { root }) {
  if (!root) throw new Error('Music root is required.');
  const source = parseMusicSource(config, document.baseURI);
  const state = {
    status: source.status, sourceType: source.sourceType || null,
    title: source.title, playing: false, muted: source.volume === 0,
    volume: source.volume, ready: false, userPaused: false,
    userMuted: source.volume === 0, pending: false, error: null,
    nativePlayNeeded: false,
  };
  let initialized = false;
  let disposed = false;
  let audio;
  let player;
  let iframe;
  let ui;
  let supportsVolume = true;
  let initialAttempted = false;
  let openingAttempted = false;
  let attemptVersion = 0;
  let fadeFrame = 0;
  let fadeVersion = 0;
  let iframePauseReason = null;
  let awaitingPauseAck = false;
  let suspended = false;
  let visibilityObserver;
  let resizeObserver;
  let poll;
  let readyTimer;
  let playbackTimer;
  let lastPlayReason;
  const cleanups = [];

  function listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    cleanups.push(() => target.removeEventListener(event, callback, options));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function cancelFade() {
    fadeVersion += 1;
    if (fadeFrame) cancelAnimationFrame(fadeFrame);
    fadeFrame = 0;
  }

  function fadeIn() {
    cancelFade();
    if (!audio || !supportsVolume || state.muted || state.userPaused) return;
    const version = fadeVersion;
    const started = performance.now();
    const from = audio.volume;
    const tick = (now) => {
      if (disposed || version !== fadeVersion || state.userPaused || state.muted || audio.paused) return;
      const progress = Math.min(1, (now - started) / 650);
      audio.volume = from + (state.volume - from) * progress;
      if (progress < 1) fadeFrame = requestAnimationFrame(tick);
      else fadeFrame = 0;
    };
    fadeFrame = requestAnimationFrame(tick);
  }

  function buildUi() {
    root.hidden = false;
    root.setAttribute('aria-label', 'Góc nghe nhạc');
    const shell = element('section', 'music-shell');
    if (source.title) shell.append(element('p', 'music-title', source.title));
    const controls = element('div', 'music-controls');
    const play = element('button', 'music-play', 'Bật nhạc');
    const mute = element('button', 'music-mute', 'Tắt tiếng');
    play.type = mute.type = 'button';
    play.setAttribute('aria-label', 'Bật nhạc');
    mute.setAttribute('aria-label', 'Tắt tiếng');
    controls.append(play, mute);
    const volumeLabel = element('label', 'music-volume');
    const volumeText = element('span', 'music-volume-label', 'Âm lượng');
    const volume = element('input', 'music-volume-input');
    volume.type = 'range';
    volume.min = '0'; volume.max = '100'; volume.step = '1';
    volume.setAttribute('aria-label', 'Âm lượng nhạc');
    volumeLabel.append(volumeText, volume);
    if (supportsVolume) controls.append(volumeLabel);
    shell.append(controls);
    const status = element('p', 'music-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    shell.append(status);
    if (!supportsVolume) shell.append(element('p', 'music-device-volume', 'Âm lượng: dùng nút trên điện thoại.'));
    root.replaceChildren(shell);
    ui = { shell, play, mute, volume, status };
    listen(play, 'click', () => {
      if (state.playing || state.pending) pauseByUser();
      else requestPlay('user');
    });
    listen(mute, 'click', () => setMuted(!state.muted));
    listen(volume, 'input', () => {
      cancelFade();
      state.volume = Number(volume.value) / 100;
      state.muted = state.volume === 0;
      state.userMuted = state.muted;
      if (audio) { audio.volume = state.volume; audio.muted = state.muted; }
      if (player && state.ready) {
        player.setVolume(state.volume * 100);
        if (state.muted) player.mute(); else player.unMute();
      }
      render();
    });
  }

  function render() {
    if (!ui || disposed) return;
    const label = state.playing ? 'Tạm dừng'
      : state.pending ? 'Dừng chờ'
        : state.status === 'error' ? 'Thử lại'
          : state.status === 'paused' || state.status === 'ended' ? 'Phát tiếp' : 'Bật nhạc';
    ui.play.textContent = label;
    ui.play.setAttribute('aria-label', label);
    ui.play.setAttribute('aria-pressed', String(state.playing));
    ui.mute.textContent = state.muted ? 'Bật tiếng' : 'Tắt tiếng';
    ui.mute.setAttribute('aria-label', state.muted ? 'Bật tiếng' : 'Tắt tiếng');
    ui.mute.setAttribute('aria-pressed', String(state.muted));
    ui.mute.disabled = !state.ready;
    ui.volume.disabled = !state.ready;
    ui.volume.value = String(Math.round(state.volume * 100));
    const message = state.status === 'error' ? 'Bài nhạc chưa mở được. Em vẫn đọc thư bình thường nhé.'
      : state.playing ? (state.muted ? 'Đang phát · tắt tiếng' : 'Đang phát')
        : state.status === 'loading' || state.pending ? 'Đang chuẩn bị nhạc…'
          : state.status === 'blocked' ? (state.nativePlayNeeded
            ? 'Chạm nút phát trong khung YouTube để nghe.'
            : 'Chạm “Bật nhạc” khi em muốn nghe.')
            : state.status === 'paused' ? 'Nhạc đang tạm dừng.'
              : state.status === 'ended' ? 'Bài nhạc đã kết thúc.' : 'Một chút nhạc, nếu em muốn.';
    if (ui.status.textContent !== message) ui.status.textContent = message;
    root.dataset.musicState = state.status;
    root.dataset.musicSource = source.sourceType;
  }

  function fail(reason) {
    if (disposed) return;
    cancelFade();
    clearTimeout(playbackTimer);
    state.pending = false;
    state.playing = false;
    state.error = reason;
    state.status = 'error';
    render();
  }

  function setMuted(muted) {
    cancelFade();
    state.muted = muted;
    state.userMuted = muted;
    if (!muted && state.volume === 0) state.volume = source.volume || 0.25;
    if (audio) {
      audio.muted = muted;
      if (supportsVolume) audio.volume = state.volume;
    }
    if (player && state.ready) {
      if (muted) player.mute(); else player.unMute();
      if (supportsVolume) player.setVolume(state.volume * 100);
    }
    render();
  }

  function pauseByUser() {
    state.userPaused = true;
    state.pending = false;
    attemptVersion += 1;
    cancelFade();
    clearTimeout(playbackTimer);
    // Pause is intentionally immediate: a fade must never delay a user's stop.
    if (audio) audio.pause();
    if (player && state.ready) {
      iframePauseReason = 'user';
      awaitingPauseAck = true;
      player.pauseVideo();
    }
    state.playing = false;
    state.status = 'paused';
    render();
  }

  function youtubeVisible() {
    if (!iframe || document.hidden || root.hidden || !iframe.isConnected) return false;
    const rect = iframe.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) return false;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const visibleWidth = Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, top + height) - Math.max(rect.top, top));
    return (visibleWidth * visibleHeight) / (rect.width * rect.height) > 0.5;
  }

  function pauseForVisibility() {
    if (!player || !state.ready || (!state.playing && !state.pending)) return;
    suspended = true;
    attemptVersion += 1;
    state.pending = false;
    state.playing = false;
    state.status = 'paused';
    iframePauseReason = 'visibility';
    awaitingPauseAck = true;
    clearTimeout(playbackTimer);
    player.pauseVideo();
    render();
  }

  function visibilityChanged() {
    if (!youtubeVisible()) pauseForVisibility();
    else if (state.ready && !initialAttempted && !suspended) requestPlay('initial');
  }

  // Deliberately synchronous until HTMLMediaElement.play()/playVideo(). The
  // caller must call onOpenGesture() before awaiting fetch/PBKDF2/decryption.
  function requestPlay(reason) {
    if (disposed || !initialized || source.status !== 'ready') return;
    const automatic = reason !== 'user';
    if (automatic && (state.userPaused || state.userMuted || suspended)) return;
    if (state.playing || state.pending) return;
    if (reason === 'initial') {
      if (initialAttempted) return;
      if (source.sourceType === 'youtube' && (!state.ready || !youtubeVisible())) return;
      initialAttempted = true;
    }
    if (source.sourceType === 'youtube' && !state.ready) {
      if (state.status === 'error' && reason === 'user') initializeYouTube();
      return;
    }
    if (source.sourceType === 'youtube' && !youtubeVisible()) {
      state.status = 'paused';
      render();
      return;
    }
    if (!automatic) { state.userPaused = false; suspended = false; }
    awaitingPauseAck = false;
    state.error = null;
    lastPlayReason = reason;
    state.pending = true;
    state.status = 'loading';
    const version = ++attemptVersion;
    render();
    if (audio) {
      if (audio.error) audio.load();
      audio.muted = state.muted;
      cancelFade();
      if (supportsVolume) audio.volume = state.muted ? state.volume : Math.min(0.005, state.volume);
      let promise;
      try { promise = audio.play(); } catch (error) { handlePlayFailure(error, version); return; }
      Promise.resolve(promise).then(() => {
        if (disposed || version !== attemptVersion) return;
        if (state.userPaused) { audio.pause(); return; }
        state.pending = false;
        state.playing = !audio.paused && !audio.ended && audio.readyState >= 3;
        state.status = state.playing ? 'playing' : 'loading';
        render();
      }).catch((error) => handlePlayFailure(error, version));
    } else if (player) {
      try { player.playVideo(); } catch { fail('youtube-play'); return; }
      clearTimeout(playbackTimer);
      // Not all browser/player combinations deliver onAutoplayBlocked. This
      // one-shot fallback only changes UI; it never repeatedly calls play.
      playbackTimer = setTimeout(() => {
        if (disposed || version !== attemptVersion || state.playing) return;
        state.pending = false;
        state.status = 'blocked';
        state.nativePlayNeeded = reason === 'user';
        render();
      }, 7000);
    }
  }

  function handlePlayFailure(error, version) {
    if (disposed || version !== attemptVersion) return;
    cancelFade();
    state.pending = false;
    state.playing = false;
    if (error?.name === 'NotAllowedError') {
      state.status = 'blocked';
      render();
    } else if (error?.name === 'AbortError') {
      state.status = 'paused';
      render();
    } else fail('mp3-load');
  }

  function initializeMp3() {
    audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.loop = source.loop;
    audio.muted = state.muted;
    audio.setAttribute('aria-hidden', 'true');
    audio.hidden = true;
    if (supportsVolume) audio.volume = state.volume;
    listen(audio, 'playing', () => {
      if (disposed) return;
      if (state.userPaused) { audio.pause(); return; }
      state.pending = false;
      state.playing = true;
      state.status = 'playing';
      fadeIn();
      render();
    });
    listen(audio, 'pause', () => {
      cancelFade();
      state.playing = false;
      state.pending = false;
      state.userPaused = true;
      if (!['error', 'blocked', 'ended'].includes(state.status)) state.status = 'paused';
      render();
    });
    listen(audio, 'waiting', () => {
      state.playing = false;
      if (!state.userPaused) { state.pending = true; state.status = 'loading'; }
      render();
    });
    listen(audio, 'ended', () => {
      state.playing = false;
      state.pending = false;
      state.status = 'ended';
      render();
    });
    listen(audio, 'error', () => fail('mp3-load'));
    listen(audio, 'volumechange', () => {
      state.muted = audio.muted || state.volume === 0;
      render();
    });
    audio.src = source.sourceUrl;
    ui.shell.append(audio);
    state.ready = true;
    state.status = 'ready';
    requestPlay('initial');
    render();
  }

  function makeYouTubeIframe() {
    iframe = document.createElement('iframe');
    iframe.title = source.title ? `YouTube — ${source.title}` : 'Trình phát nhạc YouTube';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.minWidth = '200px';
    iframe.style.minHeight = '200px';
    iframe.style.display = 'block';
    iframe.style.border = '0';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    const params = new URLSearchParams({
      enablejsapi: '1', autoplay: '0', controls: '1', playsinline: '1',
      origin: window.location.origin,
    });
    if (source.loop) { params.set('loop', '1'); params.set('playlist', source.videoId); }
    iframe.src = `https://www.youtube.com/embed/${source.videoId}?${params}`;
    return iframe;
  }

  function setupYouTubeRegion() {
    document.body.classList.add('has-youtube');
    const frame = element('div', 'music-youtube-frame');
    frame.style.minWidth = '200px';
    frame.style.minHeight = '200px';
    makeYouTubeIframe();
    frame.append(iframe);
    ui.shell.append(frame);
    const notice = element('p', 'music-notice', 'Nhạc qua YouTube, một dịch vụ bên thứ ba. ');
    const terms = element('a', '', 'Điều khoản YouTube');
    terms.href = 'https://www.youtube.com/t/terms';
    terms.target = '_blank'; terms.rel = 'noopener';
    const privacy = element('a', '', 'Quyền riêng tư Google');
    privacy.href = 'https://policies.google.com/privacy';
    privacy.target = '_blank'; privacy.rel = 'noopener';
    notice.append(terms, document.createTextNode(' · '), privacy);
    ui.shell.append(notice);
    if ('IntersectionObserver' in window) {
      visibilityObserver = new IntersectionObserver(visibilityChanged, { threshold: [0, 0.5, 0.51, 1] });
      visibilityObserver.observe(iframe);
    }
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(visibilityChanged);
      resizeObserver.observe(iframe);
    }
    listen(document, 'visibilitychange', visibilityChanged);
    listen(window, 'resize', visibilityChanged);
    listen(window, 'scroll', visibilityChanged, { passive: true, capture: true });
    if (window.visualViewport) listen(window.visualViewport, 'resize', visibilityChanged);
  }

  function initializeYouTube() {
    if (player && !state.ready) {
      visibilityObserver?.unobserve(iframe);
      resizeObserver?.unobserve(iframe);
      player.destroy();
      player = undefined;
      ui.shell.querySelector('.music-youtube-frame').replaceChildren(makeYouTubeIframe());
      visibilityObserver?.observe(iframe);
      resizeObserver?.observe(iframe);
    }
    state.status = 'loading';
    state.error = null;
    render();
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (!disposed && !state.ready) fail('youtube-ready');
    }, 18000);
    loadYouTubeApi().then((YT) => {
      if (disposed || player) return;
      player = new YT.Player(iframe, {
        events: {
          onReady: () => {
            if (disposed) return;
            clearTimeout(readyTimer);
            state.ready = true;
            state.status = 'ready';
            if (supportsVolume) player.setVolume(state.volume * 100);
            if (state.muted) player.mute();
            requestPlay('initial');
            render();
            poll = setInterval(() => {
              if (disposed || !state.ready || document.hidden) return;
              visibilityChanged();
              const muted = player.isMuted();
              const volume = supportsVolume ? player.getVolume() / 100 : state.volume;
              if (muted !== state.muted || Math.abs(volume - state.volume) > 0.015) {
                state.muted = muted || volume === 0;
                state.userMuted = state.muted;
                state.volume = volume;
                render();
              }
            }, 750);
          },
          onStateChange: (event) => {
            if (disposed) return;
            if (event.data === 1) {
              if (awaitingPauseAck) {
                player.pauseVideo();
                return;
              }
              state.playing = true;
              if (!youtubeVisible()) { pauseForVisibility(); return; }
              // Native YouTube controls are also explicit user controls.
              state.userPaused = false;
              state.pending = false;
              state.status = 'playing';
              state.nativePlayNeeded = false;
              clearTimeout(playbackTimer);
            } else if (event.data === 2) {
              awaitingPauseAck = false;
              state.playing = false;
              state.pending = false;
              if (iframePauseReason !== 'visibility') state.userPaused = true;
              iframePauseReason = null;
              if (state.status !== 'error') state.status = 'paused';
              clearTimeout(playbackTimer);
            } else if (event.data === 3) {
              if (awaitingPauseAck) {
                // A delayed buffering notification can arrive after a pause
                // command. Keep the user's stop authoritative while awaiting
                // the player's acknowledgement; never reopen pending UI.
                player.pauseVideo();
                return;
              }
              state.playing = false;
              state.pending = true;
              state.status = 'loading';
              if (!youtubeVisible()) { pauseForVisibility(); return; }
            } else if (event.data === 0) {
              state.playing = false;
              state.pending = false;
              state.status = 'ended';
            }
            render();
          },
          onAutoplayBlocked: () => {
            if (disposed) return;
            clearTimeout(playbackTimer);
            state.playing = false;
            state.pending = false;
            state.status = 'blocked';
            state.nativePlayNeeded = lastPlayReason === 'user';
            render();
          },
          onError: (event) => fail(`youtube-${event.data}`),
        },
      });
    }).catch(() => fail('youtube-network'));
  }

  return {
    init() {
      if (initialized || disposed) return;
      initialized = true;
      root.hidden = true;
      if (source.status !== 'ready') return;
      const probe = document.createElement('audio');
      try {
        probe.volume = 0.37;
        supportsVolume = Math.abs(probe.volume - 0.37) < 0.01
          && !/iPhone|iPod/.test(navigator.userAgent);
      } catch { supportsVolume = false; }
      buildUi();
      if (source.sourceType === 'mp3') initializeMp3();
      else { setupYouTubeRegion(); initializeYouTube(); }
    },
    onOpenGesture() {
      if (openingAttempted || disposed || source.status !== 'ready') return;
      openingAttempted = true;
      requestPlay('opening');
    },
    getState() { return Object.freeze({ ...state }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      attemptVersion += 1;
      cancelFade();
      clearTimeout(readyTimer);
      clearTimeout(playbackTimer);
      clearInterval(poll);
      visibilityObserver?.disconnect();
      resizeObserver?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      if (player?.destroy) player.destroy();
      root.replaceChildren();
      root.hidden = true;
      if (source.sourceType === 'youtube') document.body.classList.remove('has-youtube');
    },
  };
}
