require('dotenv').config({ path: require('path').join(__dirname, '.env') });
if (process.env.YOURHAND_ENV_FILE) require('dotenv').config({ path: process.env.YOURHAND_ENV_FILE, override: false });
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { YourHandStore } = require('./src/multiuser/store');
const { DurableTaskLedger } = require('./src/multiuser/task-ledger');
const { DeviceTaskLocks } = require('./src/multiuser/device-task-locks');
const { OperationJournal } = require('./src/multiuser/operation-journal');
const { CallTelemetry,codeOf,methodOf,routeOf,performance } = require('./src/multiuser/call-telemetry');
const { UsageMeter } = require('./src/multiuser/usage-meter');
const { ExecutionEngine } = require('./src/execution/engine');
const { BrowserExecution } = require('./src/execution/browser');
const { chooseRoute } = require('./src/execution/capability-router');
const { YourHandOAuth } = require('./src/multiuser/oauth');
const { createWebApp } = require('./src/multiuser/web');
const { WebSocketServer } = require('ws');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const z = require('zod/v4');

const VERSION = '0.9.0-alpha';
const PRODUCT_NAME = 'YourHand';
const AGENT_PORT = Number(process.env.YOURHAND_AGENT_PORT || 8791);
const MCP_PORT = Number(process.env.YOURHAND_MCP_PORT || 8792);
const WEB_PORT = Number(process.env.YOURHAND_WEB_PORT || 8790);
const DB_FILE = process.env.YOURHAND_DB_FILE || path.join(__dirname, 'runtime', 'yourhand-community.db');
const BASE_URL = process.env.YOURHAND_BASE_URL || `http://127.0.0.1:${WEB_PORT}`;
const MCP_PUBLIC_URL = process.env.YOURHAND_MCP_PUBLIC_URL || `${BASE_URL.replace(/\/$/,'')}/mcp`;
const WEB_DIR = path.join(__dirname, 'web');
const store = new YourHandStore(DB_FILE);
const taskLedger = new DurableTaskLedger(store);
const operationJournal = new OperationJournal({
  db:store.db,
  getDeviceForUser:(userId,deviceId)=>{
    const access=store.getDeviceForUser(userId,deviceId);
    return !!access && access.access_role!=='viewer';
  }
});
const EXECUTION_OWNER_EPOCH=crypto.randomUUID();

const oauth = new YourHandOAuth(store,{issuer:BASE_URL,resource:MCP_PUBLIC_URL});
const userContext = new AsyncLocalStorage();
const traceContext = new AsyncLocalStorage();
const telemetry = new CallTelemetry({db:store.db,retentionDays:process.env.YOURHAND_TELEMETRY_RETENTION_DAYS||30});
const usageMeter = new UsageMeter({db:store.db});
telemetry.prune();
const telemetryPruneTimer=setInterval(()=>{try{telemetry.prune()}catch{}},6*60*60*1000);
telemetryPruneTimer.unref();

const devices = new Map();
const pending = new Map();
const taskLocks = new DeviceTaskLocks();

function jsonText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}function normalizeResult(value) {
  if (value && Array.isArray(value.content)) return value;
  return jsonText(value);
}
const LEGACY_OWNER_USER_ID = String(process.env.YOURHAND_LEGACY_OWNER_USER_ID || '').trim();
const LEGACY_OWNER_DEVICE = String(process.env.YOURHAND_LEGACY_OWNER_DEVICE || '').trim();
const LEGACY_PUBLIC_KEY_DIR = process.env.YOURHAND_LEGACY_PUBLIC_KEY_DIR || './runtime/legacy-public-keys';
const LEGACY_MCP_AUTH_MESSAGE = 'yourhand-mcp-owner-v1';
let LEGACY_WEB_MCP_PATH = null;
try {
  const candidate = String(process.env.YOURHAND_LEGACY_WEB_MCP_PATH || '').trim();
  if (/^\/yh-web-[A-Za-z0-9_-]{20,}$/.test(candidate)) LEGACY_WEB_MCP_PATH = candidate;
} catch {}

function legacyOwnerFromBearer(token) {
  if (!LEGACY_OWNER_USER_ID || !token) return null;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(LEGACY_OWNER_DEVICE)) return null;
  let pubKey;
  try { pubKey = fs.readFileSync(path.join(LEGACY_PUBLIC_KEY_DIR, LEGACY_OWNER_DEVICE + '.pem'), 'utf8'); }
  catch { return null; }
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(LEGACY_MCP_AUTH_MESSAGE, 'utf8'), pubKey, Buffer.from(token, 'base64url')); }
  catch { return null; }
  if (!ok) return null;
  return store.db.prepare('SELECT id,email,name,picture FROM users WHERE id=?').get(LEGACY_OWNER_USER_ID) || null;
}
function requireMcpAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  let user = oauth.userFromAccessToken(token);
  const pathOnly = String(req.originalUrl || ((req.baseUrl || '') + (req.path || ''))).split('?')[0];
  if (!user && (pathOnly === '/mcp' || pathOnly === '/yourhand-rpc' || (LEGACY_WEB_MCP_PATH && pathOnly === LEGACY_WEB_MCP_PATH))) user = legacyOwnerFromBearer(token);
  if (!user) {
    res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${BASE_URL.replace(/\/$/,'')}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Connect your YourHand account"`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.yhUser = user;
  next();
}
function currentUser() {
  const user = userContext.getStore();
  if (!user) throw new Error('Unauthorized');
  return user;
}
function publicDevice(d) {
  return {
    id: d.id,
    name: d.name,
    hostname: d.meta.hostname || null,
    platform: d.meta.platform || null,
    arch: d.meta.arch || null,
    agentVersion: d.meta.agentVersion || null,
    dcVersion: d.meta.dcVersion || null,
    toolCount: d.tools.length,
    connectedAt: d.connectedAt,
    lastSeen: d.lastSeen
  };
}
function getDevice(ref, mode='control') {
  const user = currentUser();
  let d = devices.get(ref);
  if (!d) d = [...devices.values()].find(x => x.name === ref && store.getDeviceForUser(user.id,x.id));
  const access=d&&store.getDeviceForUser(user.id,d.id);
  if(!d||!access||d.ws.readyState!==1||!store.getActiveDevice(d.id))throw new Error('Device not found');
  if(mode==='control' && access.access_role==='viewer')throw new Error('Operator access required for device commands');
  if(user.scope){
    const granted=new Set(String(user.scope).split(/\s+/));
    if(!granted.has(mode==='control'?'devices.control':'devices.read'))throw new Error('OAuth scope does not authorize device '+mode);
  }
  return d;
}
// Only explicitly whitelisted observational calls bypass the exclusive mutating-task lock.
const READONLY_DC_TOOLS=new Set(['read_file','read_multiple_files','list_directory','get_file_info','list_processes','list_sessions','get_usage_stats']);
const READONLY_FS_ACTIONS=new Set(['stat','list','read_text','read_binary','search']);
function isReadOnlyRpc(method,params={}) {
  if(['ping','system_info','native_screenshot','native_observe','browser_screenshot'].includes(method))return true;
  if(method==='fs_call'&&READONLY_FS_ACTIONS.has(params.action))return true;
  if(method==='mcp_call'&&READONLY_DC_TOOLS.has(params.tool))return true;
  if(method==='proc_call'&&['list','read'].includes(params.action))return true;
  if(method==='guarded_action_status')return true;
  if(method==='native_call'&&['screenshot','observe','desktop_context','session_state','foreground','list_windows','semantic_snapshot','ui_tree','ui_find'].includes(params.action))return true;
  if(method==='browser_call'&&['status','tabs'].includes(params.action))return true;
  return false;
}
function rpcDispatch(deviceRef, method, params = {}, timeoutMs = 60000, traceMeta = null) {
  const mode=isReadOnlyRpc(method,params)?'read':'control';
  const d=getDevice(deviceRef,mode);
  // Viewer exposes only device overview/health; raw filesystem/screen contents
  // require the owner's explicit Operator grant even when the RPC is read-only.
  if(mode==='read' && !['ping','system_info'].includes(method) &&
     store.getDeviceForUser(currentUser().id,d.id).access_role==='viewer')
    throw new Error('Operator permission required for device content');
  const id = crypto.randomUUID();
  const caller=currentUser();
  let autoLease=null;
  if(mode==='control'){
    // Explicit interactive task reservations remain sticky by design. A plain
    // one-shot command must not reserve the whole shared PC for 15 minutes.
    taskLocks.dropIfUnauthorized(d.id,lockUserId=>{
      const row=store.getDeviceForUser(lockUserId,d.id);
      return !!row&&row.access_role!=='viewer';
    });
    const existing=taskLocks.info(d.id,caller.id);
    if(!existing.ownedByMe){
      autoLease='rpc_'+id.replace(/-/g,'');
      taskLocks.acquire(d.id,caller.id,autoLease);
    }else if(existing.taskId&&existing.taskId.startsWith('rpc_')){
      throw Error('Device is executing another command; wait for the active result');
    }
  }
  const releaseFinished=()=>{
    if(autoLease){try{taskLocks.release(d.id,caller.id,autoLease)}catch{}}
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Outcome uncertain: retain temporary reservation until lease expires.
      // Never grant another account GUI control while a timed-out side effect
      // may still be executing on the Agent.
      reject(new Error(`RPC timeout after ${timeoutMs}ms; outcome uncertain`));
    }, Math.min(Math.max(timeoutMs, 1000), 180000));
    pending.set(id, {
      traceMeta,
      resolve:value=>{releaseFinished();resolve(value)},
      reject:error=>{if(!/disconnect|outcome uncertain/i.test(String(error?.message||error)))releaseFinished();reject(error)},
      timer,deviceId:d.id,ws:d.ws,requesterId:caller.id
    });
    try {
      d.ws.send(JSON.stringify({ type: 'request', id, method, params }), err => {
        if (err && pending.get(id)?.ws === d.ws) {
          clearTimeout(timer); pending.delete(id);releaseFinished();reject(err);
        }
      });
    } catch (err) { clearTimeout(timer); pending.delete(id);releaseFinished();reject(err); }
  });
}
function recordInnerSteps(meta,common,trace){
 if(!Array.isArray(meta?.steps))return;
 for(const step of meta.steps.slice(0,64)){
  if(!step||typeof step.methodId!=='string'||!/^AGENT_(?:NATIVE|BROWSER)_[A-Z0-9_]{1,46}$/.test(step.methodId))continue;
  telemetry.record({...common,eventType:'agent_rpc',methodId:step.methodId,
    routeId:step.routeId,attemptIndex:step.attemptIndex,
    methodsTried:meta.steps.length,durationMs:step.durationMs,
    outcome:step.outcome==='completed'?'completed':'failed',
    errorCode:step.errorCode,errorStage:step.outcome==='completed'?null:'AGENT_INTERNAL'});
 }
}
// Every authenticated low-level attempt creates an append-only diagnostic
// event. Raw command text, arguments, URLs, device content and exceptions
// NEVER enter the telemetry DB. A failed pre-dispatch auth/lock check is
// recorded too; repeated attempts have a common trace ID.
async function rpc(deviceRef, method, params = {}, timeoutMs = 60000){
  const began=performance.now();
  const user=currentUser();
  const trace=traceContext.getStore();
  const attempt=trace?++trace.attempts:1;
  const methodId=methodOf(method,params);
  if(trace)trace.methods.add(methodId);
  const authorized=store.getDeviceForUser(user.id,deviceRef)||
    store.listDevices(user.id).find(x=>x.display_name===deviceRef);
  const deviceId=authorized?.id||null;
  const traceMeta={agentDurationMs:null,steps:[]};
  const common={traceId:trace?.id,userId:user.id,deviceId,eventType:'agent_rpc',
    methodId,routeId:routeOf(method,params),attemptIndex:attempt};
  try{

    const result=await rpcDispatch(deviceRef,method,params,timeoutMs,traceMeta);
    recordInnerSteps(traceMeta,common,trace);
    const state=['failed','needs_review','timed_out'].includes(result?.status)?result.status:
      result?.ok===false?'failed':'completed';
    const elapsed=performance.now()-began;
    telemetry.record({...common,durationMs:elapsed,
      agentDurationMs:traceMeta.agentDurationMs,
      networkQueueMs:traceMeta.agentDurationMs===null?null:Math.max(0,elapsed-traceMeta.agentDurationMs),
      methodsTried:trace?.methods.size||1,outcome:state,
      errorCode:result?.error?.code||result?.error?.message||null,
      errorStage:state==='completed'?null:'AGENT_RESULT'});
    return result;
  }catch(error){
    recordInnerSteps(traceMeta,common,trace);
    const code=codeOf(error?.message||error?.code);
    telemetry.record({...common,durationMs:performance.now()-began,
      methodsTried:trace?.methods.size||1,
      outcome:code==='TIMEOUT'?'timed_out':
        code==='CONNECTION_LOST'?'disconnected':'failed',
      errorCode:error?.message||error?.code,errorStage:deviceId?'RPC_OR_AGENT':'AUTH_OR_DEVICE'});
    throw error;
  }
}
// Execution facade coexists with the original typed tools and uses their existing
// per-account/device authorization, shared task locks, WebSocket response binding.
const execution = new ExecutionEngine({invokeNative:(deviceId,method,args,timeoutMs)=>rpc(deviceId,method,args,timeoutMs)});
const browserExecution = new BrowserExecution({call:(deviceId,action,args)=>rpc(deviceId,'browser_call',{action,args},20000)});

// Persistent idempotency and fail-closed recovery across Core process changes.
// Old in-memory engine caches are insufficient if a click was sent before a crash.
async function durableComputerAction(device,idempotencyKey,kind,payload,perform){
  const authorized=getDevice(device,'control'),deviceId=authorized.id,userId=currentUser().id;
  const operationId='op_'+crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0,64);
  const fingerprint={kind,requestHash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
  const prior=operationJournal.row(userId,deviceId,operationId);
  let record;
  try{record=operationJournal.submit(userId,deviceId,operationId,fingerprint);}
  catch(error){
    if(String(error?.message||'').startsWith('Idempotency conflict:'))
      return {operationId,status:'failed',effect:'rejected',goal:'not_verified',
        error:{code:'INVALID_REQUEST',message:'Idempotency key was reused with different arguments; original operation was not redispatched'}};
    throw error;
  }
  if(prior){
    if(record.state==='completed' && record.outcome!==null)return JSON.parse(record.outcome);
    return {operationId,status:'needs_review',effect:'unverifiable',goal:'not_verified',
      error:{code:'OUTCOME_UNCERTAIN',message:'Previous dispatch state is uncertain; inspect device state before starting a DIFFERENT authorized operation. No automatic replay.'}};
  }
  operationJournal.dispatch(userId,deviceId,operationId,EXECUTION_OWNER_EPOCH);
  try{
    // Scope the Agent-local action to the authorized user, device and durable
    // server record. No account may reuse another account's local action ID.
    const actionId='a_'+crypto.createHash('sha256').update(
      JSON.stringify([userId,deviceId,operationId])).digest('hex');
    const result=await perform({userId,deviceId,actionId});
    if(result?.effect==='unverifiable' || result?.status==='timed_out' || result?.status==='needs_review')
      operationJournal.uncertain(userId,deviceId,operationId,EXECUTION_OWNER_EPOCH);
    else operationJournal.finish(userId,deviceId,operationId,EXECUTION_OWNER_EPOCH,result);
    return result;
  }catch(error){
    try{operationJournal.uncertain(userId,deviceId,operationId,EXECUTION_OWNER_EPOCH)}catch{}
    return {operationId,status:'needs_review',effect:'unverifiable',goal:'not_verified',
      error:{code:'OUTCOME_UNCERTAIN',message:'Execution request failed after dispatch reservation. Inspect device before any new command. No automatic replay.'}};
  }
}
function dropDevice(deviceId, ws, reason) {
  // A replaced/stale socket must never remove the new session or reject its requests.
  if (devices.get(deviceId)?.ws === ws) {devices.delete(deviceId);taskLocks.forceReleaseDevice(deviceId);}
  for (const [id, p] of pending) {
    if (p.deviceId !== deviceId || p.ws !== ws) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(new Error(`Device disconnected (${reason})`));
  }
}

const agentHttp = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: PRODUCT_NAME, version: VERSION, devices: devices.size }));
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });
agentHttp.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'https://127.0.0.1');
  if (!['/agent','/agent-v2'].includes(url.pathname)) return socket.destroy();
  const deviceId = String(url.searchParams.get('device_id') || '').trim();
  const row = store.getActiveDevice(deviceId);
  if (!row?.public_key) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, row));
});

wss.on('connection', (ws, row) => {
  let authenticated = false;
  let d = null;
  const authTimer = setTimeout(() => { if (!authenticated) ws.close(1008, 'Authentication timeout'); }, 10000);
  ws._yourHandNonce = crypto.randomBytes(32).toString('base64url');
  ws.send(JSON.stringify({ type: 'challenge', nonce: ws._yourHandNonce }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!authenticated) {
      if (msg.type !== 'auth' || !msg.signature) return ws.close(1008, 'Authentication required');
      let ok = false;
      try { ok = crypto.verify(null, Buffer.from(ws._yourHandNonce, 'utf8'), row.public_key, Buffer.from(msg.signature, 'base64')); } catch {}
      if (!ok) return ws.close(1008, 'Authentication failed');
      authenticated = true;
      clearTimeout(authTimer);
      const old = devices.get(row.id);
      if (old?.ws?.readyState === 1) old.ws.close(1012, 'Replaced by new session');
      d = { id: row.id, userId: row.user_id, name: row.display_name, ws, meta: {}, tools: [], connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
      devices.set(row.id, d);
      store.touchDevice(row.id, true);
      telemetry.record({traceId:crypto.randomUUID(),userId:row.user_id,deviceId:row.id,
        eventType:'agent_socket',methodId:'AGENT_AUTHENTICATED',routeId:'agent.websocket',
        attemptIndex:1,methodsTried:1,durationMs:0,outcome:'completed'});

      ws.send(JSON.stringify({ type: 'auth_ok', deviceId: row.id }));
      console.log(`[YourHand] ${row.display_name} authenticated`);
      return;
    }
    d.lastSeen = new Date().toISOString();
    store.touchDevice(d.id, false);
    if (msg.type === 'hello') {
      d.meta = msg.meta || {};
      d.tools = Array.isArray(msg.tools) ? msg.tools : [];
      console.log(`[YourHand] ${d.name} online (${d.tools.length} tools)`);
      return;
    }
    if (msg.type === 'response' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      if (p.ws !== ws || p.deviceId !== d.id) return; // reject stale or forged cross-session replies
      clearTimeout(p.timer);
      pending.delete(msg.id);
      if(p.traceMeta && Number.isFinite(msg.agentElapsedMs) && msg.agentElapsedMs>=0 && msg.agentElapsedMs<600000)
        p.traceMeta.agentDurationMs=Math.round(msg.agentElapsedMs);
      if(p.traceMeta&&Array.isArray(msg.agentMethodCalls))
        p.traceMeta.steps=msg.agentMethodCalls.filter(x=>x&&typeof x==='object').slice(0,64);

      // If the owner revoked this teammate while a request was in flight, never
      // disclose its result to the now-unauthorized account. Device actions already
      // started cannot be undone; caller must inspect their outcome separately.
      if(!store.getDeviceForUser(p.requesterId,d.id))p.reject(new Error('Device access revoked during request; outcome requires review'));
      else msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'Agent error'));
    }
  });
  ws.on('close', (code, reason) => {
    clearTimeout(authTimer);
    if (d) {
      // Log only non-secret aggregate connection health. Do not expose device
      // name, credentials, RPC parameters, screen content, or raw close reason.
      const attached=devices.get(d.id)?.ws===ws;
      const inflight=[...pending.values()].filter(p=>p.deviceId===d.id&&p.ws===ws).length;
      const ageMs=Math.max(0,Date.now()-Date.parse(d.connectedAt||new Date().toISOString()));
      console.log('[YourHand] agent_socket_closed',
        JSON.stringify({at:new Date().toISOString(),deviceHash:crypto.createHash('sha256').update(d.id).digest('hex').slice(0,12),
          code,authenticated,attached,ageMs,inflight}));
      telemetry.record({traceId:crypto.randomUUID(),userId:d.userId,deviceId:d.id,
        eventType:'agent_socket',methodId:'AGENT_WS_DISCONNECTED',routeId:'agent.websocket',
        attemptIndex:1,methodsTried:1,durationMs:Math.max(0,Date.now()-Date.parse(d.connectedAt)),
        outcome:'disconnected',errorCode:'CONNECTION_LOST',errorStage:'WEBSOCKET_CLOSE'});
      dropDevice(d.id,ws,String(code));
    }
  });
  ws.on('error', err => console.error(`[YourHand] websocket error:`, err.message));
});

function withDevice(schema = {}) {
  return { device: z.string().describe('Connected YourHand device name'), ...schema };
}
async function dcCall(device, tool, args, timeoutMs = 120000) {
  return normalizeResult(await rpc(device, 'mcp_call', { tool, args }, timeoutMs));
}

function makeMcpServer() {
  const mcp = new McpServer({ name: 'yourhand', version: VERSION });
  // One trace for each MCP tool invocation (including authorization failures,
  // validation errors, cache hits and calls that never reach a device).
  const register=mcp.registerTool.bind(mcp);
  mcp.registerTool=(name,config,callback)=>{
    return register(name,config,async (...args)=>{
      const started=performance.now(),usageStartedMs=Date.now(),trace={id:crypto.randomUUID(),attempts:0,methods:new Set()};
      const user=currentUser();
      const rawDevice=args[0]?.device||args[0]?.device_id||null;
      const linked=rawDevice&&(store.getDeviceForUser(user.id,rawDevice)||
        store.listDevices(user.id).find(x=>x.display_name===rawDevice));
      const common={traceId:trace.id,userId:user.id,deviceId:linked?.id||null,
        eventType:'mcp_tool',methodId:'TOOL_'+name.toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,65),
        attemptIndex:0};
      return traceContext.run(trace,async()=>{
        try{
          const result=await callback(...args);
          // Tool-returned JSON can contain screenshots, files or commands:
          // inspect ONLY short metadata when the first result is plain text.
          let outcome=result?.isError?'failed':'completed',code=null,route=null;
          const first=result?.content?.[0];
          if(first?.type==='text'&&typeof first.text==='string'&&first.text.length<=2200&&first.text.trim().startsWith('{')){
            try{
              const metadata=JSON.parse(first.text);
              if(['failed','needs_review','timed_out'].includes(metadata.status))outcome=metadata.status;
              if(metadata.ok===false)outcome='failed';
              code=metadata.error?.code||metadata.code||null;
              route=typeof metadata.routeUsed==='string'?metadata.routeUsed:null;
            }catch{}
          }
          const elapsed=performance.now()-started;
          telemetry.record({...common,durationMs:elapsed,
            methodsTried:trace.methods.size,outcome,errorCode:code,routeId:route,
            errorStage:outcome==='completed'?null:'TOOL_RESULT'});
          usageMeter.record({traceId:trace.id,userId:user.id,deviceId:linked?.id,
            tool:name,attempts:trace.attempts,methods:trace.methods,
            startedMs:usageStartedMs,durationMs:elapsed,success:outcome==='completed'});
          return result;
        }catch(error){
          const elapsed=performance.now()-started;
          telemetry.record({...common,durationMs:elapsed,
            methodsTried:trace.methods.size,outcome:'failed',
            errorCode:error?.message||error?.code,errorStage:'MCP_DISPATCH'});
          usageMeter.record({traceId:trace.id,userId:user.id,deviceId:linked?.id,
            tool:name,attempts:trace.attempts,methods:trace.methods,
            startedMs:usageStartedMs,durationMs:elapsed,success:false});
          throw error;
        }
      });
    });
  };

  mcp.registerTool('list_devices', {
    description: 'List YourHand devices that are currently connected.',
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, async () => {
    const user = currentUser();
    return jsonText([...devices.values()].filter(d => store.getDeviceForUser(user.id,d.id)).map(d=>({...publicDevice(d),accessRole:store.getDeviceForUser(user.id,d.id).access_role})));
  });
  mcp.registerTool('checkpoint_save', {
    description: 'Persist a concise, confirmed task progress checkpoint. Use before and after lengthy work; do not replay an uncertain action after disconnect.',
    inputSchema: {
      device_id:z.string(), task_id:z.string(), expected_revision:z.number().int().nonnegative(),
      status:z.enum(['running','paused','completed','needs_review']),
      last_confirmed_step:z.string().max(4000), next_safe_step:z.string().max(4000),
      file_path:z.string().max(2048).optional(), notes:z.string().max(4000).optional()
    }, annotations:{readOnlyHint:false}
  }, async ({device_id,task_id,expected_revision,status,last_confirmed_step,next_safe_step,file_path,notes}) =>
    jsonText((()=>{
      const linked=store.getDeviceForUser(currentUser().id,device_id);
      if(!linked||linked.access_role==='viewer')throw new Error('Device operator permission required');
      return taskLedger.save(currentUser().id,task_id,device_id,expected_revision,status,
       {lastConfirmedStep:last_confirmed_step,nextSafeStep:next_safe_step,filePath:file_path||'',notes:notes||''});
    })()));
  mcp.registerTool('checkpoint_get', {
    description:'Read the latest persisted checkpoint for a task before attempting to resume it. Never assume an unconfirmed step finished.',
    inputSchema:{task_id:z.string()},annotations:{readOnlyHint:true}
  }, async ({task_id})=>jsonText(taskLedger.get(currentUser().id,task_id)));
  mcp.registerTool('checkpoint_list', {
    description:'List persisted task checkpoints for the signed-in account.',
    inputSchema:{},annotations:{readOnlyHint:true}
  }, async ()=>jsonText(taskLedger.list(currentUser().id)));
  mcp.registerTool('device_lock_status',{
    description:'See whether a shared device is currently reserved for a task by any account.',
    inputSchema:withDevice(),annotations:{readOnlyHint:true}
  },async ({device})=>{
    const d=getDevice(device,'read');
    return jsonText(taskLocks.info(d.id,currentUser().id));
  });
  mcp.registerTool('acquire_device_lock',{
    description:'Reserve the whole interactive device for your own task. Other accounts cannot issue mutating commands until released or lease expiration. No concurrent GUI edits.',
    inputSchema:withDevice({task_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/)}),
    annotations:{readOnlyHint:false}
  },async ({device,task_id})=>{
    const d=getDevice(device,'control');
    return jsonText(taskLocks.acquire(d.id,currentUser().id,task_id));
  });
  mcp.registerTool('release_device_lock',{
    description:'Release your own task reservation only after the task has finished or safely paused.',
    inputSchema:withDevice({task_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/)}),
    annotations:{readOnlyHint:false}
  },async ({device,task_id})=>{
    const d=getDevice(device,'control');
    return jsonText({released:taskLocks.release(d.id,currentUser().id,task_id)});
  });
  mcp.registerTool('ping_device', {
    description: 'Measure connectivity to a YourHand device.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({ device }) => {
    const t0 = Date.now();
    const r = await rpc(device, 'ping', {}, 10000);
    return jsonText({ ...r, latencyMs: Date.now() - t0 });
  });
  mcp.registerTool('get_system_info', {
    description: 'Get OS, CPU, memory, uptime and runtime information for a device.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({ device }) => jsonText(await rpc(device, 'system_info', {}, 10000)));
  mcp.registerTool('list_device_tools', {
    description: 'List all local Desktop Commander tools exposed by a device.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({ device }) => jsonText(getDevice(device,'read').tools));
  mcp.registerTool('call_device_tool', {
    description: 'Call any Desktop Commander MCP tool on a connected device. Use list_device_tools first for unfamiliar tools.',
    inputSchema: withDevice({
      tool: z.string(),
      arguments: z.record(z.string(), z.any()).optional()
    }), annotations: { readOnlyHint: false }
  }, async ({ device, tool, arguments: args }) => dcCall(device, tool, args || {}));  mcp.registerTool('start_process', {
    description: 'Start a terminal command or interactive process on a device.',
    inputSchema: withDevice({
      command: z.string(), timeout_ms: z.number().int().optional(),
      shell: z.string().optional(), verbose_timing: z.boolean().optional()
    }), annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => dcCall(device, 'start_process', args));
  mcp.registerTool('interact_with_process', {
    description: 'Send input to a running process and receive its response.',
    inputSchema: withDevice({
      pid: z.number().int(), input: z.string(), timeout_ms: z.number().int().optional(),
      wait_for_prompt: z.boolean().optional(), verbose_timing: z.boolean().optional()
    }), annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => dcCall(device, 'interact_with_process', args));
  mcp.registerTool('read_process_output', {
    description: 'Read buffered or new output from a running process.',
    inputSchema: withDevice({
      pid: z.number().int(), offset: z.number().int().optional(), length: z.number().int().optional(),
      timeout_ms: z.number().int().optional(), verbose_timing: z.boolean().optional()
    }), annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => dcCall(device, 'read_process_output', args));  mcp.registerTool('list_directory', {
    description: 'List files and folders on a device.',
    inputSchema: withDevice({ path: z.string(), depth: z.number().int().min(1).max(10).optional() }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => dcCall(device, 'list_directory', args));
  mcp.registerTool('read_file', {
    description: 'Read a file using Desktop Commander format-aware readers.',
    inputSchema: withDevice({
      path: z.string(), isUrl: z.boolean().optional(), offset: z.number().int().optional(),
      length: z.number().int().optional(), sheet: z.string().optional(), range: z.string().optional(),
      options: z.record(z.string(), z.any()).optional()
    }), annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => dcCall(device, 'read_file', args));
  mcp.registerTool('read_multiple_files', {
    description: 'Read several files from a device in one call.',
    inputSchema: withDevice({ paths: z.array(z.string()).min(1).max(50) }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => dcCall(device, 'read_multiple_files', args));
  mcp.registerTool('write_file', {
    description: 'Create, rewrite or append a file on a device.',
    inputSchema: withDevice({ path: z.string(), content: z.string(), mode: z.enum(['rewrite','append']).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, async ({ device, ...args }) => dcCall(device, 'write_file', args));  mcp.registerTool('get_config', {
    description: 'Read Desktop Commander configuration from a device.',
    inputSchema: withDevice(),
    annotations: { readOnlyHint: true }
  }, async ({ device }) => dcCall(device, 'get_config', {}));

  const nativeArgsSchema = z.record(z.string(), z.any()).optional();

  mcp.registerTool('session_state', {
    description: 'Report whether the interactive Windows session is locked/unlocked and whether native input is currently available.',
    inputSchema: withDevice(),
    annotations: { readOnlyHint: true }
  }, async ({ device }) => jsonText(await rpc(device, 'native_call', { action:'session_state', args:{} }, 10000)));

  mcp.registerTool('native_call', {
    description: 'Call a fast YourHand native desktop action on a connected device. Actions include windows, UI Automation, mouse, keyboard, clipboard, screenshot, launch and waits.',
    inputSchema: withDevice({
      action: z.enum(['ping','list_windows','foreground','focus_window','close_window','mouse','scroll','hotkey','type_text','clipboard_get','clipboard_set','screenshot','ui_tree','ui_find','ui_invoke','ui_set_value','semantic_snapshot','semantic_batch','wait_window','launch','sleep','session_state','desktop_context']),
      arguments: nativeArgsSchema,
      timeout_ms: z.number().int().min(500).max(180000).optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, action, arguments: args, timeout_ms }) =>
    jsonText(await rpc(device, 'native_call', { action, args: args || {}, timeoutMs: timeout_ms || 15000 }, (timeout_ms || 15000) + 3000)));

  mcp.registerTool('native_batch', {
    description: 'Execute many native desktop actions locally on the device in one round trip. Use this for fast deterministic UI workflows.',
    inputSchema: withDevice({
      steps: z.array(z.record(z.string(), z.any())).min(1).max(100),
      continue_on_error: z.boolean().optional(),
      timeout_ms: z.number().int().min(500).max(180000).optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, steps, continue_on_error, timeout_ms }) =>
    jsonText(await rpc(device, 'native_call', {
      action: 'batch',
      args: { steps, continueOnError: !!continue_on_error },
      timeoutMs: timeout_ms || 60000
    }, (timeout_ms || 60000) + 3000)));

  mcp.registerTool('desktop_batch', {
    description: 'FAST PATH: execute many native desktop actions locally in one round trip, then return one final screenshot. Prefer this over separate mouse/keyboard/screenshot calls for interactive workflows.',
    inputSchema: withDevice({
      steps: z.array(z.record(z.string(), z.any())).min(1).max(100),
      continue_on_error: z.boolean().optional(),
      timeout_ms: z.number().int().min(500).max(180000).optional(),
      screenshot: z.record(z.string(), z.any()).optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, steps, continue_on_error, timeout_ms, screenshot }) =>
    normalizeResult(await rpc(device, 'native_batch_frame', {
      steps, continueOnError: !!continue_on_error,
      timeoutMs: timeout_ms || 60000,
      screenshot: screenshot || {}
    }, (timeout_ms || 60000) + 33000)));

  mcp.registerTool('computer_operation_status',{
    description:'Read the persistent outcome of a guarded device operation. A running or unknown outcome MUST NOT be automatically replayed after reconnect.',
    inputSchema:withDevice({idempotency_key:z.string().min(8).max(128)}),
    annotations:{readOnlyHint:true}
  },async ({device,idempotency_key})=>{
    const d=getDevice(device,'control'),user=currentUser();
    const operationId='op_'+crypto.createHash('sha256').update(idempotency_key).digest('hex').slice(0,64);
    const row=operationJournal.get(user.id,d.id,operationId);
    let deviceOutcome=null;
    if(row&&row.state!=='completed'){
      const actionId='a_'+crypto.createHash('sha256').update(JSON.stringify([user.id,d.id,operationId])).digest('hex');
      try{deviceOutcome=await rpc(d.id,'guarded_action_status',{actionId},10000);}
      catch{deviceOutcome={state:'unavailable'};}
    }

    return jsonText(row?{state:row.state,outcome:row.state==='completed'?JSON.parse(row.outcome):null,
      deviceOutcome,
      nextStep:row.state==='running'||row.state==='needs_review'?'Inspect current device state; do not replay a mutation.':'No automatic action taken.'}:
      {state:'not_found',outcome:null,nextStep:'No recorded operation under this account/device/key.'});
  });
  mcp.registerTool('computer_observe', {
    description: 'EXPERIMENTAL GUARDED EXECUTION: observe current foreground window and return preview plus an opaque observationId. Use computer_act with that exact ID; if pixels, window or geometry change the action is rejected as stale. Existing direct tools remain available.',
    inputSchema: withDevice({
      semantic:z.boolean().optional(),
      quality:z.number().int().min(20).max(95).optional(),
      maxWidth:z.number().int().min(240).max(1920).optional(),
      maxHeight:z.number().int().min(180).max(1200).optional()
    }),annotations:{readOnlyHint:true}
  },async ({device,...params}) => normalizeResult(await execution.observe({
    userId:currentUser().id,deviceId:getDevice(device,'control').id,params
  })));

  mcp.registerTool('computer_act', {
    description: 'EXPERIMENTAL GUARDED ACTION: perform one preview click from a recent computer_observe frame. Requires observation_id and a unique idempotency_key. The native agent rechecks foreground, bounds and pixels atomically before clicking; never retry a timed-out mutation with a different key. Success confirms input delivery, not a goal unless an explicit postcondition is verified.',
    inputSchema: withDevice({
      observation_id:z.string().min(1),
      idempotency_key:z.string().min(8).max(128),
      x:z.number().int().min(0),y:z.number().int().min(0),
      verify_title_contains:z.string().min(1).max(120).optional()
    }),annotations:{readOnlyHint:false}
  },async ({device,observation_id,idempotency_key,x,y,verify_title_contains}) =>
    jsonText(await durableComputerAction(device,idempotency_key,'computer_act',({observation_id,x,y,verify_title_contains}),
      ({userId,deviceId,actionId})=>execution.act({userId,deviceId,actionId,observationId:observation_id,
     idempotencyKey:idempotency_key,x,y,
     verify:verify_title_contains?{kind:'window_title_contains',value:verify_title_contains}:undefined}))))

  mcp.registerTool('computer_semantic_act', {
    description: 'EXPERIMENTAL GUARDED UIA: execute bounded exact Windows UIA assert/set/invoke steps with mandatory postconditions from a fresh computer_observe frame. The native agent validates the frame before any side effect; ambiguous effects are never auto-replayed.',
    inputSchema: withDevice({
      observation_id:z.string().min(1),
      idempotency_key:z.string().min(8).max(128),
      steps:z.array(z.record(z.string(),z.any())).min(1).max(20)
    }),annotations:{readOnlyHint:false}
  },async ({device,observation_id,idempotency_key,steps}) =>
    jsonText(await durableComputerAction(device,idempotency_key,'computer_semantic_act',({observation_id,steps}),
      ({userId,deviceId,actionId})=>execution.act({userId,deviceId,actionId,observationId:observation_id,
     idempotencyKey:idempotency_key,mode:'semantic',steps}))))

  mcp.registerTool('computer_execute', {
    description: 'EXPERIMENTAL AUTO ROUTER: given a recent computer_observe frame, prefer uniquely evidenced UIA invoke with an exact postcondition. Pixel fallback is allowed only with explicit allow_pixel_fallback and valid preview coordinates. Idempotency and stale-reference guards apply to either route.',
    inputSchema: withDevice({
      observation_id:z.string().min(1),
      idempotency_key:z.string().min(8).max(128),
      selector:z.record(z.string(),z.any()).optional(),
      expect:z.record(z.string(),z.any()).optional(),
      x:z.number().int().min(0).optional(),y:z.number().int().min(0).optional(),
      allow_pixel_fallback:z.boolean().optional()
    }),annotations:{readOnlyHint:false}
  },async ({device,observation_id,idempotency_key,selector,expect,x,y,allow_pixel_fallback}) =>
    jsonText(await durableComputerAction(device,idempotency_key,'computer_execute',({observation_id,selector,expect,x,y,allow_pixel_fallback}),
      ({userId,deviceId,actionId})=>execution.autoAct({userId,deviceId,actionId,observationId:observation_id,
     idempotencyKey:idempotency_key,selector,expect,x,y,
     allowPixelFallback:allow_pixel_fallback===true}))))

  mcp.registerTool('computer_browser_observe', {
    description: 'Guarded BACKGROUND browser observation. Supply an explicit CDP tab ID (from browser_tabs) and a CSS selector. Return a private observationId bound to account, device, tab session, URL and exact element state. Does not require the Windows foreground or start a browser automatically.',
    inputSchema:withDevice({
      tab_id:z.string().min(1),selector:z.string().min(1).max(256)
    }),annotations:{readOnlyHint:true}
  },async ({device,tab_id,selector}) =>
    jsonText(await browserExecution.observe({userId:currentUser().id,deviceId:getDevice(device,'control').id,
      tabId:tab_id,selector})));

  mcp.registerTool('computer_browser_act', {
    description: 'Guarded BACKGROUND CDP click/type on one previously observed unique non-password DOM element. Validates tab identity, URL and element state in the browser before input. Uses a one-shot observationId and idempotency_key; an uncertain mutation is never retried automatically.',
    inputSchema:withDevice({
      observation_id:z.string().min(1),idempotency_key:z.string().min(8).max(128),
      selector:z.string().min(1).max(256),kind:z.enum(['click','type']),
      text:z.string().max(20000).optional(),
      expect_url_contains:z.string().min(1).max(256).optional(),
      expect_text_contains:z.string().min(1).max(256).optional()
    }),annotations:{readOnlyHint:false}
  },async ({device,observation_id,idempotency_key,selector,kind,text,expect_url_contains,expect_text_contains}) =>
    jsonText(await durableComputerAction(device,idempotency_key,'computer_browser_act',({observation_id,selector,kind,text,expect_url_contains,expect_text_contains}),
      ({userId,deviceId,actionId})=>browserExecution.act({userId,deviceId,actionId,observationId:observation_id,
     idempotencyKey:idempotency_key,selector,kind,text,
     expectUrlContains:expect_url_contains,expectTextContains:expect_text_contains}))))

  // Every route first checks the actual session; a locked/secure desktop is
  // NEVER treated as a failed mouse click that should be retried with focus.
  async function currentCapabilities(deviceId){
    const [ss,si,br]=await Promise.allSettled([
      rpc(deviceId,'native_call',{action:'session_state',args:{}},10000),
      rpc(deviceId,'system_info',{},10000),
      rpc(deviceId,'browser_call',{action:'status',args:{}},10000)
    ]);
    return {session:ss.status==='fulfilled'?(ss.value?.result||{}):{},
      agent:si.status==='fulfilled'?(si.value||{}):{},
      browser:br.status==='fulfilled'?(br.value||{}):{}};
  }
  mcp.registerTool('computer_plan', {
    description:'Choose a verified execution route for Windows, including locked RDP sessions. Never attempt GUI/UAC input when no interactive desktop; prefer authorized filesystem, process or isolated browser background execution.',
    inputSchema:withDevice({kind:z.enum(['file_read','file_write','process_run','browser','desktop']),
      requires_admin:z.boolean().optional(),allow_browser_start:z.boolean().optional(),
      alternate_kind:z.enum(['file_read','file_write','process_run','browser']).optional()}),
    annotations:{readOnlyHint:true}
  },async ({device,kind,requires_admin,allow_browser_start,alternate_kind})=>{
    const d=getDevice(device,'control'),caps=await currentCapabilities(d.id);
    const plan=chooseRoute({kind,session:caps.session,
      agent:{...caps.agent,elevated:caps.session.elevated===true,
        uia:caps.session.interactive===true&&caps.session.locked===false&&caps.agent.nativeHelper===true},
      browser:caps.browser,requiresAdmin:requires_admin===true,
      allowBrowserStart:allow_browser_start===true,alternate:alternate_kind?{kind:alternate_kind}:null});
    return jsonText({kind,plan,checks:{sessionLocked:caps.session.locked??null,
      approvalPending:caps.session.approvalPending===true,
      interactive:caps.session.interactive===true,elevated:caps.session.elevated===true,
      directFilesystem:caps.agent.directFilesystem===true,
      directProcesses:caps.agent.directProcessSessions===true,
      browserCdpRunning:caps.browser.running===true},
      recommendedTools:plan.ready?
        plan.route==='background.filesystem'?['fs_stat','fs_list','fs_read_text','fs_write_text']:
        plan.route==='background.process'?['exec_command','process_start','process_read']:
        plan.route.startsWith('browser.')?['browser_tabs','computer_browser_observe','computer_browser_act']:
        ['computer_observe','computer_execute','computer_semantic_act','computer_act']:
        []});
  });
  mcp.registerTool('computer_background_task', {
    description:'Execute a bounded authorized task without mouse or keyboard, even when Windows is locked. File reading works in background; process execution requires a fresh idempotency key, writes an operation journal on server AND agent, checks requested Administrator status, and never retries uncertain effects.',
    inputSchema:withDevice({
      kind:z.enum(['file_read','process_run']),
      path:z.string().min(1).max(2048).optional(),
      command:z.string().min(1).max(10000).optional(),
      shell:z.enum(['powershell','cmd']).optional(),
      timeout_ms:z.number().int().min(1000).max(120000).optional(),
      requires_admin:z.boolean().optional(),
      idempotency_key:z.string().min(8).max(128).optional()
    }),annotations:{readOnlyHint:false}
  },async ({device,kind,path,command,shell,timeout_ms,requires_admin,idempotency_key})=>{
    const d=getDevice(device,'control'),caps=await currentCapabilities(d.id);
    const plan=chooseRoute({kind,session:caps.session,
      agent:{...caps.agent,elevated:caps.session.elevated===true},
      browser:caps.browser,requiresAdmin:requires_admin===true});
    if(!plan.ready)return jsonText({status:'not_ready',effect:'rejected',plan});
    if(kind==='file_read'){
      if(!path||command||idempotency_key)return jsonText({status:'invalid',error:'Provide path only for file_read'});
      const data=await rpc(d.id,'fs_call',{action:'read_text',args:{path,maxBytes:512000}},15000);
      return jsonText({status:'succeeded',routeUsed:plan.route,content:data});
    }
    if(!command||path||!idempotency_key)return jsonText({status:'invalid',error:'process_run requires command and unique idempotency_key'});
    const result=await durableComputerAction(d.id,idempotency_key,'computer_background_task',
      {kind,command,shell,timeout_ms,requires_admin},
      ({deviceId,actionId})=>rpc(deviceId,'exec',
        {shell:shell||'powershell',command,timeoutMs:timeout_ms||30000,maxBytes:32000,
          _yhActionId:actionId},(timeout_ms||30000)+8000));
    return jsonText({routeUsed:plan.route,...(typeof result==='object'&&result?result:{result})});
  });

  mcp.registerTool('computer_doctor', {
    description: 'Diagnose one of YOUR connected devices without modifying its state. Check remote session lock, native helper, OS/background capabilities, browser CDP status and RPC latency. Report which execution routes are currently available.',
    inputSchema:withDevice(),annotations:{readOnlyHint:true}
  },async ({device}) => {
    const d=getDevice(device,'control'),started=Date.now();
    const [session,system,browser]=await Promise.allSettled([
      rpc(d.id,'native_call',{action:'session_state',args:{}},10000),
      rpc(d.id,'system_info',{},10000),
      rpc(d.id,'browser_call',{action:'status',args:{}},10000)
    ]);
    const state=session.status==='fulfilled'?session.value?.result||{}:null;
    const info=system.status==='fulfilled'?system.value||{}:null;
    const cd=browser.status==='fulfilled'?browser.value||{}:null;
    const approvalPending=state?.approvalPending===true;
    const interactive=state?.interactive===true&&state?.locked===false&&!approvalPending;
    return jsonText({deviceId:d.id,agentVersion:d.meta.agentVersion||null,
      checks:{agentConnected:true,nativeAvailable:session.status==='fulfilled',
        sessionLocked:state?.locked??null,approvalPending,interactiveDesktop:interactive,
        directFilesystem:info?.directFilesystem===true,
        directProcesses:info?.directProcessSessions===true,
        browserCdpRunning:cd?.running===true,
        guardedFramesSupported:typeof info?.agentVersion==='string'&&
          /^0\.9\.[1-9]/.test(info.agentVersion)&&session.status==='fulfilled',
        elevated:state?.elevated===true,secureDesktopInputSupported:false,
        worksWhenLocked:info?.directFilesystem===true||info?.directProcessSessions===true},
      suggestedRoute:approvalPending?'wait_for_local_admin_approval':
        interactive?'windows.uia_then_guarded_preview':
        info?.directFilesystem||info?.directProcessSessions?'background_direct_api':'wait_for_interactive_session',
      latencyMs:Date.now()-started});
  });

  mcp.registerTool('observe_desktop', {
    description: 'PRIMARY FAST OBSERVATION: detect the current foreground/modal window, return a compact semantic UI snapshot and a lightweight window screenshot in one round trip. Prefer this before interacting with GUI or after an action may open a popup.',
    inputSchema: withDevice({
      hwnd: z.number().optional(),
      autoRetarget: z.boolean().optional(),
      semantic: z.boolean().optional(),
      quality: z.number().int().min(20).max(95).optional(),
      maxWidth: z.number().int().min(240).max(1920).optional(),
      maxHeight: z.number().int().min(180).max(1200).optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) =>
    normalizeResult(await rpc(device, 'native_observe', {autoRetarget:true,...args}, 33000)));

  mcp.registerTool('click_preview', {
    description: 'Click using coordinates from the latest observe_desktop preview image. Coordinates are mapped automatically from preview pixels to the real foreground/modal window, avoiding scaling/DPI click errors.',
    inputSchema: withDevice({
      hwnd: z.number().optional(),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      imageWidth: z.number().int().min(1),
      imageHeight: z.number().int().min(1),
      kind: z.enum(['click','double','move']).optional(),
      button: z.enum(['left','right','middle']).optional(),
      count: z.number().int().min(1).max(5).optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) =>
    jsonText(await rpc(device, 'native_call', { action:'click_preview', args:{autoRetarget:true,...args} }, 15000)));

  mcp.registerTool('semantic_snapshot', {
    description: 'FAST semantic observation: return a compact Windows UI Automation control snapshot for one window without a screenshot. Use this to discover stable selectors before semantic_batch.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(),
      title: z.string().optional(), titleContains: z.string().optional(),
      requireForeground: z.boolean().optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) =>
    jsonText(await rpc(device, 'native_call', { action:'semantic_snapshot', args:{autoRetarget:true,...args} }, 30000)));

  mcp.registerTool('semantic_batch', {
    description: 'FAST semantic execution: run 1-20 UIA assert/set/invoke steps locally with exact postconditions and no automatic replay. Prefer for accessible forms/buttons/fields.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(),
      title: z.string().optional(), titleContains: z.string().optional(),
      requireForeground: z.boolean().optional(),
      steps: z.array(z.record(z.string(), z.any())).min(1).max(20)
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, steps, ...scope }) =>
    jsonText(await rpc(device, 'native_call', { action:'semantic_batch', args:{autoRetarget:true,...scope,steps}, timeoutMs:30000 }, 33000)));

  mcp.registerTool('screenshot', {
    description: 'Capture the full desktop or a specific window as a PNG image and return the actual image. For workflows that also click/type, prefer desktop_batch to avoid extra round trips.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(),
      titleContains: z.string().optional(), window: z.boolean().optional(),
      format: z.enum(['png','jpeg','jpg']).optional(),
      quality: z.number().int().min(20).max(95).optional(),
      maxWidth: z.number().int().min(240).max(7680).optional(),
      maxHeight: z.number().int().min(180).max(4320).optional(),
      keep: z.boolean().optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => normalizeResult(await rpc(device, 'native_screenshot', args, 30000)));

  mcp.registerTool('list_windows', {
    description: 'List top-level Windows windows with HWND, PID, title, process and bounds.',
    inputSchema: withDevice({ pid: z.number().int().optional(), visibleOnly: z.boolean().optional() }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'list_windows', args }, 15000)));

  mcp.registerTool('foreground_window', {
    description: 'Get the current foreground window.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({ device }) => jsonText(await rpc(device, 'native_call', { action:'foreground', args:{} }, 10000)));

  mcp.registerTool('focus_window', {
    description: 'Bring a window to the foreground by HWND, PID, exact title or title substring.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(),
      title: z.string().optional(), titleContains: z.string().optional(), settleMs: z.number().int().optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'focus_window', args }, 10000)));

  mcp.registerTool('ui_tree', {
    description: 'Read the Windows UI Automation tree directly, without screenshots.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(),
      titleContains: z.string().optional(), limit: z.number().int().min(1).max(3000).optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'ui_tree', args }, 30000)));

  mcp.registerTool('ui_find', {
    description: 'Find UI elements by name, partial name, automation id, control type or class name.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(), titleContains: z.string().optional(),
      name: z.string().optional(), nameContains: z.string().optional(), automationId: z.string().optional(),
      controlType: z.string().optional(), className: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'ui_find', args }, 30000)));

  mcp.registerTool('ui_invoke', {
    description: 'Invoke a UI Automation element directly; falls back to a native click on its bounds.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(), titleContains: z.string().optional(),
      name: z.string().optional(), nameContains: z.string().optional(), automationId: z.string().optional(),
      controlType: z.string().optional(), className: z.string().optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'ui_invoke', args }, 30000)));

  mcp.registerTool('ui_set_value', {
    description: 'Set the value of a UI Automation edit field directly; falls back to focus/select/type.',
    inputSchema: withDevice({
      hwnd: z.number().optional(), pid: z.number().int().optional(), titleContains: z.string().optional(),
      name: z.string().optional(), nameContains: z.string().optional(), automationId: z.string().optional(),
      controlType: z.string().optional(), className: z.string().optional(), value: z.string()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'ui_set_value', args }, 30000)));

  mcp.registerTool('mouse', {
    description: 'Move or click the native mouse immediately.',
    inputSchema: withDevice({
      x: z.number().int(), y: z.number().int(),
      kind: z.enum(['move','click','double']).optional(),
      button: z.enum(['left','right','middle']).optional(), count: z.number().int().min(1).max(5).optional()
    }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'mouse', args }, 10000)));

  mcp.registerTool('scroll', {
    description: 'Send native mouse-wheel input.',
    inputSchema: withDevice({ x: z.number().int().optional(), y: z.number().int().optional(), delta: z.number().int().optional() }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'scroll', args }, 10000)));

  mcp.registerTool('hotkey', {
    description: 'Send a native keyboard shortcut such as CTRL+S or ALT+F4.',
    inputSchema: withDevice({ combo: z.string(), settleMs: z.number().int().optional() }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'hotkey', args }, 10000)));

  mcp.registerTool('type_text', {
    description: 'Type Unicode text through native keyboard input.',
    inputSchema: withDevice({ text: z.string(), delayMs: z.number().int().min(0).max(1000).optional() }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'type_text', args }, 30000)));

  mcp.registerTool('clipboard_get', {
    description: 'Read text from the Windows clipboard.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({ device }) => jsonText(await rpc(device, 'native_call', { action:'clipboard_get', args:{} }, 10000)));

  mcp.registerTool('clipboard_set', {
    description: 'Set text on the Windows clipboard.',
    inputSchema: withDevice({ text: z.string() }), annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'clipboard_set', args }, 10000)));

  mcp.registerTool('launch_app', {
    description: 'Launch an application or document through Windows.',
    inputSchema: withDevice({ file: z.string(), arguments: z.string().optional() }),
    annotations: { readOnlyHint: false }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'launch', args }, 15000)));

  mcp.registerTool('wait_window', {
    description: 'Wait locally until a matching window appears, avoiding repeated AI polling.',
    inputSchema: withDevice({
      pid: z.number().int().optional(), title: z.string().optional(), titleContains: z.string().optional(),
      timeoutMs: z.number().int().min(100).max(180000).optional(), pollMs: z.number().int().min(20).max(5000).optional()
    }),
    annotations: { readOnlyHint: true }
  }, async ({ device, ...args }) => jsonText(await rpc(device, 'native_call', { action:'wait_window', args, timeoutMs: args.timeoutMs || 10000 }, (args.timeoutMs || 10000) + 3000)));

  mcp.registerTool('browser_status', {
    description: 'Check YourHand isolated Chromium CDP status on a device.',
    inputSchema: withDevice(), annotations: { readOnlyHint: true }
  }, async ({device}) => jsonText(await rpc(device,'browser_call',{action:'status',args:{}},10000)));

  mcp.registerTool('browser_start', {
    description: 'Start or attach to YourHand isolated Chromium browser with local CDP control. Works without mouse/keyboard.',
    inputSchema: withDevice({ url:z.string().optional(), timeout_ms:z.number().int().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,url,timeout_ms}) => jsonText(await rpc(device,'browser_call',{action:'start',args:{url,timeoutMs:timeout_ms||10000}},(timeout_ms||10000)+3000)));

  mcp.registerTool('browser_tabs', {
    description: 'List controllable browser tabs/targets.',
    inputSchema: withDevice(), annotations:{readOnlyHint:true}
  }, async ({device}) => jsonText(await rpc(device,'browser_call',{action:'tabs',args:{}},10000)));

  mcp.registerTool('browser_navigate', {
    description: 'Navigate a CDP-controlled browser tab directly and wait for DOM readiness.',
    inputSchema: withDevice({ url:z.string(), targetId:z.string().optional(), newTab:z.boolean().optional(), timeout_ms:z.number().int().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,url,targetId,newTab,timeout_ms}) => jsonText(await rpc(device,'browser_call',{action:'navigate',args:{url,targetId,newTab,timeoutMs:timeout_ms||15000}},(timeout_ms||15000)+3000)));

  mcp.registerTool('browser_eval', {
    description: 'Evaluate JavaScript in a browser tab through Chrome DevTools Protocol.',
    inputSchema: withDevice({ expression:z.string(), targetId:z.string().optional(), timeout_ms:z.number().int().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,expression,targetId,timeout_ms}) => jsonText(await rpc(device,'browser_call',{action:'eval',args:{expression,targetId,timeoutMs:timeout_ms||15000}},(timeout_ms||15000)+3000)));

  mcp.registerTool('browser_text', {
    description: 'Read visible page text directly from the DOM.',
    inputSchema: withDevice({ targetId:z.string().optional() }), annotations:{readOnlyHint:true}
  }, async ({device,targetId}) => jsonText(await rpc(device,'browser_call',{action:'text',args:{targetId}},15000)));

  mcp.registerTool('browser_click', {
    description: 'Click a DOM element by CSS selector without screenshots or mouse movement.',
    inputSchema: withDevice({ selector:z.string(), targetId:z.string().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,selector,targetId}) => jsonText(await rpc(device,'browser_call',{action:'click',args:{selector,targetId}},15000)));

  mcp.registerTool('browser_type', {
    description: 'Set an input value by CSS selector and dispatch input/change events directly in the DOM.',
    inputSchema: withDevice({ selector:z.string(), text:z.string(), targetId:z.string().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,selector,text,targetId}) => jsonText(await rpc(device,'browser_call',{action:'type',args:{selector,text,targetId}},15000)));

  mcp.registerTool('browser_wait_selector', {
    description: 'Wait locally for a CSS selector to appear, avoiding repeated AI polling.',
    inputSchema: withDevice({ selector:z.string(), targetId:z.string().optional(), timeout_ms:z.number().int().optional(), poll_ms:z.number().int().optional() }), annotations:{readOnlyHint:true}
  }, async ({device,selector,targetId,timeout_ms,poll_ms}) => jsonText(await rpc(device,'browser_call',{action:'wait_selector',args:{selector,targetId,timeoutMs:timeout_ms||10000,pollMs:poll_ms||80}},(timeout_ms||10000)+3000)));

  mcp.registerTool('browser_batch', {
    description: 'Execute multiple browser/CDP actions locally in one round trip for high-speed deterministic workflows.',
    inputSchema: withDevice({ steps:z.array(z.record(z.string(),z.any())).min(1).max(100), continue_on_error:z.boolean().optional(), timeout_ms:z.number().int().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,steps,continue_on_error,timeout_ms}) => jsonText(await rpc(device,'browser_batch',{steps,continueOnError:!!continue_on_error},(timeout_ms||60000))));

  mcp.registerTool('browser_screenshot', {
    description: 'Capture the browser page directly through CDP, including beyond the visible viewport.',
    inputSchema: withDevice({ targetId:z.string().optional(), format:z.enum(['png','jpeg']).optional(), captureBeyondViewport:z.boolean().optional(), timeout_ms:z.number().int().optional() }), annotations:{readOnlyHint:true}
  }, async ({device,...args}) => normalizeResult(await rpc(device,'browser_screenshot',{...args,timeoutMs:args.timeout_ms||30000},(args.timeout_ms||30000)+3000)));

  mcp.registerTool('exec_command', {
    description: 'Execute a one-shot PowerShell or cmd command directly through YourHand without Desktop Commander. Ideal for COM/API automation and fast local scripts.',
    inputSchema: withDevice({
      command:z.string(),
      shell:z.enum(['powershell','cmd']).optional(),
      cwd:z.string().optional(),
      timeout_ms:z.number().int().min(500).max(300000).optional(),
      max_bytes:z.number().int().min(1024).max(20971520).optional()
    }),
    annotations:{readOnlyHint:false}
  }, async ({device,command,shell,cwd,timeout_ms,max_bytes}) => jsonText(await rpc(device,'exec',{command,shell,cwd,timeoutMs:timeout_ms||60000,maxBytes:max_bytes||5242880},(timeout_ms||60000)+5000)));

  mcp.registerTool('fs_stat', {
    description: 'Get native filesystem metadata directly from YourHand.',
    inputSchema: withDevice({ path:z.string() }), annotations:{readOnlyHint:true}
  }, async ({device,path}) => jsonText(await rpc(device,'fs_call',{action:'stat',args:{path}},15000)));

  mcp.registerTool('fs_list', {
    description: 'List a directory directly through YourHand native filesystem.',
    inputSchema: withDevice({ path:z.string() }), annotations:{readOnlyHint:true}
  }, async ({device,path}) => jsonText(await rpc(device,'fs_call',{action:'list',args:{path}},30000)));

  mcp.registerTool('fs_read_text', {
    description: 'Read a text file directly with offset and bounded byte length.',
    inputSchema: withDevice({ path:z.string(), offset:z.number().int().min(0).optional(), length:z.number().int().min(0).optional(), max_bytes:z.number().int().min(1).max(20971520).optional(), encoding:z.string().optional() }), annotations:{readOnlyHint:true}
  }, async ({device,path,offset,length,max_bytes,encoding}) => jsonText(await rpc(device,'fs_call',{action:'read_text',args:{path,offset,length,maxBytes:max_bytes,encoding}},30000)));

  mcp.registerTool('fs_read_binary', {
    description: 'Read a bounded binary file directly as base64.',
    inputSchema: withDevice({ path:z.string(), max_bytes:z.number().int().min(1).max(20971520).optional() }), annotations:{readOnlyHint:true}
  }, async ({device,path,max_bytes}) => jsonText(await rpc(device,'fs_call',{action:'read_binary',args:{path,maxBytes:max_bytes}},30000)));

  mcp.registerTool('fs_write_text', {
    description: 'Create, overwrite or append a text file directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), text:z.string(), append:z.boolean().optional(), encoding:z.string().optional(), create_parents:z.boolean().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,path,text,append,encoding,create_parents}) => jsonText(await rpc(device,'fs_call',{action:'write_text',args:{path,text,append,encoding,createParents:create_parents!==false}},30000)));

  mcp.registerTool('fs_write_binary', {
    description: 'Create, overwrite or append a binary file from base64 directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), base64:z.string(), append:z.boolean().optional(), create_parents:z.boolean().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,path,base64,append,create_parents}) => jsonText(await rpc(device,'fs_call',{action:'write_binary',args:{path,base64,append,createParents:create_parents!==false}},30000)));

  mcp.registerTool('fs_mkdir', {
    description: 'Create a directory directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), recursive:z.boolean().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,path,recursive}) => jsonText(await rpc(device,'fs_call',{action:'mkdir',args:{path,recursive:recursive!==false}},15000)));

  mcp.registerTool('fs_move', {
    description: 'Move or rename a filesystem item directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), destination:z.string(), create_parents:z.boolean().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,path,destination,create_parents}) => jsonText(await rpc(device,'fs_call',{action:'move',args:{path,destination,createParents:create_parents!==false}},30000)));

  mcp.registerTool('fs_copy', {
    description: 'Copy a file or directory directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), destination:z.string(), recursive:z.boolean().optional(), force:z.boolean().optional(), create_parents:z.boolean().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,path,destination,recursive,force,create_parents}) => jsonText(await rpc(device,'fs_call',{action:'copy',args:{path,destination,recursive:!!recursive,force:force!==false,createParents:create_parents!==false}},60000)));

  mcp.registerTool('fs_remove', {
    description: 'Remove a file or directory directly through YourHand.',
    inputSchema: withDevice({ path:z.string(), recursive:z.boolean().optional(), force:z.boolean().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,path,recursive,force}) => jsonText(await rpc(device,'fs_call',{action:'remove',args:{path,recursive:!!recursive,force:!!force}},30000)));

  mcp.registerTool('fs_search', {
    description: 'Search filenames/paths recursively on the device without Desktop Commander.',
    inputSchema: withDevice({ path:z.string(), query:z.string().optional(), max_results:z.number().int().min(1).max(5000).optional(), max_depth:z.number().int().min(0).max(64).optional(), include_dirs:z.boolean().optional() }), annotations:{readOnlyHint:true}
  }, async ({device,path,query,max_results,max_depth,include_dirs}) => jsonText(await rpc(device,'fs_call',{action:'search',args:{path,query,maxResults:max_results,maxDepth:max_depth,includeDirs:!!include_dirs}},65000)));

  mcp.registerTool('process_start', {
    description: 'Start a native YourHand-managed process session. Interactive sessions keep stdin/stdout open for later calls.',
    inputSchema: withDevice({ command:z.string().optional(), shell:z.enum(['powershell','cmd']).optional(), interactive:z.boolean().optional(), executable:z.string().optional(), arguments:z.array(z.string()).optional(), cwd:z.string().optional(), show_window:z.boolean().optional() }), annotations:{readOnlyHint:false}
  }, async ({device,command,shell,interactive,executable,arguments:argv,cwd,show_window}) => jsonText(await rpc(device,'proc_call',{action:'start',args:{command,shell,interactive,executable,arguments:argv,cwd,showWindow:!!show_window}},15000)));

  mcp.registerTool('process_sessions', {
    description: 'List YourHand-managed process sessions.',
    inputSchema: withDevice(), annotations:{readOnlyHint:true}
  }, async ({device}) => jsonText(await rpc(device,'proc_call',{action:'list',args:{}},10000)));

  mcp.registerTool('process_read', {
    description: 'Read incremental buffered stdout/stderr from a YourHand process session.',
    inputSchema: withDevice({ session_id:z.string(), offset:z.number().int().min(0).optional() }), annotations:{readOnlyHint:true}
  }, async ({device,session_id,offset}) => jsonText(await rpc(device,'proc_call',{action:'read',args:{sessionId:session_id,offset}},15000)));

  mcp.registerTool('process_write', {
    description: 'Write stdin to a YourHand interactive process session.',
    inputSchema: withDevice({ session_id:z.string(), input:z.string() }), annotations:{readOnlyHint:false}
  }, async ({device,session_id,input}) => jsonText(await rpc(device,'proc_call',{action:'write',args:{sessionId:session_id,input}},15000)));

  mcp.registerTool('process_kill', {
    description: 'Terminate a YourHand-managed process session.',
    inputSchema: withDevice({ session_id:z.string(), signal:z.string().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,session_id,signal}) => jsonText(await rpc(device,'proc_call',{action:'kill',args:{sessionId:session_id,signal}},15000)));

  mcp.registerTool('process_close_stdin', {
    description: 'Close stdin for a YourHand-managed process session.',
    inputSchema: withDevice({ session_id:z.string() }), annotations:{readOnlyHint:false}
  }, async ({device,session_id}) => jsonText(await rpc(device,'proc_call',{action:'close_stdin',args:{sessionId:session_id}},10000)));

  mcp.registerTool('process_forget', {
    description: 'Forget a completed YourHand process session and release its buffered history.',
    inputSchema: withDevice({ session_id:z.string(), force:z.boolean().optional() }), annotations:{readOnlyHint:false,destructiveHint:true}
  }, async ({device,session_id,force}) => jsonText(await rpc(device,'proc_call',{action:'forget',args:{sessionId:session_id,force:!!force}},10000)));

  return mcp;
}

// The SDK helper installs Express' default 100 KB JSON parser; large MCP tool calls need a bounded limit.
const express = require('express');
const { hostHeaderValidation } = require(path.join(path.dirname(require.resolve('@modelcontextprotocol/sdk/server/express.js')), 'middleware', 'hostHeaderValidation.js'));
const mcpApp = express();
mcpApp.use(hostHeaderValidation(['127.0.0.1', 'localhost', 'app.wolvexai.com', 'yourhand.wolvexai.com']));
const mcpEndpoints = ['/mcp', '/yourhand-rpc', ...(LEGACY_WEB_MCP_PATH ? [LEGACY_WEB_MCP_PATH] : [])];
mcpApp.use(mcpEndpoints, requireMcpAuth);
mcpApp.use(mcpEndpoints, express.json({ limit: '32mb' }));
mcpApp.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ jsonrpc:'2.0', error:{ code:-32000, message:'MCP request exceeds 32 MB limit' }, id:null });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ jsonrpc:'2.0', error:{ code:-32700, message:'Invalid JSON body' }, id:null });
  next(err);
});
mcpApp.get('/health', (_req, res) => {
  res.json({ ok: true, name: PRODUCT_NAME, version: VERSION });
});
async function handleMcpRequest(req, res) {
  return userContext.run(req.yhUser, async () => {
    const mcp = makeMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[YourHand MCP] request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    } finally {
      res.on('close', () => {
        try { transport.close(); } catch {}
        try { mcp.close(); } catch {}
      });
    }
  });
}
mcpApp.post('/mcp', handleMcpRequest);
mcpApp.post('/yourhand-rpc', handleMcpRequest);
if (LEGACY_WEB_MCP_PATH) mcpApp.post(LEGACY_WEB_MCP_PATH, handleMcpRequest);
const methodNotAllowed = (_req, res) => res.status(405).json({
  jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null
});
mcpApp.get('/mcp', methodNotAllowed);
mcpApp.delete('/mcp', methodNotAllowed);
mcpApp.get('/yourhand-rpc', methodNotAllowed);
mcpApp.delete('/yourhand-rpc', methodNotAllowed);
if (LEGACY_WEB_MCP_PATH) {
  mcpApp.get(LEGACY_WEB_MCP_PATH, methodNotAllowed);
  mcpApp.delete(LEGACY_WEB_MCP_PATH, methodNotAllowed);
}

const mcpHttp = http.createServer(mcpApp);
mcpHttp.listen(MCP_PORT, '127.0.0.1', () => {
  console.log(`YourHand MCP ${VERSION} on http://127.0.0.1:${MCP_PORT}/mcp`);
});

// This Web dashboard probe runs without an MCP OAuth context, and never
// reserves a mutating GUI lock or issues a side effect to a shared desktop.
function probeDeviceFromWeb(userId,deviceId){
  const telemetryStarted=performance.now(),traceId=crypto.randomUUID();
  const done=(ok,error)=>telemetry.record({traceId,userId,deviceId,eventType:'web_connect',
    methodId:'WEB_DEVICE_CONNECT',routeId:'agent.websocket',attemptIndex:1,methodsTried:1,
    durationMs:performance.now()-telemetryStarted,outcome:ok?'completed':'failed',
    errorCode:error,errorStage:ok?null:'WEB_CONNECT'});

  if(!store.getDeviceForUser(userId,deviceId)){done(false,'ACCESS_DENIED');throw Error('DEVICE_NOT_AUTHORIZED');}
  const d=devices.get(deviceId);
  if(!d||d.ws.readyState!==1||!store.getActiveDevice(deviceId))
    {done(false,'CONNECTION_LOST');throw Error('AGENT_OFFLINE');}
  const started=Date.now(),id=crypto.randomUUID(),socket=d.ws;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      if(pending.get(id)?.ws===socket)pending.delete(id);
      reject(Error('Agent command timeout'));
    },8000);
    pending.set(id,{resolve:reply=>resolve({pong:reply?.pong===true,latencyMs:Date.now()-started}),
      reject,timer,deviceId,ws:socket,requesterId:userId});
    try{
      socket.send(JSON.stringify({type:'request',id,method:'ping',params:{}}),err=>{
        if(err&&pending.get(id)?.ws===socket){
          pending.delete(id);clearTimeout(timer);reject(err);
        }
      });
    }catch(err){pending.delete(id);clearTimeout(timer);reject(err)}
  }).then(result=>{if(result.pong!==true)throw Error('Unexpected Agent ping response');done(true);return result},error=>{done(false,error?.message);throw error});
}
const webApp = createWebApp({
  store,
  oauth,
  usageMeter,
  baseUrl: BASE_URL,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  webDir: WEB_DIR,
  isDeviceConnected: deviceId => { const d=devices.get(deviceId); return Boolean(d && d.ws.readyState===1 && d.userId && store.getActiveDevice(deviceId)); },
  telemetry,
  probeDevice:probeDeviceFromWeb,
  onDeviceRevoked: deviceId => {
    const live = devices.get(deviceId);
    if (!live) return;
    dropDevice(deviceId, live.ws, 'Unpaired by owner');
    try { live.ws.close(1008, 'Unpaired by owner'); } catch {}
  }
});
const webHttp = http.createServer(webApp);
webHttp.listen(WEB_PORT, '127.0.0.1', () => {
  console.log(`YourHand Web ${VERSION} on ${BASE_URL}`);
});

agentHttp.listen(AGENT_PORT, '127.0.0.1', () => {
  console.log(`YourHand Agent ${VERSION} on http://127.0.0.1:${AGENT_PORT}/agent`);
});

function shutdown() {
  for (const d of devices.values()) {
    try { d.ws.close(1001, 'Server shutdown'); } catch {}
  }
  try { wss.close(); } catch {}
  try { agentHttp.close(); } catch {}
  try { mcpHttp.close(); } catch {}
  try { webHttp.close(); } catch {}
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', err => console.error('[fatal]', err));
process.on('unhandledRejection', err => console.error('[rejection]', err));