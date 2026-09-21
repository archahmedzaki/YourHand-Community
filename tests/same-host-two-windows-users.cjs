'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {YourHandStore}=require('../src/multiuser/store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yh-two-windows-profiles-'));
let store;
try{
 store=new YourHandStore(path.join(dir,'test.sqlite'));
 const owner=store.upsertGoogleUser({sub:'owner-test',email:'owner@test.invalid'});
 const windowsAgent=label=>{
  const keys=crypto.generateKeyPairSync('ed25519');
  const pair=store.createPairingCode(owner.id);
  const pub=keys.publicKey.export({format:'pem',type:'spki'}).trim();
  const row=store.enrollDevice(pair.code,{displayName:label,hostname:'ONE-PHYSICAL-PC',publicKey:pub});
  return {row,pub};
 };
 const alpha=windowsAgent('Windows user A');
 const beta=windowsAgent('Windows user B');
 assert.notEqual(alpha.row.id,beta.row.id,'different Windows profiles must not replace device identity by hostname');
 assert.equal(store.getActiveDevice(alpha.row.id).public_key,alpha.pub);
 assert.equal(store.getActiveDevice(beta.row.id).public_key,beta.pub);
 assert.equal(store.listDevices(owner.id).length,2);
 const samePair=store.createPairingCode(owner.id);
 const sameKey=store.enrollDevice(samePair.code,{displayName:'same Windows user A',hostname:'ONE-PHYSICAL-PC',publicKey:alpha.pub});
 assert.equal(sameKey.id,alpha.row.id);
 assert.equal(store.getActiveDevice(beta.row.id).public_key,beta.pub,'no profile B takeover');
 const other=store.upsertGoogleUser({sub:'other-test',email:'other@test.invalid'});
 const crossPair=store.createPairingCode(other.id);
 assert.throws(()=>store.enrollDevice(crossPair.code,{hostname:'ONE-PHYSICAL-PC',publicKey:alpha.pub}),/another account/);
 console.log('PASS_TWO_WINDOWS_PROFILES_SAME_HOSTNAME_NO_SESSION_TAKEOVER','separateKeys=true','separateDevices=true','existingKeyIdempotent=true','crossOwnerKeyRejected=true','no_live_agent_touched=true');
}catch(e){console.error('FAIL_TWO_WINDOWS_PROFILE_IDENTITY',e.stack||e);process.exitCode=1}
finally{try{store?.db.close()}catch{};try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
