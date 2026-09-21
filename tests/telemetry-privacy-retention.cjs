'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {CallTelemetry,codeOf,methodOf,routeOf}=require('../src/multiuser/call-telemetry');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yh-privacy-telemetry-'));
let db;
try{
 db=new DatabaseSync(path.join(tmp,'private-test.db'));
 const telemetry=new CallTelemetry({db,retentionDays:30});
 const secret='TOKEN_SECRET_EXAMPLE_DO_NOT_PERSIST';
 assert.equal(codeOf('RPC timeout after 8000ms; path C:/private/'+secret),'TIMEOUT');
 assert.equal(codeOf('STALE_REFERENCE: screen changed '+secret),'STALE_REFERENCE');
 assert.equal(codeOf('Admin UAC needs consent '+secret),'ELEVATION_REQUIRED');
 assert.equal(methodOf('native_call',{action:'semantic_batch',command:secret}),'WIN_UIA_BATCH');
 assert.equal(routeOf('native_call',{action:'semantic_batch'}),'windows.uia.guarded');
 const req={traceId:'trace-01',userId:'user-a',deviceId:'device-a',eventType:'agent_rpc',
   methodId:methodOf('native_call',{action:'semantic_batch'}),routeId:'windows.uia.guarded',
   attemptIndex:1,methodsTried:2,durationMs:39,outcome:'failed',
   errorCode:'RPC timeout after 8000ms '+secret,errorStage:'RPC_OR_AGENT',
   command:secret,parameters:{token:secret},url:'https://secret.test/?bearer='+secret};
 assert.equal(telemetry.record(req),true);
 assert.equal(telemetry.record({...req,traceId:'trace-02',userId:'user-b',deviceId:'device-b',
   attemptIndex:2,outcome:'completed',errorCode:secret,durationMs:4}),true);
 const rows=db.prepare('SELECT * FROM yh_call_telemetry ORDER BY at,event_id').all();
 assert.equal(rows.length,2);
 assert.equal(rows[0].error_code,'TIMEOUT');
 assert.equal(rows[0].attempt_index,1);
 assert.equal(rows[0].methods_tried,2);
 assert.equal(rows[0].user_id,'user-a');
 assert.equal(rows[1].user_id,'user-b');
 assert.equal(rows[1].error_code,null);
 assert(!JSON.stringify(rows).includes(secret),'Secrets may not enter diagnostics DB');
 assert(!fs.readFileSync(path.join(tmp,'private-test.db')).toString('latin1').includes(secret),'No raw secrets in DB bytes');
 assert.equal(telemetry.summary({userId:'user-a'}).reduce((n,row)=>n+row.calls,0),1);
 assert.equal(telemetry.summary({userId:'user-b'}).reduce((n,row)=>n+row.calls,0),1);
 db.prepare('UPDATE yh_call_telemetry SET at=? WHERE trace_id=?').run('2020-01-01T00:00:00.000Z','trace-01');
 assert.equal(telemetry.prune(),1);
 assert.equal(db.prepare('SELECT COUNT(*) AS count FROM yh_call_telemetry').get().count,1);
 assert.equal(telemetry.failedWrites,0);
 console.log('PASS_PRIVACY_SAFE_PER_USER_TELEMETRY','methods_routes_attempts_latencies=true','no_raw_secrets=true',
  'same_customer_database=true','retention_30d=true','filtered_per_user=true');
}catch(e){console.error('FAIL_TELEMETRY_PRIVACY',e.stack||e);process.exitCode=1}
finally{try{db?.close()}catch{};try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}}
