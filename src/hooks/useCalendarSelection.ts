import { useCallback, useEffect, useRef, useState } from 'react'
import { nextSelection, pruneSelection, rangeSelection } from '../calendar-utils'

/**
 * Tracks which calendar cards are selected (by file path). Selection is dropped
 * automatically for cards that stop being visible (navigation, view switch,
 * filters, deletion), so a Delete keypress can never hit an off-screen card.
 */
export function useCalendarSelection(visiblePaths: string[]) {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
	// Where the next Shift-click range starts: the last card clicked without Shift.
	const anchorRef = useRef<string | null>(null)

	const select = useCallback((path: string, additive: boolean) => {
		anchorRef.current = path
		setSelected(cur => nextSelection(cur, path, additive))
	}, [])
	const selectOnly = useCallback((path: string) => {
		anchorRef.current = path
		setSelected(cur => (cur.size === 1 && cur.has(path) ? cur : new Set([path])))
	}, [])
	// `order` is the cards' on-screen order, so ranges follow what the user sees.
	const selectRange = useCallback((path: string, order: readonly string[]) => {
		if (anchorRef.current === null || !order.includes(anchorRef.current)) anchorRef.current = path
		setSelected(rangeSelection(order, anchorRef.current, path))
	}, [])
	const clear = useCallback(() => {
		anchorRef.current = null
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

	return { selected, select, selectOnly, selectRange, clear }
}
