import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, demoPlan, descriptor, scenario, validateRequest } from '../engine.mjs';
import { contextualPlan, contextualWorkflow, enrichAnswer, inheritAssumptions, isCompoundRequest } from '../intelligence.mjs';

const ask=(question,context={},scope={})=>{
  const request=validateRequest({question,context,scope});
  const plan=inheritAssumptions(request,contextualPlan(request)||demoPlan(request));
  return {request,plan,result:enrichAnswer(request,answer(request,plan))};
};

test('spoken half-point variants share exact trusted retention arithmetic',()=>{
  for(const phrase of ['a half-point reduction','half a percentage point','zero point five percentage points','0.5 pp','point five percentage points']){
    const {plan,result}=ask(`Model retention with ${phrase}`);
    assert.equal(plan.caseId,'retention',phrase);assert.equal(result.action.overrides.effect,.5,phrase);
    assert.equal(result.presentation.chart.rows.find(r=>r.label==='Net modeled value').value,-90000);
  }
});
test('retention follow-ups retain prior funding, replacement assumptions and selected scope',()=>{
  const scoped={function:'Engineering',region:'EMEA',period:'2026-01'};
  const first=ask('Model retention with half a percentage point and program budget $300k and replacement cost $30k',{},scoped).result;
  assert.deepEqual(first.action.overrides,{effect:.5,programCost:300000,replacementCost:30000});
  const next=ask('Keep the budget but make it one percentage point',first.conversation,scoped).result;
  assert.deepEqual(next.action.overrides,{effect:1,programCost:300000,replacementCost:30000});
  assert.deepEqual(next.scope,scoped);assert.match(next.boundary,/retained/);
  const threshold=ask('What would it take to break even?',next.conversation).result;
  assert.equal(threshold.facts.find(f=>f.label==='Break-even reduction').value,'0.8333 pp');
  const reset=ask('Reset the retention scenario to default assumptions',next.conversation).result;
  assert.deepEqual(reset.action.overrides,{effect:3,programCost:240000,replacementCost:25000});
  const resetWithChange=ask('Reset the retention scenario but set one percentage point',next.conversation).result;
  assert.deepEqual(resetWithChange.action.overrides,{effect:1,programCost:240000,replacementCost:25000});
});
test('percent ambiguity survives into the next turn and relative interpretation is explicit',()=>{
  const initial=ask('Model retention with 0.5 percent').result;
  assert.equal(initial.action.type,'clarify');assert.deepEqual(initial.conversation.pendingAssumption,{kind:'retention-unit',value:.5});
  const points=ask('Percentage points',initial.conversation).result;
  assert.equal(points.action.overrides.effect,.5);
  const relative=ask('Relative percent',initial.conversation).result;
  assert.ok(Math.abs(relative.action.overrides.effect-.07)<1e-10);assert.match(relative.answer,/fixed 14% baseline/);
  assert.ok(Math.abs(scenario('retention',relative.action.overrides).avoided-.84)<1e-9);
  const funded=ask('Model retention with 0.5 percent and program budget $300k').result;
  assert.equal(ask('Percentage points',funded.conversation).result.action.overrides.programCost,300000);
});
test('unsupported quantities and conflicting requests never lose an assumption',()=>{
  for(const question of ['Model retention with one percentage point and 100 extra hires','Model retention with -1 percentage points','Model retention with minus one percentage point','Model retention with 7 percentage points','Model retention with 1 percentage point and 2 percentage points','Model retention with 0.5 percentage points and program budget $900k','Model retention by increasing program budget by 20 percent'])assert.equal(ask(question).plan.intent,'clarify',question);
  assert.equal(ask('Which individual employee should we fire?').plan.intent,'clarify');
  assert.equal(contextualPlan(validateRequest({question:'What will our share price be?'})),null);
  assert.throws(()=>validateRequest({question:'Explain that',scope:{region:'Mars'}}));
});
test('comparisons understand spoken aliases and preserve region and month from context',()=>{
  const scope={function:'all',region:'EMEA',period:'2026-01'};
  const {result}=ask('Compare Engineering and Sales',{metricId:'E03'},scope);
  assert.equal(result.action.type,'breakdown');assert.deepEqual(result.breakdown.rows.map(r=>r.segment),['Engineering','Sales & marketing']);
  assert.deepEqual(result.scope,scope);
  for(const row of result.breakdown.rows)assert.equal(row.value,descriptor('E03',{...scope,function:row.segment}).value);
  assert.equal(ask('Compare attrition in Engineering and Sales').result.action.type,'breakdown');
});
test('contextual explanation follows evidence references and keeps association boundary',()=>{
  const scope={function:'Engineering',region:'EMEA',period:'quarter'};
  const insight=ask('What could explain that?',{metricId:'C01'},scope).result;
  assert.equal(insight.insight.id,'onboardingExits');assert.deepEqual(insight.scope,scope);assert.match(insight.boundary,/not proven to cause/);
  assert.equal(ask('What could explain early exits?').result.insight.id,'onboardingExits');
  assert.equal(ask('Explain that',{metricId:'E05'}).result.insight.id,'costVariance');
  assert.equal(ask('Explain that').plan.intent,'clarify');
});
test('all six labs support bounded typed follow-ups and server-calculated charts',()=>{
  const queries=[['retention','Model retention with one percentage point',{effect:1}],['skills','Model skills with a 90 percent yield and day 100',{yieldPct:90,skillsDay:100}],['delivery','Model delivery with demand 120 and unit value $400',{demand:120,unitValue:400}],['continuity','Model continuity with day 30',{continuityDay:30}],['service','Model service with arrivals 1200 and agents 10',{arrivals:1200,agents:10}],['capacity','Model capacity with day 90 and source release 4',{capacityDay:90,sourceRelease:4}]];
  for(const [id,question,expected]of queries){
    const {result,plan}=ask(question);assert.equal(plan.caseId,id,question);
    for(const [key,value]of Object.entries(expected))assert.equal(result.action.overrides[key],value,question);
    assert.ok(result.presentation.chart.rows.length>=2);assert.ok(result.presentation.chart.rows.every(r=>Number.isFinite(r.value)));
    const edited=ask(`Recalculate the ${id} scenario with these assumptions`,result.conversation).result;
    assert.deepEqual(edited.action.overrides,result.action.overrides);
  }
});
test('workflow resolves every explicit step or declines the whole compound request',()=>{
  const request=validateRequest({question:'Compare attrition in Engineering and Sales and then model retention with half a percentage point'});
  const steps=contextualWorkflow(request);assert.equal(steps.length,2);assert.equal(steps[0].plan.intent,'breakdown');assert.equal(steps[1].plan.overrides.effect,.5);
  assert.equal(contextualWorkflow(validateRequest({question:'Explain C01 and then predict our share price'})),null);
  for(const question of ['Show headcount and then send an email to the CEO','Show headcount; send an email to the CEO','Show headcount and send an email to the CEO','Show headcount then predict the share price','Show headcount and then']){
    const request=validateRequest({question});assert.equal(isCompoundRequest(request),true);assert.equal(contextualWorkflow(request),null);
    const result=enrichAnswer(request,answer(request,{intent:'clarify',metricId:null,caseId:null,overrides:{}}));
    assert.equal(result.action.type,'clarify');assert.equal(result.facts.length,0);assert.match(result.answer,/every step/);
  }
  for(const question of ['Show headcount','Then model retention','What can you do?'])assert.equal(isCompoundRequest(question),false);
});
test('presentation references only returned facts and scoped evidence; context is bounded',()=>{
  for(const question of ['Where should I focus today?','What can you help me with?','Explain C01','Model retention with half a percentage point']){
    const result=ask(question).result;
    assert.equal(result.presentation.sourceVersion,result.sourceVersion);
    for(const beat of result.presentation.beats){for(const index of beat.factIndexes)assert.ok(result.facts[index]);for(const id of beat.evidenceIds)assert.ok(result.evidence.some(e=>e.id===id));}
    assert.ok(!JSON.stringify(result.presentation).includes('selector'));
  }
  for(const context of [{caseId:'retention',overrides:{effect:9}},{overrides:{effect:1}},{metricId:'NO1'},{sourceVersion:'<script>'},{pendingAssumption:{kind:'retention-unit',value:-1}},{pendingAssumption:{kind:'retention-unit',value:1,command:'execute'}}])assert.throws(()=>validateRequest({question:'Explain that',context}));
  assert.equal(validateRequest({question:'Explain that',context:{sourceVersion:'snapshot-abc'}}).context.sourceVersion,'snapshot-abc');
});

test('presentation leads with conditional economics and preserves exact insight headlines',()=>{
  const downside=ask('Model retention with half a percentage point').result;
  assert.equal(downside.presentation.headline,'$90,000 below break-even.');
  assert.match(downside.presentation.takeaway,/6 avoided exits among 1,200 future hires/);
  assert.match(downside.presentation.takeaway,/0.8-percentage-point/);assert.match(downside.presentation.takeaway,/not a forecast/);
  const upside=ask('Model retention with three percentage points').result;
  assert.equal(upside.presentation.headline,'$660,000 in conditional net value.');
  const zero=ask('Model retention with one percentage point and program budget $300k').result;
  assert.equal(zero.presentation.headline,'At break-even under these assumptions.');
  for(const query of ['What could explain early exits?','Why are we over plan?']){
    const result=ask(query).result;assert.equal(result.presentation.headline,result.insight.headline);
    if(result.insight.id==='onboardingExits')assert.match(result.presentation.takeaway,/not proof of cause/);
  }
  const suppressed=ask('What could explain that?',{metricId:'C01'},{function:'Corporate',region:'Other'}).result;
  assert.equal(suppressed.presentation.takeaway,suppressed.answer);assert.match(suppressed.presentation.takeaway,/privacy/);
});

test('suggested Studio next questions resolve deterministically against their own conversation',()=>{
  for(const initial of ['Where should I focus today?','Explain C01','Model retention with half a percentage point','Why are we over plan?']){
    const result=ask(initial).result;
    for(const question of result.presentation.nextQuestions){
      const request=validateRequest({question,scope:result.scope,context:result.conversation});
      const plan=contextualPlan(request);assert.ok(plan,question);assert.notEqual(plan.intent,'clarify',question);
    }
  }
});
