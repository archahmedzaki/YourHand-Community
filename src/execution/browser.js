'use strict';
const crypto=require('node:crypto');
const MAX_AGE=30000;
const elementProbe=selector=>`(()=>{const a=document.querySelectorAll(${JSON.stringify(selector)});
 if(a.length!==1)return {matches:a.length};
 const e=a[0],r=e.getBoundingClientRect();
 return {matches:1,tag:e.tagName,kind:e.getAttribute('type')||'',text:(e.textContent||'').slice(0,120),
 value:typeof e.value==='string'?e.value.slice(0,120):'',width:r.width,height:r.height,
 disabled:!!e.disabled,connected:e.isConnected};})()`;
function inspectMeta(reply){
 const v=reply?.result?.value;
 if(v===undefined)throw Error('CDP evaluation did not return a value');
 return v;
}
function fingerprint(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function guardedExpression(frame,args){
 const {selector,kind,text}=args;
 const url=frame.url,expectedSelector=frame.selector;
 if(selector!==expectedSelector)throw Error('STALE_REFERENCE: selector changed');
 const payload={url,selector,kind,text:text??'',elementState:frame.elementState};
 return `(()=>{const p=${JSON.stringify(payload)},a=document.querySelectorAll(p.selector);
 if(location.href!==p.url)return {code:'STALE_REFERENCE',reason:'URL changed',dispatched:false};
 if(a.length!==1)return {code:'STALE_REFERENCE',reason:'Selector no longer unique',dispatched:false};
 const e=a[0],r=e.getBoundingClientRect();
 const state={matches:1,tag:e.tagName,kind:e.getAttribute('type')||'',text:(e.textContent||'').slice(0,120),
 value:typeof e.value==='string'?e.value.slice(0,120):'',width:r.width,height:r.height,
 disabled:!!e.disabled,connected:e.isConnected};
 if(JSON.stringify(state)!==JSON.stringify(p.elementState))
   return {code:'STALE_REFERENCE',reason:'Element changed since observation',dispatched:false};
 if(!e.isConnected||e.disabled||!r.width||!r.height||e.type==='password')
   return {code:'TARGET_UNAVAILABLE',dispatched:false};
 if(p.kind==='click')e.click();
 else{e.focus();const proto=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(proto,'value');
   if(d&&d.set)d.set.call(e,p.text);else e.value=p.text;
   e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
 return {dispatched:true,tag:e.tagName,kind:p.kind};})()`;
}
class BrowserExecution {
 constructor({call,now=Date.now}){this.call=call;this.now=now;this.frames=new Map();this.operations=new Map();this.leases=new Set();}
 scope(userId,deviceId){return JSON.stringify([String(userId),String(deviceId)]);}
 prune(){
   for(const [k,v] of this.frames)if(v.expiresAt<=this.now())this.frames.delete(k);
   for(const [k,v] of this.operations)if(v.expiresAt<=this.now())this.operations.delete(k);
   while(this.frames.size>=128)this.frames.delete(this.frames.keys().next().value);
   while(this.operations.size>=512)this.operations.delete(this.operations.keys().next().value);
 }
 async observe({userId,deviceId,tabId,selector}){
   if(!userId||!deviceId||typeof tabId!=='string'||!tabId||
      typeof selector!=='string'||!selector||selector.length>256)throw Error('tabId and bounded selector required');
   this.prune();
   const status=await this.call(deviceId,'status',{});
   if(status?.running!==true)throw Error('BROWSER_NOT_RUNNING: start browser explicitly');
   const tabs=await this.call(deviceId,'tabs',{}),tab=tabs.find(t=>t.id===tabId);
   if(!tab?.webSocketDebuggerUrl)throw Error('STALE_REFERENCE: tab not found');
   const e=inspectMeta(await this.call(deviceId,'eval',{targetId:tabId,expression:elementProbe(selector)}));
   if(e.matches!==1||e.disabled||!e.connected||!e.width||!e.height||e.kind==='password')
     throw Error('TARGET_UNAVAILABLE: selector must match one enabled visible non-password element');
   const id=crypto.randomUUID(),scope=this.scope(userId,deviceId);
   this.frames.set(scope+':'+id,{deviceId,userId,tabId,selector,
     url:tab.url,tabSession:fingerprint(tab.webSocketDebuggerUrl),elementState:e,
     expiresAt:this.now()+MAX_AGE});
   return {observationId:id,tabId,url:tab.url,title:tab.title,selector,validForMs:MAX_AGE,
     element:{tag:e.tag,kind:e.kind,text:e.text,disabled:e.disabled}};
 }
 act({userId,deviceId,actionId,observationId,idempotencyKey,kind='click',selector,text,expectUrlContains,expectTextContains}){
   const operationId=crypto.randomUUID(),started=this.now(),routeUsed='browser.cdp.guarded_dom';
   const bad=(code,message)=>({operationId,status:'failed',effect:code==='STALE_REFERENCE'?'stale_reference':'rejected',
     goal:'not_verified',routeUsed,error:{code,message},latencyMs:this.now()-started});
   if(!userId||!deviceId||!observationId||typeof idempotencyKey!=='string'||
      idempotencyKey.length<8||idempotencyKey.length>128||!['click','type'].includes(kind))
     return Promise.resolve(bad('INVALID_REQUEST','Valid identity, idempotencyKey and click/type required'));
   if(kind==='type'&&(typeof text!=='string'||text.length>20000))
     return Promise.resolve(bad('INVALID_REQUEST','Type requires bounded text'));
   this.prune();const scope=this.scope(userId,deviceId),key=scope+':'+idempotencyKey;
   const request=fingerprint([observationId,kind,selector,text,expectUrlContains,expectTextContains]);
   const existing=this.operations.get(key);
   if(existing)return existing.request===request?existing.promise:
     Promise.resolve(bad('INVALID_REQUEST','Idempotency key reused with different arguments'));
   const frameKey=scope+':'+observationId,frame=this.frames.get(frameKey);
   if(!frame)return Promise.resolve(bad('STALE_REFERENCE','Unknown or expired observation'));
   if(frame.selector!==selector)return Promise.resolve(bad('STALE_REFERENCE','Selector differs from observed element'));
   const lock=scope+':'+frame.tabId;
   if(this.leases.has(lock))return Promise.resolve(bad('TAB_BUSY','Another guarded action is running in the tab'));
   this.frames.delete(frameKey);this.leases.add(lock);
   const promise=this.perform({frame,kind,selector,text,expectUrlContains,expectTextContains,
     actionId,operationId,started,idempotencyKey,routeUsed}).finally(()=>this.leases.delete(lock));
   this.operations.set(key,{request,promise,expiresAt:this.now()+600000});
   return promise;
 }
 async perform({frame,kind,selector,text,expectUrlContains,expectTextContains,actionId,operationId,started,idempotencyKey,routeUsed}){
   const result={operationId,idempotencyKey,status:'failed',routeUsed,effect:'rejected',goal:'not_verified',
     latencyMs:0,evidence:{observationId:null,tabId:frame.tabId}};
   let dispatched=false,attempted=false;
   try{
     const tabs=await this.call(frame.deviceId,'tabs',{}),tab=tabs.find(t=>t.id===frame.tabId);
     if(!tab||tab.url!==frame.url||fingerprint(tab.webSocketDebuggerUrl)!==frame.tabSession)
       throw Error('STALE_REFERENCE: tab changed or browser restarted');
     attempted=true;
     const checked=inspectMeta(await this.call(frame.deviceId,'eval',
       {targetId:frame.tabId,expression:guardedExpression(frame,{selector,kind,text}),_yhActionId:actionId}));
     if(!checked?.dispatched){attempted=false;throw Error((checked?.code||'TARGET_UNAVAILABLE')+': '+(checked?.reason||'Action not dispatched'));}
     dispatched=true;result.status='succeeded';result.effect='confirmed';result.goal='not_requested';
     result.evidence={tabId:frame.tabId,dispatchConfirmed:true};
     if(expectUrlContains||expectTextContains){
       try{
         const probe=inspectMeta(await this.call(frame.deviceId,'eval',{targetId:frame.tabId,
           expression:'({url:location.href,text:document.body?document.body.innerText.slice(0,10000):""})'}));
         const matched=(!expectUrlContains||String(probe.url).includes(expectUrlContains))&&
           (!expectTextContains||String(probe.text).includes(expectTextContains));
         result.goal=matched?'verified':'not_verified';
       }catch{result.goal='not_verified';result.warning='Verification unavailable after dispatch';}
     }
   }catch(err){
     const message=String(err?.message||err),stale=message.includes('STALE_REFERENCE');
     const uncertain=attempted||dispatched||/timeout|disconnected|closed|ECONNRESET/i.test(message);
     result.status=uncertain?'timed_out':'failed';
     result.effect=stale?'stale_reference':uncertain?'unverifiable':'rejected';
     result.error={code:stale?'STALE_REFERENCE':uncertain?'OUTCOME_UNCERTAIN':'EXECUTION_FAILED',
       message:stale?'Tab/DOM changed; observe again':message};
   }
   result.latencyMs=this.now()-started;return result;
 }
}
module.exports={BrowserExecution};