'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const {OperationJournal}=require('../src/multiuser/operation-journal.js');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yh-journal-lab-'));
const file=path.join(tmp,'test.db');
let revoked=false;const approved=(u,d)=>!revoked&&u==='owner'&&d==='device1';
function connect(){
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;');
 return {db,journal:new OperationJournal({db,getDeviceForUser:approved})};
}
try{
 let {db,journal}=connect();
 const cmd={method:'click',params:{x:110,y:75}};
 let x=journal.submit('owner','device1','op1',cmd);
 assert.strictEqual(x.state,'queued');
 assert.strictEqual(journal.submit('owner','device1','op1',cmd).state,'queued');
 assert.throws(()=>journal.submit('owner','device1','op1',{method:'click',params:{x:111,y:75}}),/Idempotency conflict/);
 assert.throws(()=>journal.submit('stranger','device1','op1',cmd),/not linked/);
 x=journal.dispatch('owner','device1','op1','epochA');
 assert.strictEqual(x.state,'running');
 assert.throws(()=>journal.dispatch('owner','device1','op1','epochB'),/already dispatched/);
 assert.throws(()=>journal.finish('owner','device1','op1','epochB',{ok:true}),/Wrong owner/);
 db.close();
 ({db,journal}=connect());
 assert.strictEqual(journal.submit('owner','device1','op1',cmd).state,'running','reopen must not redispatch');
 assert.strictEqual(journal.recoverUnconfirmed('epochB'),0,'wrong owner may not alter operation');
 assert.strictEqual(journal.recoverUnconfirmed('epochA'),1,'uncertain operation needs review');
 assert.strictEqual(journal.get('owner','device1','op1').state,'needs_review');
 assert.throws(()=>journal.dispatch('owner','device1','op1','epochB'),/do not replay/);
 assert.throws(()=>journal.finish('owner','device1','op1','epochA',{ok:true}),/invalid state/);
 const op2=journal.submit('owner','device1','op2',{method:'read_file',params:{path:'fixture.txt'}});
 assert.strictEqual(op2.state,'queued');
 journal.dispatch('owner','device1','op2','epochB');
 assert.strictEqual(journal.finish('owner','device1','op2','epochB',{ok:true,value:8}).state,'completed');
 assert.strictEqual(journal.submit('owner','device1','op2',{method:'read_file',params:{path:'fixture.txt'}}).state,'completed');
 assert.strictEqual(journal.recoverUnconfirmed('epochB'),0,'finished operation must stay finished');
 revoked=true;
 assert.throws(()=>journal.get('owner','device1','op2'),/not linked/,'revoked owner must lose read access');
 db.close();
 console.log('PASS: journal persisted queued/running/completed/needs_review; no ambiguous replay; tenant/epoch/revoke guards; immutable idempotency hash');
}catch(e){console.error(e.stack);process.exitCode=1}
finally{try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}}
