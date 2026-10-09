import {decryptLetter} from './crypto.js';
import {createMusic} from './music.js?v=20261009-r6';
import musicConfig from './music-config.js';
import {createParticleLetter} from './particle-letter.js?v=20261009-r4';

const $ = id => document.getElementById(id);
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedQuery.matches;
let scene = null;
let opening = false;
let openedText = '';
let typingComplete = false;
let presentationGeneration = 0;
let dialogueTimer = 0;
let envelopePromise;
const music = createMusic(musicConfig, {root: $('music-root')});
let letterEffect;
try { letterEffect = createParticleLetter({
  canvas: $('particle-text'),
  copy: $('particle-copy'),
  reducedMotion,
  onComplete: finishSequence,
  onError: completeLetter,
  onPhase: ({phase,unit,unitCount}) => {
    $('letter-progress').textContent = phase === 'idle' || phase === 'complete' ? '' : phase === 'loading' ? 'Một chút thôi…' : `${String(unit+1).padStart(2,'0')} / ${String(unitCount).padStart(2,'0')}`;
  }
}); } catch { letterEffect = null; }
try { music.init(); } catch { $('music-root').hidden = true; }
const noLyrics = {setView(){},setReducedMotion(){},getState(){return {available:false};}};
let lyrics = noLyrics;
// Optional lyrics must never prevent the letter/player from starting, including
// a failed module download or an invalid edited configuration file.
async function loadLyrics() {
  let candidate;
  try {
    const [{createLyrics},{default:lyricsConfig}] = await Promise.all([
      import('./lyrics.js?v=20261009-word1'), import('./lyrics-config.js?v=20261009-word1'),
    ]);
    candidate = createLyrics({root:$('lyrics-zone'),current:$('lyrics-current'),next:$('lyrics-next'),music,config:lyricsConfig,reducedMotion,
      onAvailability:available=>scene?.setLyricsLayout?.(available)});
    lyrics = candidate;
    lyrics.setView(document.body.dataset.view);
    lyrics.setReducedMotion(reducedMotion);
    await lyrics.init();
  } catch {
    candidate?.dispose?.();
    lyrics = noLyrics;
    $('lyrics-zone').hidden=true;
    document.body.classList.remove('has-lyrics');
    scene?.setLyricsLayout?.(false);
  }
}
loadLyrics();
// Reserve the real control height, including a wrapped loading/error message.
if ('ResizeObserver' in window) {
  const musicLayoutObserver = new ResizeObserver(() => {
    const height=$('music-root').hidden||document.body.classList.contains('has-youtube')?0:$('music-root').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--music-reserve',`${Math.ceil(height+36)}px`);
  });
  musicLayoutObserver.observe($('music-root'));
}

function fetchEnvelope() {
  return fetch('./letter.enc.json', {cache:'no-cache'}).then(response => {
    if (!response.ok) throw new Error('LETTER_DOWNLOAD');
    return response.json();
  });
}
envelopePromise = fetchEnvelope();
envelopePromise.catch(()=>{});

function setView(view) {
  document.body.dataset.view = view;
  $('gate').hidden = view !== 'locked';
  $('letter-view').hidden = view !== 'letter';
  $('explore-view').hidden = view !== 'explore';
  lyrics.setView(view);
  scene?.setMode(view);
}
function completeLetter() {
  presentationGeneration++;
  letterEffect?.stop();
  document.body.dataset.letterMode='full';
  scene?.setReadingLayout?.(true);
  const blocks = openedText.trimEnd().split(/\n\n/);
  $('letter-content').replaceChildren(...blocks.map((text,index)=>{
    const paragraph=document.createElement('p');
    paragraph.textContent=text.normalize('NFC');
    if(index===0) paragraph.className='dateline';
    return paragraph;
  }));
  typingComplete=true;
  $('particle-stage').hidden=true;
  $('letter-scroll').hidden=false;
  $('reveal-button').hidden=true;
  $('replay-button').hidden=!letterEffect;
  $('explore-button').hidden=false;
}
function finishSequence() {
  typingComplete=true;
  setView('explore');
  $('reread-button').focus({preventScroll:true});
}
async function typeLetter() {
  const generation=++presentationGeneration;
  typingComplete=false;
  document.body.dataset.letterMode='cinematic';
  scene?.setReadingLayout?.(false);
  $('letter-content').replaceChildren();
  $('particle-stage').hidden=false;
  $('letter-scroll').hidden=true;
  $('reveal-button').hidden=false;
  $('replay-button').hidden=true;
  $('explore-button').hidden=true;
  $('letter-scroll').scrollTop=0;
  if(!letterEffect) { completeLetter(); return; }
  try { await letterEffect.start(openedText); } catch { if(generation===presentationGeneration)completeLetter(); }
}
$('open-form').addEventListener('submit', async event=>{
  event.preventDefault();
  if(opening)return;
  // This call must happen inside the gesture, before crypto/network awaits.
  music.onOpenGesture();
  const account=$('account').value;
  const password=$('password').value;
  const status=$('open-status');
  status.classList.remove('error');
  if(!account.trim() || !password.trim()){
    status.textContent='Em nhập tài khoản và mật khẩu trên tấm thiệp nhé.';
    (!account.trim()?$('account'):$('password')).focus();
    return;
  }
  opening=true;
  $('open-button').disabled=true;
  $('open-button').firstElementChild.textContent='Đang mở thư…';
  $('open-form').setAttribute('aria-busy','true');
  status.textContent='Chờ một chút, lá thư đang được mở…';
  const started=performance.now();
  try {
    if(!globalThis.crypto?.subtle)throw new Error('CRYPTO_UNAVAILABLE');
    let envelope;
    try { envelope=await envelopePromise; } catch {
      envelopePromise=fetchEnvelope();
      envelope=await envelopePromise;
    }
    openedText=await decryptLetter(envelope,account,password);
    // Timing only: never credentials or letter contents in diagnostics/storage.
    performance.mark('gift-decryption-complete');
    document.dispatchEvent(new CustomEvent('gift:opened',{detail:{durationMs:performance.now()-started}}));
    $('password').value='';
    status.textContent='';
    setView('letter');
    await typeLetter();
    (typingComplete?$('letter-scroll'):$('reveal-button')).focus({preventScroll:true});
  } catch(error) {
    status.classList.add('error');
    status.textContent=error.message==='CRYPTO_UNAVAILABLE'||error.code==='CRYPTO_UNAVAILABLE'?'Trình duyệt này chưa mở được thư. Em thử bằng Chrome hoặc Safari mới hơn nhé.':error.code==='INVALID_ENVELOPE'||error instanceof SyntaxError?'Lá thư chưa tải đúng. Em thử tải lại trang nhé.':error.message==='LETTER_DOWNLOAD'||error instanceof TypeError?'Chưa tải được lá thư. Em kiểm tra kết nối rồi thử lại nhé.':'Thông tin chưa khớp. Em kiểm tra lại tài khoản và mật khẩu trên thiệp nhé.';
  } finally {
    opening=false;
    $('open-button').disabled=false;
    $('open-button').firstElementChild.textContent='Mở thư';
    $('open-form').removeAttribute('aria-busy');
  }
});
$('password-toggle').addEventListener('click',()=>{
  const visible=$('password').type==='password';
  $('password').type=visible?'text':'password';
  $('password-toggle').textContent=visible?'Ẩn':'Hiện';
  $('password-toggle').setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');
  $('password-toggle').setAttribute('aria-pressed',String(visible));
});
$('reveal-button').addEventListener('click',completeLetter);
$('replay-button').addEventListener('click',()=>{typeLetter();$('reveal-button').focus({preventScroll:true});});
$('explore-button').addEventListener('click',()=>{if(!typingComplete)return;setView('explore');$('reread-button').focus({preventScroll:true});});
$('reread-button').addEventListener('click',()=>{setView('letter');typeLetter();(!letterEffect?$('letter-scroll'):$('reveal-button')).focus({preventScroll:true});});
$('reset-button').addEventListener('click',()=>scene?.reset());
function updateMotion(){document.body.classList.toggle('reduced-motion',reducedMotion);$('motion-toggle').setAttribute('aria-pressed',String(reducedMotion));$('motion-toggle').setAttribute('aria-label',reducedMotion?'Bật chuyển động nhẹ':'Giảm chuyển động');scene?.setReducedMotion(reducedMotion);letterEffect?.setReducedMotion(reducedMotion);lyrics.setReducedMotion(reducedMotion);$('replay-button').hidden=!typingComplete||!letterEffect;}
$('motion-toggle').addEventListener('click',()=>{reducedMotion=!reducedMotion;updateMotion();});
reducedQuery.addEventListener('change',event=>{reducedMotion=event.matches;updateMotion();});
updateMotion();
function fallback(){document.body.classList.add('fallback');$('scene-status').textContent='Một góc tĩnh lặng — em vẫn có thể đọc thư bình thường.';$('gesture-hint').textContent='Một góc bình yên, để em ngồi lại một chút.';$('reset-button').hidden=true;}
import('./scene.js?v=20261009-r6b').then(async ({createScene})=>{
  scene=await createScene({canvas:$('scene'),reducedMotion,onReady:()=>{$('scene-status').textContent='';},onFallback:fallback,onDialogue:text=>{$('dialogue').textContent=text;$('dialogue').hidden=false;clearTimeout(dialogueTimer);dialogueTimer=setTimeout(()=>{$('dialogue').hidden=true;},5500);}});
  scene?.setMode(document.body.dataset.view);
  scene?.setReadingLayout?.(document.body.dataset.letterMode==='full');
  scene?.setLyricsLayout?.(lyrics.getState().available);
  // Coordinates/state only, made available to local QA without exposing the letter.
  document.addEventListener('gift:scene-probe',()=>document.dispatchEvent(new CustomEvent('gift:scene-state',{detail:scene?.getProjectionTargets?.()??null})));
}).catch(fallback);
window.addEventListener('pagehide',()=>{letterEffect?.stop();clearTimeout(dialogueTimer);});
window.addEventListener('pageshow',event=>{if(event.persisted&&openedText&&!typingComplete&&document.body.dataset.view==='letter')typeLetter();});
