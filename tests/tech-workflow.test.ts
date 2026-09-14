import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAssignmentAction, assignmentElapsedMinutes } from '../lib/techWorkflow'

test('start/pause/complete timer transitions', () => {
  const base = {
    id: 'AS-1',
    status: 'Assigned',
    accumulatedMinutes: 0,
    timerStartedAt: null
  }
  const started = applyAssignmentAction(base, 'start', Date.parse('2026-09-14T10:00:00Z'))
  assert.equal(started.status, 'In progress')
  assert.ok(started.timerStartedAt)

  const paused = applyAssignmentAction(
    { ...started, accumulatedMinutes: 0 },
    'pause',
    Date.parse('2026-09-14T10:30:00Z')
  )
  assert.equal(paused.status, 'Paused')
  assert.equal(paused.timerStartedAt, null)
  assert.equal(Math.round(Number(paused.accumulatedMinutes)), 30)

  const done = applyAssignmentAction(paused, 'complete', Date.parse('2026-09-14T11:00:00Z'))
  assert.equal(done.status, 'Completed')
  assert.ok('completedAt' in done && done.completedAt)
})

test('elapsed minutes includes running timer', () => {
  const mins = assignmentElapsedMinutes(
    {
      id: 'AS-2',
      status: 'In progress',
      accumulatedMinutes: 10,
      timerStartedAt: '2026-09-14T10:00:00.000Z'
    },
    Date.parse('2026-09-14T10:20:00.000Z')
  )
  assert.equal(Math.round(mins), 30)
})
