import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function setup(t,options={}){
  const calls=[];
  const server=createServer({apiKey:'sk-test-studio-never-sent',fetchImpl:async(...args)=>{calls.push(args);throw Error('Known Studio requests must not contact a model');},...options});
  await server.ready;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();});
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {url,calls,post};
}

test('Studio bootstrap provides governed overview and complete catalogue without a provider call',async t=>{
  const {url,calls}=await setup(t);
  const res=await fetch(url+'/api/studio/bootstrap');assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.response.action.type,'overview');assert.equal(data.response.facts.length,3);
  assert.equal(data.response.presentation.scene,'briefing');assert.ok(data.response.sourceVersion);
  assert.equal(data.catalog.length,50);assert.ok(data.catalog.some(m=>m.id==='P01'));assert.ok(data.catalog.some(m=>m.id==='E11'));assert.ok(data.catalog.every(m=>m.label&&m.definition));
  assert.equal(calls.length,0);assert.ok(!JSON.stringify(data).includes('sk-test'));
});

test('actual HTTP scenario chain retains bounded assumptions, exposes signed chart and avoids the provider',async t=>{
  const {post,calls}=await setup(t);
  const initial=await post('/api/ask',{question:'Model retention with half a percentage point and program budget $300k',scope:{function:'Engineering',region:'EMEA',period:'quarter'}});
  assert.equal(initial.status,200);const first=await initial.json();
  const next=await post('/api/ask',{question:'Keep the budget but make it one percentage point',scope:first.scope,context:first.conversation,sourceVersion:first.sourceVersion});
  assert.equal(next.status,200);const second=await next.json();
  assert.deepEqual(second.action.overrides,{effect:1,programCost:300000,replacementCost:25000});assert.deepEqual(second.scope,first.scope);
  assert.equal(second.presentation.chart.rows.find(r=>r.label==='Net modeled value').value,0);
  const edit=await post('/api/ask',{question:'Recalculate the retention scenario with these assumptions',scope:first.scope,context:{...second.conversation,overrides:{effect:.5,programCost:300000,replacementCost:25000}}});
  assert.equal(edit.status,200);const edited=await edit.json();assert.equal(edited.presentation.chart.rows.find(r=>r.label==='Net modeled value').value,-150000);
  assert.equal(calls.length,0);
});

test('stale conversational lineage fails even when the outer request names the current snapshot',async t=>{
  const {url,post,calls}=await setup(t);
  const first=await (await post('/api/ask',{question:'Model retention with half a percentage point'})).json();
  const synced=await post('/api/workday/sync',{batch:'correction'});assert.equal(synced.status,200);
  const current=await (await fetch(url+'/api/data/snapshot')).json();assert.notEqual(current.sourceVersion,first.sourceVersion);
  const stale=await post('/api/ask',{question:'Make it one percentage point',context:first.conversation,sourceVersion:current.sourceVersion});
  assert.equal(stale.status,409);assert.match((await stale.json()).error,/source|refresh|context/i);assert.equal(calls.length,0);
});

test('explicit compound requests return every governed workflow step and final scenario result',async t=>{
  const {post,calls}=await setup(t);
  const res=await post('/api/ask',{question:'Compare attrition in Engineering and Sales and then model retention with half a percentage point'});
  assert.equal(res.status,200);const result=await res.json();
  assert.equal(result.action.type,'scenario');assert.equal(result.action.overrides.effect,.5);
  assert.equal(result.workflow.length,2);assert.equal(result.workflow[0].action.type,'breakdown');assert.equal(result.workflow[1].action.type,'scenario');
  assert.equal(result.workflow[0].breakdown.rows.length,2);assert.equal(calls.length,0);
});

test('an unsupported compound clause prevents partial execution and model fallback',async t=>{
  const {post,calls}=await setup(t);
  for(const question of ['Show headcount and then send an email to the CEO','Show headcount; send an email to the CEO','Show headcount and send an email to the CEO','Explain C01 and then predict our share price','Compare Engineering and Sales and then model retention']){
    const response=await post('/api/ask',{question});assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.action.type,'clarify',question);assert.equal(result.facts.length,0);assert.equal(result.workflow,undefined);assert.match(result.answer,/every step/);
  }
  assert.equal(calls.length,0);
});

test('Studio bootstrap remains behind the workspace password',async t=>{
  const {url,post}=await setup(t,{password:'synthetic-studio-password'});
  assert.equal((await fetch(url+'/api/studio/bootstrap')).status,401);
  assert.equal((await post('/api/studio/bootstrap',{})).status,401);
});
