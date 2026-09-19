#!/usr/bin/env node
// Copy the built plugin into an Obsidian vault.
// Vault path comes from $OBSIDIAN_VAULT or a gitignored .env.local file
// (OBSIDIAN_VAULT=/path/to/vault). Files are copied, not symlinked, so iCloud
// can sync them to iOS/iPadOS.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

function readEnvLocal() {
	if (!existsSync('.env.local')) return {}
	const env = {}
	for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
		if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
	}
	return env
}

const vault = process.env.OBSIDIAN_VAULT || readEnvLocal().OBSIDIAN_VAULT
if (!vault) {
	console.error('Set OBSIDIAN_VAULT (env var or .env.local) to your vault path.')
	process.exit(1)
}
if (!existsSync(join(vault, '.obsidian'))) {
	console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`)
	process.exit(1)
}

const { id } = JSON.parse(readFileSync('manifest.json', 'utf8'))
const dest = join(vault, '.obsidian', 'plugins', id)
mkdirSync(dest, { recursive: true })

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	if (!existsSync(file)) {
		console.error(`Missing ${file} — run "npm run build" first.`)
		process.exit(1)
	}
	copyFileSync(file, join(dest, file))
}
console.log(`Deployed ${id} to ${dest}`)
