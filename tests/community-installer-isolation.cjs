'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const manager=get('YourHandManager.cs');
const setup=get('src/multiuser/installer.js');
const core=get('server-multiuser.js');
const web=get('src/multiuser/web.js');
const agent=get('yourhand-agent.mjs');
const officialRoot='Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHand")';
const communityRoot='Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YourHandCommunity")';
for(const [name,src] of [['manager',manager],['setup',setup]]){
  assert(src.includes(communityRoot),name+': Community root missing');
  assert(!src.includes(officialRoot),name+': official install directory referenced');
  assert(src.includes('community-dashboard-url.txt'),name+': independent dashboard origin missing');
}
assert(manager.includes('Uninstall\\YourHandCommunity'),'manager: community uninstall registry key required');
assert(!manager.includes('Uninstall\\YourHand"'),'manager: official uninstall registry key');
assert(manager.includes('YourHandCommunityManager'),'manager: separate Run registry key required');
assert(!manager.includes('https://yourhand.wolvexai.com/'),'manager: official hosted dashboard must not be default');
assert(setup.includes('SetValue("YourHandCommunity",command'),'setup: separate Run registry value missing');
assert(!setup.includes('SetValue("YourHand",command'),'setup: official Run registry key referenced');
assert(!core.includes('C:/ProgramData/YourHand/'),'core: official runtime path in community defaults');
assert(!web.includes('C:/ProgramData/YourHand/'),'web: official runtime path in community defaults');
assert(!agent.includes("||'wss://yourhand.wolvexai.com/agent'"),'agent: official hosted fallback is unsafe');
assert(core.includes("path.join(__dirname, 'runtime', 'yourhand-community.db')"),'core: isolated database fallback missing');
console.log('PASS_COMMUNITY_INSTALL_ISOLATION official_localappdata=false official_cloud_fallback=false community_registry=true');
