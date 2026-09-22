'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {isAllowedEnrollmentUrl:ok}=await import('../src/multiuser/enrollment-url.mjs');
 for(const u of ['https://example.com/api/device/enroll','https://example.com:9443/api/device/enroll','http://127.0.0.1:49123/api/device/enroll','http://localhost:8000/api/device/enroll'])
  assert.equal(ok(u),true,'expected allowed URL '+u);
 for(const u of ['http://example.com/api/device/enroll','http://192.168.1.50/api/device/enroll','http://[::ffff:127.0.0.1]/api/device/enroll','ftp://localhost/api/device/enroll','http://localhost@outside.example/api/device/enroll','http://foo:bar@127.0.0.1/api/device/enroll','http://127.0.0.1/api/device/enroll?x=1','http://127.0.0.1/api/device/enroll#x','http://127.0.0.1/other','javascript:alert(1)','',undefined])
  assert.equal(ok(u),false,'expected rejected URL '+String(u));
 console.log('PASS_COMMUNITY_ENROLLMENT_URL remote_tls_required=true loopback_only_http=true credentials_rejected=true');
})().catch(e=>{console.error(e);process.exitCode=1});
