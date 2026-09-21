'use strict';
const SELECTOR_KEYS=['automationId','name','controlType','className'];
function validCoordinates(frame,x,y){
  return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&
    x<frame?.width&&y<frame?.height;
}
function exactMatch(control,selector){
  return SELECTOR_KEYS.filter(k=>selector?.[k]).length>0 &&
    SELECTOR_KEYS.every(k=>!selector?.[k]||(Object.hasOwn(control,k)&&control[k]===selector[k]));
}
function chooseDesktopRoute({frame,selector,expect,x,y,allowPixelFallback=false}){
  if(!frame)return {ok:false,code:'STALE_REFERENCE',reason:'A fresh computer_observe frame is required'};
  const pixelPossible=validCoordinates(frame,x,y);
  if(selector){
    if(!SELECTOR_KEYS.some(k=>typeof selector[k]==='string'&&selector[k].length))
      return {ok:false,code:'INVALID_SELECTOR',reason:'Exact UIA selector required'};
    const controls=Array.isArray(frame.snapshot?.controls)?frame.snapshot.controls:[];
    const matches=controls.filter(c=>exactMatch(c,selector)&&c.enabled!==false);
    if(matches.length===1&&expect?.selector&&['name','value'].includes(expect.property)&&typeof expect.equals==='string'){
      return {ok:true,mode:'semantic',reason:'Unique accessible UIA element with exact postcondition',
        steps:[{op:'invoke',selector,expect}]};
    }
    if(!allowPixelFallback || !pixelPossible)
      return {ok:false,code:matches.length>1?'AMBIGUOUS_SELECTOR':'SEMANTIC_UNAVAILABLE',
        reason:'UIA target not uniquely evidenced or postcondition absent; pixel fallback requires explicit consent and valid coordinates',
        candidates:matches.length};
    return {ok:true,mode:'preview',reason:'Explicit pixel fallback from validated observation',x,y};
  }
  if(pixelPossible)return {ok:true,mode:'preview',reason:'Observed preview coordinates',x,y};
  return {ok:false,code:'TARGET_REQUIRED',reason:'Supply a unique semantic target with postcondition or valid preview coordinates'};
}
function canEscalate({effect,sideEffectDispatched=false,requestIsReadOnly=false}){
  if(effect==='unverifiable'||effect==='confirmed'||sideEffectDispatched)return false;
  if(requestIsReadOnly)return true;
  return effect==='rejected'||effect==='stale_reference';
}
module.exports={chooseDesktopRoute,canEscalate,exactMatch};