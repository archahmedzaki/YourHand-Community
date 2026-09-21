'use strict';
class DurableTaskLedger {
  constructor(store) {
    this.store=store; this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS yourhand_task_checkpoints (
      user_id TEXT NOT NULL, task_id TEXT NOT NULL, device_id TEXT NOT NULL,
      revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(user_id,task_id)
    );`);
  }
  validateTaskId(taskId) {
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(taskId)) throw new Error('Invalid task ID');
  }
  get(userId,taskId) {
    this.validateTaskId(taskId);
    const row=this.db.prepare('SELECT task_id,device_id,revision,status,payload,updated_at FROM yourhand_task_checkpoints WHERE user_id=? AND task_id=?').get(userId,taskId);
    return row ? {...row,checkpoint:JSON.parse(row.payload),payload:undefined} : null;
  }
  list(userId) {
    return this.db.prepare('SELECT task_id,device_id,revision,status,updated_at FROM yourhand_task_checkpoints WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(userId);
  }
  save(userId,taskId,deviceId,expectedRevision,status,checkpoint) {
    this.validateTaskId(taskId);
    if(!Number.isSafeInteger(expectedRevision) || expectedRevision<0) throw new Error('Expected revision must be a non-negative integer');
    if(!['running','paused','completed','needs_review'].includes(status)) throw new Error('Invalid checkpoint status');
    if(!this.store.getDeviceForUser(userId,deviceId)) throw new Error('Device is not linked to this account');
    if(!checkpoint || typeof checkpoint!=='object' || Array.isArray(checkpoint)) throw new Error('Checkpoint must be an object');
    const payload=JSON.stringify(checkpoint);
    if(Buffer.byteLength(payload,'utf8')>16384) throw new Error('Checkpoint exceeds 16 KB');
    const now=new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT revision,device_id FROM yourhand_task_checkpoints WHERE user_id=? AND task_id=?').get(userId,taskId);
      if((old?.revision||0)!==expectedRevision) throw new Error('Checkpoint revision conflict: read latest checkpoint first');
      if(old && old.device_id!==deviceId) throw new Error('Task is linked to another device');
      if(old) this.db.prepare('UPDATE yourhand_task_checkpoints SET revision=?,status=?,payload=?,updated_at=? WHERE user_id=? AND task_id=?')
        .run(expectedRevision+1,status,payload,now,userId,taskId);
      else this.db.prepare('INSERT INTO yourhand_task_checkpoints(user_id,task_id,device_id,revision,status,payload,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(userId,taskId,deviceId,1,status,payload,now);
      this.db.exec('COMMIT');
    } catch(err) {this.db.exec('ROLLBACK');throw err;}
    return this.get(userId,taskId);
  }
}
module.exports={DurableTaskLedger};
