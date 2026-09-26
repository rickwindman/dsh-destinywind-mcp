/**
 * Common MCP server presets: one-click form prefill for the servers people
 * configure most often.
 *
 * The catalog deliberately holds exactly ONE entry. This area is a "common
 * case" shortcut, not a gallery: GitHub is the only recipe verified end to end
 * here (remote HTTP plus a token read from a secret process env var). Every
 * other server is filled in from a blank draft, so there is one obvious path
 * instead of a grid of half-checked recipes that all need editing anyway.
 *
 * A preset NEVER carries a secret. Services that authenticate with a token
 * reference a process-level environment variable by name (`${NAME}` in the
 * header value); the value itself lives in the credentials store, so the
 * plaintext never reaches this file, the draft, or cordis.patch.yml.
 * @module dsh-destinywind-mcp/client/presets
 */

import type { McpDraft } from './mcp-store.ts'
import type { McpSettingsLocaleKey } from './locales.ts'

/** One catalog entry: identity, copy keys, and the draft it prefills. */
export interface McpPreset {
  /** Stable key for React lists and tests. */
  readonly id: string
  /** Locale key of the display name. */
  readonly nameKey: McpSettingsLocaleKey
  /** Locale key of the one-line description (states what must be edited). */
  readonly descKey: McpSettingsLocaleKey
  /** True when the preset only works after a token is stored (never enabled blind). */
  readonly needsSecret: boolean
  /** Process-level env names the preset references; the UI lists them as a reminder. */
  readonly envNames: readonly string[]
  /** Upstream documentation URL, shown as a link. */
  readonly docs: string
  /** The prefilled draft; `id` is always null (a preset creates a new server). */
  readonly draft: Omit<McpDraft, 'id'>
}

/** Default tool-call timeout for a prefilled draft (ms), matching emptyDraft(). */
const TIMEOUT = '60000'

/** Ordered catalog; the GitHub entry ships disabled because it needs a token. */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'github',
    nameKey: 'presetGithubName',
    descKey: 'presetGithubDesc',
    needsSecret: true,
    envNames: ['GITHUB_MCP_PAT'],
    docs: 'https://github.com/github/github-mcp-server',
    draft: {
      serverName: 'github',
      transport: 'streamable-http',
      // 未配置令牌前不启用：否则挂载必然失败并污染工具列表。
      enabled: false,
      command: '',
      argsText: '',
      cwd: '',
      url: 'https://api.githubcopilot.com/mcp/',
      headersText: 'Authorization: Bearer ${GITHUB_MCP_PAT}',
      toolCallTimeoutMs: TIMEOUT,
      oauth: false,
      failOnStartupError: true,
    },
  },
]

/**
 * Materialize a preset into an editable draft.
 * @param preset - catalog entry to instantiate.
 * @returns a fresh draft with a null id, so saving creates a new server.
 */
export function presetToDraft(preset: McpPreset): McpDraft {
  return { id: null, ...preset.draft }
}
