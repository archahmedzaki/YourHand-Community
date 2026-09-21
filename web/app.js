const $=s=>document.querySelector(s);
const api=async(url,options={})=>{const r=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;};
const online=d=>typeof d.online==='boolean'?d.online:!!(d.last_seen && Date.now()-Date.parse(d.last_seen)<60000);
const when=v=>v?new Date(v).toLocaleString():'Never';
const params=new URLSearchParams(location.search);
const shareToken=params.get('share')||'';
const returnTo=(()=>{const v=params.get('return_to')||'/';return v.startsWith('/')&&!v.startsWith('//')?v:'/';})();

function renderAccount(user){
  const el=$('#account');el.textContent='';
  if(!user)return;
  const box=document.createElement('div');box.className='user';
  if(user.picture){const img=document.createElement('img');img.src=user.picture;img.alt='';box.append(img);}
  const name=document.createElement('span');name.textContent=user.name||user.email;box.append(name);
  const out=document.createElement('button');out.className='signout';out.textContent='Sign out';out.onclick=logout;box.append(out);el.append(box);
}


let lastDiagnosticsDevicesKey='';
function setupDiagnostics(){
 const details=$('#diagnostics-panel'),selector=$('#diagnostics-device');
 if(!details||!selector)return;
 const btn=$('#diagnostics-refresh');
 details.addEventListener('toggle',()=>{if(details.open)loadDiagnostics()});
 btn.addEventListener('click',loadDiagnostics);
}
function refreshDiagnosticsDevices(){
 const sel=$('#diagnostics-device');if(!sel)return;
 const values=allDevices.map(d=>[d.id,d.display_name]);
 const key=JSON.stringify(values);
 if(key===lastDiagnosticsDevicesKey)return;
 const previous=sel.value;lastDiagnosticsDevicesKey=key;
 sel.replaceChildren(new Option('All authorized devices',''));
 for(const [id,name] of values)sel.append(new Option(name,id));
 if(values.some(([id])=>id===previous))sel.value=previous;
}
async function loadDiagnostics(){
 const status=$('#diagnostics-status'),body=$('#diagnostics-body'),btn=$('#diagnostics-refresh');
 if(!status||!body)return;
 btn.disabled=true;status.textContent='Loading your call history…';
 try{
  const sel=$('#diagnostics-device'),query=new URLSearchParams({limit:'30'});
  if(sel.value)query.set('device_id',sel.value);
  const response=await api('/api/telemetry/recent?'+query.toString());
  body.replaceChildren();
  for(const event of response.events){
   const tr=document.createElement('tr');
   const cell=(value,cls='')=>{const td=document.createElement('td');td.textContent=value;td.className=cls;tr.append(td)};
   cell(when(event.at));
   cell(event.method_id+(event.route_id?' · '+event.route_id:''));
   cell(event.outcome+(event.error_code?' · '+event.error_code:''),'diag-'+event.outcome);
   cell((event.attempt_index||0)+' / '+(event.methods_tried||0));
   cell(event.duration_ms+' ms');
   body.append(tr);
  }
  status.textContent=response.events.length+' recent events for your account · '+response.retentionDays+'-day retention';
 }catch(error){status.textContent='Diagnostics unavailable: '+error.message}
 finally{btn.disabled=false}
}

let devicePage=0;
let allDevices=[];
const connectResults=new Map(); // non-secret per-session status; expires quickly
const deviceUsage=new Map(); // returned for current Google account only
let usageFetchedAt=0,usagePending=null,usageTrackingSince=null,usageAvailable=false;
const compactTime=ms=>{
 const minutes=Math.floor(Math.max(0,Number(ms)||0)/60000);
 return minutes<1?'<1m':(minutes<60?minutes+'m':Math.floor(minutes/60)+'h '+(minutes%60)+'m');
};
async function refreshUsageIfNeeded(force=false){
 if(!force&&usagePending)return usagePending;
 if(!force&&Date.now()-usageFetchedAt<30000)return;
 usagePending=(async()=>{
  try{
   const data=await api('/api/usage/devices');
   const seen=new Map((data.devices||[]).map(row=>[row.deviceId,row]));
   deviceUsage.clear();for(const [key,val] of seen)deviceUsage.set(key,val);
   usageTrackingSince=data.trackingSince;usageAvailable=true;
  }catch{usageAvailable=false;}
  finally{usageFetchedAt=Date.now();usagePending=null;}
 })();
 return usagePending;
}


function perDevicePage(){
  const container=$('#devices');
  if(!allDevices.length || !container) return 1;
  // Measure the real row height and available panel space, not a fixed viewport breakpoint.
  const sample=deviceCard(allDevices[0]);
  container.replaceChildren(sample);
  const height=sample.getBoundingClientRect().height || 58;
  const gap=parseFloat(getComputedStyle(container).rowGap) || 9;
  const available=container.clientHeight || container.getBoundingClientRect().height;
  container.replaceChildren();
  const fitting=Math.max(1,Math.floor((available+gap-8)/(height+gap)));
  if(allDevices.length<=fitting) return fitting;
  // Showing the pagination bar takes vertical space from the flexible device list.
  const pager=$('#device-pagination');
  const reserved=pager.classList.contains('hidden')?40:0;
  return Math.max(1,Math.floor((available-reserved+gap-8)/(height+gap)));
}
function renderDevices(){
  const root=$('#devices');
  const pageSize=perDevicePage();
  const total=Math.max(1,Math.ceil(allDevices.length/pageSize));
  devicePage=Math.min(devicePage,total-1);
  root.textContent='';
  if(!allDevices.length){
    const e=document.createElement('div');e.className='empty';
    e.textContent='No devices yet. Add your first computer.';root.append(e);
  }
  for(const d of allDevices.slice(devicePage*pageSize,(devicePage+1)*pageSize))root.append(deviceCard(d));
  const pager=$('#device-pagination');
  pager.classList.toggle('hidden',total<=1);
  $('#devices-page-label').textContent=`Page ${devicePage+1} / ${total} · ${allDevices.length} devices`;
  $('#devices-prev').disabled=devicePage===0;
  $('#devices-next').disabled=devicePage>=total-1;
}
async function loadDevices(){
  const {devices}=await api('/api/devices');
  allDevices=devices||[];
  refreshDiagnosticsDevices();
  await refreshUsageIfNeeded();
  window.dispatchEvent(new CustomEvent('yourhand-devices',{detail:allDevices.map(d=>({id:d.id,display_name:d.display_name,online:d.online}))}));
  renderDevices();
}
function deviceCard(d){
  const card=document.createElement('div');card.className='device';
  const main=document.createElement('div');main.className='device-main';
  const dot=document.createElement('span');dot.className='dot'+(online(d)?' online':'');main.append(dot);
  const info=document.createElement('div');const h=document.createElement('h3');h.textContent=d.display_name;info.append(h);
  const m=document.createElement('div');m.className='meta';
  const recent=connectResults.get(d.id);
  const result=recent&&Date.now()-recent.at<45000?recent:null;
  if(recent&&!result)connectResults.delete(d.id);
  m.textContent=result?result.text:
    (online(d)?'Online':'Offline')+' · '+(d.access_role==='owner'?'Owner':d.access_role==='operator'?'Shared operator':'Shared read-only')+
    ' · '+(Number(d.authorized_accounts)||1)+' Google account(s) · Last seen '+when(d.last_seen);
  if(result)m.title=result.title||'';
  info.append(m);
  const usage=document.createElement('div');usage.className='device-usage';
  const metrics=deviceUsage.get(d.id);
  if(!usageAvailable||!metrics){
    usage.textContent='Usage stats unavailable · ∞ Unlimited';
  }else{
    usage.title='Your Google account only · tracking since '+when(usageTrackingSince)+
      '. Background pings, connection checks and overlapping time are excluded.';
    const label=(value,label)=>{
      const item=document.createElement('span');item.className='usage-metric';
      const strong=document.createElement('strong');strong.textContent=value;
      item.append(strong,document.createTextNode(' '+label));usage.append(item);
    };
    label(Number(metrics.calls).toLocaleString(),'calls');
    label(compactTime(metrics.usageMs),'usage');
    label(Number(metrics.last7DaysCalls).toLocaleString(),'calls · 7d');
    label(compactTime(metrics.last7DaysMs),'7d');
    const unlimited=document.createElement('span');unlimited.className='usage-unlimited';
    unlimited.textContent='∞ Unlimited';
    unlimited.title='No per-device usage quota is imposed by YourHand. ChatGPT or other AI providers may have separate plan and usage limits.';
    usage.append(unlimited);
  }
  info.append(usage);main.append(info);card.append(main);
  const acts=document.createElement('div');acts.className='actions';
  const connect=document.createElement('button');connect.className='ghost connect-check';
  connect.type='button';connect.textContent=result?.ok?'Connected · '+result.latencyMs+' ms':online(d)?'Connect / test':'Test connection';
  connect.title='Verify an authenticated command round trip from YOUR signed-in account to this Agent';
  connect.onclick=async()=>{
    connect.disabled=true;connect.textContent='Testing…';
    try{
      const status=await api('/api/devices/'+encodeURIComponent(d.id)+'/connect-check',
        {method:'POST',body:'{}'});
      connectResults.set(d.id,{ok:true,at:Date.now(),latencyMs:status.latencyMs,
        text:'Verified Agent response for this account · '+status.role+
          (status.controlAllowed?' · Operator commands enabled':' · Read-only'),
        title:status.note});
    }catch(error){
      connectResults.set(d.id,{ok:false,at:Date.now(),
        text:'Command connection failed: '+error.message,
        title:'A green Online dot alone does not prove an authenticated command succeeds.'});
    }finally{
      connect.disabled=false;
      renderDevices(); // Persist status across the 5-second device refresh.
    }
  };
  const rename=document.createElement('button');rename.className='ghost';rename.textContent='Rename';rename.onclick=async()=>{const name=prompt('Device name',d.display_name);if(!name)return;await api('/api/devices/'+d.id,{method:'PATCH',body:JSON.stringify({name})});loadDevices();};
  const revoke=document.createElement('button');revoke.className='ghost';revoke.textContent='Remove';
  revoke.onclick=async()=>{
    if(!confirm(d.access_role==='owner'
      ?`Revoke ${d.display_name} and disconnect it for every shared account?`
      :`Leave shared device ${d.display_name}? This only removes your access.`))return;
    revoke.disabled=true;revoke.textContent='Removing…';
    try{
      await api('/api/devices/'+encodeURIComponent(d.id),{method:'DELETE'});
      allDevices=allDevices.filter(item=>item.id!==d.id);
      renderDevices();
      await loadDevices();
    }catch(error){alert('Could not remove device: '+error.message);}
    finally{revoke.disabled=false;revoke.textContent='Remove';}
  };
  const repair=document.createElement('button');repair.className='ghost repair';repair.type='button';
  repair.textContent=online(d)?'Update / reinstall':'Reconnect / reinstall';
  repair.title='Download the current Windows installer for this computer';
  repair.onclick=async()=>{repair.disabled=true;try{await addDevice(d);}catch(e){alert('Could not prepare the installer: '+e.message);}finally{repair.disabled=false;}};
  if(d.access_role==='owner'){
    const share=document.createElement('button');share.className='ghost';share.textContent='Share';
    share.onclick=()=>openShare(d);acts.append(share);
  } else {
    rename.style.display='none';
    revoke.textContent='Leave';
    revoke.title='Remove only your own access; owner and Agent stay connected';
    repair.style.display='none';
  }
  acts.prepend(connect);acts.append(repair,rename,revoke);card.append(acts);return card;
}
let sharingDeviceId=null;
async function listMembers(deviceId){
 const box=$('#share-members');box.replaceChildren();
 const {members}=await api('/api/devices/'+encodeURIComponent(deviceId)+'/shares');
 const title=document.createElement('p');title.textContent='Authorized accounts: '+(members.length+1)+' (owner + '+members.length+' shared). Currently active accounts are not measured.';box.append(title);
 if(!members.length){const empty=document.createElement('p');empty.textContent='No other accounts yet.';box.append(empty);}
 for(const member of members){
   const row=document.createElement('div');row.className='share-member';
   const label=document.createElement('span');label.textContent=member.email+' · '+member.role;
   const remove=document.createElement('button');remove.className='ghost';remove.textContent='Revoke';
   remove.onclick=async()=>{if(!confirm('Remove access for '+member.email+'?'))return;
     await api('/api/devices/'+encodeURIComponent(deviceId)+'/shares/'+encodeURIComponent(member.userId),{method:'DELETE'});
     await listMembers(deviceId);};
   row.append(label,remove);box.append(row);
 }

}
async function openShare(device){
 sharingDeviceId=device.id;$('#share-device-name').textContent='Share '+device.display_name;
 $('#share-email').value='';$('#share-message').textContent='';
 $('#share-invite-result').classList.add('hidden');await listMembers(device.id);$('#share-dialog').showModal();
}
async function acceptInvitedDevice(){
 if(!shareToken)return;
 if(!confirm('Accept this invitation to share a YourHand device with your signed-in account?'))return;
 try{
  await api('/api/shares/accept',{method:'POST',body:JSON.stringify({token:shareToken})});
  history.replaceState({},'',location.pathname);await loadDevices();alert('Device linked to this account. No second installation needed.');
 }catch(e){alert('Invitation could not be accepted: '+e.message);}
}
async function addDevice(device=null){
  const p=await api('/api/pairing-codes',{method:'POST',body:'{}'});
  $('#pair-dialog h2').textContent=device?'Repair / update '+device.display_name:'Add a device';
  $('#pair-dialog .muted').textContent=device?'Download on '+device.display_name+' and run the installer there. Your existing pairing and device settings will be preserved. Use the new code only if first-time pairing is required.':'Install YourHand on the computer, then enter this one-time code.';
  $('#pair-code').textContent=p.code;
  $('#pair-expiry').textContent='Download link expires '+new Date(p.expiresAt).toLocaleTimeString();
  const link=document.querySelector('.download');
  if(link){link.href=p.downloadUrl||'#';link.textContent=device?'Download repair / update':'Download for Windows';}
  $('#pair-dialog').showModal();
}
async function logout(){deviceUsage.clear();await api('/auth/logout',{method:'POST',body:'{}'});location.href='/';}

async function waitForGoogle(){
  for(let i=0;i<80;i++){if(window.google?.accounts?.id)return window.google;await new Promise(r=>setTimeout(r,100));}
  throw new Error('Google Sign-In failed to load');
}
async function initGoogle(){
  const cfg=await api('/api/config');
  const status=$('#login-status');
  if(!cfg.googleConfigured){status.textContent='Google sign-in is not configured yet.';return;}
  const g=await waitForGoogle();
  g.accounts.id.initialize({
    client_id:cfg.googleClientId,
    auto_select:false,
    cancel_on_tap_outside:true,
    callback:async response=>{
      try{
        status.textContent='Signing in…';
        const out=await api('/auth/google/id-token',{method:'POST',body:JSON.stringify({credential:response.credential,returnTo})});
        location.href=shareToken?'/?share='+encodeURIComponent(shareToken):(out.redirect||'/');
      }catch(e){status.textContent=e.message;}
    }
  });
  g.accounts.id.renderButton($('#google-button'),{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:240});
}


function setupChatGptInstructions(){
  const mcpUrl=location.origin.replace(/\/$/,'')+'/mcp';
  const urlEl=$('#mcp-url');if(urlEl)urlEl.textContent=mcpUrl;
  const iconUrl=$('#field-icon');if(iconUrl)iconUrl.textContent=location.origin+'/YourHand_256.png';
  const copy=async text=>{
    try{await navigator.clipboard.writeText(text);}
    catch{
      const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();document.execCommand('copy');t.remove();
    }
  };
  document.querySelectorAll('[data-copy-target]').forEach(btn=>{
    btn.onclick=async()=>{
      const target=document.getElementById(btn.dataset.copyTarget);if(!target)return;
      await copy(target.textContent.trim());const old=btn.textContent;btn.textContent='Copied';setTimeout(()=>btn.textContent=old,1200);
    };
  });
  const all=$('#copy-chatgpt-setup');
  if(all)all.onclick=async()=>{
    const description=$('#plugin-description')?.textContent.trim()||'';
    const text=[
      'Name: YourHand',
      'Description: '+description,
      'Connection: Server URL',
      'Server URL: '+mcpUrl,
      'Authentication: OAuth',
      'Advanced OAuth settings: Leave automatic',
      'Icon: '+location.origin+'/YourHand_256.png',
      'Use in ChatGPT: @YourHand',
      'At your hand — @YourHand'
    ].join('\n');
    await copy(text);const old=all.textContent;all.textContent='Copied';setTimeout(()=>all.textContent=old,1200);
  };
}

async function boot(){
  const {user}=await api('/api/me');renderAccount(user);
  $('#signed-out').classList.toggle('hidden',!!user);$('#dashboard').classList.toggle('hidden',!user);
  document.body.classList.toggle('dashboard-open',!!user);
  if(user){
    setupChatGptInstructions();
    await loadDevices();if(shareToken)await acceptInvitedDevice();setInterval(()=>loadDevices().catch(()=>{}),5000);
    if(returnTo!=='/')location.href=returnTo;
  }else await initGoogle();
}
$('#devices-prev').onclick=()=>{devicePage=Math.max(0,devicePage-1);renderDevices();};
$('#devices-next').onclick=()=>{devicePage++;renderDevices();};
window.addEventListener('resize',()=>{if(allDevices.length)renderDevices();});
$('#add-device').onclick=()=>addDevice().catch(e=>alert(e.message));
$('#close-dialog').onclick=()=>$('#pair-dialog').close();
$('#close-share-dialog').onclick=()=>$('#share-dialog').close();
$('#create-share-invite').onclick=async()=>{
 if(!sharingDeviceId)return;
 const button=$('#create-share-invite');button.disabled=true;
 try{
  const out=await api('/api/devices/'+encodeURIComponent(sharingDeviceId)+'/share-invites',
   {method:'POST',body:JSON.stringify({email:$('#share-email').value.trim(),role:$('#share-role').value})});
  $('#share-invite-url').value=out.inviteUrl;$('#share-invite-result').classList.remove('hidden');
  $('#share-message').textContent='Invitation expires '+new Date(out.expiresAt).toLocaleString()+'; recipient must use invited Google email.';
 }catch(e){$('#share-message').textContent='Invite failed: '+e.message;}
 finally{button.disabled=false;}
};
$('#copy-share-invite').onclick=async()=>{
 try{await navigator.clipboard.writeText($('#share-invite-url').value);$('#share-message').textContent='Invitation copied.';}
 catch(e){$('#share-message').textContent='Select the invitation URL to copy it.';}
};
boot().catch(e=>{const s=$('#login-status');if(s)s.textContent=e.message;$('#signed-out').classList.remove('hidden');});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupDiagnostics,{once:true});else setupDiagnostics();
