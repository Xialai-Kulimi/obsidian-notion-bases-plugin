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
