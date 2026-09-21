'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const skip = new Set(['.git', 'node_modules']);
let files = 0, links = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {walk(full);continue;}
    if (!entry.name.endsWith('.md')) continue;
    const text=fs.readFileSync(full,'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link=match[1].trim().split(/\s+["']/)[0];
      if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
      const dest=decodeURIComponent(link.split('#')[0].split('?')[0]);
      if (!dest) continue;
      const resolved=path.resolve(path.dirname(full),dest);
      assert(resolved.startsWith(root+path.sep) || resolved===root, 'Link escapes source: '+full+' -> '+link);
      assert(fs.existsSync(resolved), 'Broken local link: '+path.relative(root,full)+' -> '+link);
      links++;
    }
    files++;
  }
}
walk(root);
console.log('PASS_DOCUMENTATION_LOCAL_LINKS files='+files+' links='+links);
