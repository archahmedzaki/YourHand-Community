'use strict';
// Descriptive planning only. No scan, discovery by probing, domain escalation,
// credential harvesting, remote execution or ACL bypass.
const HOST=/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4=/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const MODES=new Set(['winrm_kerberos','smb','rdp_interactive','ssh_existing_key']);
function planNetworkHop({originDeviceId,target,mode,allowedTargets=[],agentCapabilities={},
  domainAuthorized=false,operatorAuthorized=false,interactiveSession=false}={}){
 const safeTarget=typeof target==='string'&&target.length<=253&&
  (HOST.test(target)||IPV4.test(target))&&
  !['localhost','localdomain','127.0.0.1','0.0.0.0'].includes(target.toLowerCase());
 if(!safeTarget||!MODES.has(mode)||typeof originDeviceId!=='string'||!originDeviceId)
  return {ready:false,route:'invalid',reason:'EXPLICIT_VALID_TARGET_AND_MODE_REQUIRED'};
 if(!Array.isArray(allowedTargets)||!allowedTargets.some(entry=>typeof entry==='string'&&entry.toLowerCase()===target.toLowerCase()))
  return {ready:false,route:'authorization_required',reason:'TARGET_NOT_APPROVED'};
 if(!operatorAuthorized)return {ready:false,route:'authorization_required',reason:'CALLER_NOT_OPERATOR'};
 if(!domainAuthorized)return {ready:false,route:'authorization_required',reason:'TARGET_DOMAIN_OR_NETWORK_PERMISSION_NOT_CONFIRMED'};
 const capable={
  winrm_kerberos:agentCapabilities.winrm===true,
  smb:agentCapabilities.smb===true,
  rdp_interactive:agentCapabilities.rdp===true&&interactiveSession===true,
  ssh_existing_key:agentCapabilities.sshExistingKey===true
 };
 if(!capable[mode])return {ready:false,route:'unavailable',reason:mode==='rdp_interactive'?'INTERACTIVE_SESSION_REQUIRED':'TARGET_PROTOCOL_NOT_AVAILABLE'};
 return {ready:true,route:'authorized_network.'+mode,reason:'EXPLICIT_TARGET_WITH_EXISTING_CREDENTIALS',
   target,originDeviceId,requiresIndependentTargetAuthorization:true,
   noAutomaticPrivilegeEscalation:true,noNetworkWideEnumeration:true};
}
module.exports={planNetworkHop};
