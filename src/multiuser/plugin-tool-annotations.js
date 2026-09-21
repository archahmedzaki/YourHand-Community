'use strict';

// Conservative public-plugin annotations: these are capability hints, never an
// authorization mechanism. Every tool still requires account/device access.
// OpenAI review must validate these against the actual *hosted* production build.
const OPEN_WORLD_TOOLS = new Set([
  'call_device_tool', 'start_process', 'interact_with_process',
  'native_call', 'native_batch', 'desktop_batch',
  'computer_act', 'computer_semantic_act', 'computer_execute',
  'computer_browser_observe', 'computer_browser_act', 'computer_background_task',
  'click_preview', 'semantic_batch', 'ui_invoke', 'ui_set_value',
  'mouse', 'hotkey', 'type_text', 'launch_app',
  'browser_start', 'browser_navigate', 'browser_eval', 'browser_text',
  'browser_click', 'browser_type', 'browser_wait_selector', 'browser_batch',
  'browser_screenshot', 'exec_command', 'process_start', 'process_write',
  // Local filesystem/process tools can operate on user-supplied network paths,
  // execute network-capable commands, or expose remote resources.
  'fs_search', 'fs_stat', 'fs_list', 'fs_read_text', 'fs_read_binary',
  'fs_write_text', 'fs_write_binary', 'fs_mkdir', 'fs_move', 'fs_copy',
  'fs_remove', 'read_file', 'read_multiple_files', 'list_directory', 'write_file'
]);

// All other mutating tools are classified conservatively as potentially
// destructive, because wrappers/batches can delegate to irreversible actions.
const NON_DESTRUCTIVE_WRITES = new Set([
  'checkpoint_save', 'acquire_device_lock', 'release_device_lock',
  'focus_window', 'scroll', 'browser_start', 'fs_mkdir'
]);

function pluginToolAnnotations(name, existing = {}) {
  const readOnlyHint = existing.readOnlyHint === true;
  const openWorldHint = OPEN_WORLD_TOOLS.has(name);
  const destructiveHint = Boolean(
    existing.destructiveHint === true ||
    (!readOnlyHint && !NON_DESTRUCTIVE_WRITES.has(name))
  );
  return {...existing, readOnlyHint, openWorldHint, destructiveHint};
}

module.exports = {pluginToolAnnotations};
