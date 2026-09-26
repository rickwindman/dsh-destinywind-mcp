/**
 * Load a linked plugin through the harness's own profile resolution.
 *
 * The Loader reports a failed entry as the bare string `failed to import` and
 * keeps the real cause on the fiber, reachable only from inside a running
 * process. This installs the same interception the harness installs, then
 * imports the plugin, so a failure surfaces with its own message instead of
 * the Loader's summary.
 *
 * Run: node tests/load-in-harness.mjs <plugin-dir>
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const pluginDir = process.argv[2]
if (pluginDir === undefined) {
  console.error('usage: node tests/load-in-harness.mjs <plugin-dir>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const INSTALL_ANCHOR = 'D:/dsh/apps/cli/package.json'

const appBoot = await import(pathToFileURL('D:/dsh/packages/boot/app-boot/lib/index.js').href)
const { installRuntimeInterception } = await import(
  pathToFileURL('D:/dsh/packages/boot/app-boot/lib/types/profile-resolution/resolver.js').href
)

// The linked roots come from the profile, so the profile has to be loaded for
// the interception layer to classify this plugin's directory as linked at all.
// Without it every request routes native and the import fails for a reason the
// harness would never hit — which is exactly the false negative to avoid.
const profile = appBoot.loadProfile('dsh', process.argv[3] ?? 'web', INSTALL_ANCHOR)
const resolution = await appBoot.createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile })
console.log(`entries: ${String(resolution.entries.length)}`)
console.log(`linked roots: ${JSON.stringify(resolution.linkedRoots)}`)

const interception = installRuntimeInterception(resolution)

try {
  const module = await import(pathToFileURL(join(pluginDir, manifest.main ?? 'lib/index.js')).href)
  console.log(`\nIMPORT OK: ${manifest.name}`)
  console.log(`exports: ${Object.keys(module).join(', ')}`)
} catch (error) {
  console.log(`\nIMPORT FAILED: ${manifest.name}`)
  console.log(`${error.name}: ${error.message}`)
  if (error.cause !== undefined) console.log(`cause: ${String(error.cause)}`)
  console.log((error.stack ?? '').split('\n').slice(0, 10).join('\n'))
  process.exitCode = 1
} finally {
  interception.dispose()
}
