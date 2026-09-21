'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {ExecutionEngine,ERRORS}=require('../src/execution/engine');
const meta=(id,title='Fixture',w=360,h=200)=>({content:[{type:'image',data:'test',mimeType:'image/jpeg'},
  {type:'text',text:JSON.stringify({observationId:id,validForMs:30000,
    window:{hwnd:123,title},screenshot:{width:w,height:h},
    snapshot:{controls:[{name:'Confirm',controlType:'Button',enabled:true}]}})}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
  let tick=1000,seq=0,actions=0,failMode='',barrier=null;
  const engine=new ExecutionEngine({now:()=>tick,invokeNative:async(device,method,args)=>{
    if(method==='native_observe')return meta('frame-'+(++seq),args?.verifyTitle||'Fixture');
    if(method==='native_call'){
      actions++;if(barrier)await barrier.promise;
      if(failMode==='stale')throw Error('STALE_REFERENCE: changed');
      if(failMode==='timeout')throw Error('RPC timeout after 33000ms');
      if(failMode==='partial-input')throw Error('INPUT_UNCERTAIN: SendInput accepted 1 of 2 events; do not retry');
      if(args.action==='semantic_batch')return {result:{ok:failMode!=='semantic-fail',
        outcome:failMode==='semantic-fail'?'unknown-after-input':'postconditions-verified',
        completed:args.args.steps.length,events:[{op:'invoke',ok:failMode!=='semantic-fail'}]}};
      return {result:{targetHwnd:123,previewX:args.args.x}};
    }
    throw Error('Unexpected method '+method);
  }});
  const base={userId:'alice',deviceId:'pc1'};
  const observe=async ctx=>JSON.parse((await engine.observe({...base,...ctx})).content.find(x=>x.type==='text').text);
  const ref=await observe(),input={...base,observationId:ref.observationId,idempotencyKey:'stable-key-01',x:20,y:30};
  assert.equal(ref.observationId,'frame-1');
  const first=await engine.act(input);assert.equal(first.status,'succeeded');
  assert.equal(first.effect,'confirmed');assert.equal(first.goal,'not_requested');
  assert.deepEqual(await engine.act(input),first);assert.equal(actions,1,'idempotent replay caused a second click');
  assert.equal((await engine.act({...input,idempotencyKey:'different-key-01'})).error.code,ERRORS.STALE);
  const r2=await observe();
  assert.equal((await engine.act({...input,observationId:r2.observationId,userId:'bob',idempotencyKey:'bob-key-123'})).error.code,ERRORS.STALE);
  assert.equal((await engine.act({...input,observationId:r2.observationId,deviceId:'pc2',idempotencyKey:'pc2-key-123'})).error.code,ERRORS.STALE);
  assert.equal((await engine.act({...input,observationId:r2.observationId,idempotencyKey:'bad-coord-key',x:360})).error.code,ERRORS.INVALID);
  tick+=31000;
  assert.equal((await engine.act({...input,observationId:r2.observationId,idempotencyKey:'expired-key-123'})).error.code,ERRORS.STALE);
  const r3=await observe();barrier=deferred();
  const inFlight=engine.act({...input,observationId:r3.observationId,idempotencyKey:'inflight-key-123'});
  assert.equal((await engine.act({...input,observationId:r3.observationId,idempotencyKey:'busy-key-123'})).error.code,ERRORS.STALE);
  const r4=await observe();
  assert.equal((await engine.act({...input,observationId:r4.observationId,idempotencyKey:'busy-other-key'})).error.code,ERRORS.BUSY);
  barrier.resolve();await inFlight;barrier=null;
  failMode='stale';const r5=await observe();
  const stale=await engine.act({...input,observationId:r5.observationId,idempotencyKey:'native-stale-key'});
  assert.equal(stale.effect,'stale_reference');
  failMode='timeout';const r6=await observe();
  const unknown=await engine.act({...input,observationId:r6.observationId,idempotencyKey:'uncertain-key-123'});
  assert.equal(unknown.effect,'unverifiable');assert.equal(unknown.error.code,ERRORS.UNCERTAIN);
  const before=actions;assert.deepEqual(await engine.act({...input,observationId:r6.observationId,idempotencyKey:'uncertain-key-123'}),unknown);
  assert.equal(actions,before,'uncertain action was replayed');
  failMode='partial-input';const partialRef=await observe();
  const partial=await engine.act({...input,observationId:partialRef.observationId,idempotencyKey:'partial-input-key-123'});
  assert.equal(partial.effect,'unverifiable');assert.equal(partial.error.code,ERRORS.UNCERTAIN);
  assert.equal((await engine.act({...input,observationId:partialRef.observationId,idempotencyKey:'partial-input-second-key'})).error.code,ERRORS.STALE);
  failMode='';const r7=await observe();
  const verified=await engine.act({...input,observationId:r7.observationId,idempotencyKey:'verify-key-123',
    verify:{kind:'window_title_contains',value:'Fixture'}});
  assert.equal(verified.goal,'verified');
  const r8=await observe();
  const rejected=await engine.act({...input,observationId:r8.observationId,idempotencyKey:'verify-key-456',
    verify:{kind:'window_title_contains',value:'Nonexistent'}});
  assert.equal(rejected.status,'succeeded');assert.equal(rejected.goal,'not_verified');
  assert.equal(engine.diagnostics().activeDevices,0);
  const semanticSteps=[{op:'invoke',selector:{name:'Confirm',controlType:'Button'},
    expect:{selector:{name:'Done',controlType:'Text'},property:'name',equals:'Done'}}];
  const rs=await observe();
  const semantic=await engine.act({...base,observationId:rs.observationId,
    idempotencyKey:'semantic-success-key',mode:'semantic',steps:semanticSteps});
  assert.equal(semantic.routeUsed,'windows.uia.guarded_semantic');
  assert.equal(semantic.status,'succeeded');assert.equal(semantic.goal,'verified');
  const rs2=await observe();failMode='semantic-fail';
  const uncertainUi=await engine.act({...base,observationId:rs2.observationId,
    idempotencyKey:'semantic-fail-key',mode:'semantic',steps:semanticSteps});
  assert.equal(uncertainUi.effect,'unverifiable');assert.equal(uncertainUi.goal,'not_verified');
  failMode='';
  const rs3=await observe();
  assert.equal((await engine.act({...base,observationId:rs3.observationId,
    idempotencyKey:'semantic-invalid-key',mode:'semantic',steps:[{op:'invoke',selector:{name:'Confirm'}}]})).error.code,ERRORS.INVALID);
  assert.equal((await engine.act({...input,idempotencyKey:'semantic-success-key'})).error.code,ERRORS.INVALID);
  const autoFrame=await observe();
  const autoResult=await engine.autoAct({...base,observationId:autoFrame.observationId,
    idempotencyKey:'auto-semantic-key',selector:{name:'Confirm',controlType:'Button'},
    expect:semanticSteps[0].expect,x:20,y:30});
  assert.equal(autoResult.routeUsed,'windows.uia.guarded_semantic');
  assert.equal(autoResult.goal,'verified');
  const autoFrame2=await observe();
  const needConsent=await engine.autoAct({...base,observationId:autoFrame2.observationId,
    idempotencyKey:'no-consent-key',selector:{name:'Missing'},expect:semanticSteps[0].expect,x:20,y:30});
  assert.equal(needConsent.status,'failed');assert.equal(needConsent.error.code,'SEMANTIC_UNAVAILABLE');
  const pixelConsent=await engine.autoAct({...base,observationId:autoFrame2.observationId,
    idempotencyKey:'pixel-consent-key',selector:{name:'Missing'},expect:semanticSteps[0].expect,
    x:20,y:30,allowPixelFallback:true});
  assert.equal(pixelConsent.routeUsed,'windows.native.guarded_preview');
  const t0=performance.now();
  for(let i=0;i<1000;i++){
    const r=await observe();
    await engine.act({...input,observationId:r.observationId,idempotencyKey:'bench-'+i+'-key'});
  }
  console.log('EXECUTION_ENGINE_TESTS_OK actions='+actions+' simulated_ops=1000 elapsed_ms='+(performance.now()-t0).toFixed(1));
})().catch(e=>{console.error(e);process.exitCode=1;});