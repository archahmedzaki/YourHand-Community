'use strict';
const assert=require('node:assert/strict');
const {chooseRoute}=require('../src/execution/capability-router');
const {codeOf}=require('../src/multiuser/call-telemetry');
const {ExecutionEngine}=require('../src/execution/engine');
(async()=>{
 const agent={elevated:true,directFilesystem:true,directProcessSessions:true,uia:true,browserCdp:true};
 const prompt={interactive:true,locked:false,approvalPending:true};
 const plan=chooseRoute({kind:'desktop',session:prompt,agent});
 assert.deepEqual({route:plan.route,ready:plan.ready,reason:plan.reason},
  {route:'waiting_for_user_approval',ready:false,reason:'USER_APPROVAL_REQUIRED'});
 assert.equal(chooseRoute({kind:'desktop',session:prompt,agent,requiresAdmin:true,
    alternate:{kind:'process_run'}}).ready,false);
 assert.equal(chooseRoute({kind:'file_read',session:prompt,agent}).ready,true,
   'Unaffected, authorized background operations may continue');
 assert.equal(chooseRoute({kind:'desktop',session:{...prompt,approvalPending:false},agent}).ready,true,
   'Only a newly observed ordinary desktop is eligible for GUI');
 assert.equal(codeOf('USER_APPROVAL_REQUIRED'),'USER_APPROVAL_REQUIRED');
 assert.equal(codeOf('Error: USER_APPROVAL_REQUIRED: Windows needs approval'),'USER_APPROVAL_REQUIRED');
 let invoked=0;
 const engine=new ExecutionEngine({invokeNative:async(_d,m,p)=>{
  if(m==='native_observe')return {content:[{type:'text',text:JSON.stringify({
    observationId:'fresh-lab-1',screenshot:{width:800,height:600},window:{hwnd:12},
    validForMs:30000})}]};
  if(m==='native_call'){invoked++;assert.equal(p.action,'click_preview');
   throw Error('USER_APPROVAL_REQUIRED: Device user must approve locally')}
  throw Error('unexpected operation');
 }});
 await engine.observe({userId:'owner',deviceId:'isolated-device'});
 const result=await engine.act({userId:'owner',deviceId:'isolated-device',
   observationId:'fresh-lab-1',idempotencyKey:'isolated-gui-once-001',x:32,y:50,mode:'preview'});
 assert.equal(result.status,'failed');assert.equal(result.effect,'rejected');
 assert.equal(result.error.code,'USER_APPROVAL_REQUIRED');
 assert.equal(invoked,1,'Do not reissue uncertain user-approval blocked action');
 const retry=await engine.act({userId:'owner',deviceId:'isolated-device',
   observationId:'fresh-lab-1',idempotencyKey:'isolated-gui-once-001',x:32,y:50,mode:'preview'});
 assert.equal(retry.error.code,'USER_APPROVAL_REQUIRED');assert.equal(invoked,1);
 const newKeyNoFrame=await engine.act({userId:'owner',deviceId:'isolated-device',
   observationId:'fresh-lab-1',idempotencyKey:'isolated-gui-new-002',x:32,y:50,mode:'preview'});
 assert.equal(newKeyNoFrame.error.code,'STALE_REFERENCE');
 assert.equal(invoked,1,'Require new frame after local user approval');
 console.log('PASS_APPROVAL_WAIT_FAIL_CLOSED','cases=9',
   'protected_prompt_never_auto_clicked=true','approval_not_a_credential_request=true',
   'no_automatic_replay=true','fresh_observation_required=true','telemetry_code_sanitized=true');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
