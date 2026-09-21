'use strict';
const crypto=require('node:crypto');
const {chooseDesktopRoute}=require('./router');
const ERRORS=Object.freeze({STALE:'STALE_REFERENCE',BUSY:'DEVICE_BUSY',INVALID:'INVALID_REQUEST',UNSUPPORTED:'UNSUPPORTED_AGENT',UNCERTAIN:'OUTCOME_UNCERTAIN'});
function parseObserve(result){
  const text=result?.content?.find(x=>x.type==='text')?.text;
  if(!text)throw Error('Observe response missing metadata');
  return JSON.parse(text);
}
class ExecutionEngine {
  constructor({invokeNative,now=Date.now,maxFrames=128,maxOperations=512}){
    if(typeof invokeNative!=='function')throw Error('invokeNative required');
    this.invokeNative=invokeNative;this.now=now;this.maxFrames=maxFrames;this.maxOperations=maxOperations;
    this.frames=new Map();this.operations=new Map();this.leases=new Set();this.trace=[];
  }
  scope(userId,deviceId){return JSON.stringify([String(userId),String(deviceId)]);}
  prune(){
    const t=this.now();
    for(const [k,v] of this.frames)if(v.expiresAt<=t)this.frames.delete(k);
    for(const [k,v] of this.operations)if(v.expiresAt<=t)this.operations.delete(k);
    while(this.frames.size>=this.maxFrames)this.frames.delete(this.frames.keys().next().value);
    while(this.operations.size>=this.maxOperations)this.operations.delete(this.operations.keys().next().value);
  }
  async observe({userId,deviceId,params={}}){
    if(!userId||!deviceId)throw Error('Authenticated device required');
    this.prune();
    const raw=await this.invokeNative(deviceId,'native_observe',params,33000);
    const meta=parseObserve(raw);
    if(!meta.observationId||!meta.screenshot?.width||!meta.screenshot?.height)
      throw Error(ERRORS.UNSUPPORTED+': guarded observe not available on device');
    const key=this.scope(userId,deviceId)+':'+meta.observationId;
    this.frames.set(key,{expiresAt:this.now()+Math.min(meta.validForMs||30000,30000),
      width:meta.screenshot.width,height:meta.screenshot.height,hwnd:meta.window?.hwnd,
      snapshot:meta.snapshot||null,deviceId,userId});
    return raw;
  }
  route({userId,deviceId,observationId,selector,expect,x,y,allowPixelFallback=false}){
    const frame=this.frames.get(this.scope(userId,deviceId)+':'+observationId);
    return chooseDesktopRoute({frame,selector,expect,x,y,allowPixelFallback});
  }
  autoAct({userId,deviceId,actionId,observationId,idempotencyKey,selector,expect,x,y,allowPixelFallback=false}){
    const plan=this.route({userId,deviceId,observationId,selector,expect,x,y,allowPixelFallback});
    if(!plan.ok)return Promise.resolve({operationId:crypto.randomUUID(),status:'failed',
      effect:plan.code==='STALE_REFERENCE'?'stale_reference':'rejected',goal:'not_verified',
      error:{code:plan.code,message:plan.reason},routeUsed:null,latencyMs:0});
    return this.act({userId,deviceId,actionId,observationId,idempotencyKey,mode:plan.mode,
      x:plan.x,y:plan.y,steps:plan.steps});
  }
  act({userId,deviceId,actionId,observationId,idempotencyKey,x,y,verify,mode='preview',steps}){
    const startedAt=this.now(),operationId=crypto.randomUUID();
    const routeUsed=mode==='semantic'?'windows.uia.guarded_semantic':'windows.native.guarded_preview';
    const bad=(code,message)=>({operationId,status:'failed',routeUsed,effect:code===ERRORS.STALE?'stale_reference':'rejected',goal:'not_verified',
      error:{code,message},latencyMs:this.now()-startedAt});
    if(!userId||!deviceId||typeof observationId!=='string'||!observationId)
      return Promise.resolve(bad(ERRORS.INVALID,'Authenticated device and observationId required'));
    if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>128)
      return Promise.resolve(bad(ERRORS.INVALID,'Unique idempotencyKey (8-128 chars) required'));
    this.prune();
    const scope=this.scope(userId,deviceId),key=scope+':'+idempotencyKey;
    const fingerprint=JSON.stringify([observationId,mode,x,y,verify||null,steps||null]);
    const prior=this.operations.get(key);
    if(prior)return prior.fingerprint===fingerprint?prior.promise:Promise.resolve(bad(ERRORS.INVALID,'Idempotency key reused with different arguments'));
    const frameKey=scope+':'+observationId,frame=this.frames.get(frameKey);
    if(!frame||frame.expiresAt<=this.now())
      return Promise.resolve(bad(ERRORS.STALE,'Observation expired, missing, or owned by a different account/device'));
    if(mode==='preview'){
      if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=frame.width||y>=frame.height)
        return Promise.resolve(bad(ERRORS.INVALID,'Coordinates outside observed preview'));
    }else if(mode==='semantic'){
      const valid=Array.isArray(steps)&&steps.length>0&&steps.length<=20&&steps.every(s=>{
        if(!s||!['assert','invoke','set'].includes(s.op)||!s.selector||typeof s.selector!=='object')return false;
        if(s.op==='assert')return ['name','value'].includes(s.property)&&typeof s.equals==='string';
        if(!s.expect||!s.expect.selector||!['name','value'].includes(s.expect.property)||typeof s.expect.equals!=='string')return false;
        return s.op!=='set'||typeof s.value==='string';
      });
      if(!valid)return Promise.resolve(bad(ERRORS.INVALID,'Expected 1-20 exact UIA steps with explicit postconditions'));
    }else return Promise.resolve(bad(ERRORS.INVALID,'Unknown execution mode'));
    if(this.leases.has(scope))return Promise.resolve(bad(ERRORS.BUSY,'Another action is active on this device'));
    this.frames.delete(frameKey); // Consume once, including uncertain network outcomes.
    this.leases.add(scope);
    const promise=this.perform({deviceId,actionId,observationId,idempotencyKey,x,y,verify,mode,steps,frame,startedAt,operationId})
      .finally(()=>this.leases.delete(scope));
    this.operations.set(key,{promise,fingerprint,expiresAt:this.now()+600000});
    return promise;
  }
  async perform({deviceId,actionId,observationId,idempotencyKey,x,y,verify,mode,steps,frame,startedAt,operationId}){
    const semantic=mode==='semantic';
    const routeUsed=semantic?'windows.uia.guarded_semantic':'windows.native.guarded_preview';
    try{
      const action=semantic?'semantic_batch':'click_preview';
      const args=semantic?{observationId,hwnd:frame.hwnd,requireForeground:true,autoRetarget:false,steps}:
        {observationId,hwnd:frame.hwnd,x,y,imageWidth:frame.width,imageHeight:frame.height,autoRetarget:false};
      const call=await this.invokeNative(deviceId,'native_call',{action,args,_yhActionId:actionId},33000);
      const raw=call?.result||call;
      if(semantic && raw?.ok!==true){
        const ambiguous=raw?.outcome==='unknown-after-input';
        const stopped={operationId,idempotencyKey,status:'failed',routeUsed,
          effect:ambiguous?'unverifiable':'rejected',goal:'not_verified',
          error:{code:ambiguous?ERRORS.UNCERTAIN:'POSTCONDITION_FAILED',message:raw?.error||'UIA action stopped'},
          postconditionResults:raw?.events||[],latencyMs:this.now()-startedAt};
        this.log({operationId,deviceId,status:stopped.status,routeUsed,latencyMs:stopped.latencyMs});
        return stopped;
      }
      const result={operationId,idempotencyKey,status:'succeeded',routeUsed,effect:'confirmed',
        goal:semantic?'verified':'not_requested',latencyMs:this.now()-startedAt,
        evidence:{observationId,targetHwnd:raw?.targetHwnd||frame.hwnd},
        postconditionResults:semantic?(raw?.events||[]):[]};
      if(verify?.kind==='window_title_contains'){
        try{
          const observed=await this.invokeNative(deviceId,'native_observe',
            {semantic:false,quality:45,maxWidth:960,maxHeight:700},33000);
          const meta=parseObserve(observed),matched=String(meta.window?.title||'').includes(verify.value);
          result.goal=matched?'verified':'not_verified';
          result.postconditionResults.push({kind:verify.kind,matched});
        }catch(err){
          result.goal='not_verified';
          result.postconditionResults.push({kind:verify.kind,matched:false,
            error:'Verification unavailable; action may already have completed'});
        }
        result.latencyMs=this.now()-startedAt;
      }
      this.log({operationId,deviceId,status:result.status,routeUsed,latencyMs:result.latencyMs});
      return result;
    }catch(err){
      const message=String(err?.message||err),approval=message.includes('USER_APPROVAL_REQUIRED');
      const stale=message.includes('STALE_REFERENCE');
      const timeout=/timeout|disconnected|closed|ECONNRESET/i.test(message);
      const uncertainInput=message.includes('INPUT_UNCERTAIN')||message.includes('OUTCOME_UNCERTAIN');
      const result={operationId,idempotencyKey,status:timeout?'timed_out':'failed',routeUsed,
        effect:stale?'stale_reference':(timeout||uncertainInput)?'unverifiable':'rejected',goal:'not_verified',
        error:{code:approval?'USER_APPROVAL_REQUIRED':stale?ERRORS.STALE:
          (timeout||uncertainInput)?ERRORS.UNCERTAIN:'EXECUTION_FAILED',
          message:approval?'Windows needs local administrator approval. No GUI input was sent. After the user approves on the device, take a NEW observation before continuing.':
            stale?'Observation changed; capture a new frame':message},latencyMs:this.now()-startedAt};
      this.log({operationId,deviceId,status:result.status,routeUsed,latencyMs:result.latencyMs});
      return result;
    }
  }
  log(entry){this.trace.push({...entry,at:new Date(this.now()).toISOString()});if(this.trace.length>128)this.trace.shift();}
  diagnostics(){return {activeDevices:this.leases.size,pendingFrames:this.frames.size,
    idempotencyEntries:this.operations.size,recentOperations:this.trace.slice(-20)};}
}
module.exports={ExecutionEngine,ERRORS};