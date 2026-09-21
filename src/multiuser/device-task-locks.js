'use strict';
// Process-local inter-account lease: prevents conflicting calls while any account owns a device.
// NOT full multi-window GUI isolation; leases do not survive a Core crash.
class DeviceTaskLocks {
 constructor({clock=()=>Date.now(),leaseMs=15*60*1000}={}){
  this.clock=clock;this.leaseMs=leaseMs;this.active=new Map();
 }
 info(deviceId,userId){
  let row=this.active.get(deviceId);
  if(row&&row.expiresAt<=this.clock()){this.active.delete(deviceId);row=null}
  return row?{busy:true,ownedByMe:row.userId===userId,taskId:row.userId===userId?row.taskId:null,expiresAt:new Date(row.expiresAt).toISOString()}:
   {busy:false,ownedByMe:false,taskId:null,expiresAt:null};
 }
 acquire(deviceId,userId,taskId='default'){
  if(typeof deviceId!=='string'||!deviceId||typeof userId!=='string'||!userId)throw Error('Invalid lock principal');
  if(typeof taskId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(taskId))throw Error('Invalid task ID');
  let row=this.active.get(deviceId);
  if(row&&row.expiresAt<=this.clock()){this.active.delete(deviceId);row=null}
  if(row&&row.userId!==userId)throw Error('Device busy with another account; wait or ask them to release their task lock');
  if(row&&row.taskId!==taskId)throw Error('Device already reserved by your other task; release it first');
  row={userId,taskId,expiresAt:this.clock()+this.leaseMs};
  this.active.set(deviceId,row);
  return this.info(deviceId,userId);
 }
 release(deviceId,userId,taskId='default'){
  const row=this.active.get(deviceId);
  if(!row||row.expiresAt<=this.clock()){this.active.delete(deviceId);return false}
  if(row.userId!==userId||row.taskId!==taskId)throw Error('Only lock owner can release');
  this.active.delete(deviceId);return true;
 }
 dropIfUnauthorized(deviceId,canAccess){
  const row=this.active.get(deviceId);
  if(row&&!canAccess(row.userId)){this.active.delete(deviceId);return true}
  return false;
 }
 forceReleaseDevice(deviceId){this.active.delete(deviceId)}
}
module.exports={DeviceTaskLocks};
