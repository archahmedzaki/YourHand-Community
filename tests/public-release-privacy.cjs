'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const forbiddenNames = new Set([
  '.env', 'device-private.pem', 'device-public.pem',
  'yourhand-config.json', 'yourhand-bootstrap.json', 'yourhand.db',
  'staging.db', 'core.log'
]);
const personalMachine = /\b(?:PC-\d{3}|vmi\d{7})\b|[A-Z]:[\\/]Users[\\/](?!Public[\\/])[^\\/\s]+[\\/]/i;
const hardcodedCredential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{24,}|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{24,}/;
const tracked = execFileSync('git', ['ls-files', '-z'], {cwd:root})
  .toString('utf8').split('\0').filter(Boolean);
assert(tracked.length > 0, 'No Git-tracked source files to audit');
let textCount = 0, binaryCount = 0;
for (const rel of tracked) {
  const segments=rel.replace(/\\/g,'/').split('/');
  assert(!segments.includes('.git') && !segments.includes('node_modules'),
    'Private build directory tracked: '+rel);
  assert(!segments.some(s=>forbiddenNames.has(s.toLowerCase())),
    'Private configuration or database tracked: '+rel);
  assert(!/\.(?:db|sqlite3?|pem|p12|pfx|key|log|zip|exe)$/i.test(rel),
    'Forbidden binary or private file extension: '+rel);
  const file=path.join(root,rel);
  assert(fs.statSync(file).isFile(), 'Not a regular source file: '+rel);
  if (/\.(?:png|jpg|jpeg|webp|gif|ico)$/i.test(rel)) {
    binaryCount++;
    continue; // Binary metadata and visual provenance are separate release gates.
  }
  const body=fs.readFileSync(file,'utf8');
  assert(!personalMachine.test(body), 'Personal-device marker: '+rel);
  assert(!hardcodedCredential.test(body), 'Potential embedded secret: '+rel);
  textCount++;
}
console.log('PASS_PUBLIC_SOURCE_PRIVACY_GUARD tracked='+tracked.length+
  ' text='+textCount+' images='+binaryCount+' known_device_identifiers=false key_patterns=false');
