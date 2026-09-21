'use strict';
// Account-scoped, durable usage accounting. No command text, tokens, paths,
// screenshots, email, application titles or other personal content is stored.
// A call is counted once per actual attempted user-initiated MCP tool; lower
// level RPCs, health probes and connection checks are never billable usage.
// Unlimited means no tool-call quota is enforced by YourHand itself.
const MAX_DURATION_MS=24*60*60*1000;
const MONITOR_TOOLS=new Set([
 'list_devices','ping_device','get_system_info','list_device_tools',
 'checkpoint_save','checkpoint_get','checkpoint_list',
 'device_lock_status','acquire_device_lock','release_device_lock',
 'session_state','computer_operation_status','computer_plan','computer_doctor',
 'browser_status','process_sessions'
]);
const NON_WORK_RPC=new Set(['AGENT_PING','SYSTEM_INFO','WIN_SESSION_STATE',
 'BROWSER_STATUS','ACTION_STATUS','WIN_NATIVE_PING']);
function countsAsUsage({tool,deviceId,attempts=0,methods=[]}={}){
 if(typeof deviceId!=='string'||!deviceId||!Number.isFinite(attempts)||attempts<1)return false;
 if(typeof tool!=='string'||!/^[a-z][a-z0-9_]{0,64}$/.test(tool))return false;
 if(MONITOR_TOOLS.has(tool))return false;
 const ids=[...methods];
 return ids.some(id=>typeof id==='string'&&id.length>0&&!NON_WORK_RPC.has(id));
}
function unionMs(intervals){
 let total=0,lastStart=null,lastEnd=null;
 for(const [start,end] of intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){
  if(lastStart===null){lastStart=start;lastEnd=end;continue}
  if(start>lastEnd){total+=lastEnd-lastStart;lastStart=start;lastEnd=end;}
  else lastEnd=Math.max(lastEnd,end);
 }
 return total+(lastStart===null?0:lastEnd-lastStart);
}
class UsageMeter {
 constructor({db,now=Date.now}={}){
  if(!db)throw Error('SQLite database required');
  this.db=db;this.now=now;this.failedWrites=0;
  db.exec(`CREATE TABLE IF NOT EXISTS yh_usage_epoch (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), started_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS yh_usage_calls (
      trace_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,started_ms INTEGER NOT NULL,ended_ms INTEGER NOT NULL,
      success INTEGER NOT NULL CHECK(success IN (0,1)));
    CREATE INDEX IF NOT EXISTS idx_yh_usage_owner_device_time
      ON yh_usage_calls(user_id,device_id,ended_ms,started_ms);`);
  db.prepare('INSERT OR IGNORE INTO yh_usage_epoch(singleton,started_ms) VALUES (1,?)').run(Math.floor(now()));
  this.startedMs=db.prepare('SELECT started_ms FROM yh_usage_epoch WHERE singleton=1').get().started_ms;
  this.insert=db.prepare('INSERT OR IGNORE INTO yh_usage_calls (trace_id,user_id,device_id,tool_id,started_ms,ended_ms,success) VALUES (?,?,?,?,?,?,?)');
  this.select=db.prepare('SELECT started_ms,ended_ms FROM yh_usage_calls WHERE user_id=? AND device_id=? AND ended_ms>=? ORDER BY started_ms');
  this.count=db.prepare('SELECT COUNT(*) AS count FROM yh_usage_calls WHERE user_id=? AND device_id=? AND ended_ms>=?');
 }
 record({traceId,userId,deviceId,tool,attempts,methods=[],startedMs,durationMs,success}={}){
  try{
   if(!countsAsUsage({tool,deviceId,attempts,methods}))return false;
   if(typeof traceId!=='string'||!/^[a-f0-9-]{36}$/.test(traceId))return false;
   if(typeof userId!=='string'||!userId||userId.length>90)return false;
   const start=Math.floor(Number(startedMs)),length=Math.ceil(Number(durationMs));
   if(!Number.isSafeInteger(start)||start<this.startedMs ||
     !Number.isFinite(length)||length<0||length>MAX_DURATION_MS)return false;
   const end=start+length;
   this.insert.run(traceId,userId,deviceId,tool,start,end,success===true?1:0);
   return true;
  }catch{this.failedWrites++;return false;}
 }
 summary({userId,deviceId}={}){
  if(typeof userId!=='string'||!userId||userId.length>90||
     typeof deviceId!=='string'||!deviceId||deviceId.length>90)
    throw Error('Authorized account and device required');
  const now=Math.floor(this.now()),since=Math.max(this.startedMs,now-7*86400000);
  const rows=this.select.all(userId,deviceId,this.startedMs);
  const total=unionMs(rows.map(r=>[r.started_ms,r.ended_ms]));
  const last7=rows.filter(r=>r.ended_ms>=since);
  const duration7=unionMs(last7.map(r=>[Math.max(since,r.started_ms),Math.min(now,r.ended_ms)])
    .filter(([a,b])=>b>=a));
  return {calls:rows.length,usageMs:total,last7DaysCalls:last7.length,
    last7DaysMs:duration7,unlimited:true,trackingSince:new Date(this.startedMs).toISOString()};
 }
}
module.exports={UsageMeter,countsAsUsage,unionMs};
