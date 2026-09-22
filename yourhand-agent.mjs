import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { FileActionJournal } from './yh-action-journal.mjs';
import { resolveYourHandNativeHelper } from './src/multiuser/native-helper-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.9.4-approval-wait';
const CONFIG_FILE = process.env.YOURHAND_CONFIG || path.join(__dirname, 'yourhand-config.json');
const BOOTSTRAP_FILE = process.env.YOURHAND_BOOTSTRAP || path.join(__dirname, 'yourhand-bootstrap.json');

function ensureDeviceKeys(){
  const privateKeyFile=path.join(__dirname,'device-private.pem');
  const publicKeyFile=path.join(__dirname,'device-public.pem');
  if(!fs.existsSync(privateKeyFile)||!fs.existsSync(publicKeyFile)){
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateKeyFile,privateKey.export({type:'pkcs8',format:'pem'}),{encoding:'utf8',mode:0o600});
    fs.writeFileSync(publicKeyFile,publicKey.export({type:'spki',format:'pem'}),'utf8');
  }
  return {privateKeyFile,publicKeyFile};
}

async function loadOrEnrollConfig(){
  if(fs.existsSync(CONFIG_FILE))return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'));
  if(!fs.existsSync(BOOTSTRAP_FILE))throw new Error('YourHand is not paired yet. Install or pair this device first.');
  const boot=JSON.parse(fs.readFileSync(BOOTSTRAP_FILE,'utf8'));
  const token=String(boot.pairingToken||'').trim();
  const enrollUrl=String(boot.enrollUrl||'').trim();
  if(!token||!/^https:\/\//i.test(enrollUrl))throw new Error('Invalid YourHand bootstrap configuration');
  const {privateKeyFile,publicKeyFile}=ensureDeviceKeys();
  const publicKey=fs.readFileSync(publicKeyFile,'utf8');
  const r=await fetch(enrollUrl,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({token,hostname:os.hostname(),displayName:os.hostname(),publicKey})
  });
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body.deviceId)throw new Error(body.error||('Enrollment failed: HTTP '+r.status));
  const cfg={
    deviceId:body.deviceId,
    displayName:body.displayName||os.hostname(),
    serverUrl:body.serverUrl||boot.serverUrl||'',
    privateKeyFile,
    publicKeyFile,
    nativeHelper:path.join(__dirname,'YourHandNative.exe'),
    disableDesktopCommander:boot.disableDesktopCommander!==false,
    browserPort:Number(boot.browserPort||9222)
  };
  const tmp=CONFIG_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(cfg,null,2),'utf8');
  fs.renameSync(tmp,CONFIG_FILE);
  try{fs.unlinkSync(BOOTSTRAP_FILE);}catch{}
  return cfg;
}

const config = await loadOrEnrollConfig();
const actionJournal=new FileActionJournal(path.join(path.dirname(CONFIG_FILE),'yh-action-journal'));

const DC_COMMAND = config.dcCommand || 'desktop-commander';
const DC_ARGS = Array.isArray(config.dcArgs) ? config.dcArgs : [];
const NATIVE_EXE = resolveYourHandNativeHelper(config.nativeHelper, __dirname);

let mcpClient=null, mcpTransport=null, mcpTools=[], mcpInit=null;
let nativeProc=null, nativeInit=null, nativeSeq=0;
const nativePending=new Map();
let ws=null, reconnectDelay=1000, heartbeat=null, reconnectTimer=null, shuttingDown=false;
const actionTrace=new AsyncLocalStorage();
function safeStep(kind,action,elapsedMs,error){
 const ctx=actionTrace.getStore();
 if(!ctx||ctx.steps.length>=64)return;
 const safe=String(action||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,46);
 const methodId=(kind==='native'?'AGENT_NATIVE_':'AGENT_BROWSER_')+safe.toUpperCase();
 // Raw exception, file path, target selector and arguments NEVER leave Agent.
 const e=String(error?.message||error||'');
 const errorCode=!error?null:/USER_APPROVAL_REQUIRED/i.test(e)?'USER_APPROVAL_REQUIRED':
   /stale/i.test(e)?'STALE_REFERENCE':
   /timeout/i.test(e)?'TIMEOUT':/locked|interactive|secure.desktop/i.test(e)?'NO_INTERACTIVE_SESSION':
   /access.denied|uac|permission/i.test(e)?'ELEVATION_REQUIRED':'UNCLASSIFIED_ERROR';
 ctx.steps.push({methodId,routeId:kind==='native'?'windows.native':'browser.cdp',
   attemptIndex:ctx.steps.length+1,durationMs:Math.min(600000,Math.max(0,Math.round(elapsedMs))),
   outcome:error?'failed':'completed',errorCode});
}


const NATIVE_ACTIONS=[
  'ping','list_windows','foreground','focus_window','close_window','mouse','scroll',
  'hotkey','type_text','clipboard_get','clipboard_set','screenshot','ui_tree','ui_find',
  'ui_invoke','ui_set_value','semantic_snapshot','semantic_batch','observe','click_preview','wait_window','launch','sleep','batch'
];

function log(...args){ console.log(new Date().toISOString(),...args); }

async function initMcp(){
  if(mcpClient)return;
  if(mcpInit)return mcpInit;
  mcpInit=(async()=>{
    if(config.disableDesktopCommander===true)throw new Error('Desktop Commander disabled');
    const [{Client},{StdioClientTransport,getDefaultEnvironment}]=await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js')
    ]);
    const transport=new StdioClientTransport({
      command:DC_COMMAND,args:DC_ARGS,cwd:__dirname,
      env:{...getDefaultEnvironment(),DC_REMOTE_DEVICE:'true'}
    });
    const client=new Client({name:'yourhand-device',version:VERSION},{capabilities:{}});
    client.onclose=()=>{log('Local Desktop Commander closed');mcpClient=null;mcpTransport=null;mcpTools=[];};
    client.onerror=e=>log('Local MCP error:',e?.message||String(e));
    await client.connect(transport);
    const listed=await client.listTools();
    mcpClient=client;mcpTransport=transport;mcpTools=listed.tools||[];
    log(`Local Desktop Commander ready (${mcpTools.length} tools)`);
  })().finally(()=>{mcpInit=null;});
  return mcpInit;
}
async function ensureMcp(){if(!mcpClient)await initMcp();}

function rejectNativePending(reason){
  for(const [id,p] of nativePending){clearTimeout(p.timer);p.reject(new Error(reason));}
  nativePending.clear();
}
async function initNative(){
  if(nativeProc&&!nativeProc.killed)return;
  if(nativeInit)return nativeInit;
  nativeInit=new Promise((resolve,reject)=>{
    if(!fs.existsSync(NATIVE_EXE)){reject(new Error(`Native helper not found: ${NATIVE_EXE}`));return;}
    const p=spawn(NATIVE_EXE,[],{cwd:__dirname,windowsHide:true,stdio:['pipe','pipe','pipe']});
    nativeProc=p;
    const rl=readline.createInterface({input:p.stdout});
    rl.on('line',line=>{
      let msg;try{msg=JSON.parse(line);}catch{return;}
      const wait=nativePending.get(msg.id);if(!wait)return;
      clearTimeout(wait.timer);nativePending.delete(msg.id);
      msg.ok?wait.resolve(msg):wait.reject(new Error(msg.error||'Native helper error'));
    });
    p.stderr.on('data',d=>log('Native stderr:',String(d).trim()));
    p.on('error',err=>{log('Native helper error:',err.message);rejectNativePending(err.message);nativeProc=null;});
    p.on('exit',(code,signal)=>{log(`Native helper exited code=${code} signal=${signal}`);rejectNativePending('Native helper exited');nativeProc=null;});
    setTimeout(()=>resolve(),40);
  }).finally(()=>{nativeInit=null;});
  return nativeInit;
}
async function nativeCallInner(action,args={},timeoutMs=15000){
  await initNative();
  if(!nativeProc||nativeProc.killed)throw new Error('Native helper unavailable');
  const id=`n${Date.now().toString(36)}-${(++nativeSeq).toString(36)}`;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{nativePending.delete(id);reject(new Error(`Native timeout after ${timeoutMs}ms: ${action}`));},Math.min(Math.max(timeoutMs,500),180000));
    nativePending.set(id,{resolve,reject,timer});
    nativeProc.stdin.write(JSON.stringify({id,action,args})+'\n','utf8',err=>{
      if(err){clearTimeout(timer);nativePending.delete(id);reject(err);}
    });
  });
}

async function nativeCall(action,args={},timeoutMs=15000){
 const t=Date.now();
 try{
   const result=await nativeCallInner(action,args,timeoutMs);
   safeStep('native',action,Date.now()-t,null);
   return result;
 }catch(error){
   safeStep('native',action,Date.now()-t,error);
   throw error;
 }
}

const BROWSER_PORT = Number(config.browserPort || 9222);
let browserProc = null;

function browserExe(){
  const candidates=[config.browserExe,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
  for(const p of candidates){ if(fs.existsSync(p)) return p; }
  throw new Error('No supported Chromium browser found');
}

async function browserJson(pathname, options={}){
  const r=await fetch(`http://127.0.0.1:${BROWSER_PORT}${pathname}`, options);
  if(!r.ok) throw new Error(`CDP HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function browserStatus(){
  try {
    const v=await browserJson('/json/version');
    const tabs=await browserJson('/json/list');
    return {running:true,port:BROWSER_PORT,browser:v.Browser||'',protocolVersion:v['Protocol-Version']||'',tabs:tabs.filter(x=>x.type==='page').length};
  } catch { return {running:false,port:BROWSER_PORT}; }
}

async function ensureBrowser(args={}){
  const st=await browserStatus(); if(st.running) return st;
  const exe=browserExe();
  const profile=args.profileDir || config.browserProfileDir || path.join(process.env.LOCALAPPDATA || __dirname,'YourHandBrowserProfile');
  fs.mkdirSync(profile,{recursive:true});
  const startUrl=args.url || 'about:blank';
  const argv=[`--remote-debugging-port=${BROWSER_PORT}`,'--remote-allow-origins=*',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-features=msEdgeFirstRunExperience','--disable-background-mode',startUrl];
  browserProc=spawn(exe,argv,{cwd:path.dirname(exe),windowsHide:false,stdio:'ignore'});
  browserProc.on('exit',()=>{browserProc=null;});
  const deadline=Date.now()+(args.timeoutMs||10000);
  while(Date.now()<deadline){ await new Promise(r=>setTimeout(r,120)); const bs=await browserStatus(); if(bs.running) return {...bs,started:true,exe,profile}; }
  throw new Error('Browser CDP did not start in time');
}

async function browserTargets(){
  await ensureBrowser();
  const tabs=await browserJson('/json/list');
  return tabs.filter(x=>x.type==='page').map(x=>({id:x.id,title:x.title,url:x.url,webSocketDebuggerUrl:x.webSocketDebuggerUrl}));
}

async function browserNewTab(url='about:blank'){
  await ensureBrowser();
  const t=await browserJson('/json/new?'+encodeURIComponent(url),{method:'PUT'});
  return {id:t.id,title:t.title,url:t.url};
}

async function cdpCall(method,params={},targetId=null,timeoutMs=15000){
  const tabs=await browserJson('/json/list');
  let tab=targetId ? tabs.find(x=>x.id===targetId) : tabs.find(x=>x.type==='page');
  if(!tab){ const n=await browserNewTab('about:blank'); return cdpCall(method,params,n.id,timeoutMs); }
  if(!tab.webSocketDebuggerUrl) throw new Error('Target has no debugger websocket');
  return new Promise((resolve,reject)=>{
    const sock=new WebSocket(tab.webSocketDebuggerUrl);
    const id=1;
    const timer=setTimeout(()=>{try{sock.close();}catch{} reject(new Error(`CDP timeout: ${method}`));},timeoutMs);
    sock.on('open',()=>sock.send(JSON.stringify({id,method,params})));
    sock.on('message',raw=>{ let msg; try{msg=JSON.parse(raw.toString());}catch{return;} if(msg.id!==id)return; clearTimeout(timer); try{sock.close();}catch{} if(msg.error)reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`)); else resolve(msg.result||{}); });
    sock.on('error',err=>{clearTimeout(timer);reject(err);});
  });
}

async function waitReady(targetId,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    try { const r=await cdpCall('Runtime.evaluate',{expression:'document.readyState',returnByValue:true},targetId,3000); const v=r?.result?.value; if(v==='complete'||v==='interactive') return v; } catch {}
    await new Promise(r=>setTimeout(r,80));
  }
  return 'timeout';
}

async function browserActionInner(action,args={}){
  if(action==='status') return browserStatus();
  if(action==='start') return ensureBrowser(args);
  if(action==='tabs') return browserTargets();
  if(action==='new_tab') return browserNewTab(args.url||'about:blank');
  if(action==='navigate'){
    await ensureBrowser();
    let targetId=args.targetId;
    if(args.newTab){const n=await browserNewTab('about:blank');targetId=n.id;}
    if(!targetId){const ts=await browserTargets();targetId=ts[0]?.id;}
    if(!targetId){const n=await browserNewTab('about:blank');targetId=n.id;}
    await cdpCall('Page.enable',{},targetId);
    await cdpCall('Page.navigate',{url:args.url},targetId,args.timeoutMs||15000);
    const ready=await waitReady(targetId,args.timeoutMs||15000);
    const info=await cdpCall('Runtime.evaluate',{expression:'({title:document.title,url:location.href,ready:document.readyState})',returnByValue:true},targetId);
    return {targetId,ready,...(info?.result?.value||{})};
  }
  if(action==='eval'){
    await ensureBrowser();
    const r=await cdpCall('Runtime.evaluate',{expression:args.expression||'',awaitPromise:args.awaitPromise!==false,returnByValue:args.returnByValue!==false},args.targetId||null,args.timeoutMs||15000);
    return {targetId:args.targetId||null,result:r.result||null,exceptionDetails:r.exceptionDetails||null};
  }
  if(action==='text'){ const r=await browserAction('eval',{targetId:args.targetId,expression:'document.body ? document.body.innerText : ""'}); return {targetId:args.targetId||null,text:r?.result?.value||''}; }
  if(action==='click'){ const sel=JSON.stringify(args.selector||''); return browserAction('eval',{targetId:args.targetId,expression:`(()=>{const e=document.querySelector(${sel});if(!e)return {ok:false};e.scrollIntoView({block:'center',inline:'center'});e.click();return {ok:true,tag:e.tagName,text:(e.innerText||e.value||'').slice(0,200)}})()`}); }
  if(action==='type'){ const sel=JSON.stringify(args.selector||''); const val=JSON.stringify(args.text??''); return browserAction('eval',{targetId:args.targetId,expression:`(()=>{const e=document.querySelector(${sel});if(!e)return {ok:false};e.focus();const p=Object.getPrototypeOf(e);const d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,${val});else e.value=${val};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:e.value}})()`}); }
  if(action==='wait_selector'){
    const deadline=Date.now()+(args.timeoutMs||10000);
    while(Date.now()<deadline){ const r=await browserAction('eval',{targetId:args.targetId,expression:`!!document.querySelector(${JSON.stringify(args.selector||'')})`}); if(r?.result?.value===true)return {found:true,targetId:args.targetId||null}; await new Promise(r=>setTimeout(r,args.pollMs||80)); }
    return {found:false,targetId:args.targetId||null};
  }
  if(action==='close_tab'){ await ensureBrowser(); const ok=await fetch(`http://127.0.0.1:${BROWSER_PORT}/json/close/${encodeURIComponent(args.targetId||'')}`); return {closed:ok.ok,targetId:args.targetId||''}; }
  throw new Error(`Unknown browser action: ${action}`);
}

async function browserScreenshot(args={}){
  await ensureBrowser();
  const r=await cdpCall('Page.captureScreenshot',{format:args.format||'png',fromSurface:true,captureBeyondViewport:args.captureBeyondViewport!==false},args.targetId||null,args.timeoutMs||30000);
  const mime=(args.format||'png')==='jpeg'?'image/jpeg':'image/png';
  return {content:[{type:'image',data:r.data,mimeType:mime},{type:'text',text:JSON.stringify({targetId:args.targetId||null,base64Chars:r.data?.length||0})}]};
}

async function browserBatch(args={}){
  const steps=Array.isArray(args.steps)?args.steps:[]; if(!steps.length)throw new Error('steps array required');
  const results=[];
  for(let i=0;i<steps.length;i++){const st=steps[i]||{};const t0=Date.now();try{const result=await browserAction(st.action,st);results.push({index:i,action:st.action,ok:true,elapsedMs:Date.now()-t0,result});}catch(e){results.push({index:i,action:st.action,ok:false,elapsedMs:Date.now()-t0,error:e?.message||String(e)});if(!args.continueOnError)break;}}
  return {count:results.length,results};
}


async function execLocal(args={}){
  const shell=(args.shell||'powershell').toLowerCase();
  const command=String(args.command||'');
  if(!command) throw new Error('command required');
  let exe,argv;
  if(shell==='cmd'){
    exe=process.env.ComSpec || 'C:/Windows/System32/cmd.exe';
    argv=['/d','/s','/c',command];
  }else{
    exe=args.executable || 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    argv=['-NoLogo','-NoProfile','-Sta','-Command',command];
  }
  const cwd=args.cwd || process.env.USERPROFILE || __dirname;
  const timeoutMs=Math.min(Math.max(Number(args.timeoutMs||60000),500),300000);
  const maxBytes=Math.min(Math.max(Number(args.maxBytes||5*1024*1024),1024),20*1024*1024);
  const t0=Date.now();
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,argv,{cwd,windowsHide:true,env:{...process.env,...(args.env||{})}});
    let stdout='',stderr='',outBytes=0,errBytes=0,timedOut=false;
    const add=(which,buf)=>{
      const s=buf.toString('utf8');
      if(which==='out'&&outBytes<maxBytes){const remain=maxBytes-outBytes;const part=Buffer.from(s).subarray(0,remain).toString('utf8');stdout+=part;outBytes+=Buffer.byteLength(part);}
      if(which==='err'&&errBytes<maxBytes){const remain=maxBytes-errBytes;const part=Buffer.from(s).subarray(0,remain).toString('utf8');stderr+=part;errBytes+=Buffer.byteLength(part);}
    };
    child.stdout.on('data',b=>add('out',b));
    child.stderr.on('data',b=>add('err',b));
    child.on('error',reject);
    const timer=setTimeout(()=>{timedOut=true;try{child.kill();}catch{}},timeoutMs);
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,timedOut,elapsedMs:Date.now()-t0,stdout,stderr,stdoutTruncated:outBytes>=maxBytes,stderrTruncated:errBytes>=maxBytes});});
  });
}

const procSessions=new Map();
const PROC_MAX_BUFFER=5*1024*1024;

function fileMeta(p,st){
  return {path:p,name:path.basename(p),type:st.isDirectory()?'directory':st.isFile()?'file':'other',size:st.size,mtime:st.mtime.toISOString(),ctime:st.ctime.toISOString()};
}

function fsSearch(root,args){
  const query=String(args.query||'').toLowerCase();
  const maxResults=Math.min(Math.max(Number(args.maxResults||200),1),5000);
  const maxDepth=Math.min(Math.max(Number(args.maxDepth||8),0),64);
  const includeDirs=args.includeDirs===true;
  const results=[];
  const walk=(dir,depth)=>{
    if(results.length>=maxResults||depth>maxDepth)return;
    let ents=[]; try{ents=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
    for(const e of ents){
      if(results.length>=maxResults)break;
      const full=path.join(dir,e.name);
      const hit=!query||e.name.toLowerCase().includes(query)||full.toLowerCase().includes(query);
      if(hit&&(e.isFile()||(includeDirs&&e.isDirectory()))){try{results.push(fileMeta(full,fs.statSync(full)));}catch{}}
      if(e.isDirectory())walk(full,depth+1);
    }
  };
  walk(root,0);
  return {root,query,count:results.length,truncated:results.length>=maxResults,results};
}

function fsCall(action,args={}){
  const p=args.path?path.resolve(String(args.path)):null;
  if(action==='stat'){ if(!p)throw new Error('path required'); return fileMeta(p,fs.statSync(p)); }
  if(action==='list'){
    if(!p)throw new Error('path required');
    const ents=fs.readdirSync(p,{withFileTypes:true});
    const items=[];
    for(const e of ents){const full=path.join(p,e.name);try{items.push(fileMeta(full,fs.statSync(full)));}catch{items.push({path:full,name:e.name,type:e.isDirectory()?'directory':'unknown'});}}
    return {path:p,count:items.length,items};
  }
  if(action==='read_text'){
    if(!p)throw new Error('path required'); const enc=args.encoding||'utf8'; const max=Math.min(Math.max(Number(args.maxBytes||5*1024*1024),1),20*1024*1024);
    const st=fs.statSync(p); const start=Math.max(Number(args.offset||0),0); const len=Math.min(Math.max(Number(args.length||Math.min(max,st.size-start)),0),max);
    const fd=fs.openSync(p,'r'); const buf=Buffer.alloc(len); const n=fs.readSync(fd,buf,0,len,start); fs.closeSync(fd);
    return {path:p,offset:start,bytes:n,totalBytes:st.size,truncated:start+n<st.size,text:buf.subarray(0,n).toString(enc)};
  }
  if(action==='read_binary'){
    if(!p)throw new Error('path required'); const max=Math.min(Math.max(Number(args.maxBytes||10*1024*1024),1),20*1024*1024); const st=fs.statSync(p); if(st.size>max)throw new Error(`file too large (${st.size} bytes > ${max})`);
    const b=fs.readFileSync(p); return {path:p,bytes:b.length,base64:b.toString('base64')};
  }
  if(action==='write_text'){
    if(!p)throw new Error('path required'); if(args.createParents!==false)fs.mkdirSync(path.dirname(p),{recursive:true}); const data=String(args.text??'');
    if(args.append===true)fs.appendFileSync(p,data,{encoding:args.encoding||'utf8'}); else fs.writeFileSync(p,data,{encoding:args.encoding||'utf8'});
    return fileMeta(p,fs.statSync(p));
  }
  if(action==='write_binary'){
    if(!p)throw new Error('path required'); if(args.createParents!==false)fs.mkdirSync(path.dirname(p),{recursive:true}); const b=Buffer.from(String(args.base64||''),'base64');
    if(args.append===true)fs.appendFileSync(p,b); else fs.writeFileSync(p,b); return fileMeta(p,fs.statSync(p));
  }
  if(action==='mkdir'){ if(!p)throw new Error('path required'); fs.mkdirSync(p,{recursive:args.recursive!==false}); return {path:p,created:true}; }
  if(action==='move'){ if(!p||!args.destination)throw new Error('path and destination required'); const d=path.resolve(String(args.destination)); if(args.createParents!==false)fs.mkdirSync(path.dirname(d),{recursive:true}); fs.renameSync(p,d); return {from:p,to:d}; }
  if(action==='copy'){ if(!p||!args.destination)throw new Error('path and destination required'); const d=path.resolve(String(args.destination)); if(args.createParents!==false)fs.mkdirSync(path.dirname(d),{recursive:true}); fs.cpSync(p,d,{recursive:args.recursive===true,force:args.force!==false}); return {from:p,to:d}; }
  if(action==='remove'){ if(!p)throw new Error('path required'); fs.rmSync(p,{recursive:args.recursive===true,force:args.force===true}); return {path:p,removed:true}; }
  if(action==='search'){ if(!p)throw new Error('path required'); return fsSearch(p,args); }
  throw new Error(`Unknown fs action: ${action}`);
}

function procAppend(sess,kind,buf){
  const s=buf.toString('utf8'); sess.buffer+=s; sess[kind]+=s; sess.totalChars+=s.length;
  if(sess.buffer.length>PROC_MAX_BUFFER){const cut=sess.buffer.length-PROC_MAX_BUFFER;sess.buffer=sess.buffer.slice(cut);sess.baseOffset+=cut;}
  if(sess.stdout.length>PROC_MAX_BUFFER)sess.stdout=sess.stdout.slice(-PROC_MAX_BUFFER);
  if(sess.stderr.length>PROC_MAX_BUFFER)sess.stderr=sess.stderr.slice(-PROC_MAX_BUFFER);
}

function procStart(args={}){
  const shell=(args.shell||'powershell').toLowerCase(); const interactive=args.interactive===true; const command=String(args.command||'');
  let exe,argv;
  if(args.executable){exe=String(args.executable);argv=Array.isArray(args.arguments)?args.arguments.map(String):[];}
  else if(shell==='cmd'){exe=process.env.ComSpec||'C:/Windows/System32/cmd.exe';argv=interactive?['/d']:['/d','/s','/c',command];}
  else {exe='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';argv=interactive?['-NoLogo','-NoProfile','-Sta']:['-NoLogo','-NoProfile','-Sta','-Command',command];}
  const id=crypto.randomUUID(); const cwd=args.cwd||process.env.USERPROFILE||__dirname;
  const child=spawn(exe,argv,{cwd,windowsHide:args.showWindow!==true,env:{...process.env,...(args.env||{})},stdio:['pipe','pipe','pipe']});
  const sess={id,pid:child.pid,child,exe,argv,cwd,createdAt:new Date().toISOString(),buffer:'',stdout:'',stderr:'',baseOffset:0,totalChars:0,exited:false,code:null,signal:null};
  procSessions.set(id,sess);
  child.stdout.on('data',b=>procAppend(sess,'stdout',b)); child.stderr.on('data',b=>procAppend(sess,'stderr',b));
  child.on('exit',(code,signal)=>{sess.exited=true;sess.code=code;sess.signal=signal;sess.exitedAt=new Date().toISOString();});
  child.on('error',e=>{procAppend(sess,'stderr',Buffer.from(String(e?.stack||e)));});
  return {sessionId:id,pid:child.pid,exe,arguments:argv,cwd,interactive};
}

function procCall(action,args={}){
  if(action==='start')return procStart(args);
  if(action==='list'){return {count:procSessions.size,sessions:[...procSessions.values()].map(s=>({sessionId:s.id,pid:s.pid,exe:s.exe,cwd:s.cwd,createdAt:s.createdAt,exited:s.exited,code:s.code,signal:s.signal,baseOffset:s.baseOffset,nextOffset:s.baseOffset+s.buffer.length}))};}
  const id=String(args.sessionId||''); const s=procSessions.get(id); if(!s)throw new Error(`Unknown process session: ${id}`);
  if(action==='read'){const req=Number(args.offset??s.baseOffset);const start=Math.max(req,s.baseOffset);const local=Math.max(0,start-s.baseOffset);const text=s.buffer.slice(local);return {sessionId:id,pid:s.pid,text,requestedOffset:req,actualOffset:start,nextOffset:s.baseOffset+s.buffer.length,truncated:req<s.baseOffset,exited:s.exited,code:s.code,signal:s.signal};}
  if(action==='write'){if(s.exited)throw new Error('process already exited');const input=String(args.input??'');s.child.stdin.write(input);return {sessionId:id,pid:s.pid,chars:input.length};}
  if(action==='kill'){if(!s.exited){try{s.child.kill(args.signal||undefined);}catch{}}return {sessionId:id,pid:s.pid,killed:true};}
  if(action==='close_stdin'){try{s.child.stdin.end();}catch{}return {sessionId:id,pid:s.pid,closed:true};}
  if(action==='forget'){if(!s.exited&&!args.force)throw new Error('process still running; set force=true or kill it first');if(!s.exited&&args.force){try{s.child.kill();}catch{}}procSessions.delete(id);return {sessionId:id,forgotten:true};}
  throw new Error(`Unknown process action: ${action}`);
}

function systemInfo(){
  return {
    hostname:os.hostname(),platform:os.platform(),release:os.release(),arch:os.arch(),
    cpus:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),
    uptimeSeconds:os.uptime(),node:process.version,deviceName:config.displayName||config.deviceName||os.hostname(),
    agentVersion:VERSION,nativeHelper:fs.existsSync(NATIVE_EXE),nativeActions:NATIVE_ACTIONS.length,browserCdp:true,browserPort:BROWSER_PORT,desktopCommanderAvailable:!!mcpClient,desktopCommanderDisabled:config.disableDesktopCommander===true,directFilesystem:true,directProcessSessions:true
  };
}

async function browserAction(action,args={}){
 const t=Date.now();
 try{
   const result=await browserActionInner(action,args);
   safeStep('browser',action,Date.now()-t,null);
   return result;
 }catch(error){
   safeStep('browser',action,Date.now()-t,error);
   throw error;
 }
}
async function nativeScreenshot(params={}){
  const shotParams={memory:true,...params};
  const msg=await nativeCall('screenshot',shotParams,30000);
  const info=msg.result||{};
  let data=info.dataBase64||'';
  if(!data){
    const p=info.path;
    if(!p||!fs.existsSync(p))throw new Error('Screenshot payload missing');
    data=fs.readFileSync(p).toString('base64');
    if(params.keep!==true){try{fs.unlinkSync(p);}catch{}}
  }
  const mimeType=info.format==='jpeg'?'image/jpeg':'image/png';
  return {
    content:[
      {type:'image',data,mimeType},
      {type:'text',text:JSON.stringify({width:info.width,height:info.height,sourceWidth:info.sourceWidth||info.width,sourceHeight:info.sourceHeight||info.height,format:info.format||'png',quality:info.quality||null,bytes:info.bytes,nativeElapsedMs:msg.elapsedMs,memory:!!info.dataBase64})}
    ]
  };
}

async function nativeObserve(params={}){
  const t0=Date.now();
  const msg=await nativeCall('observe',{format:'jpeg',quality:45,maxWidth:960,maxHeight:700,...params},30000);
  const result=msg.result||{};
  const shot=result.screenshot||{};
  let data=shot.dataBase64||'';
  if(!data)throw new Error('Observe screenshot payload missing');
  const mimeType=shot.format==='jpeg'?'image/jpeg':'image/png';
  const meta={
    observationId:result.observationId||null,
    frameId:result.frameId||null,
    validForMs:result.validForMs||0,
    window:result.window||null,
    snapshot:result.snapshot||null,
    screenshot:{width:shot.width,height:shot.height,sourceWidth:shot.sourceWidth||shot.width,sourceHeight:shot.sourceHeight||shot.height,format:shot.format||'jpeg',quality:shot.quality||45,bytes:shot.bytes},
    nativeElapsedMs:msg.elapsedMs,
    totalAgentElapsedMs:Date.now()-t0
  };
  return {content:[
    {type:'image',data,mimeType},
    {type:'text',text:JSON.stringify(meta)}
  ]};
}

async function nativeBatchFrame(params={}){
  const steps=Array.isArray(params.steps)?params.steps:[];
  if(!steps.length)throw new Error('steps array required');
  const timeoutMs=Math.min(Math.max(Number(params.timeoutMs||60000),500),180000);
  const t0=Date.now();
  const batch=await nativeCall('batch',{steps,continueOnError:!!params.continueOnError},timeoutMs);
  const shotArgs={memory:true,window:true,captureMethod:'screen',format:'jpeg',quality:45,maxWidth:960,maxHeight:700,...(params.screenshot||{})};
  const shot=await nativeCall('screenshot',shotArgs,30000);
  const info=shot.result||{};
  let data=info.dataBase64||'';
  if(!data){
    const p=info.path;
    if(!p||!fs.existsSync(p))throw new Error('Screenshot payload missing');
    data=fs.readFileSync(p).toString('base64');
    if(shotArgs.keep!==true){try{fs.unlinkSync(p);}catch{}}
  }
  const mimeType=info.format==='jpeg'?'image/jpeg':'image/png';
  return {content:[
    {type:'image',data,mimeType},
    {type:'text',text:JSON.stringify({batch:batch.result||null,width:info.width,height:info.height,sourceWidth:info.sourceWidth||info.width,sourceHeight:info.sourceHeight||info.height,format:info.format||shotArgs.format,quality:info.quality||shotArgs.quality,bytes:info.bytes,batchNativeElapsedMs:batch.elapsedMs,screenshotNativeElapsedMs:shot.elapsedMs,totalAgentElapsedMs:Date.now()-t0})}
  ]};
}

async function dispatch(method,params={}){
  if(method==='ping')return {pong:true,at:new Date().toISOString()};
  if(method==='system_info')return systemInfo();
  if(method==='mcp_call'){
    await ensureMcp();
    return mcpClient.callTool({name:params.tool,arguments:params.args||{},_meta:{remote:true,yourhand:true}});
  }
  if(method==='native_call'){
    const perform=async()=>{
      const msg=await nativeCall(params.action,params.args||{},params.timeoutMs||15000);
      return {action:params.action,nativeElapsedMs:msg.elapsedMs,result:msg.result};
    };
    if(['click_preview','semantic_batch'].includes(params.action) && params._yhActionId)
      return actionJournal.execute(params._yhActionId,{method,action:params.action,args:params.args||{}},perform);
    return perform();
  }
  if(method==='native_screenshot')return nativeScreenshot(params);
  if(method==='native_observe')return nativeObserve(params);
  if(method==='native_batch_frame')return nativeBatchFrame(params);
  if(method==='browser_call'){
    const args=params.args||{};
    if(params.action==='eval' && args._yhActionId)
      return actionJournal.execute(args._yhActionId,
        {method,action:'guarded_eval',targetId:args.targetId,expression:args.expression},
        ()=>browserAction(params.action,args));
    return browserAction(params.action,args);
  }
  if(method==='guarded_action_status'){
    return actionJournal.status(params.actionId);
  }
  if(method==='browser_batch')return browserBatch(params||{});
  if(method==='browser_screenshot')return browserScreenshot(params||{});
  if(method==='exec'){
    if(params?._yhActionId)
      return actionJournal.execute(params._yhActionId,
        {method:'exec',shell:params.shell||'powershell',command:params.command||'',
          cwd:params.cwd||null,timeoutMs:params.timeoutMs||60000},
        ()=>execLocal(params));
    return execLocal(params||{});
  }
  if(method==='fs_call')return fsCall(params.action,params.args||{});
  if(method==='proc_call')return procCall(params.action,params.args||{});
  throw new Error(`Unknown method: ${method}`);
}

function toolSummary(){
  return mcpTools.map(t=>({name:t.name,description:t.description||'',inputSchema:t.inputSchema||null,annotations:t.annotations||null}));
}

function scheduleReconnect(){
  if(shuttingDown || reconnectTimer)return;
  const delay=reconnectDelay;
  reconnectDelay=Math.min(reconnectDelay*2,30000);
  reconnectTimer=setTimeout(async()=>{
    reconnectTimer=null;
    try{await connectRemote();}
    catch(err){log('Reconnect failed:',err?.message||String(err));scheduleReconnect();}
  },delay);
}

async function connectRemote(){
  if(shuttingDown || (ws && (ws.readyState===WebSocket.CONNECTING || ws.readyState===WebSocket.OPEN)))return;
  await initNative();
  if(!config.deviceId) throw new Error('YourHand deviceId is missing. Pair this device again.');
  const url=new URL(config.serverUrl);
  url.searchParams.set('device_id',config.deviceId);
  const wsOptions={rejectUnauthorized:true};
  if(config.caFile && fs.existsSync(config.caFile)) wsOptions.ca=fs.readFileSync(config.caFile);
  log(`YourHand connecting ${config.displayName||os.hostname()} -> ${url.origin}${url.pathname}`);
  ws=new WebSocket(url,wsOptions);
  const socket=ws;
  let ready=false;
  const connectionDeadline=setTimeout(()=>{
    if(socket.readyState===WebSocket.CONNECTING || (socket.readyState===WebSocket.OPEN && !ready)){
      log('YourHand connection/auth timed out; reconnecting');socket.terminate();
    }
  },30000);
  const markReady=()=>{
    if(ready || socket!==ws || socket.readyState!==WebSocket.OPEN)return;
    ready=true;clearTimeout(connectionDeadline);reconnectDelay=1000;
    socket.send(JSON.stringify({type:'hello',meta:{...systemInfo(),dcVersion:config.dcVersion||'0.2.51'},tools:toolSummary()}));
    heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'heartbeat'}));},20000);
    heartbeat.unref?.();
    log('YourHand authenticated and ready');
  };
  socket.on('open',()=>log('YourHand socket open; waiting for Ed25519 challenge'));
  socket.on('message',async raw=>{
    if(socket!==ws || shuttingDown)return;
    let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
    if(msg.type==='challenge'){
      try{
        const key=fs.readFileSync(config.privateKeyFile,'utf8');
        const signature=crypto.sign(null,Buffer.from(msg.nonce,'utf8'),key).toString('base64');
        socket.send(JSON.stringify({type:'auth',signature}));
      }catch(error){log('Signature auth failed locally:',error?.message||String(error));socket.close(1008,'Local authentication failure');}
      return;
    }
    if(msg.type==='auth_ok'){markReady();return;}
    if(msg.type!=='request')return;
    const actionStart=Date.now();
    const trace={steps:[]};
    try{
      const result=await actionTrace.run(trace,()=>dispatch(msg.method,msg.params||{}));
      if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'response',id:msg.id,ok:true,result,agentElapsedMs:Date.now()-actionStart,agentMethodCalls:trace.steps}));
      else log('Request finished after its socket disconnected; result not replayed',msg.id);
    }catch(error){
      if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'response',id:msg.id,ok:false,error:error?.stack||error?.message||String(error),agentElapsedMs:Date.now()-actionStart,agentMethodCalls:trace.steps}));
      else log('Request failed after its socket disconnected; no automatic replay',msg.id);
    }
  });
  socket.on('error',err=>log('YourHand websocket error:',err.message));
  socket.on('close',(code,reason)=>{
    clearTimeout(connectionDeadline);
    if(socket!==ws)return; // obsolete sockets cannot schedule duplicate reconnects
    ready=false;if(heartbeat)clearInterval(heartbeat);heartbeat=null;
    ws=null;
    log(`YourHand connection closed ${code} ${String(reason)}`);
    scheduleReconnect();
  });
}

async function shutdown(){
  shuttingDown=true;
  if(reconnectTimer)clearTimeout(reconnectTimer);reconnectTimer=null;
  log('Shutting down');if(heartbeat)clearInterval(heartbeat);
  try{ws?.close(1000,'Agent shutdown');}catch{}
  try{await mcpClient?.close();}catch{}
  try{await mcpTransport?.close();}catch{}
  try{nativeProc?.kill();}catch{}
  setTimeout(()=>process.exit(0),250).unref();
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
process.on('uncaughtException',err=>log('Uncaught:',err));
process.on('unhandledRejection',err=>log('Unhandled rejection:',err));

try{if(config.disableDesktopCommander===true){log('Desktop Commander disabled by config');mcpClient=null;mcpTools=[];}else{try{await initMcp();}catch(e){log('Desktop Commander optional init failed:',e?.message||String(e));mcpClient=null;mcpTools=[];}}await initNative();try{const dc=await nativeCall('desktop_context',{},5000);log('Desktop context',JSON.stringify(dc.result));}catch(e){log('Desktop context error',e.message);}await connectRemote();}
catch(error){log('Startup failed:',error?.stack||error);process.exit(1);}
