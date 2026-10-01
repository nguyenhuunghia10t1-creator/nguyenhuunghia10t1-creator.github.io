'use strict';
const menu = document.querySelector('#primary-nav');
const toggle = document.querySelector('#menu-toggle');
function closeMenu(restoreFocus=false){if(!menu||!toggle)return;menu.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');if(restoreFocus)toggle.focus();}
toggle?.addEventListener('click',()=>{const open=menu.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');});
menu?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>closeMenu()));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu?.classList.contains('open'))closeMenu(true)});
document.addEventListener('click',e=>{if(menu?.classList.contains('open')&&!e.target.closest('.site-header'))closeMenu()});
matchMedia('(min-width:1001px)').addEventListener('change',e=>{if(e.matches)closeMenu()});
const flows={
 vision:{steps:[['Sensors / Cameras','Trigger, optics and lighting'],['Edge Computing','Acquire and buffer images'],['AI / Vision','Inspect against defined criteria'],['PLC / Control','Validate result and interlocks'],['Industrial Software','Record result and image reference'],['Production Decision','Route, hold or request review']],note:'Reference architecture. Missing images, low confidence or late results must produce a defined hold or review state. Machine control and safety remain in the control system.'},
 automation:{steps:[['Sensors / I/O','Read position and process values'],['Control System','Execute PLC sequence and interlocks'],['Machine Actuation','Command drives, servos and valves'],['HMI / SCADA','Expose state, alarms and recipes'],['Data Acquisition','Timestamp signals and events'],['Production Decision','Review trends and investigate stops']],note:'Reference architecture. The PLC owns the machine sequence. Data collection and dashboards must tolerate disconnection without taking control of the safety circuit.'},
 data:{steps:[['Machine Signals','Collect counters and events'],['Edge Gateway','Normalize and timestamp'],['Industrial Network','Transport through agreed protocols'],['Data Service','Validate, buffer and store'],['Industrial Software','Show trends and event history'],['Production Decision','Trace issues and plan action']],note:'Reference architecture. Preserve units, timestamps and signal quality. Show stale data explicitly; a disconnected machine must never appear to be producing live data.'}
};
const tabs=[...document.querySelectorAll('[data-flow]')];
function selectFlow(tab,focus=false){const data=flows[tab.dataset.flow];tabs.forEach(t=>{const selected=t===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1});document.querySelectorAll('.flow-step').forEach((node,i)=>{node.querySelector('h3').textContent=data.steps[i][0];node.querySelector('p').textContent=data.steps[i][1]});document.querySelector('#flow-note').textContent=data.note;document.querySelector('#flow-panel').setAttribute('aria-labelledby',tab.id);if(focus)tab.focus()}
tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>selectFlow(tab));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();selectFlow(tabs[next],true)}})});
const form=document.querySelector('#project-form');
if(form)form.hidden=false;
form?.addEventListener('submit',e=>{
 e.preventDefault();
 for(const input of form.querySelectorAll('[required]')){input.setCustomValidity(input.value.trim()?'':'Please complete this field.');if(!input.checkValidity()){input.reportValidity();return}}
 const value=id=>document.querySelector('#'+id).value.trim();
 const subject=`Engineering inquiry: ${value('project-type')} — ${value('company')}`;
 const body=[`Hello VerdefSoft,`,'',`Name: ${value('name')}`,`Company: ${value('company')}`,`Work email: ${value('email')}`,`Phone: ${value('phone')||'Not provided'}`,`Project type: ${value('project-type')}`,'','Project brief:',value('message')].join('\n');
 const draft=`To: engineering@verdefsoft.me\nSubject: ${subject}\n\n${body}`;
 document.querySelector('#email-draft').value=draft;
 document.querySelector('#open-email').href=`mailto:engineering@verdefsoft.me?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
 const result=document.querySelector('#email-result');result.hidden=false;document.querySelector('#draft-status').textContent='Draft prepared locally. Your inquiry has not been sent.';result.focus();
});
form?.querySelectorAll('[required]').forEach(input=>input.addEventListener('input',()=>input.setCustomValidity('')));
document.querySelector('#copy-draft')?.addEventListener('click',async()=>{const draft=document.querySelector('#email-draft');const status=document.querySelector('#draft-status');try{await navigator.clipboard.writeText(draft.value);status.textContent='Draft copied. Paste it into your email application and send to engineering@verdefsoft.me.'}catch{draft.focus();draft.select();status.textContent='Select and copy the draft, then send it from your email application.'}});
