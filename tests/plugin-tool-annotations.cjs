'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pluginToolAnnotations}=require('../src/multiuser/plugin-tool-annotations');

const serverSource=fs.readFileSync(path.join(__dirname,'..','server-multiuser.js'),'utf8');
const registered=[...serverSource.matchAll(/mcp\.registerTool\('([^']+)'\s*,/g)].map(x=>x[1]);
assert(registered.length>=60,'Review the exposed tools if the server registration shape changes');
assert.equal(new Set(registered).size,registered.length,'Every MCP tool name must be unique');
assert(serverSource.includes('annotations: pluginToolAnnotations(name, config.annotations)'),
  'Every registered MCP tool must pass through the centralized annotation adapter');
for(const name of registered){
  const hints=pluginToolAnnotations(name,{readOnlyHint:name==='list_devices'});
  for(const key of ['readOnlyHint','openWorldHint','destructiveHint']){
    assert.equal(typeof hints[key],'boolean',name+' has missing '+key);
  }
}
assert.deepEqual(pluginToolAnnotations('list_devices',{readOnlyHint:true}),
  {readOnlyHint:true,openWorldHint:false,destructiveHint:false});
assert.deepEqual(pluginToolAnnotations('browser_navigate',{readOnlyHint:false}),
  {readOnlyHint:false,openWorldHint:true,destructiveHint:true});
assert.deepEqual(pluginToolAnnotations('call_device_tool',{readOnlyHint:false}),
  {readOnlyHint:false,openWorldHint:true,destructiveHint:true});
assert.deepEqual(pluginToolAnnotations('write_file',{readOnlyHint:false,destructiveHint:true}),
  {readOnlyHint:false,destructiveHint:true,openWorldHint:true});
assert.deepEqual(pluginToolAnnotations('checkpoint_save',{readOnlyHint:false}),
  {readOnlyHint:false,openWorldHint:false,destructiveHint:false});
assert.deepEqual(pluginToolAnnotations('screenshot',{readOnlyHint:true}),
  {readOnlyHint:true,openWorldHint:false,destructiveHint:false});
console.log('PASS_OPENAI_PLUGIN_TOOL_ANNOTATIONS tools='+registered.length+' three_boolean_hints=true');
