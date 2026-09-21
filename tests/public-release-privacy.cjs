'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'node_modules']);
const forbiddenNames = new Set(['.env', 'device-private.pem', 'yourhand-config.json', 'yourhand-bootstrap.json', 'yourhand.db', 'staging.db', 'core.log']);
const personalMachine = /\b(?:PC-\d{3}|vmi\d{7})\b|[A-Z]:[\\/]Users[\\/](?!Public[\\/])[^\\/\s]+[\\/]/i;
const hardcodedCredential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{24,}|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{24,}/;
let checked = 0;
function visit(dir) {
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    if (ignored.has(item.name)) throw new Error('Forbidden directory in public candidate: '+item.name);
    const full = path.join(dir,item.name), rel = path.relative(root,full).replace(/\\/g,'/');
    if (item.isDirectory()) { visit(full); continue; }
    assert(!forbiddenNames.has(item.name.toLowerCase()), 'Forbidden file: '+rel);
    if (/\.(?:png|jpg|jpeg|gif|webp|ico)$/i.test(item.name)) { checked++; continue; }
    const raw = fs.readFileSync(full,'utf8');
    assert(!personalMachine.test(raw), 'Machine-specific marker in '+rel);
    assert(!hardcodedCredential.test(raw), 'Potential embedded secret in '+rel);
    checked++;
  }
}
visit(root);
console.log('PASS_PUBLIC_SOURCE_PRIVACY_GUARD files='+checked+' no_known_device_identifiers=true no_key_pattern=true');
