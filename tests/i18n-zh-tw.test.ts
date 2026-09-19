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
