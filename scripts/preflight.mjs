import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

const args = process.argv.slice(2), live = args.includes('--live'), claude = args.includes('--claude');
const outputIndex = args.indexOf('--output');
const output = outputIndex < 0 ? null : args[outputIndex + 1];
if (args.includes('--help')) {
  console.log('Usage: npm run preflight -- [--live] [--claude] [--output report.json]\nDefault: isolated synthetic check, no external network or API credits.\n--live: paid OpenAI TTS → transcription → Astra → narration probe.\n--claude: paid independent review of a synthetic saved scenario.\nMicrophone, WebRTC and WebM playback require the in-app browser checks.');
} else {
  const known = new Set(['--live', '--claude', '--output']);
  const unexpected = args.filter((value, index) => index !== outputIndex + 1 || outputIndex < 0).filter(value => !known.has(value));
  if (unexpected.length || (outputIndex >= 0 && (!output || output.startsWith('--')))) throw Error('Invalid arguments. Run npm run preflight -- --help.');
  if (live && !process.env.OPENAI_API_KEY) throw Error('--live requires OPENAI_API_KEY. No model call was made.');
  if (claude && (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL)) throw Error('--claude requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL. No model call was made.');
  const report = { schema:'workforce-preflight.v1', at:new Date().toISOString(), node:process.version, synthetic:true,
    externalCallsEnabled:{openai:live,claude}, checks:[], browserChecks:'Not run: use Connections & readiness, Continuous voice and narrated WebM export on the presentation machine.' };
  const state = await mkdtemp(join(tmpdir(),'workforce-preflight-'));
  const server = createServer({ storageDir:state, apiKey:live ? process.env.OPENAI_API_KEY : '',
    reviewApiKey:claude ? process.env.ANTHROPIC_API_KEY : '', reviewModel:claude ? process.env.ANTHROPIC_MODEL : '',
    fetchImpl:async (url, init) => {
      const origin = new URL(url).origin;
      if ((origin === 'https://api.openai.com' && live) || (origin === 'https://api.anthropic.com' && claude)) return fetch(url,init);
      throw Error('External request is disabled for this preflight.');
    }
  });
  let origin, stage='Initialize isolated workspace';
  const check = async (name, fn) => { stage=name; const detail=await fn(); report.checks.push({name,status:'passed',...(detail?{detail}: {})}); };
  const request = async (path, data, type='application/json') => {
    const res = await fetch(origin+path,{...(data===undefined?{}:{method:'POST',headers:{'content-type':type},body:type==='application/json'?JSON.stringify(data):data}),signal:AbortSignal.timeout(path==='/api/ask'?130000:50000)});
    if (!res.ok) { const message=await res.json().catch(()=>({})); throw Error(message.error||`HTTP ${res.status}`); }
    return type==='application/json' && path!=='/api/speech' ? res.json() : res;
  };
  try {
    await server.ready;
    await new Promise((done,fail) => { server.once('error',fail);server.listen(0,'127.0.0.1',done); });
    origin=`http://127.0.0.1:${server.address().port}`;
    await check('Local HTTP service and dashboard assets',async()=>{
      assert.equal((await request('/health')).ok,true);
      const page=await fetch(origin); assert.equal(page.status,200);const html=await page.text();
      assert.ok(html.includes('wi-dataset-bootstrap'));assert.ok(html.includes('wi-source-decide-js'));
      for(const file of ['conversation.js','live.js','operations.js','workspace.js']) assert.equal((await fetch(origin+'/'+file)).status,200);
      return 'Served initialized HTML and all four experience modules.';
    });
    let snapshot=await request('/api/data/snapshot');
    await check('Synthetic source coverage and report pagination',async()=>{
      assert.equal(snapshot.cells.length,240);assert.equal(snapshot.cohorts.length,20);
      const first=await request('/api/workday/report?name=CoreHCM&limit=7');assert.equal(first.rows.length,7);assert.ok(first.nextCursor);
      const next=await request('/api/workday/report?name=CoreHCM&limit=7&cursor='+encodeURIComponent(first.nextCursor));assert.notDeepEqual(next.rows[0],first.rows[0]);
      return '240 monthly function/region cells; 20 mature cohorts; paged report retrieval.';
    });
    await check('Versioned correction, replay and rejected-batch rollback',async()=>{
      const target=data=>data.cells.find(row=>row.function==='Engineering'&&row.region==='EMEA'&&row.month==='2026-09').flow.goalsSubmitted;
      const before=target(snapshot),initialVersion=snapshot.sourceVersion;
      const changed=await request('/api/workday/sync',{batch:'correction'});assert.equal(target(changed.snapshot),before+17);assert.notEqual(changed.snapshot.sourceVersion,initialVersion);
      const replay=await request('/api/workday/sync',{batch:'correction'});assert.equal(replay.changed,false);
      const invalid=await fetch(origin+'/api/workday/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch:'invalid'})});assert.equal(invalid.status,422);
      snapshot=await request('/api/data/snapshot');assert.equal(snapshot.sourceVersion,changed.snapshot.sourceVersion);
      return 'Correction adds 17 goal submissions; repeat is idempotent; invalid input preserves the valid snapshot.';
    });
    let draft;
    await check('Saved decision, evidence and server-calculated downside',async()=>{
      const pin={metricId:'P07',scope:{function:'Engineering',region:'EMEA',period:'2026-09'},sourceVersion:snapshot.sourceVersion};
      draft=await request('/api/decisions',{caseId:'retention',overrides:{effect:0.5},sourceVersion:snapshot.sourceVersion,
        context:pin,evidenceLedger:[pin],record:{rationale:'Synthetic preflight downside',owner:'Demo CHRO',snapshots:[{caseId:'retention',assumptions:{effect:3}}]}});
      assert.equal(draft.status,'draft-unapproved');assert.equal(draft.assumptions.effect,0.5);assert.equal(draft.record.snapshots.length,1);
      assert.equal(draft.evidenceLedger[0].sourceVersion,snapshot.sourceVersion);assert.equal((await request('/api/decisions')).items.length,1);
      assert.ok((await request('/api/audit')).events.length>0);
      return 'Saved active assumptions, observed context, pinned evidence, capture and audit metadata.';
    });
    await check(claude?'Claude API review of saved assumptions':'Offline method review',async()=>{
      const reviewed=await request('/api/review',{id:draft.id});assert.equal(reviewed.review.mode,claude?'claude':'rules');
      assert.ok(reviewed.review.review.decisionGates.length>0);return 'Review attached; calculated figures remain unchanged.';
    });
    if(live){
      let narration,transcript;
      await check('OpenAI speech generation',async()=>{
        narration=await request('/api/speech',{text:'Show employee headcount.'});assert.equal(narration.headers.get('content-type'),'audio/mpeg');
        narration=await narration.arrayBuffer();assert.ok(narration.byteLength>100);return 'Received MP3 audio bytes; playback still requires a browser.';
      });
      await check('OpenAI transcription of generated test speech',async()=>{
        const r=await request('/api/transcribe',narration,'audio/mpeg');transcript=(await r.json()).text;assert.ok(transcript.trim());
        return 'Generated synthetic speech was transcribed successfully.';
      });
      let result;
      await check('Astra investigation and grounded response',async()=>{
        result=await request('/api/ask',{question:transcript,sourceVersion:snapshot.sourceVersion});assert.equal(result.mode,'api');
        assert.ok(result.analysis?.sections?.length,'Astra must compose a structured explanation');
        const headcount=result.evidenceReferences?.find(item=>item.definitions?.some(definition=>definition.id==='P01'));
        assert.ok(headcount?.facts?.length,'The analyst must retrieve calculated P01 headcount evidence');
        assert.ok(result.analysis.sections.some(section=>section.kind==='finding'&&section.evidenceRefs.includes(headcount.refId)),'A finding must cite the retrieved headcount evidence');
        assert.equal(headcount.sourceVersion,snapshot.sourceVersion);assert.equal(result.sourceVersion,snapshot.sourceVersion);
        return 'Transcribed question produced a structured analysis citing calculated headcount evidence from the active source revision.';
      });
      await check('Narration of the governed answer',async()=>{
        const audio=await request('/api/speech',{text:result.answer});assert.ok((await audio.arrayBuffer()).byteLength>100);
        return 'Narration bytes generated from the same answer snapshot.';
      });
    }else{
      await check('Deterministic question and downside answer',async()=>{
        const result=await request('/api/ask',{question:'What if retention improves by only 0.5 percentage points?',sourceVersion:snapshot.sourceVersion});
        assert.equal(result.mode,'demo');assert.equal(result.facts.find(f=>f.label==='Net modeled value').value,'−$90k');
        return 'The 0.5 pp retention case reports −$90k net modeled value.';
      });
    }
  }catch(error){report.checks.push({name:stage,status:'failed',detail:error.message});process.exitCode=1;}
  finally{
    if(server.listening){server.closeAllConnections();await new Promise(done=>server.close(done));await server.whenClosed();}
    await rm(state,{recursive:true,force:true});
    report.passed=report.checks.length>0&&report.checks.every(x=>x.status==='passed');
    if(output){const path=resolve(output);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');}
    console.log(JSON.stringify(report,null,2));
  }
}
