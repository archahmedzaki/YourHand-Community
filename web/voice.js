'use strict';
// Voice is explicitly user-initiated and is NOT ChatGPT's Voice tool invocation.
// No microphone stream or transcript is persisted by YourHand, and no arbitrary
// speech is converted into mutating Windows input or privileged commands.
(function(){
const el=id=>document.getElementById(id);
let recognizer=null,devices=[];
const result=el('voice-result'),select=el('voice-device');
if(!result||!select)return;
const readout=(text,spoken=false)=>{
 result.textContent=text;
 if(spoken&&'speechSynthesis' in window){
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,200));u.lang='ar-EG';speechSynthesis.speak(u)}catch{}
 }
};
const updateList=items=>{
 devices=Array.isArray(items)?items.filter(d=>typeof d?.id==='string'):[];
 const old=select.value;select.replaceChildren();
 for(const d of devices){
  const option=document.createElement('option');option.value=d.id;
  option.textContent=d.display_name+' ('+(d.online?'Online':'Offline')+')';
  select.append(option);
 }
 if(devices.some(d=>d.id===old))select.value=old;
};
window.addEventListener('yourhand-devices',e=>updateList(e.detail));
const start=el('voice-start'),stop=el('voice-stop'),send=el('voice-send'),transcript=el('voice-transcript');
const endMic=()=>{start.disabled=false;stop.disabled=true};
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!Recognition){
 start.disabled=true;
 readout('Speech recognition is unavailable in this browser. Type your request below, or use a supported browser with microphone permission.');
}else{
 start.addEventListener('click',()=>{
  if(recognizer)return;
  try{
   recognizer=new Recognition();
   recognizer.lang=(navigator.language||'ar-EG').startsWith('ar')?'ar-EG':'en-US';
   recognizer.continuous=false;recognizer.interimResults=false;
   recognizer.onresult=e=>{const spoken=e.results?.[0]?.[0]?.transcript;
     if(typeof spoken==='string')transcript.value=spoken.slice(0,320);
     readout('Speech recognized. Review the text and press Check status. No action was sent automatically.');
   };
   recognizer.onerror=e=>{readout('Microphone recognition error: '+String(e.error||'unavailable').replace(/[^a-z_-]/ig,'').slice(0,35));};
   recognizer.onend=()=>{recognizer=null;endMic()};
   recognizer.start();start.disabled=true;stop.disabled=false;
   readout('Listening after your browser grants microphone access. Say: حالة الجهاز, or device status.');
  }catch{recognizer=null;endMic();readout('Microphone could not start. Allow microphone access or type a status request.');}
 });
 stop.addEventListener('click',()=>{try{recognizer?.stop()}catch{};endMic()});
}
send.addEventListener('click',async()=>{
 const utterance=transcript.value.trim().toLocaleLowerCase();
 if(!utterance){readout('Say or type a device-status request first.');return}
 const listed=/(?:قائمة|الاجهزة|الأجهزة|devices|list)/i.test(utterance);
 const check=/(?:حالة|وضع|اتصال|اتصل|وصل|check|connect|status|ping|online)/i.test(utterance);
 if(listed&&!check){readout('Authorized devices: '+devices.map(d=>d.display_name+' '+(d.online?'online':'offline')).join('، '),true);return}
 if(!check){readout('This voice preview supports only device status and connection checks. It cannot issue general Windows, administrator, or destructive commands. Use an authorized text tool for those tasks.');return}
 const item=devices.find(d=>d.id===select.value);
 if(!item){readout('Select an authorized device first.');return}
 send.disabled=true;readout('Checking the authorized Agent command connection, not controlling the Windows desktop...');
 try{
  const response=await fetch('/api/devices/'+encodeURIComponent(item.id)+'/connect-check',{
   method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:'{}'});
  const data=await response.json();
  if(!response.ok)throw Error(data.code||'CONNECT_FAILED');
  readout('Device '+item.display_name+' responded to an authenticated ping in '+data.latencyMs+
    ' milliseconds. This does not prove GUI control or Administrator rights.',true);
 }catch(err){
  const code=String(err.message||'CONNECT_FAILED').replace(/[^a-z_]/ig,'').slice(0,48);
  readout('Device command check failed: '+code+'. Check the Agent connection and device-sharing permissions.',true);
 }finally{send.disabled=false}
});
window.addEventListener('pagehide',()=>{try{recognizer?.abort()}catch{};if('speechSynthesis' in window)speechSynthesis.cancel()});
})();