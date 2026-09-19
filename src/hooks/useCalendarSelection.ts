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
