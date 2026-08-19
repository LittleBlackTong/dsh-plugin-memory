import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memorySkillContent, MEMORY_SKILL_NAME, MEMORY_SKILL_DESCRIPTION, MEMORY_SKILL_WHEN_TO_USE } from '../lib/skill.js'

test('memory skill ships its protocol body', () => {
  const content = memorySkillContent()
  assert.ok(content.length > 500, 'instruction body must be non-trivial')
  // The four operations are the heart of the protocol.
  assert.match(content, /remember|记/)
  assert.match(content, /recall|忆/)
  assert.match(content, /consolidate|整理/)
  assert.match(content, /forget|忘/)
  // Digest is a hard duty, not optional.
  assert.match(content, /digest/)
})

test('memory skill explains soul bootstrap and the boot-directive trigger', () => {
  const content = memorySkillContent()
  // Fresh store → the boot block carries the first-person directive, so the
  // agent opens the soul-definition conversation on its own (OpenClaw-init
  // style). The skill must tell it to follow that directive.
  assert.match(content, /铸魂阶段/)
  assert.match(content, /引导词/)
  assert.match(content, /主动发起铸魂/)
  // Fallback path: no directive but BOOTSTRAP not complete → still the top task.
  assert.match(content, /BOOTSTRAP\.md/)
  assert.match(content, /首要任务/)
})

test('skill metadata stays consistent', () => {
  assert.equal(MEMORY_SKILL_NAME, 'memory')
  assert.match(MEMORY_SKILL_DESCRIPTION, /digest/)
  assert.match(MEMORY_SKILL_WHEN_TO_USE, /会话开始/)
})
