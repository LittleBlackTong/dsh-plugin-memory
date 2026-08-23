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
  recallEnabled: z.boolean().default(true),
  recallIntervalMinMinutes: z.number().default(30),
  recallIntervalMaxMinutes: z.number().default(240),
  recallMaxPerSession: z.number().default(3),
})
