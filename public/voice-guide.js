/* Narration attention follows validated facts. Transcripts are approximate, never new evidence. */
(() => {
 const root=document.querySelector('#wi-app');if(!root)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const panel=document.createElement('section');panel.id='voice-guide';panel.hidden=true;panel.setAttribute('aria-label','Narration evidence guide');
 const head=document.createElement('div');head.className='vg-head';
 const status=document.createElement('span');status.className='vg-status';
 const close=document.createElement('button');close.type='button';close.textContent='Hide guide';close.addEventListener('click',()=>stop());head.append(status,close);
 const title=document.createElement('h2'),scope=document.createElement('p'),facts=document.createElement('div'),caption=document.createElement('p');scope.className='vg-scope';facts.className='vg-facts';caption.className='vg-caption';panel.append(head,title,scope,facts,caption);root.append(panel);
 let answer=null,transcript='',index=-1,epoch=0,target=null;
 const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 function clearTarget(){target?.classList.remove('vg-spotlight');target=null;}
 function focusFact(i){if(!answer||i===index||!answer.facts[i])return;index=i;[...facts.children].forEach((n,j)=>n.setAttribute('aria-current',j===i?'true':'false'));facts.children[i]?.scrollIntoView({block:'nearest',inline:'nearest',behavior:reduced.matches?'instant':'smooth'});}
 function spotlight(){
  clearTarget();const main=root.querySelector('.wi-main');if(!main||!answer)return;
  const type=answer.action?.type;
  target=(type==='insight'||type==='breakdown')?main.querySelector('.fx-stage'):type==='scenario'?main.querySelector('.wi-decide-case-body > .wi-grid3'):type==='metric'?main.querySelector('.wi-split .wi-panel'):main.querySelector('.wi-grid4');
  if(target){target.classList.add('vg-spotlight');const r=target.getBoundingClientRect();if(r.top<80||r.top>innerHeight*.7)target.scrollIntoView({block:'center',behavior:reduced.matches?'instant':'smooth'});}
 }
 function prepare(data){
  stop();if(!data?.facts?.length)return;answer=structuredClone(data);answer.facts=answer.facts.slice(0,12);const run=++epoch;
  title.textContent=data.title;scope.textContent=[data.scope?.function==='all'?'All functions':data.scope?.function,data.scope?.region==='all'?'All regions':data.scope?.region,data.scope?.period==='quarter'?'Q3 2026':data.scope?.period].filter(Boolean).join(' · ')+' · Synthetic evidence';
  status.textContent='Evidence ready';caption.textContent='Highlights follow available speech transcripts; timing may differ from audio.';
  facts.replaceChildren();answer.facts.forEach((f,i)=>{const b=document.createElement('button');b.type='button';b.className='vg-fact'+(String(f.value).length>32?' vg-long':'');const label=document.createElement('span'),value=document.createElement('strong'),note=document.createElement('small');label.textContent=f.label;value.textContent=f.value;note.textContent=f.note||'';b.append(label,value,note);b.addEventListener('click',()=>focusFact(i));facts.append(b);});
  panel.hidden=false;root.classList.add('vg-active');focusFact(0);setTimeout(()=>{if(epoch===run)spotlight();},200);
 }
 function speak(delta){if(!answer)return;transcript=(transcript+String(delta)).slice(-1600);status.textContent='Speaking · transcript guide';caption.textContent=transcript.slice(-220);const text=normalize(transcript);let best=-1,at=-1;answer.facts.forEach((f,i)=>{const label=normalize(f.label);if(label.length<4)return;const p=text.lastIndexOf(label);if(p>at){at=p;best=i;}});if(best>=0)focusFact(best);}
 function progress(ratio){if(!answer)return;status.textContent='Playing · approximate reading guide';caption.textContent='Evidence order follows playback progress; this is not word-level alignment.';focusFact(Math.min(answer.facts.length-1,Math.floor(Math.max(0,ratio)*answer.facts.length)));}
 function stop(){++epoch;clearTarget();panel.hidden=true;root.classList.remove('vg-active');answer=null;transcript='';index=-1;}
 root.addEventListener('click',e=>{if(e.target.closest?.('[data-go],[data-page],[data-inspect],[data-cell],[data-lab],[data-decide-case],[data-audience]'))stop();},true);
 root.addEventListener('change',e=>{if(e.target.closest?.('#wi-filters'))stop();},true);
 for(const name of ['wi-source-updated','pagehide'])addEventListener(name,stop);
 window.WI_VOICE_GUIDE=Object.freeze({prepare,speak,progress,stop});
})();
