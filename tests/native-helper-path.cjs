'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const {resolveYourHandNativeHelper} = await import('../src/multiuser/native-helper-path.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-native-path-'));
  try {
    assert.equal(resolveYourHandNativeHelper('', dir), path.join(dir, 'native', 'YourHandNative.exe'));
    const configured = path.join(dir, 'custom', 'helper.exe');
    assert.equal(resolveYourHandNativeHelper(configured, dir), configured);
    fs.writeFileSync(path.join(dir, 'YourHandNative.exe'), 'synthetic test fixture only');
    assert.equal(resolveYourHandNativeHelper('', dir), path.join(dir, 'YourHandNative.exe'));
    assert.equal(resolveYourHandNativeHelper(configured, dir), configured);
    console.log('PASS_NATIVE_HELPER_PATH explicit_config_respected=true source_build_fallback=true');
  } finally {fs.rmSync(dir, {recursive:true, force:true});}
})().catch(e => { console.error(e);process.exitCode=1; });
