/**
 * Reproduce the harness's linked-plugin resolution for one specifier.
 *
 * A linked plugin's `@deepseek-ai/*` imports are not resolved by Node: the
 * harness intercepts them and routes a name only when some ancestor
 * `node_modules` position is declared by a `package.json` listing that name in
 * `peerDependencies`. When no position declares it, the request falls through
 * to native resolution and fails at import time.
 *
 * This walks the same positions `routeLinked` walks and reports what each one
 * declares, so a failure names the position that is missing the declaration
 * instead of only naming the specifier.
 *
 * Run: node tests/trace-resolution.mjs <importer-file> <specifier> [more...]
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [importer, ...specifiers] = process.argv.slice(2)
if (importer === undefined || specifiers.length === 0) {
  console.error('usage: node tests/trace-resolution.mjs <importer-file> <specifier> [more...]')
  process.exit(2)
}

const require = createRequire(pathToFileURL(importer))

/** Node's own node_modules search path list for this importer. */
function nodeModulePaths(from) {
  const paths = []
  let current = from
  for (;;) {
    if (current.endsWith('node_modules')) {
      paths.push(current)
    } else {
      paths.push(join(current, 'node_modules'))
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return paths
}

/** The names a directory's manifest declares as peers; none when unreadable. */
function peerNames(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const peers = manifest.peerDependencies
    return new Set(peers !== null && typeof peers === 'object' ? Object.keys(peers) : [])
  } catch {
    return new Set()
  }
}

console.log(`importer: ${importer}\n`)

for (const specifier of specifiers) {
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
  console.log(`${specifier}  (package: ${name})`)

  let routed = false
  for (const searchPath of nodeModulePaths(dirname(importer))) {
    const directory = dirname(searchPath)
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const declares = peerNames(directory).has(name)
    const physical = existsSync(join(searchPath, name))
    if (declares) {
      console.log(`  ROUTED   ${manifestPath}`)
      routed = true
      break
    }
    if (physical) {
      console.log(`  occupied ${manifestPath} (has the package on disk but does not declare it as a peer)`)
    }
  }
  if (!routed) {
    console.log('  NOT ROUTED — this import fails inside the harness')
    try {
      console.log(`  native fallback: ${require.resolve(specifier)}`)
    } catch (error) {
      console.log(`  native fallback also fails: ${error.code}`)
    }
  }
  console.log('')
}
