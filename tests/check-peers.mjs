/**
 * Report, for one plugin directory, which of its bare imports the harness's
 * interception layer can actually route.
 *
 * A linked plugin does not resolve `@deepseek-ai/*` through Node. The layer
 * routes a name only when some ancestor `node_modules` position is declared by
 * a `package.json` that lists the name in `peerDependencies`. A name that is
 * imported but not declared therefore falls through to native resolution and
 * fails at import time — with a message that names the specifier but not the
 * missing declaration. This script closes that gap by checking the declaration
 * set against the real import list.
 *
 * Run: node tests/check-peers.mjs <plugin-dir>
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const declared = new Set(Object.keys(manifest.peerDependencies ?? {}))

/** Every bare specifier reachable from the plugin's own JavaScript. */
function importsOf(dir, found = new Set()) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') importsOf(path, found)
      continue
    }
    if (!/\.(js|mjs|cjs)$/.test(entry)) continue
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)) {
      const spec = match[1]
      if (spec.startsWith('node:')) continue
      found.add(spec)
    }
  }
  return found
}

/** The package a specifier belongs to: `@scope/name` or `name`, without a subpath. */
function packageOf(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const needed = new Set([...importsOf(join(pluginDir, 'lib'))].map(packageOf))
const missing = [...needed].filter(name => !declared.has(name)).sort()
const unused = [...declared].filter(name => !needed.has(name)).sort()

console.log(`plugin: ${manifest.name}`)
console.log(`imported packages (${needed.size}):`)
for (const name of [...needed].sort()) {
  console.log(`  ${declared.has(name) ? 'declared  ' : 'UNDECLARED'}  ${name}`)
}
if (missing.length > 0) {
  console.log(`\nUNDECLARED — these will fail to import inside the harness:`)
  for (const name of missing) console.log(`  ${name}`)
}
if (unused.length > 0) {
  console.log(`\ndeclared but never imported (harmless, but inert):`)
  for (const name of unused) console.log(`  ${name}`)
}
console.log(`\nmanifest: ${join(dirname(join(pluginDir, 'package.json')), 'package.json')}`)
process.exitCode = missing.length === 0 ? 0 : 1
