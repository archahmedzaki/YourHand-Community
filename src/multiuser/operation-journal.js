'use strict';
// STAGED ONLY. This journal does not migrate or modify the live YourHand database.
const crypto = require('crypto');
const STATES = new Set(['queued','running','completed','needs_review']);
const IDENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
class OperationJournal {
  constructor({db,getDeviceForUser}) {
    if(!db || typeof getDeviceForUser!=='function') throw Error('Journal needs a database and device authorization');
    this.db=db; this.authorized=getDeviceForUser;
    db.exec(`CREATE TABLE IF NOT EXISTS yh_operation_journal (
      user_id TEXT NOT NULL, device_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','running','completed','needs_review')),
      owner_epoch TEXT, outcome TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,device_id,operation_id)
    );`);
  }
  check(userId,deviceId,operationId) {
    if(![userId,deviceId,operationId].every(x=>typeof x==='string'&&IDENT.test(x))) throw Error('Invalid operation identity');
    if(!this.authorized(userId,deviceId)) throw Error('Device not linked to user');
  }
  hash(operation) {
    if(!operation || typeof operation!=='object' || Array.isArray(operation)) throw Error('Invalid operation');
    const raw=JSON.stringify(operation);
    if(Buffer.byteLength(raw)>16384) throw Error('Operation request too large');
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
  row(userId,deviceId,operationId) {
    return this.db.prepare('SELECT user_id,device_id,operation_id,fingerprint,state,owner_epoch,outcome,created_at,updated_at FROM yh_operation_journal WHERE user_id=? AND device_id=? AND operation_id=?').get(userId,deviceId,operationId)||null;
  }
  submit(userId,deviceId,operationId,operation) {
    this.check(userId,deviceId,operationId);
    const fingerprint=this.hash(operation),now=new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO yh_operation_journal(user_id,device_id,operation_id,fingerprint,state,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)").run(userId,deviceId,operationId,fingerprint,now,now);
    const found=this.row(userId,deviceId,operationId);
    if(found.fingerprint!==fingerprint) throw Error('Idempotency conflict: same ID has different payload');
    return found; // Existing running/uncertain ops are never redispatched.
  }
  dispatch(userId,deviceId,operationId,epoch) {
    this.check(userId,deviceId,operationId);
    if(typeof epoch!=='string'||!IDENT.test(epoch)) throw Error('Invalid owner epoch');
    const r=this.db.prepare("UPDATE yh_operation_journal SET state='running',owner_epoch=?,updated_at=? WHERE user_id=? AND device_id=? AND operation_id=? AND state='queued'").run(epoch,new Date().toISOString(),userId,deviceId,operationId);
    if(r.changes!==1) throw Error('Operation already dispatched, completed, or needs review; do not replay');
    return this.row(userId,deviceId,operationId);
  }
  finish(userId,deviceId,operationId,epoch,outcome) {
    this.check(userId,deviceId,operationId);
    const raw=JSON.stringify(outcome??null);
    if(Buffer.byteLength(raw)>8192) throw Error('Result too large');
    const r=this.db.prepare("UPDATE yh_operation_journal SET state='completed',outcome=?,updated_at=? WHERE user_id=? AND device_id=? AND operation_id=? AND state='running' AND owner_epoch=?").run(raw,new Date().toISOString(),userId,deviceId,operationId,epoch);
    if(r.changes!==1) throw Error('Wrong owner epoch, invalid state, or already completed');
    return this.row(userId,deviceId,operationId);
  }
  uncertain(userId,deviceId,operationId,epoch) {
    this.check(userId,deviceId,operationId);
    const r=this.db.prepare("UPDATE yh_operation_journal SET state='needs_review',updated_at=? WHERE user_id=? AND device_id=? AND operation_id=? AND state='running' AND owner_epoch=?").run(new Date().toISOString(),userId,deviceId,operationId,epoch);
    if(r.changes!==1) throw Error('Cannot mark an operation belonging to another epoch');
    return this.row(userId,deviceId,operationId);
  }
  recoverUnconfirmed(ownerEpoch) {
    // Only call after independent proof that the OLD owner cannot still execute.
    if(typeof ownerEpoch!=='string'||!IDENT.test(ownerEpoch)) throw Error('Invalid owner epoch');
    const r=this.db.prepare("UPDATE yh_operation_journal SET state='needs_review',updated_at=? WHERE state='running' AND owner_epoch=?").run(new Date().toISOString(),ownerEpoch);
    return r.changes; // Never rerun an uncertain mouse click, typing, file write or Save As.
  }
  get(userId,deviceId,operationId) {
    this.check(userId,deviceId,operationId);
    return this.row(userId,deviceId,operationId);
  }
}
module.exports={OperationJournal,STATES};
