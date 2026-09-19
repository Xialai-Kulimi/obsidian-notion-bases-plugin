import { describe, expect, it } from 'vitest'
import {
	applyMove, applyMoveToEnd, buildDateValue, computeMoveDelta, nextSelection, parseDateValue,
	pruneSelection, resolveDraft, sanitizeTitle, shiftDateValue, snapMinutes, stripTime,
	targetDateValue, yToMinutes,
	type DropTarget,
} from '../src/calendar-utils'

describe('parseDateValue', () => {
	it('parses date-only values with a 0-based month', () => {
		expect(parseDateValue('2026-09-21')).toEqual({ year: 2026, month: 8, day: 21 })
	})
	it('parses date-time values', () => {
		expect(parseDateValue('2026-09-21T14:05')).toEqual({ year: 2026, month: 8, day: 21, hour: 14, minute: 5 })
	})
	it('returns null for anything else', () => {
		for (const v of ['', 'abc', '2026-09', null, undefined, 42]) expect(parseDateValue(v)).toBeNull()
	})
})

describe('buildDateValue / stripTime', () => {
	it('builds date-only and date-time strings', () => {
		expect(buildDateValue(2026, 8, 5, null)).toBe('2026-09-05')
		expect(buildDateValue(2026, 8, 5, 845)).toBe('2026-09-05T14:05')
		expect(buildDateValue(2026, 8, 5, 0)).toBe('2026-09-05T00:00')
	})
	it('strips the time part', () => {
		expect(stripTime('2026-09-21T10:00')).toBe('2026-09-21')
		expect(stripTime('2026-09-21')).toBe('2026-09-21')
	})
})

describe('snapMinutes', () => {
	it('floors to the 15 minute grid by default', () => {
		expect(snapMinutes(0)).toBe(0)
		expect(snapMinutes(14)).toBe(0)
		expect(snapMinutes(15)).toBe(15)
		expect(snapMinutes(44)).toBe(30)
		expect(snapMinutes(1439)).toBe(1425)
	})
	it('supports a custom step', () => {
		expect(snapMinutes(44, 30)).toBe(30)
	})
})

describe('yToMinutes', () => {
	it('maps the column height onto 24 hours', () => {
		expect(yToMinutes(0, 1152)).toBe(0)
		expect(yToMinutes(576, 1152)).toBe(720)
		expect(yToMinutes(696, 1152)).toBe(870)
	})
	it('clamps to the day', () => {
		expect(yToMinutes(-10, 1152)).toBe(0)
		expect(yToMinutes(1152, 1152)).toBe(1439)
		expect(yToMinutes(5000, 1152)).toBe(1439)
	})
	it('returns 0 for a zero-height column', () => {
		expect(yToMinutes(10, 0)).toBe(0)
	})
})

describe('shiftDateValue', () => {
	it('shifts date-only values by days and ignores minutes', () => {
		expect(shiftDateValue('2026-09-21', 2, 0)).toBe('2026-09-23')
		expect(shiftDateValue('2026-09-21', 0, 90)).toBe('2026-09-21')
		expect(shiftDateValue('2026-09-30', 1, 0)).toBe('2026-10-01')
	})
	it('shifts date-time values by minutes, rolling over midnight', () => {
		expect(shiftDateValue('2026-09-21T14:00', 0, 90)).toBe('2026-09-21T15:30')
		expect(shiftDateValue('2026-09-21T23:30', 0, 60)).toBe('2026-09-22T00:30')
		expect(shiftDateValue('2026-09-21T00:15', 0, -30)).toBe('2026-09-20T23:45')
		expect(shiftDateValue('2026-09-21T14:00', 3, 0)).toBe('2026-09-24T14:00')
	})
	it('keeps the original time text when only days change', () => {
		expect(shiftDateValue('2026-09-21T14:00:30', 1, 0)).toBe('2026-09-22T14:00:30')
	})
	it('returns unparsable values unchanged', () => {
		expect(shiftDateValue('soon', 1, 30)).toBe('soon')
	})
})

const timeTarget: DropTarget = { kind: 'time', year: 2026, month: 8, day: 23, minutes: 840 }
const monthTarget: DropTarget = { kind: 'month-day', year: 2026, month: 8, day: 25 }
const allDayTarget: DropTarget = { kind: 'all-day', year: 2026, month: 8, day: 25 }

describe('computeMoveDelta', () => {
	it('computes day and minute deltas from a timed anchor', () => {
		expect(computeMoveDelta('2026-09-21T10:00', timeTarget)).toEqual({ days: 2, minutes: 240 })
	})
	it('ignores minutes for month and all-day targets', () => {
		expect(computeMoveDelta('2026-09-21T10:00', monthTarget)).toEqual({ days: 4, minutes: 0 })
		expect(computeMoveDelta('2026-09-21T10:00', allDayTarget)).toEqual({ days: 4, minutes: 0 })
	})
	it('has no minute delta for a date-only anchor', () => {
		expect(computeMoveDelta('2026-09-21', timeTarget)).toEqual({ days: 2, minutes: 0 })
	})
	it('counts days across a month boundary', () => {
		expect(computeMoveDelta('2026-10-31', { kind: 'month-day', year: 2026, month: 10, day: 2 })).toEqual({ days: 2, minutes: 0 })
	})
	it('returns a zero delta for an undated anchor', () => {
		expect(computeMoveDelta(undefined, timeTarget)).toEqual({ days: 0, minutes: 0 })
		expect(computeMoveDelta('', timeTarget)).toEqual({ days: 0, minutes: 0 })
	})
})

describe('targetDateValue', () => {
	it('is date-only for month/all-day and date-time for time targets', () => {
		expect(targetDateValue(monthTarget)).toBe('2026-09-25')
		expect(targetDateValue(allDayTarget)).toBe('2026-09-25')
		expect(targetDateValue(timeTarget)).toBe('2026-09-23T14:00')
	})
})

describe('applyMove', () => {
	it('moves a timed anchor to the dropped time', () => {
		const delta = { days: 2, minutes: 240 }
		expect(applyMove('2026-09-21T10:00', delta, timeTarget, true)).toBe('2026-09-23T14:00')
	})
	it('shifts other selected timed cards by the same delta', () => {
		expect(applyMove('2026-09-22T09:30', { days: 2, minutes: 240 }, timeTarget, false)).toBe('2026-09-24T13:30')
	})
	it('shifts other selected date-only cards by days only', () => {
		expect(applyMove('2026-09-22', { days: 2, minutes: 240 }, timeTarget, false)).toBe('2026-09-24')
	})
	it('gives a date-only anchor the dropped time', () => {
		expect(applyMove('2026-09-21', { days: 2, minutes: 0 }, timeTarget, true)).toBe('2026-09-23T14:00')
	})
	it('keeps the time when dropped on a month day', () => {
		expect(applyMove('2026-09-21T10:00', { days: 4, minutes: 0 }, monthTarget, true)).toBe('2026-09-25T10:00')
	})
	it('drops the time when dropped on the all-day row', () => {
		expect(applyMove('2026-09-21T10:00', { days: 4, minutes: 0 }, allDayTarget, true)).toBe('2026-09-25')
	})
	it('assigns the target when the card had no valid date', () => {
		expect(applyMove('', { days: 0, minutes: 0 }, timeTarget, true)).toBe('2026-09-23T14:00')
		expect(applyMove(undefined, { days: 0, minutes: 0 }, monthTarget, true)).toBe('2026-09-25')
	})
})

describe('applyMoveToEnd', () => {
	it('shifts the end by days and minutes for time targets', () => {
		expect(applyMoveToEnd('2026-09-21T11:00', { days: 2, minutes: 240 }, timeTarget)).toBe('2026-09-23T15:00')
	})
	it('shifts the end by days only for the all-day row', () => {
		expect(applyMoveToEnd('2026-09-21T11:00', { days: 4, minutes: 0 }, allDayTarget)).toBe('2026-09-25T11:00')
	})
})

describe('selection helpers', () => {
	it('replaces the selection on a plain click', () => {
		expect([...nextSelection(new Set(['a', 'b']), 'c', false)]).toEqual(['c'])
	})
	it('toggles membership on an additive click without mutating the input', () => {
		const current = new Set(['a'])
		expect([...nextSelection(current, 'b', true)].sort()).toEqual(['a', 'b'])
		expect([...nextSelection(current, 'a', true)]).toEqual([])
		expect([...current]).toEqual(['a'])
	})
	it('prunes paths that are no longer visible', () => {
		expect([...pruneSelection(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))].sort()).toEqual(['b', 'c'])
	})
})

describe('resolveDraft', () => {
	it('cancels when the text is empty or whitespace, whatever the trigger', () => {
		expect(resolveDraft('', true, 'enter')).toBe('cancel')
		expect(resolveDraft('   ', true, 'blur')).toBe('cancel')
		expect(resolveDraft('', false, 'enter')).toBe('cancel')
	})
	it('commits on blur only when the user typed something', () => {
		expect(resolveDraft('Meeting', true, 'blur')).toBe('commit')
		expect(resolveDraft('Untitled', false, 'blur')).toBe('cancel')
	})
	it('commits on Enter, even for the untouched default', () => {
		expect(resolveDraft('Untitled', false, 'enter')).toBe('commit')
		expect(resolveDraft('Meeting', true, 'enter')).toBe('commit')
	})
})

describe('sanitizeTitle', () => {
	it('replaces characters Obsidian does not allow in file names', () => {
		expect(sanitizeTitle('Meeting: Q3/Q4 review?', 'Untitled')).toBe('Meeting Q3 Q4 review')
		expect(sanitizeTitle('[[x]] #tag ^b', 'Untitled')).toBe('x tag b')
	})
	it('trims, collapses whitespace and strips leading dots', () => {
		expect(sanitizeTitle('  a   b  ', 'Untitled')).toBe('a b')
		expect(sanitizeTitle('...hidden', 'Untitled')).toBe('hidden')
	})
	it('falls back when nothing is left', () => {
		expect(sanitizeTitle('   ', 'Untitled')).toBe('Untitled')
		expect(sanitizeTitle('///', 'Untitled')).toBe('Untitled')
	})
	it('keeps CJK text', () => {
		expect(sanitizeTitle('會議', 'Untitled')).toBe('會議')
	})
})
