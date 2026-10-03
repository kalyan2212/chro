import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';

async function setup(t,options={}){
  const server=createServer({apiKey:'',...options});await server.ready;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;let cookie='',closed=false;
  const close=async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();};t.after(close);
  const request=(path,body,headers={})=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const login=async password=>{const response=await request('/api/login',{password});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];};
  return {request,login,close};
}

test('source browser returns actual bounded aggregate values and hides protected field families',async t=>{
  const {request}=await setup(t);
  const catalog=await (await request('/api/source/catalog')).json();
  assert.equal(catalog.categories.length,6);assert.ok(catalog.fields.some(field=>field.path==='stock.costBreakdown.overtime'&&field.editable));
  assert.ok(catalog.fields.every(field=>!/gender|diversity|race|cohort/i.test(field.path)));
  const table=await (await request('/api/source/data?category=cost')).json();
  const snapshot=await (await request('/api/data/snapshot')).json();
  assert.equal(table.sourceVersion,snapshot.sourceVersion);assert.equal(table.filters.month,snapshot.months.at(-1));assert.equal(table.filters.function,'all');
  for(const row of table.rows){const cell=snapshot.cells.find(cell=>cell.month===row.month&&cell.function===row.function&&cell.region===row.region);assert.equal(row.value,row.path.split('.').reduce((value,key)=>value[key],cell));}
  const all=await (await request('/api/source/data')).json();assert.equal(all.rows.length,300);assert.equal(all.truncated,true);assert.ok(all.totalRows>all.rows.length);
  assert.equal((await request('/api/source/data?path=.env')).status,400);
});

test('proposal, apply and undo preserve exact source values, reconcile costs and reject stale writes',async t=>{
  const {request}=await setup(t);
  const initial=await (await request('/api/data/snapshot')).json(),month=initial.months.at(-1),find=snapshot=>snapshot.cells.find(cell=>cell.month===month&&cell.function==='Engineering'&&cell.region==='EMEA');
  const cell=find(initial),before=cell.stock.costBreakdown.overtime;
  const changes=[{month,function:'Engineering',region:'EMEA',path:'stock.costBreakdown.overtime',operation:'add',value:1000}];
  const proposed=await request('/api/source/propose',{expectedSourceVersion:initial.sourceVersion,changes,reason:'User-directed overtime correction'});assert.equal(proposed.status,201);
  const proposal=await proposed.json();assert.equal(proposal.status,'proposed');assert.equal(proposal.changes.length,2);assert.equal(proposal.owner,undefined);assert.equal(proposal.changes[0].before,before);assert.equal(proposal.changes[0].after,before+1000);assert.equal(proposal.changes[1].derived,true);
  assert.equal((await (await request('/api/data/snapshot')).json()).sourceVersion,initial.sourceVersion);
  const applied=await request('/api/source/apply',{proposalId:proposal.id,expectedSourceVersion:initial.sourceVersion});assert.equal(applied.status,200);
  const result=await applied.json();assert.equal(result.changed,true);assert.equal(find(result.snapshot).stock.costBreakdown.overtime,before+1000);assert.equal(find(result.snapshot).stock.annualCostRunRate,cell.stock.annualCostRunRate+1000);assert.notEqual(result.snapshot.sourceVersion,initial.sourceVersion);
  assert.equal((await request('/api/source/apply',{proposalId:proposal.id,expectedSourceVersion:initial.sourceVersion})).status,409);
  assert.equal((await request('/api/source/propose',{expectedSourceVersion:initial.sourceVersion,changes,reason:'Stale'})).status,409);
  const history=await (await request('/api/source/history')).json();assert.equal(history.latestUndoableEditId,result.edit.id);assert.equal(history.edits[0].owner,undefined);
  const undone=await request('/api/source/undo',{editId:result.edit.id,expectedSourceVersion:result.snapshot.sourceVersion});assert.equal(undone.status,200);
  const restored=await undone.json();assert.equal(find(restored.snapshot).stock.costBreakdown.overtime,before);assert.equal(find(restored.snapshot).stock.annualCostRunRate,cell.stock.annualCostRunRate);assert.notEqual(restored.snapshot.sourceVersion,initial.sourceVersion);assert.equal(restored.edit.kind,'undo');
  const invalid=await request('/api/source/propose',{expectedSourceVersion:restored.snapshot.sourceVersion,changes:[{...changes[0],path:'stock.__proto__.polluted'}],reason:'Invalid path'});assert.equal(invalid.status,400);assert.equal(Object.prototype.polluted,undefined);
  const audit=await (await request('/api/audit')).json();assert.ok(audit.events.some(event=>event.type==='source.edit.applied'));assert.ok(audit.events.some(event=>event.type==='source.edit.undone'));
});

test('authenticated shared editors can undo after restart; cross-origin and unsigned writes cannot execute',async t=>{
  const storageDir=await mkdtemp(join(tmpdir(),'chro-source-http-'));t.after(()=>rm(storageDir,{recursive:true,force:true}));
  const password='synthetic-test-shared-password';
  const first=await setup(t,{storageDir,password});assert.equal((await first.request('/api/source/catalog')).status,401);
  assert.equal((await first.request('/api/source/apply',{proposalId:'unknown',expectedSourceVersion:'unknown'})).status,401);
  await first.login(password);
  const snapshot=await (await first.request('/api/data/snapshot')).json(),changes=[{month:snapshot.months.at(-1),function:'Engineering',region:'EMEA',path:'stock.costBreakdown.overtime',operation:'add',value:1000}];
  assert.equal((await first.request('/api/source/propose',{expectedSourceVersion:snapshot.sourceVersion,changes,reason:'Blocked origin'},{origin:'https://untrusted.example'})).status,403);
  assert.equal((await first.request('/api/source/propose',{expectedSourceVersion:snapshot.sourceVersion,changes,owner:'forged'})).status,400);
  const proposal=await (await first.request('/api/source/propose',{expectedSourceVersion:snapshot.sourceVersion,changes,reason:'Persistent source correction'})).json();
  const applied=await (await first.request('/api/source/apply',{proposalId:proposal.id,expectedSourceVersion:snapshot.sourceVersion})).json();await first.close();
  const second=await setup(t,{storageDir,password});await second.login(password);
  const history=await (await second.request('/api/source/history')).json();assert.equal(history.latestUndoableEditId,applied.edit.id);
  const undo=await second.request('/api/source/undo',{editId:applied.edit.id,expectedSourceVersion:applied.snapshot.sourceVersion});assert.equal(undo.status,200);assert.equal((await undo.json()).edit.kind,'undo');
  await second.close();
});

test('API analysis uses real source services and returns a proposal that the authenticated endpoint can apply',async t=>{
  let round=0;
  const {request}=await setup(t,{apiKey:'sk-test-source-editor',fetchImpl:async(url,options)=>{
    assert.match(String(url),/\/responses$/);const payload=JSON.parse(options.body),catalog=JSON.parse(payload.input[0].content[0].text.split('\n').slice(1).join('\n'));
    const month=catalog.sourceData.months.at(-1);let output;
    if(++round===1)output=[{type:'function_call',call_id:'inspect_actual',name:'inspect_source_data',arguments:JSON.stringify({month,function:'Engineering',region:'EMEA',category:'cost'})}];
    else if(round===2)output=[{type:'function_call',call_id:'propose_actual',name:'propose_source_changes',arguments:JSON.stringify({changes:[{month,function:'Engineering',region:'EMEA',path:'stock.costBreakdown.overtime',operation:'add',value:1000}],reason:'Requested source correction'})}];
    else {const items=payload.input.filter(item=>item.type==='function_call_output').flatMap(item=>JSON.parse(item.output).items||[]),proposal=items.find(item=>item.kind==='source-proposal');assert.ok(proposal);output=[{type:'message',content:[{type:'output_text',text:JSON.stringify({headline:'Source correction proposed',summary:'The actual source rows and exact pending correction are ready for review. No source value has changed.',sections:[{kind:'recommendation',title:'Review before applying',text:'Review the exact before and after values, including the reconciled total, then apply the proposal.',evidenceRefs:[proposal.refId]}],unknowns:[],followups:[],panels:[]})}]}];}
    return new Response(JSON.stringify({status:'completed',output}),{headers:{'content-type':'application/json'}});
  }});
  const response=await request('/api/ask',{question:'Show latest Engineering EMEA overtime source data and add $1,000 to it. Reason: Requested source correction',owner:'untrusted-client-owner'});assert.equal(response.status,200);
  const result=await response.json();assert.equal(round,3);assert.equal(result.sourceOnly,true);assert.equal(result.sourceEditProposal.status,'proposed');assert.equal(result.sourceEditProposal.owner,undefined);assert.ok(result.sourceData.rows.length);
  const unchanged=await (await request('/api/data/snapshot')).json();assert.equal(unchanged.sourceVersion,result.sourceEditProposal.sourceVersion);
  const applied=await request('/api/source/apply',{proposalId:result.sourceEditProposal.id,expectedSourceVersion:unchanged.sourceVersion});assert.equal(applied.status,200);assert.equal((await applied.json()).changed,true);
});

test('the guided edit endpoint validates choices without provider calls or source mutations and refuses stale drafts',async t=>{
  let providerCalls=0;
  const {request}=await setup(t,{apiKey:'sk-test-source-guide',fetchImpl:async()=>{providerCalls++;throw Error('Guide must not call the provider');}});
  const initial=await(await request('/api/data/snapshot')).json();
  const first=await request('/api/source/guide',{context:{sourceVersion:initial.sourceVersion,category:'cost'}});assert.equal(first.status,200);
  const opened=await first.json();assert.equal(opened.missing[0],'path');assert.ok(opened.sourceData.rows.some(row=>row.path==='stock.costBreakdown.employeeLoaded'));
  const context={...opened.context,path:'stock.costBreakdown.employeeLoaded',function:'Engineering',region:'EMEA',operation:'set',value:102000000};
  const selected=await(await request('/api/source/guide',{context})).json();assert.deepEqual(selected.missing,['allocation','reason']);
  const complete=await(await request('/api/source/guide',{context:{...context,allocation:'preserve_pay_level_proportions',reason:'Reforecast'}})).json();assert.equal(complete.readyForProposal,true);assert.equal(complete.context.reason,'Reforecast');
  assert.equal((await request('/api/source/guide',{context:{...context,sourceVersion:'old-source'}})).status,409);
  assert.equal((await request('/api/ask',{question:'Continue this source change',sourceEditContext:{...context,sourceVersion:'old-source'}})).status,409);
  assert.equal((await request('/api/source/guide',{context:{...context,path:'stock.loadedPayByLevel.0'}})).status,400);
  assert.equal((await request('/api/source/guide',{context,owner:'forged'})).status,400);
  assert.equal((await request('/api/source/guide',{context},{origin:'https://untrusted.example'})).status,403);
  assert.equal(providerCalls,0);assert.deepEqual(await(await request('/api/data/snapshot')).json(),initial);
  const history=await(await request('/api/source/history')).json();assert.equal(history.edits.length,0);assert.equal(history.proposals.length,0);
});
