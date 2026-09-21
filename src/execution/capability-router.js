'use strict';
// Planner is pure; it neither escalates privileges nor attempts secure-desktop input.
const TYPES=new Set(['file_read','file_write','process_run','browser','desktop']);
function chooseRoute({kind,session={},agent={},browser={},requiresAdmin=false,allowBrowserStart=false,
  alternate=null}={}){
 if(!TYPES.has(kind))return {route:'invalid',ready:false,reason:'TASK_TYPE_REQUIRED'};
 if(kind==='desktop' && session.approvalPending===true)
   return {route:'waiting_for_user_approval',ready:false,reason:'USER_APPROVAL_REQUIRED',
     requiresForeground:true,worksWhileLocked:false,
     next:'Windows administrator approval must be completed by the authorized device user. Do not enter credentials remotely or retry clicks. Recheck session_state, take a new observation, and continue only after approval.'};
 if(requiresAdmin && agent.elevated!==true)
   return {route:'authorized_admin_provisioning',ready:false,reason:'ELEVATION_NOT_PROVISIONED',
     next:'A device administrator must provision an approved elevated worker once. Never automate UAC, credentials or secure desktop.'};
 const unlocked=session.interactive===true&&session.locked===false;
 const capability={file_read:agent.directFilesystem===true,file_write:agent.directFilesystem===true,
   process_run:agent.directProcessSessions===true};
 if(kind in capability)
   return capability[kind]?{route:kind.startsWith('file')?'background.filesystem':'background.process',
     ready:true,requiresForeground:false,worksWhileLocked:true,reason:'NATIVE_DIRECT_BACKGROUND'}:
     {route:'unavailable',ready:false,reason:'DIRECT_CAPABILITY_UNAVAILABLE'};
 if(kind==='browser'){
   if(browser.running===true)return {route:'browser.cdp',ready:true,requiresForeground:false,
     worksWhileLocked:true,reason:'EXISTING_ISOLATED_BROWSER_CDP'};
   if(allowBrowserStart===true&&agent.browserCdp===true)return {route:'browser.cdp_start',ready:true,
     requiresForeground:false,worksWhileLocked:true,reason:'EXPLICIT_BROWSER_START_AUTHORIZED'};
   return {route:'browser_not_ready',ready:false,reason:'CDP_NOT_RUNNING',
     next:'Authorize starting an isolated browser or use existing browser-independent APIs.'};
 }
 if(unlocked)return {route:agent.uia===true?'windows.uia_guarded':'windows.preview_guarded',
   ready:true,requiresForeground:true,worksWhileLocked:false,reason:'INTERACTIVE_DESKTOP_READY'};
 // A declared semantic alternative must be a different complete operation,
 // not a GUI click masquerading as background work.
 if(alternate&&['file_read','file_write','process_run','browser'].includes(alternate.kind)){
   const p=chooseRoute({...alternate,session,agent,browser,requiresAdmin});
   if(p.ready)return {...p,reason:'DECLARED_NON_GUI_ALTERNATIVE',originalKind:'desktop'};
 }
 return {route:'waiting_for_interactive_session',ready:false,worksWhileLocked:false,
   reason:session.locked===true?'WINDOWS_SECURE_DESKTOP':'NO_INTERACTIVE_SESSION',
   next:'Run the portion that has a supported background API, otherwise wait for an authorized unlocked session. Do not inject input on Winlogon/UAC.'};
}
module.exports={chooseRoute};
