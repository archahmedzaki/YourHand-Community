'use strict';
// Run only on the authorized VPS with filesystem ACLs. This intentionally
// exposes no HTTP endpoint for viewing other customers' aggregate diagnostics.
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const fs=require('node:fs');
const name=process.argv[2];
if(!name||!path.isAbsolute(name)||!fs.existsSync(name)){
 console.error('Usage: node diagnostics-report.cjs <absolute-path-to-customer-db>');
 process.exit(2);
}
let db;
try{
 db=new DatabaseSync(name,{readOnly:true});
 const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='yh_call_telemetry'").get();
 if(!exists){console.log(JSON.stringify({available:false,reason:'Telemetry not yet deployed to selected DB'}));process.exit(0)}
 const totals=db.prepare("SELECT event_type,outcome,COUNT(*) count FROM yh_call_telemetry GROUP BY event_type,outcome ORDER BY count DESC").all();
 const errors=db.prepare("SELECT method_id,route_id,error_code,error_stage,COUNT(*) count FROM yh_call_telemetry WHERE success=0 GROUP BY method_id,route_id,error_code,error_stage ORDER BY count DESC LIMIT 30").all();
 const slow=db.prepare("SELECT method_id,route_id,duration_ms,agent_duration_ms,network_queue_ms FROM yh_call_telemetry ORDER BY at DESC LIMIT 3000").all();
 const aggregate=new Map();
 for(const row of slow){
  const key=row.method_id+'|'+(row.route_id||'');
  const bucket=aggregate.get(key)||{methodId:row.method_id,routeId:row.route_id,samples:[],agent:[],network:[]};
  bucket.samples.push(row.duration_ms);
  if(row.agent_duration_ms!==null)bucket.agent.push(row.agent_duration_ms);
  if(row.network_queue_ms!==null)bucket.network.push(row.network_queue_ms);
  aggregate.set(key,bucket);
 }
 const quantile=(items,p)=>{
  if(!items.length)return null;
  const a=items.slice().sort((x,y)=>x-y);
  return a[Math.max(0,Math.ceil(a.length*p)-1)];
 };
 const routes=[...aggregate.values()].map(g=>({
  methodId:g.methodId,routeId:g.routeId,samples:g.samples.length,
  p50Ms:quantile(g.samples,.50),p95Ms:quantile(g.samples,.95),
  agentP95Ms:quantile(g.agent,.95),networkAndQueueP95Ms:quantile(g.network,.95)
 })).sort((a,b)=>b.samples-a.samples).slice(0,30);
 console.log(JSON.stringify({available:true,scope:'all_customers_aggregate_no_user_or_device_ids',
  count:totals.reduce((n,row)=>n+row.count,0),
  distinctUsers:db.prepare("SELECT COUNT(DISTINCT user_id) count FROM yh_call_telemetry WHERE user_id IS NOT NULL").get().count,
  totals,topErrors:errors,latencies:routes},null,2));
}catch(err){
 console.error('Diagnostics report unavailable:',String(err.code||'READ_FAILED').slice(0,40));
 process.exitCode=1;
}finally{try{db?.close()}catch{}}
