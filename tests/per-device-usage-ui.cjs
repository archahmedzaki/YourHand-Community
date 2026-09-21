'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const start=src.indexOf('function deviceCard(d){'),end=src.indexOf('let sharingDeviceId=null;',start);
assert(start>0&&end>start,'Exact user-facing device-card renderer');
const format=src.match(/const compactTime=ms=>\{[\s\S]*?\n\};/);
assert(format,'Real duration formatter');
function element(tag){
 return {tag,className:'',textContent:'',title:'',style:{},children:[],
   append(...items){this.children.push(...items)},
   prepend(...items){this.children.unshift(...items)}};
}
const usage=new Map();
const ctx={document:{createElement:element,createTextNode:text=>({textContent:String(text)})},
 online:()=>true,when:()=>'<test-time>',connectResults:new Map(),deviceUsage:usage,
 usageAvailable:true,usageTrackingSince:'2026-09-21T00:00:00Z'};
vm.createContext(ctx);
vm.runInContext(format[0]+'\n'+src.slice(start,end)+'\nthis.render=deviceCard;this.format=compactTime;',ctx);
assert.equal(ctx.format(2*3600000+5*60000),'2h 5m');
usage.set('dev',{calls:142,usageMs:3*3600000+12*60000,
 last7DaysCalls:42,last7DaysMs:40*60000,unlimited:true});
const find=(node,clazz)=>node.className===clazz?node:
 node.children.map(child=>find(child,clazz)).find(Boolean);
const card=ctx.render({id:'dev',display_name:'My device',access_role:'owner'});
const badge=find(card,'device-usage');assert(badge,'Usage visible on each device card');
const labels=badge.children.filter(x=>x.className==='usage-metric').map(x=>x.children.map(c=>c.textContent).join(''));
assert.equal(labels.length,4);
assert(labels.some(x=>x.includes('142 calls')));
assert(labels.some(x=>x.includes('3h 12m usage')));
assert(labels.some(x=>x.includes('42 calls · 7d')));
assert(labels.some(x=>x.includes('40m 7d')));
assert.equal(badge.children.find(x=>x.className==='usage-unlimited').textContent,'∞ Unlimited');
assert(badge.title.includes('Your Google account only'));
usage.clear();const absent=find(ctx.render({id:'dev',display_name:'My device',access_role:'owner'}),'device-usage');
assert(absent.textContent.includes('unavailable')&&!absent.textContent.includes('0 calls'));
assert(!src.includes('innerHTML='),'Never interpolate API data into HTML');
console.log('PASS_PER_DEVICE_USAGE_UI','labels=4','calls=142','total=3h12m',
 'last7days=42calls','unlimited=true','noFakeZeroOnUnavailable=true',
 'accountScopedLabel=true');
