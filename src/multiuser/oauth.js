'use strict';
const crypto=require('crypto');
const express=require('express');

const nowIso=()=>new Date().toISOString();
const addMsIso=ms=>new Date(Date.now()+ms).toISOString();
const sha256=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const rand=(n=32)=>crypto.randomBytes(n).toString('base64url');
const b64sha=v=>crypto.createHash('sha256').update(String(v)).digest('base64url');
const scopes=s=>[...new Set(String(s||'').split(/\s+/).filter(Boolean))].join(' ');

class YourHandOAuth{
  constructor(store,{issuer,resource}){
    this.store=store;this.db=store.db;
    this.issuer=issuer.replace(/\/$/,'');this.resource=resource;
    this.init();
  }
  init(){
    this.db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients(
 client_id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, client_name TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_auth_codes(
 code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,code_challenge TEXT NOT NULL,scope TEXT NOT NULL,
 resource TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL
);
`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS oauth_access_tokens(
 token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
 scope TEXT NOT NULL,resource TEXT NOT NULL,expires_at TEXT NOT NULL,
 revoked_at TEXT,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens(
 token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
 scope TEXT NOT NULL,resource TEXT NOT NULL,expires_at TEXT NOT NULL,
 revoked_at TEXT,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_user ON oauth_access_tokens(user_id);
`);
  }
  registerClient(meta={}){
    const uris=Array.isArray(meta.redirect_uris)?meta.redirect_uris.map(String):[];
    if(!uris.length||uris.length>10||uris.some(u=>{try{return new URL(u).protocol!=='https:';}catch{return true;}})) throw new Error('Valid HTTPS redirect_uris required');
    const id='yh_'+rand(18);
    this.db.prepare('INSERT INTO oauth_clients(client_id,redirect_uris,client_name,created_at) VALUES(?,?,?,?)')
      .run(id,JSON.stringify(uris),String(meta.client_name||'OpenAI client').slice(0,120),nowIso());
    return {client_id:id,client_id_issued_at:Math.floor(Date.now()/1000),redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
  }
  client(id){
    const r=this.db.prepare('SELECT * FROM oauth_clients WHERE client_id=?').get(String(id||''));
    if(!r)return null;r.redirect_uris=JSON.parse(r.redirect_uris);return r;
  }
  createCode({userId,clientId,redirectUri,codeChallenge,scope,resource}){
    const code=rand(32);const sc=scopes(scope)||'devices.read devices.control';
    this.db.prepare(`INSERT INTO oauth_auth_codes(code_hash,user_id,client_id,redirect_uri,code_challenge,scope,resource,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(sha256(code),userId,clientId,redirectUri,codeChallenge,sc,resource,addMsIso(5*60*1000),nowIso());
    return code;
  }
  consumeCode(code){
    const h=sha256(code);const row=this.db.prepare('SELECT * FROM oauth_auth_codes WHERE code_hash=? AND used_at IS NULL').get(h);
    if(!row||row.expires_at<nowIso())return null;
    this.db.prepare('UPDATE oauth_auth_codes SET used_at=? WHERE code_hash=?').run(nowIso(),h);return row;
  }
  issueTokens({userId,clientId,scope,resource}){
    const access=rand(32),refresh=rand(40),accessTtl=60*60*1000,refreshTtl=30*24*60*60*1000;
    this.db.prepare('INSERT INTO oauth_access_tokens(token_hash,user_id,client_id,scope,resource,expires_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(sha256(access),userId,clientId,scope,resource,addMsIso(accessTtl),nowIso());
    this.db.prepare('INSERT INTO oauth_refresh_tokens(token_hash,user_id,client_id,scope,resource,expires_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(sha256(refresh),userId,clientId,scope,resource,addMsIso(refreshTtl),nowIso());
    return {access_token:access,token_type:'Bearer',expires_in:Math.floor(accessTtl/1000),refresh_token:refresh,scope};
  }
  userFromAccessToken(token){
    if(!token)return null;
    const row=this.db.prepare(`SELECT a.*,u.id AS uid,u.email,u.name,u.picture FROM oauth_access_tokens a JOIN users u ON u.id=a.user_id
      WHERE a.token_hash=? AND a.revoked_at IS NULL AND a.expires_at>? AND a.resource=?`).get(sha256(token),nowIso(),this.resource);
    return row?{id:row.uid,email:row.email,name:row.name,picture:row.picture,scope:row.scope,resource:row.resource}:null;
  }
  rotateRefresh(token,clientId){
    const h=sha256(token);const row=this.db.prepare('SELECT * FROM oauth_refresh_tokens WHERE token_hash=? AND revoked_at IS NULL').get(h);
    if(!row||row.expires_at<nowIso()||row.client_id!==clientId)return null;
    this.db.prepare('UPDATE oauth_refresh_tokens SET revoked_at=? WHERE token_hash=?').run(nowIso(),h);
    return this.issueTokens({userId:row.user_id,clientId:row.client_id,scope:row.scope,resource:row.resource});
  }
  metadata(){return {
    issuer:this.issuer,
    authorization_endpoint:`${this.issuer}/oauth/authorize`,
    token_endpoint:`${this.issuer}/oauth/token`,
    registration_endpoint:`${this.issuer}/oauth/register`,
    response_types_supported:['code'],
    grant_types_supported:['authorization_code','refresh_token'],
    code_challenge_methods_supported:['S256'],
    token_endpoint_auth_methods_supported:['none'],
    scopes_supported:['devices.read','devices.control'],
    authorization_response_iss_parameter_supported:true
  };}
  protectedMetadata(){return {
    resource:this.resource,
    authorization_servers:[this.issuer],
    scopes_supported:['devices.read','devices.control'],
    bearer_methods_supported:['header']
  };}
  router(){
    const r=express.Router();
    const form=express.urlencoded({extended:false,limit:'32kb'});
    const sessionUser=req=>{
      const raw=String(req.headers.cookie||'');
      const hit=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('yh_session='));
      const token=hit?decodeURIComponent(hit.slice('yh_session='.length)):'';
      return this.store.userFromSession(token);
    };
    r.get('/.well-known/oauth-authorization-server',(_q,res)=>res.json(this.metadata()));
    r.get('/.well-known/oauth-protected-resource',(_q,res)=>res.json(this.protectedMetadata()));
    r.get('/.well-known/oauth-protected-resource/mcp',(_q,res)=>res.json(this.protectedMetadata()));
    r.post('/oauth/register',(req,res)=>{
      try{res.status(201).json(this.registerClient(req.body||{}));}
      catch(e){res.status(400).json({error:'invalid_client_metadata',error_description:e.message});}
    });
    r.get('/oauth/authorize',(req,res)=>{
      const user=sessionUser(req);
      if(!user){const ret=req.originalUrl;return res.redirect('/auth/google?return_to='+encodeURIComponent(ret));}
      const q=req.query||{};const client=this.client(q.client_id);
      if(!client)return res.status(400).send('Unknown OAuth client.');
      if(q.response_type!=='code'||q.code_challenge_method!=='S256'||!q.code_challenge)return res.status(400).send('PKCE S256 is required.');
      const redirect=String(q.redirect_uri||'');
      if(!client.redirect_uris.includes(redirect))return res.status(400).send('Redirect URI rejected.');
      const resource=String(q.resource||'');
      if(resource!==this.resource)return res.status(400).send('Invalid resource.');
      const requested=scopes(q.scope);
      const allowed=new Set(['devices.read','devices.control']);
      if(requested.split(' ').some(s=>s&&!allowed.has(s)))return res.status(400).send('Invalid scope.');
      const code=this.createCode({userId:user.id,clientId:client.client_id,redirectUri:redirect,codeChallenge:String(q.code_challenge),scope:requested,resource});
      const u=new URL(redirect);u.searchParams.set('code',code);
      if(q.state)u.searchParams.set('state',String(q.state));
      u.searchParams.set('iss',this.issuer);
      res.redirect(u.toString());
    });
    r.post('/oauth/token',form,(req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');
      const b=req.body||{};const client=this.client(b.client_id);
      if(!client)return res.status(401).json({error:'invalid_client'});
      if(b.grant_type==='authorization_code'){
        const row=this.consumeCode(b.code);
        if(!row||row.client_id!==b.client_id||row.redirect_uri!==b.redirect_uri||row.resource!==String(b.resource||''))return res.status(400).json({error:'invalid_grant'});
        if(!b.code_verifier||b64sha(b.code_verifier)!==row.code_challenge)return res.status(400).json({error:'invalid_grant',error_description:'PKCE verification failed'});
        return res.json(this.issueTokens({userId:row.user_id,clientId:row.client_id,scope:row.scope,resource:row.resource}));
      }
      if(b.grant_type==='refresh_token'){
        const t=this.rotateRefresh(b.refresh_token,b.client_id);
        if(!t)return res.status(400).json({error:'invalid_grant'});
        return res.json(t);
      }
      return res.status(400).json({error:'unsupported_grant_type'});
    });
    return r;
  }
}
module.exports={YourHandOAuth};
