'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { buildWindowsInstaller } = require('./installer');

const SESSION_COOKIE = 'yh_session';
const json = express.json({ limit: '64kb' });
const parseCookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return i<0?[v,'']:[v.slice(0,i),decodeURIComponent(v.slice(i+1))];}));
const cleanUser = u => u ? ({ id:u.id,email:u.email,name:u.name,picture:u.picture }) : null;
const safeReturnTo = value => {
  const v = String(value || '/');
  return v.startsWith('/') && !v.startsWith('//') ? v : '/';
};
const b64url = value => {
  const s = String(value).replace(/-/g,'+').replace(/_/g,'/');
  return Buffer.from(s + '='.repeat((4 - s.length % 4) % 4), 'base64');
};

function createGoogleVerifier(clientId) {
  let cache = { expiresAt: 0, keys: new Map() };
  async function refresh() {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('Google signing keys unavailable');
    const body = await r.json();
    const cc = String(r.headers.get('cache-control') || '');
    const m = cc.match(/max-age=(\d+)/);
    const ttl = (m ? Number(m[1]) : 3600) * 1000;
    cache = { expiresAt: Date.now() + Math.max(ttl,60000), keys: new Map((body.keys || []).map(k => [k.kid,k])) };
  }
  return async credential => {
    if (!clientId) throw new Error('Google sign-in is not configured');
    const parts = String(credential || '').split('.');
    if (parts.length !== 3) throw new Error('Invalid Google credential');
    let header, payload;
    try {
      header = JSON.parse(b64url(parts[0]).toString('utf8'));
      payload = JSON.parse(b64url(parts[1]).toString('utf8'));
    } catch { throw new Error('Invalid Google credential'); }
    if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential');
    if (cache.expiresAt < Date.now() || !cache.keys.has(header.kid)) await refresh();
    const jwk = cache.keys.get(header.kid);
    if (!jwk) throw new Error('Unknown Google signing key');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), key, b64url(parts[2]));
    if (!ok) throw new Error('Invalid Google signature');
    const now = Math.floor(Date.now()/1000);
    if (!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)) throw new Error('Invalid Google issuer');
    if (String(payload.aud) !== String(clientId)) throw new Error('Invalid Google audience');
    if (!payload.exp || Number(payload.exp) <= now) throw new Error('Expired Google credential');
    if (payload.nbf && Number(payload.nbf) > now + 60) throw new Error('Google credential not active');
    if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('Verified Google email required');
    return { sub:String(payload.sub||''), email:String(payload.email||''), name:String(payload.name||''), picture:String(payload.picture||''), email_verified:true };
  };
}

function createWebApp({ store, oauth, baseUrl, googleClientId, webDir, onDeviceRevoked = () => {}, isDeviceConnected = () => false, probeDevice = async () => ({}), telemetry = null, usageMeter = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
    next();
  });
  app.use(json);

  const verifyGoogle = createGoogleVerifier(googleClientId);
  const sessionUser = req => store.userFromSession(parseCookies(req)[SESSION_COOKIE]);
  const requireUser = (req,res,next)=>{ const u=sessionUser(req); if(!u)return res.status(401).json({error:'Sign in required'}); req.user=u; next(); };
  const sameOrigin = (req,res,next)=>{ const o=req.headers.origin; if(o && o!==baseUrl)return res.status(403).json({error:'Origin rejected'}); next(); };
  // Request-scoped privacy-safe API telemetry. Route templates (not raw URLs)
  // are captured at finish, so account IDs, invite tokens, query strings and
  // authorization headers can never enter the diagnostics store.
  app.use((req,res,next)=>{
    const monitored=req.path.startsWith('/api/')||req.path.startsWith('/auth/');
    if(!monitored||!telemetry)return next();
    const began=process.hrtime.bigint(),traceId=crypto.randomUUID();
    res.once('finish',()=>{
      try{
        const template=req.route?.path;
        if(typeof template!=='string'||!/^\/(api|auth)\/[A-Za-z0-9_/:.-]+$/.test(template))return;
        const user=sessionUser(req);
        const requestedId=req.params?.id||null;
        const authorized=requestedId&&user?store.getDeviceForUser(user.id,requestedId):null;
        const code=res.statusCode,status=code>=200&&code<400?'completed':'failed';
        telemetry.record({traceId,userId:user?.id||null,deviceId:authorized?.id||null,
          eventType:'web_request',methodId:'HTTP_'+req.method+'_'+template.replace(/[^A-Za-z0-9]/g,'_').toUpperCase().slice(0,59),
          routeId:'web.api',attemptIndex:1,methodsTried:1,
          durationMs:Number(process.hrtime.bigint()-began)/1e6,outcome:status,
          errorCode:status==='completed'?null:'HTTP '+code,errorStage:status==='completed'?null:'HTTP_RESPONSE'});
      }catch{}
    });
    next();
  });

  const bundlePath = process.env.YOURHAND_AGENT_BUNDLE || 'C:/ProgramData/YourHand/dist/YourHandAgent.zip';
  let bundleHashCache={mtimeMs:0,hash:''};
  const bundleHash=()=>{
    const st=fs.statSync(bundlePath);
    if(bundleHashCache.mtimeMs!==st.mtimeMs){bundleHashCache={mtimeMs:st.mtimeMs,hash:crypto.createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex')};}
    return bundleHashCache.hash;
  };
  const setSession = (res,user) => {
    const session=store.createSession(user.id);
    const secure=baseUrl.startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
  };
  app.get('/health', (_req,res)=>res.json({ok:true,name:'YourHand',mode:'multiuser',features:{sharedDevices:true}}));
  app.get('/api/config', (_req,res)=>res.json({googleClientId:googleClientId||'',googleConfigured:!!googleClientId,sharedDevices:true}));
  app.get('/auth/google', (req,res)=>{
    if(!googleClientId) return res.status(503).send('Google sign-in is not configured yet.');
    res.redirect('/?return_to='+encodeURIComponent(safeReturnTo(req.query.return_to)));
  });
  app.post('/auth/google/id-token', sameOrigin, async (req,res)=>{
    try {
      const profile=await verifyGoogle(req.body?.credential);
      if(!profile.sub||!profile.email) throw new Error('Google profile is incomplete');
      const user=store.upsertGoogleUser(profile);
      setSession(res,user);
      res.json({ok:true,user:cleanUser(user),redirect:safeReturnTo(req.body?.returnTo)});
    } catch(err) {
      console.error('[google-auth]',err?.message||err);
      res.status(401).json({error:'Google sign-in failed'});
    }
  });
  app.post('/auth/logout', sameOrigin, (req,res)=>{
    store.deleteSession(parseCookies(req)[SESSION_COOKIE]);
    res.setHeader('Set-Cookie',`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ok:true});
  });

  app.get('/api/me',(req,res)=>res.json({user:cleanUser(sessionUser(req))}));
  app.get('/api/devices',requireUser,(req,res)=>res.json({devices:store.listDevices(req.user.id).map(d=>({...d,online:isDeviceConnected(d.id)}))}));
  // Only the current authenticated Google account's work on devices it still
  // owns/has accepted may be measured. Owner never sees invitee's usage.
  app.get('/api/usage/devices',requireUser,(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!usageMeter)return res.status(503).json({error:'Usage tracking unavailable'});
    const devices=store.listDevices(req.user.id);
    res.json({scope:'current_google_account',trackingSince:new Date(usageMeter.startedMs).toISOString(),
      devices:devices.map(device=>({deviceId:device.id,
        ...usageMeter.summary({userId:req.user.id,deviceId:device.id})}))});
  });
  // Per-account diagnostics: no cross-user event access, no raw command or
  // screenshot content, and no administrative aggregation over other accounts.
  app.get('/api/telemetry/summary',requireUser,(req,res)=>{
    if(!telemetry)return res.status(503).json({error:'Diagnostics not enabled'});
    res.setHeader('Cache-Control','no-store');
    const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||30));
    res.json({scope:'current_google_account',retentionDays:telemetry.retentionDays,
      summary:telemetry.summary({userId:req.user.id,limit})});
  });

  // Diagnostics are strictly scoped to the signed-in account. Even a device
  // owner cannot silently inspect another invited user's command history.
  app.get('/api/telemetry/recent',requireUser,(req,res)=>{
    if(!telemetry)return res.status(503).json({error:'Diagnostics not enabled'});
    res.setHeader('Cache-Control','no-store');
    const limit=Math.min(60,Math.max(1,Number.parseInt(req.query.limit,10)||25));
    const deviceId=typeof req.query.device_id==='string'?req.query.device_id:null;
    if(deviceId&&!store.getDeviceForUser(req.user.id,deviceId))
      return res.status(404).json({error:'Device not found'});
    res.json({scope:'current_google_account',retentionDays:telemetry.retentionDays,
      events:telemetry.recent({userId:req.user.id,deviceId,limit})});
  });
  // A device dot alone is not proof of connectivity for this account. This
  // read-only, authenticated round trip checks the SAME physical Agent socket.
  app.post('/api/devices/:id/connect-check',sameOrigin,requireUser,async(req,res)=>{
    const linked=store.getDeviceForUser(req.user.id,req.params.id);
    if(!linked)return res.status(404).json({error:'Device not found or this account has not accepted its invitation'});
    res.setHeader('Cache-Control','no-store, max-age=0');
    try{
      const result=await probeDevice(req.user.id,req.params.id);
      res.json({ok:true,deviceId:linked.id,role:linked.access_role,connected:true,
        commandReachable:true,latencyMs:result.latencyMs,
        controlAllowed:linked.access_role!=='viewer',
        note:linked.access_role==='viewer'?
          'Read-only account. Owner must grant Operator access before commands.':
          'Connected: this account can send authorized commands. Interactive desktop access also depends on Windows session state.'});
    }catch(error){
      const message=String(error?.message||error);
      const code=message==='AGENT_OFFLINE'?'AGENT_OFFLINE':
        message.includes('timeout')?'AGENT_NOT_RESPONDING':'CONNECT_CHECK_FAILED';
      res.status(503).json({ok:false,connected:false,commandReachable:false,
        code,error:code==='AGENT_OFFLINE'?'Agent offline: check Windows Agent and network':
          code==='AGENT_NOT_RESPONDING'?'Agent socket is connected but did not respond to a command':
          'Device command channel unavailable. Try again after checking Agent connection.'});
    }
  });
  // One Agent/identity, many explicitly invited accounts. Invitee must sign in with
  // the exact invited verified Google email; merely finding the installer is not access.
  app.post('/api/devices/:id/share-invites',sameOrigin,requireUser,(req,res)=>{
    try{
      const invited=store.createDeviceShareInvite(req.user.id,req.params.id,req.body?.email,req.body?.role||'operator');
      // Token is delivered only to the owner here; owner shares link privately.
      const inviteUrl=baseUrl.replace(/\/$/,'')+'/?share='+encodeURIComponent(invited.token);
      res.setHeader('Cache-Control','no-store');
      res.status(201).json({inviteUrl,expiresAt:invited.expiresAt});
    }catch(e){res.status(403).json({error:e.message})}
  });
  app.post('/api/shares/accept',sameOrigin,requireUser,(req,res)=>{
    try{res.json({ok:true,...store.acceptDeviceShareInvite(req.user.id,req.body?.token)})}
    catch(e){res.status(403).json({error:e.message})}
  });
  app.get('/api/shares/pending',requireUser,(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json({invites:store.listPendingDeviceShareInvites(req.user.id)});
  });
  app.get('/api/devices/:id/shares',requireUser,(req,res)=>{
    try{res.json({members:store.listDeviceShares(req.user.id,req.params.id)})}
    catch(e){res.status(403).json({error:e.message})}
  });
  app.delete('/api/devices/:id/shares/:userId',sameOrigin,requireUser,(req,res)=>{
    try{res.json({ok:store.revokeDeviceShare(req.user.id,req.params.id,req.params.userId)})}
    catch(e){res.status(403).json({error:e.message})}
  });
  app.post('/api/pairing-codes',sameOrigin,requireUser,(req,res)=>{
    const pair=store.createPairingCode(req.user.id,30*60*1000);
    res.json({code:pair.code,expiresAt:pair.expiresAt,downloadUrl:'/download/windows?token='+encodeURIComponent(pair.installerToken)});
  });
  app.patch('/api/devices/:id',sameOrigin,requireUser,(req,res)=>{
    const ok=store.renameDevice(req.user.id,req.params.id,req.body?.name);
    if(!ok)return res.status(404).json({error:'Device not found'});
    res.json({ok:true});
  });
  app.delete('/api/devices/:id',sameOrigin,requireUser,(req,res)=>{
    const ok=store.revokeDevice(req.user.id,req.params.id);
    if(!ok)return res.status(404).json({error:'Device not found'});
    // Leaving a shared device must never close its owner's Agent connection.
    if(!store.getActiveDevice(req.params.id))onDeviceRevoked(req.params.id);
    res.json({ok:true});
  });

  app.get('/downloads/YourHandAgent.zip',(req,res)=>{
    if(!fs.existsSync(bundlePath))return res.status(404).send('Agent package not available.');
    const currentHash=bundleHash();
    const requested=String(req.query.sha||'').trim().toLowerCase();
    if(requested && requested!==currentHash.toLowerCase())return res.status(410).send('Agent package version expired.');
    res.setHeader('ETag','"'+currentHash+'"');
    res.setHeader('Cache-Control',requested?'public, max-age=31536000, immutable':'no-cache');
    res.setHeader('Content-Type','application/zip');
    res.sendFile(path.resolve(bundlePath));
  });
  app.get('/download/windows',requireUser,async(req,res)=>{
    const token=String(req.query.token||'').trim();
    if(!store.validateInstallerToken(req.user.id,token))return res.status(404).send('This download link is invalid or expired.');
    if(!fs.existsSync(bundlePath))return res.status(503).send('Windows installer package is not ready yet.');
    try{
      const built=await buildWindowsInstaller({token,baseUrl,bundleSha256:bundleHash(),agentUrl:process.env.YOURHAND_INSTALL_AGENT_URL||undefined});
      res.download(built.output,'YourHand-Setup.exe',err=>{
        built.cleanup();
        if(err&&!res.headersSent)res.status(500).end();
      });
    }catch(err){
      console.error('[installer]',err?.message||err);
      res.status(500).send('Could not build YourHand installer.');
    }
  });

  app.post('/api/device/enroll',sameOrigin,(req,res)=>{
    try{
      const input={displayName:req.body?.displayName,hostname:req.body?.hostname,publicKey:req.body?.publicKey};
      const token=String(req.body?.token||'').trim();
      const code=String(req.body?.code||'').toUpperCase().trim();
      const device=token?store.enrollDeviceToken(token,input):store.enrollDevice(code,input);
      if(!device)return res.status(400).json({error:'Invalid or expired pairing token'});
      res.json({deviceId:device.id,displayName:device.display_name,serverUrl:process.env.YOURHAND_AGENT_URL||null});
    }catch(err){ res.status(400).json({error:err.message}); }
  });
  app.use(oauth.router());

  app.use(express.static(webDir,{extensions:['html'],index:'index.html',maxAge:'5m'}));
  app.use((req,res)=>res.status(404).json({error:'Not found'}));
  return app;
}

module.exports={createWebApp,createGoogleVerifier};
