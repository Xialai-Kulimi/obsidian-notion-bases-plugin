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

/**
 * Shift-click range: every path between `anchor` and `target` (inclusive, either
 * direction) in on-screen `order`. Without a usable anchor it is just the target.
 */
export function rangeSelection(order: readonly string[], anchor: string | null, target: string): Set<string> {
	const a = anchor === null ? -1 : order.indexOf(anchor)
	const b = order.indexOf(target)
	if (a === -1 || b === -1) return new Set([target])
	return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))
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
