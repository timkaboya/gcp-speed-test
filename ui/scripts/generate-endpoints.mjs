// Generates ui/src/assets/data/endpoints.json from gcping's public endpoints API.
// gcping endpoints have NO CORS, so we cannot fetch this list at runtime in the
// browser; we bake it in at build time and ping the region URLs with `no-cors`.
//
// Usage: node scripts/generate-endpoints.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://global.gcping.com/api/endpoints'

const geographyFor = (region) => {
  if (region === 'global') return 'Global'
  const prefix = region.split('-')[0]
  switch (prefix) {
    case 'africa':
      return 'Africa'
    case 'asia':
      return 'Asia Pacific'
    case 'australia':
      return 'Asia Pacific'
    case 'europe':
      return 'Europe'
    case 'me':
      return 'Middle East'
    case 'northamerica':
      return 'North America'
    case 'southamerica':
      return 'South America'
    case 'us':
      return 'North America'
    default:
      return 'Other'
  }
}

const main = async () => {
  const res = await fetch(SOURCE)
  if (!res.ok) throw new Error(`gcping endpoints fetch failed: ${res.status}`)
  const raw = await res.json()
  const list = Array.isArray(raw) ? raw : Object.values(raw)

  const endpoints = list
    .filter((e) => e && e.Region && e.URL)
    .map((e) => ({
      regionId: e.Region,
      displayName: e.RegionName || e.Region,
      geography: geographyFor(e.Region),
      url: e.URL.replace(/\/$/, '')
    }))
    .sort((a, b) => a.regionId.localeCompare(b.regionId))

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outPath = `${__dirname}/../src/assets/data/endpoints.json`
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(endpoints, null, 2) + '\n')
  console.log(`Wrote ${endpoints.length} endpoints to ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
