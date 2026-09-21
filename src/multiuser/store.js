'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const nowIso = () => new Date().toISOString();
const randomId = () => crypto.randomUUID();
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const addMsIso = ms => new Date(Date.now() + ms).toISOString();

class YourHandStore {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }
  migrate() {
    this.db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
 name TEXT, picture TEXT, created_at TEXT NOT NULL, last_login_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS oauth_states (
 state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, return_to TEXT,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL,
 hostname TEXT, public_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active',
 connected_at TEXT, last_seen TEXT, created_at TEXT NOT NULL, revoked_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS pairing_codes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT UNIQUE NOT NULL,
 installer_token_hash TEXT,
 expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mcp_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);
    const pairCols=this.db.prepare('PRAGMA table_info(pairing_codes)').all().map(r=>r.name);
    if(!pairCols.includes('installer_token_hash')) this.db.exec('ALTER TABLE pairing_codes ADD COLUMN installer_token_hash TEXT');
    this.db.exec(`
CREATE TABLE IF NOT EXISTS device_shares (
 device_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','operator')),
 created_at TEXT NOT NULL, PRIMARY KEY(device_id,user_id),
 FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_shares_user ON device_shares(user_id);
CREATE TABLE IF NOT EXISTS device_share_invites (
 token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 target_email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','operator')),
 expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);
`);

  }
  saveOauthState(state, nonce, returnTo = '/', ttlMs = 10 * 60 * 1000) {
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(nowIso());
    this.db.prepare('INSERT INTO oauth_states(state_hash,nonce,return_to,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(sha256(state), nonce, returnTo, addMsIso(ttlMs), nowIso());
  }
  consumeOauthState(state) {
    const key = sha256(state);
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(key);
    this.db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(key);
    if (!row || row.expires_at < nowIso()) return null;
    return row;
  }
  upsertGoogleUser(profile) {
    const email = String(profile.email || '').trim().toLowerCase();
    const sub = String(profile.sub || '').trim();
    if (!email || !sub) throw new Error('Google profile missing email/sub');
    const existing = this.db.prepare('SELECT * FROM users WHERE google_sub=? OR email=?').get(sub, email);
    if (existing) {
      this.db.prepare('UPDATE users SET google_sub=?,email=?,name=?,picture=?,last_login_at=? WHERE id=?')
        .run(sub, email, profile.name || '', profile.picture || '', nowIso(), existing.id);
      return this.db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
    }
    const id = randomId();
    this.db.prepare('INSERT INTO users(id,google_sub,email,name,picture,created_at,last_login_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, sub, email, profile.name || '', profile.picture || '', nowIso(), nowIso());
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  createSession(userId, ttlMs = 30 * 24 * 60 * 60 * 1000) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(randomId(), userId, sha256(token), addMsIso(ttlMs), nowIso());
    return token;
  }
  userFromSession(token) {
    if (!token) return null;
    return this.db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(token), nowIso()) || null;
  }
  deleteSession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
  }
  listDevices(userId) {
    return this.db.prepare(`SELECT d.id,d.display_name,d.hostname,d.status,d.connected_at,d.last_seen,d.created_at,
      CASE WHEN d.user_id=? THEN 'owner' ELSE sh.role END AS access_role,
      1 + (SELECT COUNT(*) FROM device_shares allshares WHERE allshares.device_id=d.id) AS authorized_accounts
      FROM devices d LEFT JOIN device_shares sh ON sh.device_id=d.id AND sh.user_id=?
      WHERE d.status='active' AND (d.user_id=? OR sh.user_id IS NOT NULL)
      ORDER BY d.created_at DESC`).all(userId,userId,userId);
  }
  getDeviceForUser(userId, deviceId) {
    return this.db.prepare(`SELECT d.*,CASE WHEN d.user_id=? THEN 'owner' ELSE sh.role END AS access_role
      FROM devices d LEFT JOIN device_shares sh ON sh.device_id=d.id AND sh.user_id=?
      WHERE d.id=? AND d.status='active' AND (d.user_id=? OR sh.user_id IS NOT NULL)`)
      .get(userId,userId,deviceId,userId) || null;
  }
  getActiveDevice(deviceId) {
    return this.db.prepare('SELECT * FROM devices WHERE id=? AND status=?').get(deviceId, 'active') || null;
  }
  renameDevice(userId, deviceId, name) {
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) throw new Error('Device name required');
    const r = this.db.prepare('UPDATE devices SET display_name=? WHERE id=? AND user_id=? AND status=?')
      .run(clean, deviceId, userId, 'active');
    return r.changes > 0;
  }
  revokeDevice(userId, deviceId) {
    // A shared user can leave, never revoke the owner's live device or disconnect other members.
    const device=this.getDeviceForUser(userId,deviceId);
    if(!device)return false;
    if(device.access_role!=='owner') return this.db.prepare(
      'DELETE FROM device_shares WHERE user_id=? AND device_id=?').run(userId,deviceId).changes>0;
    const r=this.db.prepare('UPDATE devices SET status=?,revoked_at=? WHERE id=? AND user_id=? AND status=?')
      .run('revoked', nowIso(), deviceId, userId, 'active');
    if(r.changes)this.db.prepare('DELETE FROM device_share_invites WHERE device_id=?').run(deviceId);
    return r.changes>0;
  }
  ownerDevice(userId,deviceId) {
    return this.db.prepare("SELECT id FROM devices WHERE id=? AND user_id=? AND status='active'")
      .get(deviceId,userId)||null;
  }
  createDeviceShareInvite(userId,deviceId,email,role='operator',ttlMs=30*60*1000) {
    if(!this.ownerDevice(userId,deviceId))throw new Error('Only the device owner can invite users');
    const target=String(email||'').trim().toLowerCase();
    if(!/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(target))throw new Error('Valid account email required');
    if(!['viewer','operator'].includes(role))throw new Error('Invalid share role');
    const owner=this.db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    if(owner?.email?.toLowerCase()===target)throw new Error('Owner already has access');
    const token=crypto.randomBytes(32).toString('base64url'),at=nowIso();
    this.db.prepare('INSERT INTO device_share_invites(token_hash,device_id,owner_id,target_email,role,expires_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(sha256(token),deviceId,userId,target,role,addMsIso(Math.min(Math.max(ttlMs,60000),86400000)),at);
    return {token,expiresAt:addMsIso(Math.min(Math.max(ttlMs,60000),86400000))};
  }
  acceptDeviceShareInvite(userId,token) {
    if(typeof token!=='string'||!token||token.length>256)throw new Error('Invalid invitation');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const user=this.db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);
      const row=this.db.prepare("SELECT * FROM device_share_invites WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?").get(sha256(token),nowIso());
      if(!user||!row||row.target_email!==user.email.toLowerCase())throw new Error('Invalid, expired or different-account invitation');
      if(!this.ownerDevice(row.owner_id,row.device_id))throw new Error('The device is no longer shared by its owner');
      const stamp=nowIso();
      const used=this.db.prepare('UPDATE device_share_invites SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL').run(stamp,row.token_hash);
      if(used.changes!==1)throw new Error('Invitation already used');
      this.db.prepare(`INSERT INTO device_shares(device_id,user_id,role,created_at) VALUES(?,?,?,?)
         ON CONFLICT(device_id,user_id) DO UPDATE SET role=excluded.role`).run(row.device_id,userId,row.role,stamp);
      this.db.exec('COMMIT');
      return {deviceId:row.device_id,role:row.role};
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  listDeviceShares(ownerId,deviceId) {
    if(!this.ownerDevice(ownerId,deviceId))throw new Error('Only owner may view members');
    return this.db.prepare(`SELECT sh.user_id AS userId,u.email,sh.role,sh.created_at AS sharedAt
      FROM device_shares sh JOIN users u ON u.id=sh.user_id WHERE sh.device_id=? ORDER BY sh.created_at`).all(deviceId);
  }
  revokeDeviceShare(ownerId,deviceId,memberId) {
    if(!this.ownerDevice(ownerId,deviceId))throw new Error('Only owner may revoke members');
    return this.db.prepare('DELETE FROM device_shares WHERE device_id=? AND user_id=?')
      .run(deviceId,memberId).changes>0;
  }
  listPendingDeviceShareInvites(userId) {
    const user=this.db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    if(!user)return [];
    return this.db.prepare(`SELECT inv.device_id AS deviceId,d.display_name AS deviceName,
     inv.role,inv.expires_at AS expiresAt,inv.created_at AS createdAt
     FROM device_share_invites inv JOIN devices d ON d.id=inv.device_id
     WHERE inv.target_email=? AND inv.consumed_at IS NULL AND inv.expires_at>? AND d.status='active'
     ORDER BY inv.created_at DESC LIMIT 30`).all(user.email.toLowerCase(),nowIso());
  }
  touchDevice(deviceId, connected = false) {
    const at = nowIso();
    if (connected) this.db.prepare("UPDATE devices SET last_seen=?,connected_at=? WHERE id=? AND status='active'").run(at, at, deviceId);
    else this.db.prepare("UPDATE devices SET last_seen=? WHERE id=? AND status='active'").run(at, deviceId);
  }
  createPairingCode(userId, ttlMs = 10 * 60 * 1000) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let raw = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) raw += alphabet[bytes[i] % alphabet.length];
    const code = `YH-${raw.slice(0,4)}-${raw.slice(4)}`;
    const installerToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = addMsIso(ttlMs);
    this.db.prepare('INSERT INTO pairing_codes(id,user_id,code_hash,installer_token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomId(), userId, sha256(code), sha256(installerToken), expiresAt, nowIso());
    return { code, installerToken, expiresAt };
  }
  _enrollRow(row, input) {
    if (!row || row.used_at || row.expires_at < nowIso()) return null;
    const publicKey = String(input.publicKey || '').trim();
    if (!publicKey.includes('BEGIN PUBLIC KEY')) throw new Error('Invalid public key');
    const hostname = String(input.hostname || '').trim().slice(0, 255);
    const displayName = String(input.displayName || hostname || 'My device').trim().slice(0, 80);
    let id;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const at = nowIso();
      const consumed = this.db.prepare('UPDATE pairing_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?')
        .run(at, row.id, at);
      if (!consumed.changes) throw new Error('Pairing token already used or expired');
      // A device public key is owned by exactly one account. Never transfer it by hostname.
      const byKey = this.db.prepare('SELECT * FROM devices WHERE public_key=?').get(publicKey);
      if (byKey && byKey.user_id !== row.user_id) throw new Error('Device key belongs to another account');
      // Hostname is NOT an identity. Two Windows profiles on one PC have the
      // same hostname but independent Agent keys and sessions; a new enrollment
      // must not evict the other profile's public key / device socket. An existing
      // paired profile is restored by preserving its configuration and key,
      // never by inferring ownership from a host string.
      const existing = byKey;
      id = existing ? existing.id : randomId();
      if (existing) {
        this.db.prepare("UPDATE devices SET display_name=?,hostname=?,public_key=?,status='active',revoked_at=NULL,last_seen=NULL,connected_at=NULL WHERE id=? AND user_id=?")
          .run(existing.display_name || displayName, hostname || existing.hostname, publicKey, id, row.user_id);
      } else {
        this.db.prepare(`INSERT INTO devices(id,user_id,display_name,hostname,public_key,status,created_at)
          VALUES(?,?,?,?,?,'active',?)`).run(id, row.user_id, displayName, hostname, publicKey, at);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.db.prepare('SELECT * FROM devices WHERE id=?').get(id);
  }
  validateInstallerToken(userId, token) {
    if(!token)return false;
    const row=this.db.prepare('SELECT id FROM pairing_codes WHERE user_id=? AND installer_token_hash=? AND used_at IS NULL AND expires_at>?').get(userId,sha256(token),nowIso());
    return !!row;
  }
  enrollDevice(code, input) {
    const row = this.db.prepare('SELECT * FROM pairing_codes WHERE code_hash=? AND used_at IS NULL').get(sha256(code));
    return this._enrollRow(row,input);
  }
  enrollDeviceToken(token, input) {
    const row = this.db.prepare('SELECT * FROM pairing_codes WHERE installer_token_hash=? AND used_at IS NULL').get(sha256(token));
    return this._enrollRow(row,input);
  }
  createMcpToken(userId, ttlMs = 30 * 24 * 60 * 60 * 1000) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO mcp_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(randomId(), userId, sha256(token), addMsIso(ttlMs), nowIso());
    return token;
  }
  userFromMcpToken(token) {
    if (!token) return null;
    return this.db.prepare(`SELECT u.* FROM mcp_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`)
      .get(sha256(token), nowIso()) || null;
  }
  revokeMcpTokens(userId) {
    this.db.prepare('UPDATE mcp_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(nowIso(), userId);
  }
  countUsers() {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n || 0);
  }
}

module.exports = { YourHandStore, sha256 };
