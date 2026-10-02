/* Evidence-directed presentation. Model text is always rendered as text. */
(() => {
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
 const button=(label,run,cls='')=>{const b=el('button',cls,label);b.type='button';b.onclick=run;return b;};
 let active=null;
 function render(data,actions){
  const root=el('article','an-board st-scene'),heading=el('header','an-heading'),top=el('div','an-topline');
  top.append(el('span','st-eyebrow','Astra / Evidence briefing'),el('span','an-provenance',`${data.evidenceReferences.length} retrieved references · Synthetic workforce`));
  heading.append(top,el('h1',null,data.title),el('p','an-summary',data.analysis.summary));
  const controls=el('div','an-controls');controls.append(button('Listen to briefing',actions.listen,'st-button st-listen'),button('Export brief ↓',actions.export,'st-button'));heading.append(controls);root.append(heading);
  const layout=el('div','an-layout'),reasoning=el('section','an-reasoning');reasoning.setAttribute('aria-label','Findings and recommendations');
  const canvas=el('section','an-canvas');canvas.setAttribute('aria-label','Evidence canvas');const tabs=el('div','an-tabs');tabs.setAttribute('aria-label','Evidence panels');const panel=el('div','an-panel');canvas.append(tabs,panel);
  let selected=null;
  function select(id,scroll=false){
   const p=data.panels.find(x=>x.id===id);if(!p)return;selected=p;active.selected=p.response;
   tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===id)));panel.replaceChildren();panel.dataset.panel=id;
   const intro=el('div','an-panel-heading');intro.append(el('div','st-eyebrow',`${p.evidenceRefs.join(' · ')} / ${p.response.action?.type||'Evidence'}`),el('h2',null,p.title),el('p',null,p.why));panel.append(intro);
   const factGrid=el('div','st-facts an-facts');(p.response.action?.type==='breakdown'?[]:p.response.facts||[]).slice(0,3).forEach((f,i)=>{const fact=button('',()=>highlightFact(i),'st-fact'+(String(f.value).length>24?' st-long':''));fact.dataset.factIndex=i;fact.setAttribute('aria-current','false');fact.append(el('span',null,f.label),el('strong',null,f.value),el('small',null,f.note));factGrid.append(fact);});if(factGrid.children.length)panel.append(factGrid);
   const chart=window.WI_STUDIO_CHARTS?.render(p.response);if(chart)panel.append(chart);
   if(p.response.action?.type==='scenario')actions.assumptions(panel,p.response);
   const foot=el('div','an-panel-footer');foot.append(el('span',null,scopeName(p.response.scope)),button('Save '+(p.response.action?.type==='scenario'?'decision':'investigation'),()=>actions.save(p.response),'st-button'));panel.append(foot);
   actions.evidence(panel,p.response);if(scroll&&matchMedia('(max-width: 900px)').matches)panel.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function highlightFact(index){panel.querySelectorAll('.st-fact').forEach((n,i)=>n.setAttribute('aria-current',String(i===index)));panel.querySelector('.studio-chart')?.highlight?.(index);}
  function reference(ref){const p=data.panels.find(x=>x.evidenceRefs.includes(ref));actions.manualSelect?.(p?.response);if(p){select(p.id,true);return;}const item=data.evidenceReferences.find(x=>x.refId===ref);if(item)actions.reference(item);}
  data.panels.forEach((p,i)=>{const tab=button('',()=>{actions.manualSelect?.(p.response);select(p.id);},'an-tab');tab.dataset.panel=p.id;tab.append(el('span',null,String(i+1).padStart(2,'0')),el('b',null,p.title));tabs.append(tab);});
  data.analysis.sections.forEach((s,i)=>{const card=el('section','an-section');card.dataset.section=i;card.dataset.kind=s.kind;const label=el('div','an-section-label');label.append(el('span',null,({finding:'Evidence',hypothesis:'Working hypothesis',recommendation:'Proposed action',question:'To resolve',limitation:'Evidence limit'})[s.kind]||s.kind),el('span',null,String(i+1).padStart(2,'0')));card.append(label,el('h2',null,s.title),el('p',null,s.text));const refs=el('div','an-refs');s.evidenceRefs.forEach(ref=>refs.append(button(ref,()=>reference(ref),'an-ref')));card.append(refs);reasoning.append(card);});
  if(data.analysis.unknowns.length){const unknowns=el('details','an-unknowns');unknowns.append(el('summary',null,'What we still need to know'));const list=el('ul');data.analysis.unknowns.forEach(x=>list.append(el('li',null,x)));unknowns.append(list);reasoning.append(unknowns);}
  if(!data.panels.length){canvas.append(el('div','an-empty', 'Continue the discussion to bring workforce evidence onto the canvas.'));}
  layout.append(reasoning,canvas);root.append(layout);const next=el('nav','an-next');next.setAttribute('aria-label','Continue the investigation');data.analysis.followups.slice(0,4).forEach(q=>next.append(button(q+' ↗',()=>actions.ask(q),'st-button')));root.append(next,el('p','st-boundary',data.boundary));
  active={root,data,selected:null,select,highlightFact};if(data.panels.length)select(data.panels[0].id);return root;
 }
 function scopeName(s){return s?[s.function==='all'?'All functions':s.function,s.region==='all'?'All regions':s.region,s.period].join(' · '):'Scenario population';}
 const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const stopwords=new Set('about after again against also annual before could current data does evidence first from have into more most only other over should show than that their them then there these they this through under what when where which while with would your'.split(' '));
 const tokens=s=>new Set(normalize(s).split(' ').filter(w=>w.length>3&&!stopwords.has(w)).map(w=>w.endsWith('s')?w.slice(0,-1):w));
 function topic(text,items){const spoken=tokens(text),sets=items.map(tokens),frequencies=new Map();sets.forEach(s=>s.forEach(t=>frequencies.set(t,(frequencies.get(t)||0)+1)));const ranked=sets.map((s,index)=>{let score=0,hits=0;s.forEach(t=>{if(spoken.has(t)){hits++;score+=1+Math.log((sets.length+1)/(frequencies.get(t)+1));}});return {index,score,hits};}).sort((a,b)=>b.score-a.score);return ranked[0]?.hits>=3&&ranked[0].score>Math.max(3,(ranked[1]?.score||0)*1.12)?ranked[0].index:-1;}
 function speak(text){if(!active||!active.root.isConnected)return;const t=normalize(text);let best=-1,index=-1;active.data.analysis.sections.forEach((s,i)=>{const n=normalize(s.title),at=t.lastIndexOf(n);if(n.length>5&&at>best){best=at;index=i;}});if(index<0)index=topic(String(text).slice(-380),active.data.analysis.sections.map(s=>s.title+' '+s.text));if(index>=0){if(active.spokenSection!==index){active.spokenSection=index;const card=active.root.querySelector('[data-section="'+index+'"]'),dock=document.querySelector('.st-dock');if(card&&dock){const rect=card.getBoundingClientRect(),canvas=active.root.querySelector('.an-canvas').getBoundingClientRect();if(rect.top<100||rect.bottom>dock.getBoundingClientRect().top||canvas.top>220)window.scrollBy({top:rect.top-120,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}active.root.querySelectorAll('.an-section').forEach((n,i)=>n.classList.toggle('an-speaking',i===index));const refs=active.data.analysis.sections[index].evidenceRefs;const related=active.data.panels.filter(p=>p.evidenceRefs.some(r=>refs.includes(r)));const matched=topic(String(text).slice(-300),related.map(p=>p.title+' '+p.why+' '+p.response.facts.map(f=>f.label).join(' ')));const p=related[matched>=0?matched:0];if(p&&active.root.querySelector('.an-panel')?.dataset.panel!==p.id)active.select(p.id);}
  for(const p of active.data.panels){const n=normalize(p.title);if(n.length>5&&t.endsWith(n)&&active.root.querySelector('.an-panel')?.dataset.panel!==p.id)active.select(p.id);}
  let at=-1,fact=-1;(active.selected?.facts||[]).forEach((f,i)=>{const n=normalize(f.label),p=t.lastIndexOf(n);if(n.length>4&&p>at){at=p;fact=i;}});if(fact>=0)active.highlightFact(fact);
 }
 function stop(){if(!active)return;active.spokenSection=null;active.root.querySelectorAll('.an-speaking').forEach(n=>n.classList.remove('an-speaking'));active.highlightFact(-1);}
 function narration(data){if(!data?.analysis)return [{title:'',text:data?.answer||''}];const segments=[],candidates=[{title:'',text:data.analysis.summary},...data.analysis.sections.map(s=>({title:s.title,text:s.title+'. '+s.text}))];let length=0;for(const segment of candidates){if(length+segment.text.length+2>2800){if(!segments.length){const sentences=segment.text.split(/(?<=[.!?])\s+/);let text='';for(const sentence of sentences){if(text.length+sentence.length>2700)break;text+=(text?' ':'')+sentence;}if(text){segments.push({...segment,text});length+=text.length;}}continue;}segments.push(segment);length+=segment.text.length+2;}return segments;}
 window.WI_ANALYSIS={render,speak,stop,narration,selected:()=>active?.root.isConnected?active.selected:null};
})();
