'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {CallTelemetry,codeOf,methodOf,routeOf}=require('../src/multiuser/call-telemetry');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-telemetry-privacy-'));
let db;
try{
 db=new DatabaseSync(path.join(dir,'telemetry.sqlite'));
 const journal=new CallTelemetry({db,retentionDays:30});
 const userA='user-alice',userB='user-bob',device='device-one';
 assert.equal(methodOf('native_call',{action:'click_preview'}),'WIN_MOUSE_GUARDED');
 assert.equal(methodOf('native_call',{action:'semantic_batch'}),'WIN_UIA_BATCH');
 assert.equal(routeOf('native_call',{action:'semantic_batch'}),'windows.uia.guarded');
 assert.equal(codeOf('HTTP 502 cloudflare'),'EDGE_ORIGIN_UNAVAILABLE');
 assert.equal(codeOf('Windows session locked'),'NO_INTERACTIVE_SESSION');
 const secret='SECRET_TOKEN_MUST_NOT_BE_PERSISTED_9845';
 for(let i=1;i<=5;i++){
  const success=i%2===0;
  assert(journal.record({traceId:'trace-1',userId:userA,deviceId:device,
    eventType:'agent_rpc',methodId:'WIN_MOUSE_GUARDED',routeId:'windows.native.guarded',
    attemptIndex:i,methodsTried:i>3?2:1,durationMs:12*i,
    outcome:success?'completed':'failed',
    errorCode:success?null:'timeout '+secret,errorStage:success?null:'AGENT_RESULT'}));
 }
 assert(journal.record({traceId:'trace-2',userId:userB,deviceId:device,
  eventType:'mcp_tool',methodId:'TOOL_COMPUTER_ACT',routeId:'windows.uia.guarded',
  attemptIndex:0,methodsTried:2,durationMs:241,outcome:'needs_review',
  errorCode:'OUTCOME_UNCERTAIN '+secret,errorStage:'TOOL_RESULT'}));
 assert.equal(journal.record({methodId:secret,eventType:'agent_rpc',outcome:'completed'}),false,
   'Raw unsanitized method IDs must not be persisted');
 const entries=db.prepare('SELECT user_id,attempt_index,methods_tried,duration_ms,outcome,error_code FROM yh_call_telemetry WHERE trace_id=? ORDER BY attempt_index').all('trace-1');
 assert.equal(entries.length,5);assert.deepEqual(entries.map(x=>x.attempt_index),[1,2,3,4,5]);
 assert(entries.every(x=>x.user_id===userA));
 assert.deepEqual(journal.summary({userId:userA}).reduce((n,x)=>n+x.calls,0),5);
 assert.deepEqual(journal.summary({userId:userB}).reduce((n,x)=>n+x.calls,0),1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM yh_call_telemetry').get().n,6);
 const disk=fs.readFileSync(path.join(dir,'telemetry.sqlite'),'utf8');
 assert(!disk.includes(secret),'A bearer/token-looking raw message cannot appear in persisted database');
 assert(!disk.includes('password'),'Never store response or command content');
 assert.equal(journal.failedWrites,1);
 console.log('PASS_TELEMETRY_PRIVACY_SQLITE users=2 methods=2 events=6 attempts=5 raw_tokens_in_db=0 row_scope=true error_codes_sanitized=true');
}catch(error){console.error('FAIL_TELEMETRY_PRIVACY',error.stack||error);process.exitCode=1}
finally{try{db?.close()}catch{};try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
