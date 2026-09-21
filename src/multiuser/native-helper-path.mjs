import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the native helper for a source checkout or an installed Agent.
 * An explicitly configured path takes priority; never silently substitute a
 * different executable when that path is missing.
 */
export function resolveYourHandNativeHelper(configuredPath, rootDir) {
  const base = path.resolve(rootDir);
  if (configuredPath && String(configuredPath).trim()) {
    return path.resolve(base, String(configuredPath));
  }
  const installed = path.join(base, 'YourHandNative.exe');
  const sourceBuild = path.join(base, 'native', 'YourHandNative.exe');
  return fs.existsSync(installed) ? installed : sourceBuild;
}
