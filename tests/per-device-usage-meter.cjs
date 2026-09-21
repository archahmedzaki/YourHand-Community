'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {UsageMeter,countsAsUsage,unionMs}=require('../src/multiuser/usage-meter');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-per-device-usage-'));
let db;
try{
 let now=Date.UTC(2026,8,21,6);
 db=new DatabaseSync(path.join(dir,'usage.db'));
 const usage=new UsageMeter({db,now:()=>now});
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).calls,0);
 assert.equal(countsAsUsage({tool:'ping_device',deviceId:'dev',attempts:1,methods:['AGENT_PING']}),false);
 assert.equal(countsAsUsage({tool:'read_file',deviceId:'dev',attempts:1,methods:['AGENT_PING']}),false);
 const record=(user,device,tool,start,duration,methods=['FS_READ'],attempts=1,traceId=crypto.randomUUID())=>
  usage.record({traceId,userId:user,deviceId:device,tool,startedMs:start,durationMs:duration,
   methods,attempts,success:true});
 assert.equal(record('A','dev','ping_device',now,1000),false);
 assert.equal(record('A','dev','read_file',now,1000,['AGENT_PING']),false);
 assert.equal(record('A','dev','read_file',now,1000,['FS_READ'],0),false);
 assert(record('A','dev','read_file',now,10*60000));
 assert(record('A','dev','read_file',now+5*60000,10*60000));
 assert(record('B','dev','read_file',now,25*60000));
 assert(record('A','other','read_file',now,30000));
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).calls,2);
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).usageMs,15*60000,
  'Overlapping calls for one account and device count elapsed time once');
 assert.equal(usage.summary({userId:'B',deviceId:'dev'}).usageMs,25*60000);
 assert.equal(usage.summary({userId:'A',deviceId:'other'}).calls,1);
 assert.equal(usage.summary({userId:'B',deviceId:'other'}).calls,0);
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).last7DaysCalls,2);
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).unlimited,true);
 const dedup=crypto.randomUUID();assert(record('A','dev','read_file',now,9000,['FS_READ'],1,dedup));
 assert(record('A','dev','read_file',now,9000,['FS_READ'],1,dedup));
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).calls,3,'Duplicate trace must not inflate count');
 now+=8*86400000;
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).calls,3,'Total usage survives week boundary');
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).last7DaysCalls,0);
 assert(record('A','dev','exec_command',now-500,1000,['BACKGROUND_PROCESS']));
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).last7DaysCalls,1);
 assert.equal(usage.summary({userId:'A',deviceId:'dev'}).last7DaysMs,500,'7-day duration clipped to now');
 assert.equal(unionMs([[10,20],[14,40],[40,50],[80,90]]),50);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM yh_usage_calls').get().n,6);
 const disk=fs.readFileSync(path.join(dir,'usage.db'),'utf8');
 assert(!disk.includes('SECRET_TOKEN'), 'No raw task contents are stored');
 db.close();db=new DatabaseSync(path.join(dir,'usage.db'));
 const restarted=new UsageMeter({db,now:()=>now});
 assert.equal(restarted.startedMs,Date.UTC(2026,8,21,6));
 assert.equal(restarted.summary({userId:'A',deviceId:'dev'}).calls,4,
  'Usage remains durable across Core restarts');
 console.log('PASS_PER_DEVICE_USAGE_METER',
  'accountIsolation=true','deviceIsolation=true','overlapDedup=true','traceIdDedup=true',
  'probesExcluded=true','7dayBoundary=true','durableAcrossRestart=true','unlimited=true');
}catch(err){console.error('FAIL_PER_DEVICE_USAGE',err.stack||err);process.exitCode=1}
finally{try{db?.close()}catch{};try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
