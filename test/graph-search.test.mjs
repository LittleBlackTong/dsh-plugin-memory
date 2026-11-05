import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GRAPH_SEARCH_LIMIT, focusAngles, matchGraphNodes } from '../lib/graph-search.js'
import { rotatePoint } from '../lib/graph-3d.js'

const nodes = [
  { id: 'projects/active/dsh-plugin-memory.md', label: 'dsh-plugin-memory 插件项目', type: 'project', tags: ['project'], x: 0, y: 0, z: 0 },
  { id: 'skills/dsh-plugin-development.md', label: 'DSH 插件开发要点', type: 'skill', tags: ['dsh', 'plugin'], x: 0, y: 0, z: 0 },
  { id: 'user/preferences.md', label: '阿周的偏好与工作风格', type: 'user', tags: ['user'], x: 0, y: 0, z: 0 },
  { id: 'index.md', label: 'Memory Index', type: 'meta', tags: ['index'], x: 0, y: 0, z: 0 },
]

test('matchGraphNodes: empty query returns no suggestions', () => {
  assert.deepEqual(matchGraphNodes(nodes, ''), [])
  assert.deepEqual(matchGraphNodes(nodes, '   '), [])
})

test('matchGraphNodes ranks label matches above id/type/tag matches', () => {
  const byLabel = matchGraphNodes(nodes, 'DSH 插件')
  assert.equal(byLabel[0].id, 'skills/dsh-plugin-development.md')
  const byId = matchGraphNodes(nodes, 'dsh-plugin-memory')
  assert.equal(byId[0].id, 'projects/active/dsh-plugin-memory.md')
  const byType = matchGraphNodes(nodes, 'skill')
  assert.equal(byType[0].id, 'skills/dsh-plugin-development.md', 'type match still finds the node')
})

test('matchGraphNodes: case-insensitive and matches tags', () => {
  assert.equal(matchGraphNodes(nodes, 'MEMORY INDEX')[0].id, 'index.md')
  assert.equal(matchGraphNodes(nodes, 'index')[0].id, 'index.md')
  assert.ok(matchGraphNodes(nodes, 'dsh').some((node) => node.id === 'skills/dsh-plugin-development.md'))
})

test('matchGraphNodes: respects the suggestion limit', () => {
  assert.equal(matchGraphNodes(nodes, 'dsh', { limit: 1 }).length, 1)
  assert.equal(matchGraphNodes(nodes, 'dsh', { limit: 2 }).length, 2)
  assert.ok(GRAPH_SEARCH_LIMIT >= 5)
})

test('focusAngles projects the node onto the canvas centre', () => {
  const point = { id: 'p', x: 120, y: -80, z: -200 }
  const { yaw, pitch } = focusAngles(point)
  const rotated = rotatePoint(point, yaw, pitch)
  assert.ok(Math.abs(rotated.x) < 1e-9, `rotated.x=${rotated.x}`)
  assert.ok(Math.abs(rotated.y) < 1e-9, `rotated.y=${rotated.y}`)
})

test('focusAngles handles the poles and the origin without NaN', () => {
  for (const point of [{ x: 250, y: 0, z: 0 }, { x: 0, y: 250, z: 0 }, { x: 0, y: 0, z: 250 }, { x: 0, y: 0, z: 0 }]) {
    const { yaw, pitch } = focusAngles(point)
    assert.ok(Number.isFinite(yaw) && Number.isFinite(pitch))
  }
})
