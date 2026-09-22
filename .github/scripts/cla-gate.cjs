'use strict';

// YourHand-Community ONLY. No untrusted PR code or third-party broad OAuth grants.
const https = require('node:https');
const fs = require('node:fs');
const crypto = require('node:crypto');

const REPOSITORY = 'archahmedzaki/YourHand-Community';
const REPOSITORY_ID = 1380179304;
const GIST_ID = 'e2b383e438726b5b157bd5451c0171ba';
const GIST_FILENAME = 'YourHand-Community-Individual-CLA-v1.1.md';
const AGREEMENT_SHA256 = Buffer.from([0x4c, 0x8e, 0x9c, 0x89, 0x4e, 0x34, 0x56, 0xa5, 0x39, 0xff, 0xf3, 0xa2, 0x5b, 0x9d, 0x01, 0x2a, 0x14, 0x4e, 0xcd, 0x64, 0x9d, 0x2e, 0xbf, 0xde, 0x28, 0xc0, 0x55, 0x25, 0xdb, 0xd8, 0x1a, 0xcf]).toString('hex'); // public SHA-256 fingerprint; avoid treating this fixed document ID as a credential
const AGREEMENT_URL = 'https://gist.github.com/archahmedzaki/' + GIST_ID;
const CONSENT_TEXT = 'I have read and agree to the YourHand Community Individual Contributor License Agreement v1.1 at ' +
  AGREEMENT_URL + ' (SHA-256: ' + AGREEMENT_SHA256 +
  '), and I confirm I personally own or have authorization to license every contribution I submitted in this pull request.';
const CONTEXT = 'YourHand CLA v1.1 / contributor consent';
const CLA_FIRST_PUBLISHED = Date.parse('2026-09-22T12:46:52Z');

function hasValidConsent(comments, prUser, minTimestamp = CLA_FIRST_PUBLISHED) {
  if (!prUser || prUser.type !== 'User' || typeof prUser.id !== 'number') return false;
  return comments.some(c => c && c.user &&
    c.user.id === prUser.id && c.user.type === 'User' &&
    c.body === CONSENT_TEXT &&
    Number.isFinite(Date.parse(c.created_at)) &&
    Date.parse(c.created_at) >= minTimestamp);
}

function targetPrNumber(eventName, event) {
  if (eventName === 'pull_request_target') return event.pull_request?.number || event.number || null;
  if (eventName === 'issue_comment' && event.issue?.pull_request) return event.issue.number || null;
  return null;
}

function requestJson(url, token, {method='GET', body, auth=true}={}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['api.github.com'].includes(u.hostname)) throw new Error('Unexpected API destination');
  const payload=body===undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject) => {
    const req=https.request(u,{method,headers:{
      'User-Agent':'YourHand-Community-CLA-Consent-v1',
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      ...(auth ? {'Authorization':'Bearer '+token} : {}),
      ...(payload ? {'Content-Type':'application/json','Content-Length':String(payload.length)} : {})
    },timeout:12000},res=>{
      const parts=[];let size=0;
      res.on('data',v=>{size+=v.length;if(size>2000000){req.destroy(new Error('API body too large'));return;} parts.push(v);});
      res.on('end',()=>{
        let parsed;
        try{parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));}
        catch{return reject(new Error('Unparseable GitHub API response'));}
        if(res.statusCode<200 || res.statusCode>=300)return reject(new Error('GitHub API HTTP '+res.statusCode));
        resolve({body:parsed,headers:res.headers});
      });
    });
    req.on('timeout',()=>req.destroy(new Error('GitHub API timeout')));
    req.on('error',reject);
    if(payload)req.write(payload);
    req.end();
  });
}

async function collectComments(repo, number, token) {
  const out=[];
  for(let page=1;page<=30;page++){
    const {body}=await requestJson('https://api.github.com/repos/'+repo+'/issues/'+number+
      '/comments?per_page=100&page='+page,token);
    if(!Array.isArray(body))throw new Error('Comments not an array');
    out.push(...body);
    if(body.length<100)return out;
  }
  throw new Error('More than 3000 PR comments; fail closed and review manually');
}

async function verifyExactAgreement(token) {
  const {body}=await requestJson('https://api.github.com/gists/'+GIST_ID,token,{auth:false});
  const file=body.files?.[GIST_FILENAME];
  if(!body.public || !file || file.truncated || typeof file.content!=='string')throw new Error('CLA Gist content unavailable');
  const hash=crypto.createHash('sha256').update(file.content,'utf8').digest('hex');
  if(hash!==AGREEMENT_SHA256)throw new Error('CLA text was edited: a new version and new consent are required');
  return true;
}

async function run(env=process.env) {
  if(env.GITHUB_REPOSITORY !== REPOSITORY)throw new Error('Refuse to run outside public Community repository');
  if(!env.GITHUB_TOKEN)throw new Error('No scoped GitHub Actions token');
  const event=JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
  if(event.repository?.id !== REPOSITORY_ID || event.repository?.private !== false)
    throw new Error('Wrong repository ID or repository not public');
  const number=targetPrNumber(env.GITHUB_EVENT_NAME,event);
  if(!Number.isSafeInteger(number) || number<1){console.log('Not a PR event; no status changes');return;}
  const url='https://api.github.com/repos/'+REPOSITORY;
  const {body:pr}=await requestJson(url+'/pulls/'+number,env.GITHUB_TOKEN);
  if(pr.base?.repo?.id!==REPOSITORY_ID || pr.base?.ref!=='main') {
    console.log('Not a PR against public main; no status changes'); return;
  }
  if(pr.state!=='open'){console.log('PR is not open; no status change');return;}
  const sha=pr.head?.sha;
  if(!/^[0-9a-f]{40}$/i.test(sha||''))throw new Error('Invalid PR head SHA');
  let state='failure',description='CLA v1 consent not found: read agreement and post exact acceptance comment';
  try{
    await verifyExactAgreement(env.GITHUB_TOKEN);
    const comments=await collectComments(REPOSITORY,number,env.GITHUB_TOKEN);
    if(hasValidConsent(comments,pr.user)){
      state='success';
      description='PR author accepted exact SHA-256-pinned CLA v1.1; rights review still required';
    }
  }catch(err){
    state='error';
    description='Cannot verify CLA text or consent; fail closed';
    console.error('CLA verification failed: '+String(err.message).slice(0,130));
  }
  await requestJson(url+'/statuses/'+sha,env.GITHUB_TOKEN,{method:'POST',body:{
    state,context:CONTEXT,description:description.slice(0,140),
    target_url:AGREEMENT_URL
  }});
  console.log(JSON.stringify({context:CONTEXT,pr:number,head:sha,state,comment:'Rights-holder and co-author provenance still require maintainer review'}));
}

if(require.main===module)run().catch(e=>{console.error('CLA check could not post status: '+e.message);process.exitCode=1;});
module.exports={REPOSITORY,REPOSITORY_ID,GIST_ID,AGREEMENT_SHA256,AGREEMENT_URL,CONSENT_TEXT,CONTEXT,CLA_FIRST_PUBLISHED,hasValidConsent,targetPrNumber,run};
