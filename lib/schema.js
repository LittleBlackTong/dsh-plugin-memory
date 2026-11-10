/**
 * Shared schemas for dsh-plugin-memory.
 *
 * Split out so the config store can validate without importing the plugin
 * entry (which imports the store).
 *
 * @module dsh-plugin-memory/schema
 */

import z from '@deepseek-ai/schemastery'

/** The user-facing settings schema: composition config is the base layer. */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default('~/.memory'),
  autoInject: z.boolean().default(true),
  registerSkill: z.boolean().default(true),
  // Gate 1: don't inject anything until the session's first real user message.
  deferUntilUserSpeaks: z.boolean().default(true),
  // Gate 2: only the currently active session (most recent user message) injects.
  activeSessionOnly: z.boolean().default(true),
  recallEnabled: z.boolean().default(true),
  recallIntervalMinMinutes: z.number().default(30),
  recallIntervalMaxMinutes: z.number().default(240),
  recallMaxPerSession: z.number().default(3),
  // 0.12.0: shared proactive-speech arbitration with dsh-plugin-heartbeat.
  // 180s default; 0 turns arbitration off (each plugin speaks freely).
  proactiveCooldownSeconds: z.number().default(180),
  // 0.12.0: tone drift — how to shift register by context. The intensity
  // select is the only knob; `off` ships a pure engineering voice.
  toneGuideEnabled: z.boolean().default(true),
  toneIntensity: z.union([z.const('low'), z.const('medium'), z.const('off')]).default('low'),
  // 0.12.0: weekly growth recap delivered on the recall channel.
  growthRecapEnabled: z.boolean().default(true),
  growthRecapIntervalDays: z.number().default(7),
  // Workspaces that default to memory off (session gate layer 3). A session
  // inside one of these roots starts muted until the user turns it back on.
  disabledWorkspaces: z.array(z.string()).default([]),
  // 0.18.0: freeze the boot block for the whole session so mid-session writes
  // do not invalidate the prompt-prefix cache (issue #8). `live` keeps the
  // 0.17 behaviour of re-reading the store on every turn.
  bootSnapshot: z.union([z.const('live'), z.const('session')]).default('live'),
})
