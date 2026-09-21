'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const cs=fs.readFileSync(path.join(root,'native/YourHandNative.cs'),'utf8');
const methods=['CloseWindow','FocusWindow','Mouse','Scroll','Hotkey','TypeText',
  'UiTree','UiFind','UiInvoke','UiSetValue','SemanticGuard','Observe','ClickPreview'];
let checked=0;
for(const name of methods){
 const signature=new RegExp('static (?:object|void) '+name+'\\(Dictionary<string,object> [^)]+\\) \\{\\s+RequireInteractive\\(\\);');
 assert(signature.test(cs),'Missing read-only approval gate before native '+name);checked++;
}
assert(cs.includes('ApprovalPromptDetected()'));
assert(cs.includes('GetProcessesByName("consent")'));
assert(cs.includes('USER_APPROVAL_REQUIRED'));
assert(cs.includes('if(ex.Message.Contains("USER_APPROVAL_REQUIRED")||!B(a,"continueOnError",false))break;'));
assert(cs.includes('if(String.Equals(input,"Default",StringComparison.OrdinalIgnoreCase))'));
const helper=path.join(root,'native/YourHandNative.exe');
const out=spawnSync(helper,[],{input:JSON.stringify({id:'read-only-native-session',action:'session_state',args:{}})+'\n',
 encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(out.status,0,out.stderr);
const lines=out.stdout.split(/\r?\n/).filter(Boolean);assert.equal(lines.length,1);
const response=JSON.parse(lines[0]);assert.equal(response.ok,true);
assert.equal(typeof response.result.approvalPending,'boolean');
assert.equal(typeof response.result.interactive,'boolean');
assert.equal(response.result.secureDesktopInputSupported,false);
assert(!(response.result.approvalPending&&response.result.interactive));
console.log('PASS_NATIVE_APPROVAL_GATE_COVERAGE','guardedGuiEntryPoints='+checked,
 'pendingApprovalReadOnlyDetected=true','noProtectedDesktopInput=true','nativeSessionReadOnly=true');
