// Conversation continuity and presentation are built from validated references and engine facts.
// No client-supplied numerical result, HTML, selector or executable instruction is accepted.
import { demoPlan, effectiveAssumptions, scenario, validatePlan, validateRequest } from './engine.mjs';

const route = (intent, metricId=null, caseId=null, overrides={}) => ({intent,metricId,caseId,overrides});
const clarify = () => route('clarify');
const normal = text => String(text).toLowerCase().replace(/[\u2010-\u2014]/g,'-').replace(/\s+/g,' ').trim();
const numberWords = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const numberSource = '(?:[+-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:\\s*[km])?|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|point|half|a)(?:[ -]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|point|half|a))*\\b)';
function number(text) {
  const q=text.trim().replace(/,/g,'').replace(/^a /,'');
  if(q==='a')return NaN;
  const numeric=q.match(/^([+\-]?\d+(?:\.\d+)?)\s*([km])?$/);
  if(numeric)return Number(numeric[1])*({k:1000,m:1000000}[numeric[2]]||1);
  if(/^half(?: a)?$/.test(q))return .5;
  const parts=q.replace(/-/g,' ').split(/\s+/), point=parts.indexOf('point');
  if(point>=0){const tail=parts.slice(point+1);if(!tail.length||tail.some(x=>!(x in numberWords)||numberWords[x]>9))return NaN;return (point?number(parts.slice(0,point).join(' ')):0)+Number('0.'+tail.map(x=>numberWords[x]).join(''));}
  let total=0,current=0;
  for(const part of parts){if(part==='a')continue;if(part in numberWords)current+=numberWords[part];else if(part==='hundred')current=(current||1)*100;else if(part==='thousand'||part==='million'){total+=(current||1)*(part==='thousand'?1000:1000000);current=0;}else return NaN;}
  return total+current;
}
const pointPattern = new RegExp(`(?<![\\w.])(${numberSource})[- ]*(?:percentage[- ]points?|percent[- ]points?|pp|points?)\\b`,'g');
const percentPattern = new RegExp(`(?<![\\w.])(${numberSource})\\s*(?:relative\\s+)?(?:percent(?:age)?\\b(?![- ]points?)|%)`,'g');
const moneyPatterns = {
  programCost: new RegExp(`(?:program(?:me)? (?:cost|budget|spend)|(?:program(?:me)? )?budget|investment)\\s*(?:at|to|of|is|=)?\\s*\\$?(${numberSource})(?:\\s*dollars)?`,'g'),
  replacementCost: new RegExp(`replacement (?:cost|value)\\s*(?:at|to|of|is|=)?\\s*\\$?(${numberSource})(?:\\s*dollars)?`,'g')
};
const modelWords=/\b(?:model|simulate|test|calculate|recalculate|scenario|what if|improv\w*|reduc\w*|decreas\w*|increas\w*|make it|change|set|keep|downside)\b/;
const privateRequest=/\b(?:individual|employee names?|who should|fire|dismiss|protected traits?|predict who)\b/;
const resetRequested=q=>/\b(?:reset|start over|baseline assumptions|default assumptions|shipped baseline)\b/.test(q);
const pendingReply=q=>/^(?:i mean |use |make it |yes[, ]+)?(?:percentage points?|percent points?|pp|points?|relative(?: percent(?:age)?)?(?: (?:reduction|decrease))?)[.!?]*$/.test(q);

// A recognized number is removed only after its unit and target have both been resolved.
function retentionIntent(request) {
  const q=normal(request.question), context=request.context||{};
  if(privateRequest.test(q))return null;
  const pending=context.pendingAssumption;
  if(pending && pendingReply(q))return {value:pending.value, unit:/relative/.test(q)?'relative':'points',overrides:{},consumed:q};
  const explicit=/\b(?:retention|first[- ]year|early[- ]exit)\b/.test(q);
  const relevant=explicit||context.caseId==='retention'||context.metricId==='C01';
  if(!relevant || !modelWords.test(q))return null;
  if(/\b(?:skills?|delivery|capacity|continuity|service|agents?|yield|demand)\b/.test(q))return null;
  if(resetRequested(q)&&!(/\d|\b(?:zero|one|two|three|four|five|six|half|hundred|thousand|million)\b/.test(q)))return {overrides:{},reset:true};
  if(/\b(?:minus|negative)\b/.test(q)||/\b(?:increase|raise)\b.*\b(?:exit rate|attrition rate)\b/.test(q))return {invalid:'This lab models an exit-rate reduction. State a reduction from 0 to 6 percentage points.'};
  let rest=q,overrides={},value=null,unit=null;
  for(const [key,pattern]of Object.entries(moneyPatterns)){
    const matches=[...rest.matchAll(pattern)];
    if(matches.length>1)return {invalid:'State one value for each assumption.'};
    if(matches.length){overrides[key]=number(matches[0][1]);rest=rest.replace(matches[0][0],' ');}
  }
  if(/\b(?:budget|program cost|replacement (?:cost|value))\s+(?:by|increase|decrease)\b/.test(rest))return {invalid:'State the program budget and replacement value as dollar amounts; percentage changes to costs need an explicit new amount.'};
  const pointMatches=[...rest.matchAll(pointPattern)],percentMatches=[...rest.matchAll(percentPattern)];
  if(pointMatches.length+percentMatches.length>1)return {invalid:'State one exit-reduction assumption at a time.'};
  if(pointMatches.length){value=number(pointMatches[0][1]);unit='points';rest=rest.replace(pointMatches[0][0],' ');}
  if(percentMatches.length){value=number(percentMatches[0][1]);unit=/\brelative\b/.test(q)?'relative':'ambiguous';rest=rest.replace(percentMatches[0][0],' ');}
  // Do not silently drop extra quantities, even if some parts of the question were understood.
  if(/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|hundred|thousand|million)\b/.test(rest))return {invalid:'Please give an explicit exit reduction in percentage points and a program budget in dollars.'};
  if(value===null && !Object.keys(overrides).length)return null;
  return {value,unit,overrides};
}
function effectOf(parsed){
  if(parsed.unit==='relative'){const baseline=scenario('retention');return (baseline.baselineExits/baseline.population*100)*(parsed.value/100);}
  return parsed.value;
}

const caseNames={retention:/\b(?:retention|first[- ]year|early[- ]exits?)\b/,skills:/\b(?:skills?|capability|capabilities)\b/,delivery:/\b(?:delivery|coding|workflow)\b/,continuity:/\b(?:continuity|succession|critical services)\b/,service:/\b(?:hr service|service|queue|backlog)\b/,capacity:/\b(?:workforce capacity|capacity scenario|capacity lab|redeployment|capacity)\b/};
const assumptionNames={
  skills:{yieldPct:['learner yield','training yield','yield'],skillsDay:['assessment day','readiness day','day']},
  delivery:{demand:['weekly demand','demand'],unitValue:['unit value','value per accepted unit']},
  continuity:{continuityDay:['readiness day','day']},
  service:{openingQueue:['opening queue','initial backlog'],arrivals:['monthly arrivals','arrivals'],agents:['baseline agents','agents'],agentProductivity:['agent productivity','cases per agent'],automationGain:['automation gain'],agentMonthlyCost:['agent monthly cost'],automationMonthlyCost:['automation monthly cost'],serviceSetup:['setup cost','service setup']},
  capacity:{capacityDay:['deadline day','day'],capacityYield:['build yield','yield'],sourceRelease:['source release'],delayValue:['delay value']}
};
const scenarioChoices={skills:{skillsPlan:{hire:/\bhire\b/,reskill:/\breskill(?:ing)?\b/,hybrid:/\bhybrid\b/}},delivery:{deliveryPlan:{current:/\bcurrent (?:plan|workflow)\b/,coding:/\bcoding\b/,redesign:/\bredesign\b/}},continuity:{continuityPlan:{current:/\bcurrent (?:plan|cover)\b/,cross:/\bcross[- ]train(?:ing)?\b/,external:/\bexternal (?:plan|cover)\b/},shock:{A:/\b(?:absence|shock) a\b/,B:/\b(?:absence|shock) b\b/,AB:/\b(?:absence|shock) (?:ab|a and b)\b/}},service:{servicePlan:{current:/\bcurrent (?:plan|staffing)\b/,staff:/\b(?:add staffing|staffing plan|staff plan)\b/,automate:/\bautomat(?:e|ion plan)\b/}},capacity:{capacityPlan:{build:/\bbuild\b/,buy:/\bbuy\b/,redeploy:/\bredeploy\b/,defer:/\bdefer\b/}}};
function otherScenarioIntent(request){
  const q=normal(request.question),context=request.context||{};
  if(!modelWords.test(q)&&!/^\s*(?:use|switch to|try)\b/.test(q))return null;
  const named=Object.entries(caseNames).filter(([,pattern])=>pattern.test(q)).map(([id])=>id);
  // "service capacity" refers to the service lab, not the separate workforce capacity lab.
  const ids=named.includes('service')&&named.includes('capacity')&&!/workforce capacity/.test(q)?named.filter(x=>x!=='capacity'):named;
  if(ids.length>1)return {invalid:true};
  const caseId=ids[0]||context.caseId;
  if(!caseId||caseId==='retention')return null;
  if(resetRequested(q)&&!(/\d|\b(?:zero|one|two|three|four|five|six|half|hundred|thousand|million)\b/.test(q)))return {caseId,overrides:{}};
  let rest=q;const overrides={};
  for(const [key,names]of Object.entries(assumptionNames[caseId])){
    const targets=names.join('|');
    const patterns=[new RegExp(`\\b(?:${targets})\\s*(?:at|to|of|is|=)?\\s*\\$?(${numberSource})(?:\\s*(?:percent|%|dollars))?`,'g')];
    if(/yield|gain/i.test(key))patterns.push(new RegExp(`(?<![\\w.])(${numberSource})\\s*(?:percent|%)\\s+(?:${targets})\\b`,'g'));
    const matches=patterns.flatMap(pattern=>[...rest.matchAll(pattern)]);
    if(matches.length>1)return {invalid:true};
    if(matches.length){overrides[key]=number(matches[0][1]);rest=rest.replace(matches[0][0],' ');}
  }
  for(const [key,choices]of Object.entries(scenarioChoices[caseId]||{})){
    const matches=Object.entries(choices).filter(([,pattern])=>pattern.test(rest));
    if(matches.length>1)return {invalid:true};
    if(matches.length)overrides[key]=matches[0][0];
  }
  if(/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|hundred|thousand|million)\b/.test(rest))return {invalid:true};
  return {caseId,overrides};
}

export function inheritAssumptions(request,plan){
  const p=validatePlan(plan),context=request.context||{};
  if(p.intent==='scenario'&&p.caseId===context.caseId&&!resetRequested(normal(request.question)))p.overrides={...(context.overrides||{}),...p.overrides};
  return validatePlan(p);
}

// Only bounded, unambiguous turns take this deterministic route. Everything else can use Astra.
export function contextualPlan(request){
  const q=normal(request.question),context=request.context||{};
  if(privateRequest.test(q))return clarify();
  if(context.caseId&&new RegExp(`^recalculate the ${context.caseId} scenario with these assumptions[.!?]?$`).test(q))return inheritAssumptions(request,route('scenario',null,context.caseId));
  if(/\bbreak[- ]?even\b/.test(q)&&!(/\d|\b(?:zero|one|two|three|four|five|six|half|hundred|thousand|million)\b/.test(q))&&(context.caseId==='retention'||/\bretention\b/.test(q)))return inheritAssumptions(request,route('scenario',null,'retention'));
  if(/\b(?:where should (?:i|we) focus|what (?:needs|deserves) (?:my|our) attention|what matters (?:most|today)|what should (?:i|we) (?:look at|focus on)|what can you (?:do|help)|how can you help|brief me|walk me through (?:the )?(?:business|priorities)|executive briefing)\b/.test(q))return route('overview');
  const retention=retentionIntent(request);
  if(retention){
    if(retention.invalid||retention.unit==='ambiguous')return clarify();
    const overrides={...retention.overrides};if(retention.value!==null&&retention.value!==undefined)overrides.effect=effectOf(retention);
    try{return inheritAssumptions(request,route('scenario',null,'retention',overrides));}catch{return clarify();}
  }
  const other=otherScenarioIntent(request);
  if(other){if(other.invalid)return clarify();try{return inheritAssumptions(request,route('scenario',null,other.caseId,other.overrides));}catch{return clarify();}}
  if(/\b(?:what could explain|why|driving|investigate)\b/.test(q)&&/\b(?:early exits?|first[- ]year exits?|new hires leaving)\b/.test(q))return {intent:'insight',metricId:null,caseId:null,overrides:{},insight:'onboardingExits'};
  if(/\b(?:where|which function|which region)\b/.test(q)&&/\b(?:first[- ]year|retention|early[- ]exits?)\b/.test(q)&&/\b(?:most|highest|risk|worst)\b/.test(q))return {intent:'breakdown',metricId:'C01',caseId:null,overrides:{},breakdown:{dimension:/\bregion\b/.test(q)?'region':'function',segments:null,sort:'desc',limit:null,window:null}};
  if(context.caseId&&resetRequested(q))return route('scenario',null,context.caseId);
  const explanation=/^(?:(?:and|so|then|okay|please)[, ]+)*(?:explain (?:that|this|it)|(?:what|which factors) could explain (?:that|this|it)|why (?:is|was) (?:that|this)|(?:what|what's|what is) (?:is )?driving (?:that|this|it)|tell me more|dig deeper|investigate (?:that|this))\??$/;
  if(explanation.test(q)){
    if(context.metricId==='C01'||context.insightId==='onboardingExits')return {intent:'insight',metricId:null,caseId:null,overrides:{},insight:'onboardingExits'};
    if(['E02','E05'].includes(context.metricId)||context.insightId==='costVariance')return {intent:'insight',metricId:null,caseId:null,overrides:{},insight:'costVariance'};
    if(context.caseId)return inheritAssumptions(request,route('scenario',null,context.caseId));
    if(context.metricId)return route('metric',context.metricId);
    return clarify();
  }
  // Comparison, trend and scope follow-ups reuse the metric reference, never an earlier result.
  const references=/\b(?:compare|versus|vs|break (?:that|this|it) down|by region|by function|trend|over time|how about|what about|and in|same (?:for|in)|show (?:that|this|it))\b/;
  if(context.metricId && references.test(q)){
    const named=demoPlan(request);
    if(named.intent!=='clarify')return named;
    const plan=demoPlan({...request,question:`${request.question} ${context.metricId}`});
    if(['metric','breakdown'].includes(plan.intent))return plan;
  }
  // A bare comparison with a named metric is deterministic as well; aliases are resolved upstream.
  if(request.mentions){const plan=demoPlan(request);if(plan.intent==='breakdown')return plan;}
  if(knownNextQuestions.has(q)){const plan=demoPlan(request);if(plan.intent!=='clarify')return inheritAssumptions(request,plan);}
  return null;
}

const compoundSeparator=/\s*(?:;\s*(?:and\s+)?(?:then\s+)?|,?\s+(?:and\s+)?then(?:\s+|$)|\s+and\s+(?=(?:show|model|compare|explain|send|email|predict|delete|approve|publish|deploy|execute|transfer)\b))\s*/i;
export function isCompoundRequest(input){return compoundSeparator.test(typeof input==='string'?input:input?.question||'');}
// A null workflow plus isCompoundRequest=true means refuse the WHOLE sequence, never reroute it.
export function contextualWorkflow(request){
  const parts=request.question.split(compoundSeparator).filter(Boolean);
  if(parts.length<2||parts.length>4)return null;
  let context=request.context||{},scope=request.scope;const steps=[];
  for(const question of parts){
    const current=validateRequest({question,scope,context}),plan=contextualPlan(current)||demoPlan(current);
    if(plan.intent==='clarify')return null;
    const validated=inheritAssumptions(current,plan);steps.push({question,scope:current.scope,plan:validated});
    context={...(validated.metricId?{metricId:validated.metricId}:{}),...(validated.caseId?{caseId:validated.caseId,overrides:effectiveAssumptions(validated.caseId,validated.overrides)}:{})};
    scope=current.scope;
  }
  return steps;
}

function clarification(request,result){
  if(isCompoundRequest(request)&&!contextualWorkflow(request))return {...result,title:'One step needs clarification',answer:'I could not resolve every step in that sequence, so I have not completed it as a workflow. Ask for metrics, comparisons, evidence explanations or one of the six scenarios; sending messages and executing external actions are not connected.',action:{type:'clarify',metricId:null,caseId:null,overrides:{}},followups:['Where should I focus today?','Compare attrition in Engineering and Sales and then model retention with half a percentage point']};
  const parsed=retentionIntent(request);
  if(!parsed)return result;
  if(parsed.unit==='ambiguous'){
    const value=parsed.value;
    return {...result,title:`Do you mean ${value} percentage points?`,answer:`Do you mean a ${value} percentage-point reduction in the exit rate, or a ${value}% relative reduction? The retention scenario starts with 168 exits among 1,200 hires (14%). These interpretations produce different results.`,followups:[`Model retention with a ${value} percentage-point reduction`,`Model retention with a ${value} percent relative reduction`],action:{type:'clarify',metricId:null,caseId:null,overrides:{}},pendingAssumption:{kind:'retention-unit',value}};
  }
  if(parsed.invalid)return {...result,title:'Let’s make the assumption explicit',answer:parsed.invalid,action:{type:'clarify',metricId:null,caseId:null,overrides:{}},followups:['Model retention with a 0.5 percentage-point reduction','Model retention with a 1 percentage-point reduction and program budget $300k']};
  if(parsed.value!==null&&parsed.value!==undefined){
    const effect=effectOf(parsed);
    if(!Number.isFinite(effect)||effect<0||effect>6)return {...result,title:'Choose a supported scenario assumption',answer:'The retention lab supports exit reductions from 0 to 6 percentage points. Keep the effect in that range; the program budget can range from $120,000 to $600,000.',action:{type:'clarify',metricId:null,caseId:null,overrides:{}},followups:['Model retention with a 1 percentage-point reduction']};
  }
  return result;
}
const questionSet={
  overview:['Where is first-year retention most at risk?','What is driving our cost over plan?','Model the HR service scenario'],
  retention:['Make it one percentage point','What could explain first-year exits?','Compare first-year exit rate in Engineering and Sales'],
  cost:['Compare workforce cost in Engineering and Sales','Show workforce cost trend over the last six months','Explain E05'],
  cohort:['What could explain that?','Compare Engineering and Sales','Model retention with a half-point reduction']
};
const knownNextQuestions=new Set(Object.values(questionSet).flat().map(normal));
function nextQuestions(result){
  if(result.action.type==='clarify')return result.followups;
  if(result.action.caseId==='retention'&&result.action.type==='scenario')return questionSet.retention;
  if(result.action.metricId==='C01'||result.insight?.id==='onboardingExits')return questionSet.cohort;
  if(['E02','E05'].includes(result.action.metricId))return questionSet.cost;
  if(result.action.type==='overview')return questionSet.overview;
  return result.followups;
}
function calculatedChart(result){
  if(result.action.type!=='scenario')return null;
  const id=result.action.caseId,r=scenario(id,result.action.overrides),a=effectiveAssumptions(id,result.action.overrides);
  const bar=(title,unit,rows)=>({type:'bar',title,unit,rows:rows.map(([label,value])=>({label,value})),basis:'Fixed hypothetical scenario population; conditional assumptions, not a forecast'});
  if(id==='retention')return bar('The economics of this assumption','usd',[['Gross modeled value',r.gross],['Program cost',r.cost],['Net modeled value',r.net]]);
  if(id==='service')return {type:'line',title:'Queue through the next 12 months',unit:'count',rows:[{label:'Opening',value:r.opening},...r.months.map((m,i)=>({label:`Month ${i+1}`,value:m.closing}))],basis:'Independent queue; each closing balance = opening + arrivals − resolved'};
  if(id==='skills'||id==='capacity')return bar(`Ready capacity at day ${id==='skills'?a.skillsDay:a.capacityDay}`,'count',[['Ready FTE',r.ready],['Remaining gap',r.gap]]);
  if(id==='continuity')return bar('Continuity under the selected absence','count',[['Covered services',r.covered],['Uncovered services',r.uncovered]]);
  if(id==='delivery')return bar('Accepted capacity against weekly demand','count',[['Accepted units / week',r.accepted],['Demand / week',a.demand]]);
  return null;
}
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const count=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
const percent=value=>new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(value);
function presentationNarrative(result){
  if(result.action.type==='scenario'&&result.action.caseId==='retention'){
    const r=scenario('retention',result.action.overrides);
    return {
      headline:r.net<0?`${money(Math.abs(r.net))} below break-even.`:r.net>0?`${money(r.net)} in conditional net value.`:'At break-even under these assumptions.',
      takeaway:`A ${count(r.effect)}-percentage-point reduction models ${count(r.avoided)} avoided exits among ${count(r.population)} future hires. With a ${money(r.cost)} program, break-even requires a ${count(r.breakEven)}-percentage-point reduction; these are conditional results, not a forecast.`
    };
  }
  if(result.insight?.headline){
    const i=result.insight;
    const takeaway=i.id==='onboardingExits'?`${count(i.delayed)} of ${count(i.hires)} hires started late, with a first-year exit rate of ${percent(i.delayedExitRate)} versus ${percent(i.onTimeExitRate)} for on-time starts. This is an association in the matured cohort, not proof of cause; the value estimate uses an assumed ${money(i.replacementCost)} replacement cost.`:result.answer;
    return {headline:i.headline,takeaway};
  }
  return {headline:result.title,takeaway:result.answer};
}
// Presentation beats reference immutable fact positions and evidence IDs in this very answer.
export function enrichAnswer(request,answer){
  let result=answer;
  if(!result.facts.length)result=clarification(request,result);
  if(result.action.type==='scenario'&&result.action.caseId==='retention'&&/\bbreak[- ]?even\b/.test(normal(request.question))){
    const r=scenario('retention',result.action.overrides),threshold=Number(r.breakEven.toFixed(4));
    result={...result,facts:[...result.facts,{label:'Break-even reduction',value:`${threshold} pp`,note:'Program cost / (1,200 hires × assumed replacement value), expressed in percentage points'}],answer:`The retention scenario breaks even at a ${threshold} percentage-point exit reduction with your current budget and replacement-value assumptions. ${result.answer}`};
  }
  const {action}=result,scene=result.facts.length?({breakdown:'comparison',insight:'investigation',scenario:'scenario',metric:'metric',overview:'briefing'}[action.type]||'briefing'):'clarify';
  const context=request.context||{},conversation={sourceVersion:result.sourceVersion};
  if(action.metricId)conversation.metricId=action.metricId;
  if(action.caseId)conversation.caseId=action.caseId;
  if(action.type==='scenario')conversation.overrides={...action.overrides};
  if(result.insight?.id)conversation.insightId=result.insight.id;
  if(result.pendingAssumption){
    conversation.pendingAssumption=result.pendingAssumption;conversation.caseId='retention';
    conversation.overrides={...(context.caseId==='retention'?context.overrides||{}:{}),...(retentionIntent(request)?.overrides||{})};
  }else if(scene==='clarify'){
    for(const key of ['metricId','caseId','overrides','insightId'])if(context[key]!=null)conversation[key]=structuredClone(context[key]);
  }
  const evidenceIds=result.evidence.map(item=>item.id),visibleFacts=result.facts.map((fact,index)=>({fact,index})).filter(({fact})=>fact.label!=='Assumptions');
  const beats=visibleFacts.slice(0,6).map(({fact,index},i)=>({id:`fact-${index}`,label:fact.label,detail:fact.value,context:fact.note,factIndexes:[index],evidenceIds:i===0?evidenceIds:[]}));
  if(!beats.length)beats.push({id:'clarification',label:result.title,detail:result.answer,context:'One clarification before continuing',factIndexes:[],evidenceIds:[]});
  const parsed=retentionIntent(request);
  if(parsed?.unit==='relative'&&action.type==='scenario'){
    const interpretation=`Interpreting ${parsed.value}% as a relative reduction from the fixed 14% baseline: ${Number(effectOf(parsed).toFixed(6))} percentage points.`;
    result={...result,answer:`${interpretation} ${result.answer}`,interpretation};
  }
  if(action.type==='scenario'&&context.caseId===action.caseId&&context.overrides&&!resetRequested(normal(request.question))){
    result={...result,boundary:result.boundary.replace('Each answer starts from the shipped scenario baseline, then applies stated overrides.','Previously stated scenario assumptions are retained; this turn changes only explicitly requested inputs.')};
  }
  const followups=nextQuestions(result);
  return {...result,followups,conversation,presentation:{version:1,scene,...presentationNarrative(result),beats,nextQuestions:followups,sourceVersion:result.sourceVersion,...(action.type==='scenario'?{chart:calculatedChart(result)}:{})}};
}
