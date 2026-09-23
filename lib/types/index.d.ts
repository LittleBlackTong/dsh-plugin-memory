/**
 * Type declarations for dsh-plugin-memory.
 *
 * The implementation is plain ESM JavaScript (zero build step); these
 * declarations describe its public surface for TypeScript consumers.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Plugin entry name. */
export const name: 'memory'
/** Services required by the plugin. */
export const inject: ['systemPrompt', 'skills', 'agents']

/** User-facing plugin configuration (all fields optional). */
export interface MemoryConfig {
  /** Master switch: stops boot injection AND skill registration. Default `true`. */
  enabled?: boolean
  /** Absolute memory-store path; `~` is expanded. Default `'~/.memory'`. */
  memoryDir?: string
  /** Files injected at session start. Default `['SOUL.md', 'MEMORY.md', 'index.md']`. */
  bootFiles?: string[]
  /** Total character budget of the boot block. Default `12000`. */
  bootMaxChars?: number
  /**
   * Explicit per-file character caps for the boot block (composition-time
   * only). Files without a cap share what is left, with `index.md` taking its
   * share first so the routing table is never starved.
   */
  bootFileBudgets?: Record<string, number>
  /** Stamp `last_access` on the pages a session actually loaded. Default `true`. */
  trackPageAccess?: boolean
  /** Inject the boot block at session start. Default `true`. */
  autoInject?: boolean
  /** Don't inject anything until the session's first real user message. Default `true`. */
  deferUntilUserSpeaks?: boolean
  /** Only inject for the currently active session (most recent user message). Default `true`. */
  activeSessionOnly?: boolean
  /** Register the embedded `memory` skill. Default `true`. */
  registerSkill?: boolean
  /** Create the store layout and templates when missing. Default `true`. */
  scaffold?: boolean
  /** Absolute user-facing config-file path. Default `<dshHome>/memory.json`. */
  configFile?: string
  /** Digest guard: inject a reminder when the store goes unwritten too long. Default `true`. */
  digestNudgeEnabled?: boolean
  /** Minutes of store inactivity before a digest reminder. Default `120`. */
  digestNudgeAfterMinutes?: number
  /** Minimum minutes between digest reminders. Default `180`. */
  digestNudgeCooldownMinutes?: number
  /** Max digest reminders per session. Default `2`. */
  digestNudgeMaxPerSession?: number
  /** Recall nudge: idle-time first-person recall of a real memory. Default `true`. */
  recallEnabled?: boolean
  /** Lower bound (minutes) of the random recall interval. Default `30`. */
  recallIntervalMinMinutes?: number
  /** Upper bound (minutes) of the random recall interval. Default `240`. */
  recallIntervalMaxMinutes?: number
  /** Max recall nudges per session. Default `3`. */
  recallMaxPerSession?: number
  /** Auto-commit the store's git history after a quiet period. Default `true`. */
  autoCommit?: boolean
  /** Seconds of quiet before an auto-commit. Default `60`. */
  autoCommitQuietSeconds?: number
  /** Poll interval (seconds) for the auto-committer. Default `60`. */
  autoCommitIntervalSeconds?: number
}

/** Schemastery schema for {@link MemoryConfig}. */
export const Config: import('@deepseek-ai/schemastery').default<MemoryConfig>

/** HTTP route serving the user-facing config to the Settings panel. */
export const CONFIG_ROUTE_PATH: '/api/memory/config'

/** User-editable settings (composition config is the base layer). */
export interface MemorySettings {
  enabled?: boolean
  memoryDir?: string
  autoInject?: boolean
  deferUntilUserSpeaks?: boolean
  activeSessionOnly?: boolean
  registerSkill?: boolean
  recallEnabled?: boolean
  recallIntervalMinMinutes?: number
  recallIntervalMaxMinutes?: number
  recallMaxPerSession?: number
}

/** Schemastery schema for {@link MemorySettings}. */
export const SettingsSchema: import('@deepseek-ai/schemastery').default<MemorySettings>

/** JSON config store: base + user layer, atomic persist, in-process watch. */
export class MemoryConfigStore {
  constructor(options?: { path?: string; base?: MemorySettings })
  readonly path: string
  get(): MemorySettings
  update(patch: Partial<MemorySettings>): MemorySettings
  watch(callback: (config: MemorySettings) => void): () => void
}

/** Default config-file path (`<dshHome>/memory.json`). */
export function defaultConfigPath(): string

/** Expand `~` and resolve `dir` to an absolute path. */
export function resolveMemoryDir(dir: string): string

/** Callable Cordis plugin entry plus metadata consumed by the DSH loader. */
export interface MemoryPlugin {
  (ctx: Context, config?: MemoryConfig): () => void
  readonly name: 'memory'
  readonly inject: ['systemPrompt', 'skills', 'agents']
  readonly Config: import('@deepseek-ai/schemastery').default<MemoryConfig>
}

/** Cordis plugin entry. Returns the effect disposer. */
export function apply(ctx: Context, config?: MemoryConfig): () => void

declare const plugin: MemoryPlugin

export default plugin

/** Render the boot memory block injected at session start. */
export function renderBootBlock(
  memoryDir: string,
  options?: {
    bootFiles?: string[]
    bootMaxChars?: number
    bootFileBudgets?: Record<string, number>
  },
): string

/** Files injected at session start when the config does not override them. */
export const DEFAULT_BOOT_FILES: string[]

/**
 * Split the boot budget across the injected files: explicit per-file caps
 * first, then `index.md`'s share, then an even split, each clamped to the
 * file's real size.
 */
export function allocateBootBudget(
  memoryDir: string,
  options?: {
    files?: string[]
    total?: number
    perFile?: Record<string, number>
  },
): Map<string, number>

/** Walk a store and return every page path relative to its root. */
export function listPagePaths(memoryDir: string, dirs?: string[]): string[]

/** Extract the real, store-relative pages a rendered boot block refers to. */
export function extractReferencedPages(text: string, memoryDir: string, dirs?: string[]): string[]

/** Stamp `last_access` (`YYYY-MM-DD`, today by default) on the given pages. */
export function touchPages(
  memoryDir: string,
  paths: string[],
  options?: { date?: string; dirs?: string[] },
): string[]

/** Rewrite one page's `last_access` when it differs. Returns true when written. */
export function touchPageFile(filePath: string, date?: string): boolean

/** Today as `YYYY-MM-DD` (local time). */
export function today(): string

/** Store-wide `last_access` summary used by `dsh-memory status`. */
export function accessSummary(
  memoryDir: string,
  options?: { staleDays?: number; now?: Date },
): { total: number; missing: number; stale: string[]; oldest?: { path: string; lastAccess: string } }

/** Create the memory-store layout if missing. Returns created paths. */
export function ensureMemoryScaffold(memoryDir: string): string[]

/**
 * Per-agent activity tracker behind the two polite-injection gates
 * (`deferUntilUserSpeaks` + `activeSessionOnly`).
 */
export class ActivityTracker {
  constructor(options?: { agents?: unknown; logger?: unknown })
  attach(agent: unknown): void
  noteUserMessage(id: string): void
  detach(id: string): void
  hasUserSpoken(id: string): boolean
  isActive(id: string): boolean
  shouldInject(id: string, config?: { deferUntilUserSpeaks?: boolean; activeSessionOnly?: boolean }): boolean
  dispose(): void
}
