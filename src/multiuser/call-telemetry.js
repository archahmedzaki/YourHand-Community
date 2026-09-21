'use strict';
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
// No commands, prompts, paths, URLs, screenshot pixels, arguments, response
// bodies, auth headers, tokens or unsanitized exception messages are stored.
const CODE_MAP=[
 [/(?:USER_APPROVAL_REQUIRED|waiting_for_user_approval)/i,'USER_APPROVAL_REQUIRED'],
 [/\b(401|unauthorized|auth(?:entication)? failed|invalid_token)\b/i,'AUTH_REJECTED'],
 [/\b(403|permission|forbidden|operator access|scope|not linked|revok)\b/i,'ACCESS_DENIED'],
 [/\b(404|not found|no such device)\b/i,'NOT_FOUND'],
 [/\b(429|rate.?limit)\b/i,'RATE_LIMITED'],
 [/(?:502|503|504|cloudflare|gateway unavailable)/i,'EDGE_ORIGIN_UNAVAILABLE'],
 [/(?:timeout|timed.out|ETIMEDOUT)/i,'TIMEOUT'],
 [/(?:disconnect|socket|ECONNRESET|EPIPE|closed)/i,'CONNECTION_LOST'],
 [/(?:STALE_REFERENCE|stale.frame|observation.expired)/i,'STALE_REFERENCE'],
 [/(?:outcome.uncertain|INPUT_UNCERTAIN)/i,'OUTCOME_UNCERTAIN'],
 [/(?:INTERACTIVE_DESKTOP_UNAVAILABLE|WINDOWS_SECURE_DESKTOP|session.*locked)/i,'NO_INTERACTIVE_SESSION'],
 [/(?:ELEVATION_NOT_PROVISIONED|access.denied|requires.admin|UAC)/i,'ELEVATION_REQUIRED'],
 [/(?:Device busy|TAB_BUSY|DEVICE_BUSY|reserved)/i,'DEVICE_BUSY'],
 [/(?:POSTCONDITION_FAILED|not_verified)/i,'GOAL_NOT_VERIFIED'],
 [/(?:INVALID_REQUEST|invalid argument|invalid.*token)/i,'INVALID_REQUEST'],
 [/(?:UNSUPPORTED_AGENT|not supported)/i,'UNSUPPORTED_CAPABILITY'],
 [/(?:ENOSPC|disk full|database or disk is full)/i,'STORAGE_EXHAUSTED'],
 [/(?:memory|ENOMEM)/i,'RESOURCE_EXHAUSTED']
];
const SAFE_CODES=new Set(['AUTH_REJECTED','ACCESS_DENIED','NOT_FOUND','RATE_LIMITED',
 'EDGE_ORIGIN_UNAVAILABLE','TIMEOUT','CONNECTION_LOST','STALE_REFERENCE','OUTCOME_UNCERTAIN',
 'NO_INTERACTIVE_SESSION','USER_APPROVAL_REQUIRED','ELEVATION_REQUIRED','DEVICE_BUSY','GOAL_NOT_VERIFIED',
 'INVALID_REQUEST','UNSUPPORTED_CAPABILITY','STORAGE_EXHAUSTED','RESOURCE_EXHAUSTED',
 'UNCLASSIFIED_ERROR']);
const codeOf=(code)=>{
 const safe=String(code??'').slice(0,240);
 if(SAFE_CODES.has(safe))return safe;
 for(const [pattern,label] of CODE_MAP)if(pattern.test(safe))return label;
 return 'UNCLASSIFIED_ERROR';
};
const METHOD_IDS={
 native_call:{session_state:'WIN_SESSION_STATE',screenshot:'WIN_SCREENSHOT',observe:'WIN_OBSERVE',
   semantic_batch:'WIN_UIA_BATCH',click_preview:'WIN_MOUSE_GUARDED',batch:'WIN_NATIVE_BATCH',
   ping:'WIN_NATIVE_PING',ui_tree:'WIN_UI_TREE'},
 native_observe:'WIN_OBSERVE',native_screenshot:'WIN_SCREENSHOT',
 browser_call:{status:'BROWSER_STATUS',tabs:'BROWSER_TABS',eval:'BROWSER_CDP_EVAL'},
 fs_call:{read_text:'FS_READ',write_text:'FS_WRITE',stat:'FS_STAT',list:'FS_LIST',
   read_binary:'FS_READ_BINARY',search:'FS_SEARCH'},
 proc_call:{start:'PROC_START',read:'PROC_READ',write:'PROC_WRITE',kill:'PROC_KILL',list:'PROC_LIST'},
 exec:'BACKGROUND_PROCESS',ping:'AGENT_PING',system_info:'SYSTEM_INFO',
 mcp_call:'DC_BRIDGE',guarded_action_status:'ACTION_STATUS'
};
function methodOf(method,params={}){
 const entry=METHOD_IDS[method];
 if(typeof entry==='string')return entry;
 if(entry&&typeof entry==='object')return entry[String(params?.action||'')]||'OTHER_'+method.toUpperCase().slice(0,24);
 return /^[a-zA-Z_]{1,48}$/.test(method)?'RPC_'+method.toUpperCase():'RPC_OTHER';
}
function routeOf(method,params={},result=null){
 const known=result&&typeof result.routeUsed==='string'?result.routeUsed:'';
 if(/^[a-z0-9._-]{1,64}$/i.test(known))return known;
 if(method==='native_call'){
  const name=String(params.action||'');
  return name==='semantic_batch'?'windows.uia.guarded':name==='click_preview'?'windows.native.guarded':
    name==='batch'?'windows.native.batch':'windows.native.observation';
 }
 if(method==='native_observe')return 'windows.observe';
 if(method==='browser_call')return 'browser.cdp';
 if(method==='fs_call')return 'background.filesystem';
 if(['exec','proc_call'].includes(method))return 'background.process';
 if(method==='mcp_call')return 'desktop_commander';
 return 'agent.websocket';
}
const OUTCOMES=new Set(['completed','failed','rejected','needs_review','timed_out','disconnected','uncertain']);
const EVENT_TYPES=new Set(['mcp_tool','agent_rpc','web_request','web_connect','agent_socket','diagnostic']);
class CallTelemetry{
 constructor({db,clock=()=>new Date().toISOString(),retentionDays=30}={}){
  if(!db)throw Error('Database required');
  this.db=db;this.clock=clock;
  this.retentionDays=Math.min(90,Math.max(1,Number(retentionDays)||30));
  db.exec(`CREATE TABLE IF NOT EXISTS yh_call_telemetry (
     event_id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,at TEXT NOT NULL,
     user_id TEXT,device_id TEXT, event_type TEXT NOT NULL,
     method_id TEXT NOT NULL,route_id TEXT,attempt_index INTEGER NOT NULL,
     methods_tried INTEGER NOT NULL, duration_ms INTEGER NOT NULL, agent_duration_ms INTEGER, network_queue_ms INTEGER,
     outcome TEXT NOT NULL,error_code TEXT,error_stage TEXT,success INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_yh_trace_at ON yh_call_telemetry(at);
  CREATE INDEX IF NOT EXISTS idx_yh_trace_user_device ON yh_call_telemetry(user_id,device_id,at);
  CREATE INDEX IF NOT EXISTS idx_yh_trace_group ON yh_call_telemetry(trace_id,attempt_index);`);
  this.insert=db.prepare(`INSERT INTO yh_call_telemetry (
   event_id,trace_id,at,user_id,device_id,event_type,method_id,route_id,
   attempt_index,methods_tried,duration_ms,agent_duration_ms,network_queue_ms,outcome,error_code,error_stage,success)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  this.failedWrites=0;
 }
 record(data={}){
  try{
   const safe=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max?x:null;
   const type=EVENT_TYPES.has(data.eventType)?data.eventType:'diagnostic';
   const outcome=OUTCOMES.has(data.outcome)?data.outcome:'failed';
   const method=safe(data.methodId,80);
   // Fixed application-generated method classes only. Arbitrary raw commands,
   // bearer tokens, hostnames and paths must never become diagnostic IDs.
   if(!method||!/^(?:WIN_|BROWSER_|FS_|PROC_|BACKGROUND_|AGENT_|RPC_|TOOL_|HTTP_|WEB_DEVICE_CONNECT$|SYSTEM_INFO$|DC_BRIDGE$|ACTION_STATUS$|OTHER_)[A-Z0-9_]{0,70}$/.test(method))
     throw Error('Invalid telemetry method ID');
   const route=safe(data.routeId,80);
   const rawErr=data.errorCode;
   const errorCode=outcome==='completed'?null:codeOf(rawErr);
   const errStage=safe(data.errorStage,40);
   this.insert.run(crypto.randomUUID(),safe(data.traceId,80)||crypto.randomUUID(),this.clock(),
      safe(data.userId,90),safe(data.deviceId,90),type,method,
      route&&/^[a-zA-Z0-9_.:\/-]+$/.test(route)?route:null,
      Math.max(0,Math.min(999,Math.trunc(Number(data.attemptIndex)||0))),
      Math.max(0,Math.min(999,Math.trunc(Number(data.methodsTried)||0))),
      Math.max(0,Math.min(600000,Math.round(Number(data.durationMs)||0))),
      Number.isFinite(Number(data.agentDurationMs))&&data.agentDurationMs!==null&&data.agentDurationMs!==undefined?
        Math.max(0,Math.min(600000,Math.round(Number(data.agentDurationMs)))):null,
      Number.isFinite(Number(data.networkQueueMs))&&data.networkQueueMs!==null&&data.networkQueueMs!==undefined?
        Math.max(0,Math.min(600000,Math.round(Number(data.networkQueueMs)))):null,
      outcome,errorCode,errStage&&/^[A-Z_]{1,40}$/.test(errStage)?errStage:null,outcome==='completed'?1:0);
   return true;
  }catch(error){this.failedWrites++;return false}
 }
 prune(){
  const cutoff=new Date(Date.now()-this.retentionDays*86400000).toISOString();
  return this.db.prepare('DELETE FROM yh_call_telemetry WHERE at < ?').run(cutoff).changes;
 }
 recent({userId,deviceId=null,limit=30}={}){
  if(typeof userId!=='string'||!userId||userId.length>90)throw Error('Account required');
  const count=Math.min(60,Math.max(1,Math.trunc(Number(limit)||30)));
  const selected='at,device_id,event_type,method_id,route_id,attempt_index,methods_tried,duration_ms,outcome,error_code,error_stage';
  const sql='SELECT '+selected+' FROM yh_call_telemetry WHERE user_id=?'+
    (deviceId?' AND device_id=?':'')+' ORDER BY at DESC,event_id DESC LIMIT ?';
  return deviceId?this.db.prepare(sql).all(userId,deviceId,count):
    this.db.prepare(sql).all(userId,count);
 }
 summary({userId=null,limit=30}={}){
  const max=Math.min(200,Math.max(1,Math.trunc(Number(limit)||30)));
  const cond=userId?'WHERE user_id=?':'';
  const sql=`SELECT method_id,route_id,outcome,error_code,COUNT(*) AS calls,
      ROUND(AVG(duration_ms),1) AS mean_ms,MIN(duration_ms) AS min_ms,MAX(duration_ms) AS max_ms
      FROM yh_call_telemetry ${cond}
      GROUP BY method_id,route_id,outcome,error_code ORDER BY calls DESC LIMIT ?`;
  return userId?this.db.prepare(sql).all(userId,max):this.db.prepare(sql).all(max);
 }
}
module.exports={CallTelemetry,codeOf,methodOf,routeOf,performance};
