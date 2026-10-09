import {decryptLetter} from './crypto.js';
import {createMusic} from './music.js';
import musicConfig from './music-config.js';
import {createParticleLetter} from './particle-letter.js';

const $ = id => document.getElementById(id);
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedQuery.matches;
let scene = null;
let opening = false;
let openedText = '';
let typingComplete = false;
let dialogueTimer = 0;
let envelopePromise;
const music = createMusic(musicConfig, {root: $('music-root')});
let letterEffect;
try { letterEffect = createParticleLetter({
  canvas: $('particle-text'),
  onComplete: completeLetter,
  onPhase: ({phase,unit,unitCount}) => {
    $('letter-progress').textContent = phase === 'idle' || phase === 'complete' ? '' : `${String(unit+1).padStart(2,'0')} / ${String(unitCount).padStart(2,'0')}`;
  }
}); } catch { letterEffect = null; }
try { music.init(); } catch { $('music-root').hidden = true; }
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
  scene?.setMode(view);
}
function completeLetter() {
  letterEffect?.stop();
  document.body.dataset.letterMode='full';
  const blocks = openedText.trimEnd().split(/\n\n/);
  $('letter-content').replaceChildren(...blocks.map((text,index)=>{
    const paragraph=document.createElement('p');
    paragraph.textContent=text;
    if(index===0) paragraph.className='dateline';
    return paragraph;
  }));
  typingComplete=true;
  $('particle-stage').hidden=true;
  $('letter-scroll').hidden=false;
  $('reveal-button').hidden=true;
  $('replay-button').hidden=reducedMotion||!letterEffect;
  $('explore-button').hidden=false;
}
function typeLetter() {
  typingComplete=false;
  document.body.dataset.letterMode='cinematic';
  $('letter-content').replaceChildren();
  $('particle-stage').hidden=false;
  $('letter-scroll').hidden=true;
  $('reveal-button').hidden=false;
  $('replay-button').hidden=true;
  $('explore-button').hidden=true;
  $('letter-scroll').scrollTop=0;
  if(reducedMotion || !letterEffect) { completeLetter(); return; }
  try { letterEffect.start(openedText); } catch { completeLetter(); }
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
    typeLetter();
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
$('reread-button').addEventListener('click',()=>{setView('letter');completeLetter();$('letter-scroll').scrollTop=0;$('letter-scroll').focus({preventScroll:true});});
$('reset-button').addEventListener('click',()=>scene?.reset());
function updateMotion(){document.body.classList.toggle('reduced-motion',reducedMotion);$('motion-toggle').setAttribute('aria-pressed',String(reducedMotion));$('motion-toggle').setAttribute('aria-label',reducedMotion?'Bật chuyển động nhẹ':'Giảm chuyển động');scene?.setReducedMotion(reducedMotion);if(reducedMotion&&openedText&&!typingComplete)completeLetter();$('replay-button').hidden=reducedMotion||!typingComplete||!letterEffect;}
$('motion-toggle').addEventListener('click',()=>{reducedMotion=!reducedMotion;updateMotion();});
reducedQuery.addEventListener('change',event=>{reducedMotion=event.matches;updateMotion();});
updateMotion();
function fallback(){document.body.classList.add('fallback');$('scene-status').textContent='Một góc tĩnh lặng — em vẫn có thể đọc thư bình thường.';$('gesture-hint').textContent='Một góc bình yên, để em ngồi lại một chút.';$('reset-button').hidden=true;}
import('./scene.js').then(async ({createScene})=>{
  scene=await createScene({canvas:$('scene'),reducedMotion,onReady:()=>{$('scene-status').textContent='';},onFallback:fallback,onDialogue:text=>{$('dialogue').textContent=text;$('dialogue').hidden=false;clearTimeout(dialogueTimer);dialogueTimer=setTimeout(()=>{$('dialogue').hidden=true;},5500);}});
  scene?.setMode(document.body.dataset.view);
  // Coordinates/state only, made available to local QA without exposing the letter.
  document.addEventListener('gift:scene-probe',()=>document.dispatchEvent(new CustomEvent('gift:scene-state',{detail:scene?.getProjectionTargets?.()??null})));
}).catch(fallback);
window.addEventListener('pagehide',()=>{letterEffect?.stop();clearTimeout(dialogueTimer);});
window.addEventListener('pageshow',event=>{if(event.persisted&&openedText&&!typingComplete)completeLetter();});
