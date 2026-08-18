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
export const inject: ['systemPrompt', 'skills']

/** User-facing plugin configuration (all fields optional). */
export interface MemoryConfig {
  /** Absolute memory-store path; `~` is expanded. Default `'~/.memory'`. */
  memoryDir?: string
  /** Files injected at session start. Default `['SOUL.md', 'MEMORY.md', 'index.md']`. */
  bootFiles?: string[]
  /** Total character budget of the boot block. Default `6000`. */
  bootMaxChars?: number
  /** Inject the boot block at session start. Default `true`. */
  autoInject?: boolean
  /** Register the embedded `memory` skill. Default `true`. */
  registerSkill?: boolean
  /** Create the store layout and templates when missing. Default `true`. */
  scaffold?: boolean
}

/** Schemastery schema for {@link MemoryConfig}. */
export const Config: import('@deepseek-ai/schemastery').default<MemoryConfig>

/** Expand `~` and resolve `dir` to an absolute path. */
export function resolveMemoryDir(dir: string): string

/** Callable Cordis plugin entry plus metadata consumed by the DSH loader. */
export interface MemoryPlugin {
  (ctx: Context, config?: MemoryConfig): () => void
  readonly name: 'memory'
  readonly inject: ['systemPrompt', 'skills']
  readonly Config: import('@deepseek-ai/schemastery').default<MemoryConfig>
}

/** Cordis plugin entry. Returns the effect disposer. */
export function apply(ctx: Context, config?: MemoryConfig): () => void

declare const plugin: MemoryPlugin

export default plugin

/** Render the boot memory block injected at session start. */
export function renderBootBlock(
  memoryDir: string,
  options?: { bootFiles?: string[]; bootMaxChars?: number },
): string

/** Create the memory-store layout if missing. Returns created paths. */
export function ensureMemoryScaffold(memoryDir: string): string[]
