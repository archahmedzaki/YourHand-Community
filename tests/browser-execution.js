'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {BrowserExecution}=require('../src/execution/browser');
(async()=>{
  let now=1000,url='https://example.test/app',tabVersion=1,clicked=0,mode='button';
  const target={id:'tab1',url,title:'Fixture',webSocketDebuggerUrl:'ws://127.0.0.1/browser/'+tabVersion};
  let element;
  const reset=(tag='BUTTON')=>{
    element={tagName:tag,type:tag==='INPUT'?mode:'button',disabled:false,isConnected:true,
      textContent:'Confirm',value:'',getAttribute:k=>k==='type'?(tag==='INPUT'?mode:null):null,
      getBoundingClientRect:()=>({width:90,height:24}),click:()=>{clicked++;element.textContent='Clicked';},
      focus:()=>{},dispatchEvent:()=>{}};
  };
  reset();
  let failAfterDispatch=false;
  const call=async(id,action,args)=>{
    if(action==='status')return {running:true};
    if(action==='tabs')return [{...target,url,webSocketDebuggerUrl:'ws://127.0.0.1/browser/'+tabVersion}];
    if(action==='eval'){
      const document={querySelectorAll:selector=>selector==='#confirm'?[element]:[],
        body:{innerText:'Result completed'}};
      const location={href:url};
      const result=vm.runInNewContext(args.expression,{document,location,Event:class Event{}},{timeout:1500});
      if(failAfterDispatch && result?.dispatched)throw Error('CDP context destroyed');
      return {result:{value:result}};
    }
    throw Error('Unknown action '+action);
  };
  const engine=new BrowserExecution({call,now:()=>now});
  const base={userId:'alice',deviceId:'machine1',tabId:'tab1',selector:'#confirm'};
  const observed=await engine.observe(base);
  assert.equal(observed.tabId,'tab1');assert.ok(observed.observationId);
  const args={userId:'alice',deviceId:'machine1',observationId:observed.observationId,
    idempotencyKey:'browser-key-one',kind:'click',selector:'#confirm'};
  const first=await engine.act(args);
  assert.equal(first.status,'succeeded');assert.equal(clicked,1);assert.equal(first.goal,'not_requested');
  assert.deepEqual(await engine.act(args),first);assert.equal(clicked,1,'Duplicate DOM click');
  assert.equal((await engine.act({...args,userId:'bob',idempotencyKey:'other-user-key'})).effect,'stale_reference');
  reset();const observed2=await engine.observe(base);url='https://example.test/elsewhere';
  assert.equal((await engine.act({...args,observationId:observed2.observationId,
    idempotencyKey:'stale-url-key'})).effect,'stale_reference');assert.equal(clicked,1);
  url='https://example.test/app';reset();const observed3=await engine.observe(base);tabVersion++;
  assert.equal((await engine.act({...args,observationId:observed3.observationId,
    idempotencyKey:'stale-session-key'})).effect,'stale_reference');
  reset();const observed4=await engine.observe(base);element.textContent='Changed';
  assert.equal((await engine.act({...args,observationId:observed4.observationId,
    idempotencyKey:'stale-element-key'})).effect,'stale_reference');assert.equal(clicked,1);
  reset();const observed5=await engine.observe(base);
  assert.equal((await engine.act({...args,observationId:observed5.observationId,
    idempotencyKey:'wrong-selector-key',selector:'#other'})).effect,'stale_reference');
  reset('INPUT');mode='password';
  await assert.rejects(engine.observe(base),/TARGET_UNAVAILABLE/);
  mode='text';reset('INPUT');
  const observed6=await engine.observe(base);
  const typed=await engine.act({...args,observationId:observed6.observationId,idempotencyKey:'typing-key-123',
    kind:'type',text:'Hello world',expectTextContains:'Result completed'});
  assert.equal(typed.status,'succeeded');assert.equal(typed.goal,'verified');assert.equal(element.value,'Hello world');
  reset();const observed7=await engine.observe(base);failAfterDispatch=true;
  const unknown=await engine.act({...args,observationId:observed7.observationId,idempotencyKey:'browser-uncertain-key'});
  assert.equal(unknown.effect,'unverifiable');
  const before=clicked;assert.deepEqual(await engine.act({...args,observationId:observed7.observationId,
    idempotencyKey:'browser-uncertain-key'}),unknown);assert.equal(clicked,before);
  now+=31000;
  console.log('BROWSER_GUARDED_TESTS_OK clicks='+clicked+' user_scope=true tab_and_dom_stale=true');
})().catch(e=>{console.error(e);process.exitCode=1;});