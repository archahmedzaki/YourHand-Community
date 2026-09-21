'use strict';
const assert=require('node:assert/strict');
const {planNetworkHop}=require('../src/execution/network-capability');
const base={originDeviceId:'isolated-windows-profile',target:'server-07.corp.test',
 mode:'winrm_kerberos',allowedTargets:['server-07.corp.test'],
 agentCapabilities:{winrm:true,smb:true,rdp:true,sshExistingKey:true},
 domainAuthorized:true,operatorAuthorized:true,interactiveSession:true};
let passed=0;function expect(p,fields){
 const actual=planNetworkHop(p);
 for(const [k,v] of Object.entries(fields))assert.deepEqual(actual[k],v,k);
 passed++;
}
expect(base,{ready:true,route:'authorized_network.winrm_kerberos',noAutomaticPrivilegeEscalation:true});
expect({...base,operatorAuthorized:false},{ready:false,reason:'CALLER_NOT_OPERATOR'});
expect({...base,domainAuthorized:false},{ready:false,reason:'TARGET_DOMAIN_OR_NETWORK_PERMISSION_NOT_CONFIRMED'});
expect({...base,allowedTargets:['different.corp.test']},{ready:false,reason:'TARGET_NOT_APPROVED'});
expect({...base,target:'\\\\server-07.corp.test\\ADMIN$'},{ready:false,reason:'EXPLICIT_VALID_TARGET_AND_MODE_REQUIRED'});
expect({...base,target:'server-08.corp.test'},{ready:false,reason:'TARGET_NOT_APPROVED'});
expect({...base,mode:'rdp_interactive',interactiveSession:false},{ready:false,reason:'INTERACTIVE_SESSION_REQUIRED'});
expect({...base,mode:'smb',interactiveSession:false},{ready:true,route:'authorized_network.smb'});
expect({...base,mode:'ssh_existing_key',agentCapabilities:{sshExistingKey:false}},{ready:false,reason:'TARGET_PROTOCOL_NOT_AVAILABLE'});
expect({...base,mode:'arbitrary_scan'},{ready:false,reason:'EXPLICIT_VALID_TARGET_AND_MODE_REQUIRED'});
console.log('PASS_APPROVED_NETWORK_TARGET_POLICY scenarios='+passed+' unauthorized_target_denied=true locked_background_protocol_distinguished=true no_privilege_override=true no_remote_host_contacted=true');
