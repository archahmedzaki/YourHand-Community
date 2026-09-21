'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
(async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-action-journal-test-'));
const modulePath=path.resolve(__dirname,'../yh-action-journal.mjs');
const {FileActionJournal}=await import(pathToFileURL(modulePath).href);
const j=new FileActionJournal(dir),id=n=>'a_'+crypto.createHash('sha256').update(n).digest('hex');
let effects=0;
const command={method:'native_call',action:'click_preview',args:{x:14,y:20}};
try{
 assert.deepEqual(j.status(id('new')),{state:'not_found',result:null});
 const first=await j.execute(id('first-click'),command,async()=>{effects++;return {ok:true,action:'click_preview',result:{ok:true}}});
 assert.equal(effects,1);assert.equal(j.status(id('first-click')).state,'completed');
 const recreated=new FileActionJournal(dir);
 const cached=await recreated.execute(id('first-click'),command,async()=>{effects++;throw Error('DUPLICATE_SIDE_EFFECT')});
 assert.deepEqual(cached,first);assert.equal(effects,1);
 await assert.rejects(()=>j.execute(id('first-click'),{...command,args:{x:15,y:20}},async()=>{}),/INVALID_REQUEST/);
 await assert.rejects(()=>j.execute('../outside',command,async()=>{}),/INVALID_ACTION_ID/);
 const crashId=id('crash-after-dispatch');
 const sideEffectPath=path.join(dir,'crash-side-effect.txt');
 const code=[
 "import {FileActionJournal} from "+JSON.stringify(pathToFileURL(modulePath).href)+";",
 "import fs from 'node:fs';",
 "const j=new FileActionJournal("+JSON.stringify(dir)+");",
 "await j.execute("+JSON.stringify(crashId)+","+JSON.stringify(command)+",async()=>{",
 " fs.appendFileSync("+JSON.stringify(sideEffectPath)+",'action-run\\n');",
 " process.exit(17);",
 "});"
 ].join('\n');
 const worker=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:10000});
 assert.equal(worker.status,17,'simulated crash must run side effect once then exit before completion');
 assert.equal(fs.readFileSync(sideEffectPath,'utf8'),'action-run\n');
 assert.equal(new FileActionJournal(dir).status(crashId).state,'running');
 await assert.rejects(()=>new FileActionJournal(dir).execute(crashId,command,async()=>{
   fs.appendFileSync(sideEffectPath,'DUPLICATE\n');return {};
 }),/OUTCOME_UNCERTAIN/);
 assert.equal(fs.readFileSync(sideEffectPath,'utf8'),'action-run\n','side effect must not be replayed after crash');
 const corrupt=id('corrupt-record');
 fs.writeFileSync(j.location(corrupt),'');
 await assert.rejects(()=>j.execute(corrupt,command,async()=>{throw Error('SHOULD_NOT_EXECUTE')}),/OUTCOME_UNCERTAIN/);
 // Concurrency: reserve is synchronous before perform; duplicate cannot re-enter side-effect.
 const concurrent=id('concurrent');
 let release;const pending=new Promise(resolve=>release=resolve);
 const active=j.execute(concurrent,command,async()=>{effects++;await pending;return {ok:true}});
 await assert.rejects(()=>j.execute(concurrent,command,async()=>{effects++;return {ok:true}}),/OUTCOME_UNCERTAIN/);
 release();await active;assert.equal(effects,2);
 console.log('PASS_LOCAL_AGENT_DURABLE_JOURNAL','cached_completed=true','no_crash_replay=true','no_concurrent_replay=true','tampered_record_fails_closed=true','no_production_actions');
}catch(err){console.error('FAIL_LOCAL_AGENT_JOURNAL',err.stack||err);process.exitCode=1}
finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
