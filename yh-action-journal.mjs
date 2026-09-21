import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Per-user, per-device local journal for ONLY explicitly tagged guarded actions.
// A reservation is fsynced BEFORE any native input / CDP side effect. After a
// crash, running or corrupted records fail closed and cannot auto-replay.
const VALID=/^a_[0-9a-f]{64}$/;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export class FileActionJournal {
  constructor(directory){
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Absolute journal directory required');
    this.directory=directory;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
  }
  location(id){
    if(typeof id!=='string'||!VALID.test(id))throw Error('INVALID_ACTION_ID');
    return path.join(this.directory,sha(id)+'.json');
  }
  read(location){
    try{
      const b=fs.readFileSync(location);
      if(!b.length||b.length>131072)throw Error('Malformed journal record');
      const r=JSON.parse(b.toString('utf8'));
      if(!r||typeof r!=='object'||!['running','completed'].includes(r.state)||
         !/^[0-9a-f]{64}$/.test(r.fingerprint))throw Error('Malformed journal record');
      return r;
    }catch(error){
      if(error?.code==='ENOENT')return null;
      throw Error('OUTCOME_UNCERTAIN: local action journal unreadable; inspect device; never auto-replay');
    }
  }
  async execute(id,payload,perform){
    if(typeof perform!=='function')throw Error('Action handler required');
    const location=this.location(id);
    const raw=JSON.stringify(payload);
    if(typeof raw!=='string'||Buffer.byteLength(raw)>131072)throw Error('INVALID_REQUEST: action too large');
    const fingerprint=sha(raw);
    let cached=this.read(location);
    if(!cached){
      let file;
      try{
        file=fs.openSync(location,'wx',0o600);
        const reservation=JSON.stringify({version:1,idHash:sha(id),fingerprint,state:'running',
          createdAt:new Date().toISOString()});
        fs.writeSync(file,reservation);fs.fsyncSync(file);
      }catch(error){
        if(error?.code==='EEXIST')cached=this.read(location);
        else throw Error('OUTCOME_UNCERTAIN: unable to reserve action on disk; input not attempted');
      }finally{if(file!==undefined)fs.closeSync(file);}
    }
    if(cached){
      if(cached.idHash!==sha(id)||cached.fingerprint!==fingerprint)
        throw Error('INVALID_REQUEST: action ID reused with different arguments');
      if(cached.state==='completed'&&Object.hasOwn(cached,'result'))return cached.result;
      throw Error('OUTCOME_UNCERTAIN: local action already reserved; inspect status before another action');
    }
    // No automatic replay even if the process dies immediately after reservation.
    const result=await perform();
    const record=JSON.stringify({version:1,idHash:sha(id),fingerprint,state:'completed',
      result,completedAt:new Date().toISOString()});
    if(Buffer.byteLength(record)>131072)
      throw Error('OUTCOME_UNCERTAIN: result too large to journal; action may already have executed');
    const temp=location+'.'+crypto.randomUUID()+'.tmp';
    try{
      const f=fs.openSync(temp,'wx',0o600);
      try{fs.writeSync(f,record);fs.fsyncSync(f);}finally{fs.closeSync(f);}
      fs.renameSync(temp,location);
      return result;
    }catch{
      throw Error('OUTCOME_UNCERTAIN: action dispatched but durable result unavailable; never auto-replay');
    }finally{try{fs.rmSync(temp,{force:true});}catch{}}
  }
  status(id){
    const r=this.read(this.location(id));
    return r?{state:r.state,result:r.state==='completed'?r.result:null}:
      {state:'not_found',result:null};
  }
}
