# Calendar Interaction Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traditional-Chinese UI, plus a calendar that creates notes through an inline title box, supports click-to-select / double-click-to-open / Cmd-Ctrl multi-select / Delete-key deletion, creates notes at a clicked time slot in the week view, and drags cards to a new day *and time*.

**Architecture:** Keep everything in `DatabaseCalendar.tsx`, but move all pure logic (date math, snapping, move planning, selection, draft resolution, title sanitising) into a new `src/calendar-utils.ts` that is unit-tested with vitest. Add a small `useCalendarSelection` hook and an `InlineCreateInput` component. `DatabaseManager.createNote*` gains an optional `title`, and the start/end dates are written as part of the note's initial frontmatter.

**Tech Stack:** TypeScript, React 18 (esbuild `jsx: automatic`), Obsidian API, vitest. Tabs for indentation.

**Spec:** [docs/superpowers/specs/2026-09-19-calendar-interaction-requirements.md](../specs/2026-09-19-calendar-interaction-requirements.md)

## Global Constraints

- Indentation is **tabs**, no semicolons, single quotes (match the surrounding code).
- `manifest.json` `minAppVersion` is `1.8.7` and `isDesktopOnly` is `false` — **mobile behaviour must not change**: tap opens a card, long-press on a day opens the action sheet, no selection / delete / drag on mobile.
- Use `activeDocument` / `activeWindow` rather than `document` / `window` timers where existing code does (lint config declares them). Do not disable ESLint rules that are not configured.
- Month is **0-based** everywhere in code (`new Date(y, month, d)`), matching the existing `parseDateValue`.
- Date values are stored as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`; time snapping is **15 minutes**, click position rounds **down**.
- Delete goes through `DatabaseManager.deleteNotes()` (`trashFile`), **no confirmation dialog**.
- New user-facing strings (none are expected) must be added to both `en.ts` and `zh-TW.ts`.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Do **not** push.
- **Verification scope (user decision):** unit tests for `calendar-utils` and the locale, `tsc`/build, lint, then deploy. No manual functional test pass is required.

## File Structure

| File | Responsibility |
|---|---|
| `src/calendar-utils.ts` (new) | Pure functions: date parse/build/shift, snapping, Y→minutes, drop-move planning, selection sets, inline-draft outcome, title sanitising |
| `tests/calendar-utils.test.ts` (new) | Unit tests for the above |
| `src/hooks/useCalendarSelection.ts` (new) | React state wrapper around `nextSelection` / `pruneSelection` |
| `src/components/InlineCreateInput.tsx` (new) | The inline title `<input>`: focus/select, IME-safe Enter, Esc, blur rules |
| `src/components/DatabaseCalendar.tsx` (modify) | Wire selection, delete, inline create, time-slot create, drag-to-time |
| `src/database-manager.ts` (modify) | `createNote` / `createNoteWithTemplate` accept `title` |
| `src/i18n/locales/zh-TW.ts` (new), `src/i18n/index.ts` (modify) | Traditional Chinese locale |
| `tests/i18n-zh-tw.test.ts` (new) | Same keys as `zh`, no simplified-only characters |
| `styles.css` (modify) | `.nb-cal-card--selected`, `.nb-cal-root`, `.nb-cal-inline-input` |

---

### Task 1: Pure calendar logic (`calendar-utils.ts`)

**Files:**
- Create: `src/calendar-utils.ts`
- Test: `tests/calendar-utils.test.ts`

**Interfaces:**
- Produces (all exported from `src/calendar-utils.ts`; later tasks import these exact names):
  - `interface ParsedDate { year: number; month: number; day: number; hour?: number; minute?: number }`
  - `parseDateValue(val: unknown): ParsedDate | null`
  - `buildDateValue(year: number, month: number, day: number, minutes: number | null): string`
  - `stripTime(value: string): string`
  - `snapMinutes(minutes: number, step?: number): number` (floor, default step 15)
  - `yToMinutes(offsetY: number, columnHeight: number): number` (0–1439)
  - `shiftDateValue(value: string, deltaDays: number, deltaMinutes: number): string`
  - `type DropTarget = { kind: 'month-day'; year; month; day } | { kind: 'all-day'; year; month; day } | { kind: 'time'; year; month; day; minutes }`
  - `interface MoveDelta { days: number; minutes: number }`
  - `computeMoveDelta(anchorValue: unknown, target: DropTarget): MoveDelta`
  - `targetDateValue(target: DropTarget): string`
  - `applyMove(value: unknown, delta: MoveDelta, target: DropTarget, isAnchor: boolean): string`
  - `applyMoveToEnd(value: string, delta: MoveDelta, target: DropTarget): string`
  - `nextSelection(current: ReadonlySet<string>, path: string, additive: boolean): Set<string>`
  - `pruneSelection(current: ReadonlySet<string>, visible: ReadonlySet<string>): Set<string>`
  - `resolveDraft(value: string, dirty: boolean, trigger: 'enter' | 'blur'): 'commit' | 'cancel'`
  - `sanitizeTitle(raw: string, fallback: string): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/calendar-utils.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/calendar-utils.test.ts`
Expected: FAIL — cannot resolve `../src/calendar-utils`.

- [ ] **Step 3: Implement `src/calendar-utils.ts`**

```ts
/**
 * Pure helpers for the calendar view: date-value math, time snapping, drag-move
 * planning, selection sets and inline-create rules. No Obsidian or React imports
 * so everything here is unit-testable.
 */

export interface ParsedDate {
	year: number
	month: number // 0-based
	day: number
	hour?: number
	minute?: number
}

export function parseDateValue(val: unknown): ParsedDate | null {
	if (!val || typeof val !== 'string') return null
	const tIdx = val.indexOf('T')
	const datePart = tIdx >= 0 ? val.slice(0, tIdx) : val
	const parts = datePart.split('-')
	if (parts.length !== 3) return null
	const year = parseInt(parts[0])
	const month = parseInt(parts[1]) - 1
	const day = parseInt(parts[2])
	if (isNaN(year) || isNaN(month) || isNaN(day)) return null
	if (tIdx >= 0) {
		const tp = val.slice(tIdx + 1).split(':')
		if (tp.length >= 2) {
			const hour = parseInt(tp[0])
			const minute = parseInt(tp[1])
			if (!isNaN(hour) && !isNaN(minute)) return { year, month, day, hour, minute }
		}
	}
	return { year, month, day }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `minutes` (from midnight) is given. */
export function buildDateValue(year: number, month: number, day: number, minutes: number | null): string {
	const date = `${year}-${pad(month + 1)}-${pad(day)}`
	if (minutes === null) return date
	return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function stripTime(value: string): string {
	const i = value.indexOf('T')
	return i >= 0 ? value.slice(0, i) : value
}

export function snapMinutes(minutes: number, step = 15): number {
	return Math.floor(minutes / step) * step
}

/** Converts a Y offset inside a 24h column into minutes from midnight (0–1439). */
export function yToMinutes(offsetY: number, columnHeight: number): number {
	if (columnHeight <= 0) return 0
	const raw = (offsetY * 1440) / columnHeight
	return Math.min(1439, Math.max(0, Math.floor(raw)))
}

/**
 * Shifts a date value. Date-only values only move by days. Date-time values
 * also move by minutes (rolling over midnight); when the minute delta is 0 the
 * original time text (including seconds) is kept verbatim.
 */
export function shiftDateValue(value: string, deltaDays: number, deltaMinutes: number): string {
	const p = parseDateValue(value)
	if (!p) return value
	if (p.hour === undefined || p.minute === undefined) {
		const d = new Date(p.year, p.month, p.day + deltaDays)
		return buildDateValue(d.getFullYear(), d.getMonth(), d.getDate(), null)
	}
	if (deltaMinutes === 0) {
		const d = new Date(p.year, p.month, p.day + deltaDays)
		const timePart = value.slice(value.indexOf('T') + 1)
		return `${buildDateValue(d.getFullYear(), d.getMonth(), d.getDate(), null)}T${timePart}`
	}
	const d = new Date(p.year, p.month, p.day + deltaDays, p.hour, p.minute + deltaMinutes)
	return buildDateValue(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() * 60 + d.getMinutes())
}

// ── Drag-move planning ──────────────────────────────────────────────────────

export type DropTarget =
	| { kind: 'month-day'; year: number; month: number; day: number }
	| { kind: 'all-day'; year: number; month: number; day: number }
	| { kind: 'time'; year: number; month: number; day: number; minutes: number }

export interface MoveDelta {
	days: number
	minutes: number
}

/** Delta between the dragged ("anchor") card's current start and the drop target. */
export function computeMoveDelta(anchorValue: unknown, target: DropTarget): MoveDelta {
	const p = parseDateValue(anchorValue)
	if (!p) return { days: 0, minutes: 0 }
	const days = Math.round((Date.UTC(target.year, target.month, target.day) - Date.UTC(p.year, p.month, p.day)) / 86400000)
	const minutes = target.kind === 'time' && p.hour !== undefined && p.minute !== undefined
		? target.minutes - (p.hour * 60 + p.minute)
		: 0
	return { days, minutes }
}

export function targetDateValue(target: DropTarget): string {
	return buildDateValue(target.year, target.month, target.day, target.kind === 'time' ? target.minutes : null)
}

/** New start value for one card in the dragged group. */
export function applyMove(value: unknown, delta: MoveDelta, target: DropTarget, isAnchor: boolean): string {
	const p = parseDateValue(value)
	if (typeof value !== 'string' || !p) return targetDateValue(target)
	if (target.kind === 'all-day') return stripTime(shiftDateValue(value, delta.days, 0))
	if (target.kind === 'time' && isAnchor && p.hour === undefined) return targetDateValue(target)
	return shiftDateValue(value, delta.days, delta.minutes)
}

/** New end value for one card in the dragged group. */
export function applyMoveToEnd(value: string, delta: MoveDelta, target: DropTarget): string {
	return shiftDateValue(value, delta.days, target.kind === 'all-day' ? 0 : delta.minutes)
}

// ── Selection ───────────────────────────────────────────────────────────────

export function nextSelection(current: ReadonlySet<string>, path: string, additive: boolean): Set<string> {
	if (!additive) return new Set([path])
	const next = new Set(current)
	if (next.has(path)) next.delete(path)
	else next.add(path)
	return next
}

export function pruneSelection(current: ReadonlySet<string>, visible: ReadonlySet<string>): Set<string> {
	const next = new Set<string>()
	for (const path of current) if (visible.has(path)) next.add(path)
	return next
}

// ── Inline create ───────────────────────────────────────────────────────────

/**
 * Enter creates whatever is in the box (even the untouched default). Blur only
 * creates when the user actually typed. An empty box never creates.
 */
export function resolveDraft(value: string, dirty: boolean, trigger: 'enter' | 'blur'): 'commit' | 'cancel' {
	if (value.trim() === '') return 'cancel'
	if (trigger === 'blur' && !dirty) return 'cancel'
	return 'commit'
}

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g

export function sanitizeTitle(raw: string, fallback: string): string {
	const cleaned = raw
		.replace(ILLEGAL_FILENAME_CHARS, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
	return cleaned || fallback
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/calendar-utils.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/calendar-utils.ts tests/calendar-utils.test.ts
git commit -m "feat: add pure calendar helpers for time snapping, moves and selection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `createNote` accepts a title

**Files:**
- Modify: `src/database-manager.ts` (imports; `createNote` ~line 345; `createNoteWithTemplate` ~line 372)

**Interfaces:**
- Consumes: `sanitizeTitle(raw: string, fallback: string): string` from Task 1.
- Produces:
  - `createNote(dbFile: TFile, initialFrontmatter?: Record<string, unknown>, templatePath?: string | null, title?: string): Promise<TFile>`
  - `createNoteWithTemplate(dbFile: TFile, initialFrontmatter?: Record<string, unknown>, title?: string): Promise<TFile>`
  - Existing callers (`DatabaseBoard`, `DatabaseTable`, `DatabaseList`, `DatabaseGallery`, `quick-add-modal`) pass 1–2 args and keep working.

- [ ] **Step 1: Import `sanitizeTitle`**

Add to the imports at the top of `src/database-manager.ts`:

```ts
import { sanitizeTitle } from './calendar-utils'
```

- [ ] **Step 2: Add the `title` parameter to `createNote`**

Replace the signature and the first lines of the body:

```ts
	async createNote(
		dbFile: TFile,
		initialFrontmatter?: Record<string, unknown>,
		templatePath?: string | null,
		title?: string,
	): Promise<TFile> {
		const folderPath = dbFile.parent?.path ?? ''
		const name = sanitizeTitle(title ?? '', t('db_untitled_note'))
		const base = normalizePath(`${folderPath}/${name}`)
		let path = `${base}.md`
		let i = 1
		while (this.app.vault.getFileByPath(path)) {
			path = `${base} ${i++}.md`
		}
```

(The rest of the method — `vault.create`, frontmatter, template — is unchanged.)

- [ ] **Step 3: Pass `title` through `createNoteWithTemplate`**

Replace the method with:

```ts
	async createNoteWithTemplate(dbFile: TFile, initialFrontmatter?: Record<string, unknown>, title?: string): Promise<TFile> {
		const config = this.readConfig(dbFile)
		if (config.askTemplateOnCreate) {
			const templatePath = await new Promise<string | null>(resolve => {
				new TemplatePickerModal(
					this.app,
					(path) => resolve(path),
					config.templatePath ? this.folderOf(config.templatePath) : null,
					config.templateFolder ?? null,
				).open()
			})
			return this.createNote(dbFile, initialFrontmatter, templatePath, title)
		}
		return this.createNote(dbFile, initialFrontmatter, config.templatePath ?? null, title)
	}
```

- [ ] **Step 4: Type-check and run the existing tests**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/database-manager.ts
git commit -m "feat: let createNote take a sanitised title

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Traditional Chinese locale (`zh-TW`)

**Files:**
- Create: `src/i18n/locales/zh-TW.ts`
- Modify: `src/i18n/index.ts`
- Test: `tests/i18n-zh-tw.test.ts`

**Interfaces:**
- Produces: default export `zhTW: Partial<Record<keyof typeof en, string>>`; `locales['zh-TW']` points to it. `locales.zh` stays the simplified file.

- [ ] **Step 1: Write the failing test**

Create `tests/i18n-zh-tw.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import zh from '../src/i18n/locales/zh'
import zhTW from '../src/i18n/locales/zh-TW'

describe('zh-TW locale', () => {
	it('defines exactly the same keys as the simplified zh locale', () => {
		expect(Object.keys(zhTW).sort()).toEqual(Object.keys(zh).sort())
	})

	it('contains no simplified-only characters', () => {
		const text = Object.values(zhTW).join('')
		for (const ch of '视图设删选库时线复显过滤画历标题导数据') {
			expect(text.includes(ch), `found simplified character ${ch}`).toBe(false)
		}
	})

	it('uses Taiwan terminology for the most common words', () => {
		const text = Object.values(zhTW).join('')
		expect(text.includes('字段')).toBe(false)
		expect(text.includes('倉庫')).toBe(false)
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/i18n-zh-tw.test.ts`
Expected: FAIL — cannot resolve `../src/i18n/locales/zh-TW`.

- [ ] **Step 3: Generate `zh-TW.ts` from `zh.ts` with OpenCC (Taiwan phrases)**

```bash
python3 -m venv "$TMPDIR/opencc-venv"
"$TMPDIR/opencc-venv/bin/pip" install opencc-python-reimplemented
"$TMPDIR/opencc-venv/bin/python" - <<'EOF'
from opencc import OpenCC

cc = OpenCC('s2twp')
src = open('src/i18n/locales/zh.ts', encoding='utf-8').read()
out = cc.convert(src)
out = out.replace('const zh:', 'const zhTW:').replace('export default zh', 'export default zhTW')

# Vocabulary the converter does not map the way Obsidian / Notion zh-TW UIs do.
terms = {
    '字段': '欄位',
    '視圖': '檢視',
    '時間線': '時間軸',
    '添加': '新增',
    '倉庫': '保管庫',
    '粘貼': '貼上',
}
for a, b in terms.items():
    out = out.replace(a, b)

open('src/i18n/locales/zh-TW.ts', 'w', encoding='utf-8').write(out)
EOF
```

- [ ] **Step 4: Review the vocabulary by hand**

Run: `grep -nE "文件|默認|預設|設置|設定|搜索|搜尋|信息|資訊|複製|字串|列印|打開|開啟" src/i18n/locales/zh-TW.ts | head -60`

Read the hits and correct anything that reads as Mainland usage (e.g. `設置`→`設定`, `打開`→`開啟`, `默認`→`預設`, `搜索`→`搜尋`, `信息`→`資訊`). Keep `文件` only where it means "document", not "file"; use `檔案` for files. Edit `src/i18n/locales/zh-TW.ts` directly. Do not touch `zh.ts`.

- [ ] **Step 5: Register the locale**

In `src/i18n/index.ts` add the import and change the map:

```ts
import zhTW from './locales/zh-TW'
```

```ts
	zh,
	'zh-TW': zhTW,
```

(Replace the existing `'zh-TW': zh,` line.)

- [ ] **Step 6: Run the tests and type-check**

Run: `npx vitest run tests/i18n-zh-tw.test.ts && npx tsc -noEmit -skipLibCheck`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/locales/zh-TW.ts src/i18n/index.ts tests/i18n-zh-tw.test.ts
git commit -m "feat: add Traditional Chinese (zh-TW) locale

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Card selection, double-click open, Delete key (R4, R5, R6)

**Files:**
- Create: `src/hooks/useCalendarSelection.ts`
- Modify: `src/components/DatabaseCalendar.tsx`
- Modify: `styles.css` (append near the other `.nb-cal-card` rules, ~line 3660)

**Interfaces:**
- Consumes: `nextSelection`, `pruneSelection`, `parseDateValue` from Task 1.
- Produces:
  - `useCalendarSelection(visiblePaths: string[]): { selected: ReadonlySet<string>; select(path: string, additive: boolean): void; selectOnly(path: string): void; clear(): void }`
  - In `DatabaseCalendar`: `rowByPath: Map<string, NoteRow>` and `selection` (the hook result), used by Tasks 5 and 6.

- [ ] **Step 1: Create the hook**

`src/hooks/useCalendarSelection.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { nextSelection, pruneSelection } from '../calendar-utils'

/**
 * Tracks which calendar cards are selected (by file path). Selection is dropped
 * automatically for cards that stop being visible (navigation, view switch,
 * filters, deletion), so a Delete keypress can never hit an off-screen card.
 */
export function useCalendarSelection(visiblePaths: string[]) {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

	const select = useCallback((path: string, additive: boolean) => {
		setSelected(cur => nextSelection(cur, path, additive))
	}, [])
	const selectOnly = useCallback((path: string) => {
		setSelected(cur => (cur.size === 1 && cur.has(path) ? cur : new Set([path])))
	}, [])
	const clear = useCallback(() => {
		setSelected(cur => (cur.size === 0 ? cur : new Set()))
	}, [])

	const key = visiblePaths.join('\n')
	useEffect(() => {
		const visible = new Set(key === '' ? [] : key.split('\n'))
		setSelected(cur => {
			const next = pruneSelection(cur, visible)
			return next.size === cur.size ? cur : next
		})
	}, [key])

	return { selected, select, selectOnly, clear }
}
```

- [ ] **Step 2: Replace the local `parseDateValue` with the shared one**

In `src/components/DatabaseCalendar.tsx`:

1. Delete the local `function parseDateValue(val: unknown): {...} | null { ... }` (currently lines ~89–109).
2. Add to the imports:

```ts
import { parseDateValue } from '../calendar-utils'
import { useCalendarSelection } from '../hooks/useCalendarSelection'
```

- [ ] **Step 3: Add `rowByPath` and the selection hook**

Immediately after the `noDateRows` `useMemo` (before `earliestTimedMinute`), add:

```ts
	const rowByPath = useMemo(() => {
		const map = new Map<string, NoteRow>()
		for (const dayRows of rowsByDate.values()) for (const row of dayRows) map.set(row._file.path, row)
		for (const row of noDateRows) map.set(row._file.path, row)
		return map
	}, [rowsByDate, noDateRows])
	const visiblePaths = useMemo(() => Array.from(rowByPath.keys()), [rowByPath])
	const selection = useCalendarSelection(visiblePaths)
```

- [ ] **Step 4: Add the card handlers and the key handler**

After `closeMobileMenus` (which is after the two early returns), add:

```ts
	const cardClass = (row: NoteRow, base: string) =>
		`${base}${selection.selected.has(row._file.path) ? ' nb-cal-card--selected' : ''}`

	const openRow = (row: NoteRow) => { void app.workspace.getLeaf().openFile(row._file) }

	// Desktop: click selects (Cmd/Ctrl toggles), double-click opens. Mobile keeps tap-to-open.
	const handleCardClick = (e: React.MouseEvent, row: NoteRow) => {
		e.stopPropagation()
		if (isMobile) { openRow(row); return }
		selection.select(row._file.path, e.metaKey || e.ctrlKey)
	}
	const handleCardDoubleClick = (e: React.MouseEvent, row: NoteRow) => {
		e.stopPropagation()
		if (!isMobile) openRow(row)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (isMobile) return
		// Never treat text editing (inline title box, filter inputs) as a delete request.
		if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
		if (e.key === 'Escape') { selection.clear(); return }
		if ((e.key === 'Delete' || e.key === 'Backspace') && selection.selected.size > 0) {
			e.preventDefault()
			const files = Array.from(selection.selected)
				.map(path => rowByPath.get(path)?._file)
				.filter((f): f is TFile => f !== undefined)
			selection.clear()
			void trackSave(manager.deleteNotes(files))
		}
	}
```

- [ ] **Step 5: Make the container focusable and key-aware**

Replace `<div className="nb-container">` (the one wrapping `{toolbarContent}`) with:

```tsx
		<div className="nb-container nb-cal-root" tabIndex={-1} onKeyDown={handleKeyDown}>
```

- [ ] **Step 6: Wire the four card render sites**

For each card `<div>`, replace the `className` and `onClick` (keep `key`, `draggable`, `onDragStart` and the children as they are), and add `onDoubleClick`. Indentation follows the file.

1. All-day card (`nb-cal-card nb-cal-card--allday`):

```tsx
className={cardClass(row, 'nb-cal-card nb-cal-card--allday')}
onClick={e => handleCardClick(e, row)}
onDoubleClick={e => handleCardDoubleClick(e, row)}
```

2. Timed card:

```tsx
className={cardClass(row, `nb-cal-card nb-cal-card--timed${heightPct !== null ? ' nb-cal-card--spanning' : ''}`)}
onClick={e => handleCardClick(e, row)}
onDoubleClick={e => handleCardDoubleClick(e, row)}
```

3. Month card (`className="nb-cal-card"`, has `draggable={!isMobile}`):

```tsx
className={cardClass(row, 'nb-cal-card')}
onClick={e => handleCardClick(e, row)}
onDoubleClick={e => handleCardDoubleClick(e, row)}
```

4. No-date card:

```tsx
className={cardClass(row, 'nb-cal-card nb-cal-card--no-date')}
onClick={e => handleCardClick(e, row)}
onDoubleClick={e => handleCardDoubleClick(e, row)}
```

- [ ] **Step 7: Clicking empty space clears the selection**

At the top of `handleDayClick` (the function is replaced in Task 5; for now) insert as the first line:

```ts
		selection.clear()
```

- [ ] **Step 8: Add the styles**

Append after the `.nb-cal-card:hover` rule in `styles.css`:

```css
.nb-cal-root:focus {
	outline: none;
}

.nb-cal-card--selected {
	outline: 2px solid var(--text-normal);
	outline-offset: 1px;
	filter: brightness(1.1);
}
```

- [ ] **Step 9: Type-check, run tests**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useCalendarSelection.ts src/components/DatabaseCalendar.tsx styles.css
git commit -m "feat: select calendar cards, open on double-click, delete with Delete key

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Inline create in month, week and all-day (R1, R2)

**Files:**
- Create: `src/components/InlineCreateInput.tsx`
- Modify: `src/components/DatabaseCalendar.tsx`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `resolveDraft`, `buildDateValue`, `shiftDateValue`, `snapMinutes`, `yToMinutes` (Task 1); `manager.createNoteWithTemplate(dbFile, initial, title)` (Task 2); `selection.clear()` (Task 4).
- Produces: `InlineCreateInput` props `{ defaultValue: string; className?: string; style?: React.CSSProperties; onCommit(title: string): void; onCancel(): void }`; in `DatabaseCalendar`: `interface CreateDraft { year: number; month: number; day: number; minutes: number | null }`, `createAt(target: CreateDraft, title?: string): Promise<void>`.

- [ ] **Step 1: Create the input component**

`src/components/InlineCreateInput.tsx`:

```tsx
import React, { useEffect, useRef } from 'react'
import { resolveDraft } from '../calendar-utils'

interface InlineCreateInputProps {
	defaultValue: string
	className?: string
	style?: React.CSSProperties
	onCommit: (title: string) => void
	onCancel: () => void
}

/**
 * Title box shown where a new calendar note will go. Enter creates, Esc cancels,
 * blur creates only if the user typed something (see resolveDraft). An empty box
 * never creates.
 */
export function InlineCreateInput({ defaultValue, className, style, onCommit, onCancel }: InlineCreateInputProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const dirtyRef = useRef(false)
	const doneRef = useRef(false)

	useEffect(() => {
		inputRef.current?.focus()
		inputRef.current?.select()
	}, [])

	const finish = (trigger: 'enter' | 'blur') => {
		if (doneRef.current) return
		doneRef.current = true
		const value = inputRef.current?.value ?? ''
		if (resolveDraft(value, dirtyRef.current, trigger) === 'commit') onCommit(value.trim())
		else onCancel()
	}

	return (
		<input
			ref={inputRef}
			type="text"
			className={className}
			style={style}
			defaultValue={defaultValue}
			onChange={() => { dirtyRef.current = true }}
			onKeyDown={e => {
				e.stopPropagation()
				if (e.key === 'Escape') {
					doneRef.current = true
					onCancel()
					return
				}
				if (e.key === 'Enter') {
					// The Enter that confirms an IME candidate must not submit the title.
					if (e.nativeEvent.isComposing) return
					e.preventDefault()
					finish('enter')
				}
			}}
			onBlur={() => finish('blur')}
			onClick={e => e.stopPropagation()}
			onDoubleClick={e => e.stopPropagation()}
		/>
	)
}
```

- [ ] **Step 2: Add the styles**

Append after the `.nb-cal-card--selected` rule in `styles.css`:

```css
.nb-cal-inline-input {
	width: 100%;
	min-width: 0;
	height: 22px;
	box-sizing: border-box;
	padding: 1px 4px;
	font-size: 11px;
	border-radius: 3px;
	border: 1px solid var(--interactive-accent);
	background: var(--background-primary);
	color: var(--text-normal);
}

.nb-cal-inline-input--timed {
	position: absolute;
	left: 2px;
	right: 2px;
	width: auto;
	z-index: 4;
}
```

- [ ] **Step 3: Imports and the draft type**

In `src/components/DatabaseCalendar.tsx`, extend the calendar-utils import and add the component import:

```ts
import { buildDateValue, parseDateValue, shiftDateValue, snapMinutes, yToMinutes } from '../calendar-utils'
import { InlineCreateInput } from './InlineCreateInput'
```

Add above `export function DatabaseCalendar`:

```ts
interface CreateDraft {
	year: number
	month: number // 0-based
	day: number
	minutes: number | null // null = all-day / date only
}
```

- [ ] **Step 4: Draft state**

Next to the other `useState` calls (e.g. after `actionDay`) add:

```ts
	const [draft, setDraft] = useState<CreateDraft | null>(null)
```

After `const viewMode = activeView.calendarViewMode ?? 'month'`, add:

```ts
	// A pending inline title box belongs to the page it was opened on.
	useEffect(() => { setDraft(null) }, [currentYear, currentMonth, currentDay, viewMode])
```

- [ ] **Step 5: Replace `handleDayClick`**

Replace the whole existing `handleDayClick` with:

```ts
	const createAt = async (target: CreateDraft, title?: string) => {
		if (!dbFile || !dateField) return
		const start = buildDateValue(target.year, target.month, target.day, target.minutes)
		const initial: Record<string, unknown> = { [dateField.id]: start }
		// A note created on a time slot gets a default one-hour length when an end field is set.
		if (endDateField && target.minutes !== null) initial[endDateField.id] = shiftDateValue(start, 0, 60)
		await trackSave(manager.createNoteWithTemplate(dbFile, initial, title))
	}

	const startDraft = (target: CreateDraft) => {
		selection.clear()
		setDraft(target)
	}

	const handleDayClick = (year: number, month: number, day: number) => {
		startDraft({ year, month, day, minutes: null })
	}

	const handleTimeClick = (e: React.MouseEvent<HTMLDivElement>, d: Date) => {
		const rect = e.currentTarget.getBoundingClientRect()
		const minutes = snapMinutes(yToMinutes(e.clientY - rect.top, rect.height))
		startDraft({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), minutes })
	}

	const commitDraft = (title: string) => {
		const target = draft
		setDraft(null)
		if (target) void createAt(target, title)
	}
```

- [ ] **Step 6: Draft rendering helpers**

Next to `handleKeyDown` (after the early returns) add:

```tsx
	const isDraftOn = (year: number, month: number, day: number, timed: boolean) =>
		draft !== null && draft.year === year && draft.month === month && draft.day === day && (draft.minutes !== null) === timed

	const draftInput = (className: string, style?: React.CSSProperties) => draft && (
		<InlineCreateInput
			key={`${draft.year}-${draft.month}-${draft.day}-${draft.minutes}`}
			className={className}
			style={style}
			defaultValue={t('db_untitled_note')}
			onCommit={commitDraft}
			onCancel={() => setDraft(null)}
		/>
	)
```

- [ ] **Step 7: Update the click sites**

1. **Month cell** — change

```tsx
onClick={!isMobile ? () => { void handleDayClick(currentYear, currentMonth, day) } : undefined}
```
to
```tsx
onClick={!isMobile ? () => { handleDayClick(currentYear, currentMonth, day) } : undefined}
```

2. **All-day cell** — change `onClick={() => { void handleDayClick(d.getFullYear(), d.getMonth(), d.getDate()) }}` (in `nb-cal-week-allday-cell`) to:

```tsx
onClick={() => { handleDayClick(d.getFullYear(), d.getMonth(), d.getDate()) }}
```

3. **Week day column** — change the same `onClick` on `nb-cal-week-day-col` to:

```tsx
onClick={e => { handleTimeClick(e, d) }}
```

4. **Mobile long-press sheet** (`t('add_card')` button) — mobile keeps immediate creation:

```tsx
<button className="nb-menu-item" onClick={() => { void createAt({ year: actionDay.year, month: actionDay.month, day: actionDay.day, minutes: null }); setActionDay(null) }}>
```

- [ ] **Step 8: Render the input in the three places**

1. **Month cell body**: inside the IIFE's fragment, just before its closing `</>` (after the `extraCount > 0 && (...)` block), add:

```tsx
													{isDraftOn(currentYear, currentMonth, day, false) && draftInput('nb-cal-inline-input')}
```

2. **All-day cell**: after `{dayRows.map(row => ( ... ))}` inside `nb-cal-week-allday-cell`, add:

```tsx
											{isDraftOn(d.getFullYear(), d.getMonth(), d.getDate(), false) && draftInput('nb-cal-inline-input')}
```

3. **Timed day column**: after `{timedRows.map(row => { ... })}` (still inside `nb-cal-week-day-col`), add:

```tsx
												{isDraftOn(d.getFullYear(), d.getMonth(), d.getDate(), true) && draftInput(
													'nb-cal-inline-input nb-cal-inline-input--timed',
													{ top: `${((draft?.minutes ?? 0) / 1440) * 100}%` },
												)}
```

- [ ] **Step 9: Type-check and run tests**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/InlineCreateInput.tsx src/components/DatabaseCalendar.tsx styles.css
git commit -m "feat: create calendar notes through an inline title box, incl. time slots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Drag cards to a new day and time, multi-card (R3)

**Files:**
- Modify: `src/components/DatabaseCalendar.tsx`

**Interfaces:**
- Consumes: `computeMoveDelta`, `applyMove`, `applyMoveToEnd`, `snapMinutes`, `yToMinutes`, `parseDateValue`, `DropTarget` (Task 1); `rowByPath`, `selection` (Task 4).
- Produces: `moveDraggedCards(e: React.DragEvent, target: DropTarget): Promise<void>` used by all three drop zones.

- [ ] **Step 1: Extend the calendar-utils import**

```ts
import {
	applyMove, applyMoveToEnd, buildDateValue, computeMoveDelta, parseDateValue, shiftDateValue,
	snapMinutes, yToMinutes, type DropTarget,
} from '../calendar-utils'
```

- [ ] **Step 2: Remember where inside the card the drag started**

Next to `longPressRef` add:

```ts
	const dragGrabPxRef = useRef(0)
```

Replace `handleCardDragStart` with:

```ts
	const handleCardDragStart = (e: React.DragEvent, row: NoteRow) => {
		e.dataTransfer.setData('nb-cal-path', row._file.path)
		e.dataTransfer.effectAllowed = 'move'
		e.stopPropagation()
		// Vertical distance from the card's top edge, so the card lands where its top was aimed.
		dragGrabPxRef.current = e.clientY - e.currentTarget.getBoundingClientRect().top
		// Dragging an unselected card moves only that card; dragging a selected one moves the whole selection.
		if (!selection.selected.has(row._file.path)) selection.selectOnly(row._file.path)
	}
```

- [ ] **Step 3: Replace `handleDayDrop` with `moveDraggedCards` and a time-drop wrapper**

Delete the existing `handleDayDrop` and add:

```ts
	const moveDraggedCards = async (e: React.DragEvent, target: DropTarget) => {
		e.preventDefault()
		e.stopPropagation()
		setDragOverDay(null)
		const anchorPath = e.dataTransfer.getData('nb-cal-path')
		const anchor = rowByPath.get(anchorPath)
		if (!anchor || !dateField) return
		const group = selection.selected.has(anchorPath)
			? Array.from(selection.selected).map(p => rowByPath.get(p)).filter((r): r is NoteRow => r !== undefined)
			: [anchor]
		const delta = computeMoveDelta((anchor as Record<string, unknown>)[dateField.id], target)
		await trackSave(Promise.all(group.map(row =>
			app.fileManager.processFrontMatter(row._file, (fm: Record<string, unknown>) => {
				const nextStart = applyMove(fm[dateField.id], delta, target, row === anchor)
				if (nextStart !== fm[dateField.id]) fm[dateField.id] = nextStart
				// Keep each event's duration: the end moves by the same amount (#58).
				if (endDateField) {
					const end = fm[endDateField.id]
					if (typeof end === 'string' && parseDateValue(end)) {
						const nextEnd = applyMoveToEnd(end, delta, target)
						if (nextEnd !== end) fm[endDateField.id] = nextEnd
					}
				}
			})
		)))
	}

	const handleTimeDrop = (e: React.DragEvent<HTMLDivElement>, d: Date) => {
		const rect = e.currentTarget.getBoundingClientRect()
		const minutes = snapMinutes(yToMinutes(e.clientY - rect.top - dragGrabPxRef.current, rect.height))
		void moveDraggedCards(e, { kind: 'time', year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), minutes })
	}
```

- [ ] **Step 4: Point the three drop zones at it**

1. **Month cell** — replace `onDrop={e => { void handleDayDrop(e, currentYear, currentMonth, day) }}` with:

```tsx
onDrop={e => { void moveDraggedCards(e, { kind: 'month-day', year: currentYear, month: currentMonth, day }) }}
```

2. **All-day cell** (`nb-cal-week-allday-cell`) — replace its `onDrop` with:

```tsx
onDrop={e => { void moveDraggedCards(e, { kind: 'all-day', year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }) }}
```

3. **Timed day column** (`nb-cal-week-day-col`) — replace its `onDrop` with:

```tsx
onDrop={e => { handleTimeDrop(e, d) }}
```

- [ ] **Step 5: Type-check and run tests**

Run: `npx tsc -noEmit -skipLibCheck && npx vitest run`
Expected: no type errors; all tests pass. If `noUnusedLocals` flags a now-unused import or helper (e.g. `shiftDateValue` is still used by `createAt`), remove only genuinely unused ones.

- [ ] **Step 6: Commit**

```bash
git add src/components/DatabaseCalendar.tsx
git commit -m "feat: drag calendar cards to a new day and time, moving the whole selection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Build, lint, deploy

**Files:** none modified unless lint reports issues in the files touched above.

- [ ] **Step 1: Full unit test run**

Run: `npm test`
Expected: all test files pass, including `calendar-utils` and `i18n-zh-tw`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no **new** errors in the files touched by this plan. Fix any that appear there. Pre-existing warnings/errors elsewhere are out of scope — check with `git stash; npm run lint; git stash pop` only if the baseline is unclear.

- [ ] **Step 3: Production build and deploy to the vault**

Run: `npm run deploy`
Expected: `tsc` passes, esbuild writes `main.js`, and the last line reads `Deployed notion-bases-custom to …/Ever Keep/.obsidian/plugins/notion-bases-custom`.

- [ ] **Step 4: Commit any lint fixes (skip if there were none)**

```bash
git add -A src styles.css tests
git commit -m "chore: fix lint findings in calendar changes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand back to the user**

Tell the user the build is deployed, that they need to reload the plugin in Obsidian (Settings → Community plugins → reload list, then toggle the plugin, or restart Obsidian), and that nothing was pushed. Per the user's instruction, no manual test checklist is required; they will report problems as they use it.

---

## Self-Review Notes

**Spec coverage**
- R0 → Task 3. R1 (Enter/Esc/blur/empty/IME) → Tasks 1 (`resolveDraft`), 5. R2 (time slot, 15-min snap, all-day = date only, +1h end) → Tasks 1, 5. R3 (drag day + time, end shifts, 15-min snap, multi-move, all-day drop) → Tasks 1, 6. R4 (single-click select, double-click open, click empty clears, no-date cards) → Task 4. R5 (Delete/Backspace, no confirm, not in inputs) → Task 4. R6 (Cmd/Ctrl toggle) → Tasks 1, 4.
- Interaction table: R1×R4 (`startDraft` clears selection), R1×R5 (`handleKeyDown` input guard), R3×R4 (`selectOnly` on drag start), R4×navigation (`pruneSelection` on visible-set change), R1×template (`createNoteWithTemplate` shows the picker after the title is known), R1×createNote (Task 2).
- Mobile unchanged: `handleCardClick` opens on tap, `handleKeyDown` returns early on mobile, month cell click and drag remain desktop-only, the long-press sheet creates immediately via `createAt`.

**Type consistency:** `DropTarget`, `MoveDelta`, `CreateDraft`, `useCalendarSelection` return shape and `InlineCreateInput` props are defined once (Task 1 / 4 / 5) and used with identical names in later tasks. Month is 0-based throughout; `DropTarget.month` and `CreateDraft.month` follow that.

**Known limitations (intentional, per spec):** only the dragged card is shown as the drag image when several are selected; the "no date" section cards can be selected and deleted but not resized; touch devices don't get selection/drag.
