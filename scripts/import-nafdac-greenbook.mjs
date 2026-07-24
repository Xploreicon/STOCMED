import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const GREENBOOK_URL = 'https://greenbook.nafdac.gov.ng/'
const MANUFACTURERS_URL = `${GREENBOOK_URL}manufacturers`

const CATEGORY_RULES = [
  { category: 'Analgesics', prefixes: ['N02'] },
  { category: 'Antibiotics', prefixes: ['J01'] },
  { category: 'Antimalarials', prefixes: ['P01B'] },
  { category: 'Antihypertensives', prefixes: ['C02', 'C03', 'C07', 'C08', 'C09'] },
  { category: 'Diabetes', prefixes: ['A10'] },
  { category: 'Respiratory', prefixes: ['R06'] },
  { category: 'Gastrointestinal', prefixes: ['A02', 'A03', 'A04', 'A06', 'A07', 'A09'] },
  { category: 'Vitamins', prefixes: ['A11', 'B03'] },
]

export function decodeHtml(value) {
  return String(value ?? '')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
}

export function cleanText(value) {
  return decodeHtml(value).replace(/\s+/g, ' ').trim()
}

export function cleanBrandName(value) {
  return cleanText(value)
    .replace(/[#*]+/g, '')
    .replace(/\s*\(check pack size\)\s*$/i, '')
    .trim()
}

export function categoryForAtc(atcCode) {
  const normalized = cleanText(atcCode).toUpperCase()
  return CATEGORY_RULES.find(({ prefixes }) =>
    prefixes.some((prefix) => normalized.startsWith(prefix))
  )?.category ?? null
}

export function normalizeProduct(row, manufacturers) {
  if (row.status !== 'Active' || row.product_category?.name !== 'Drugs') {
    return { product: null, reason: 'not_active_human_drug' }
  }

  const category = categoryForAtc(row.atc)
  if (!category) {
    return { product: null, reason: 'outside_priority_categories' }
  }

  const product = {
    generic_name: cleanText(row.ingredient?.ingredient_name),
    brand_name: cleanBrandName(row.product_name),
    manufacturer: cleanText(manufacturers.get(Number(row.manufacturer_id))),
    strength: cleanText(row.strength),
    dosage_form: cleanText(row.form?.name).toLowerCase(),
    category,
    pack_size: cleanText(row.pack_size),
    nafdac_number: cleanText(row.NAFDAC).toUpperCase(),
    atc_code: cleanText(row.atc).toUpperCase(),
    requires_prescription: Number(row.marketing_category_id) === 1,
  }

  const missingFields = Object.entries(product)
    .filter(([key, value]) => key !== 'requires_prescription' && !value)
    .map(([key]) => key)

  if (missingFields.length > 0) {
    return {
      product: null,
      reason: `missing_${missingFields.join('_')}`,
    }
  }

  return { product, reason: null }
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function normalizedSql(column) {
  return `LOWER(REGEXP_REPLACE(TRIM(COALESCE(${column}, '')), '\\s+', '', 'g'))`
}

export function buildMigration(products) {
  const dosageForms = [...new Set(products.map((product) => product.dosage_form))].sort()
  const values = products.map((product) => `  (
    ${sqlString(product.generic_name)},
    ${sqlString(product.brand_name)},
    ${sqlString(product.manufacturer)},
    ${sqlString(product.strength)},
    ${sqlString(product.dosage_form)},
    ${sqlString(product.category)},
    ${sqlString(product.pack_size)},
    ${sqlString(product.nafdac_number)},
    ${sqlString(product.atc_code)},
    ${product.requires_prescription}
  )`).join(',\n')

  return `-- Generated from the official NAFDAC Greenbook public database.
-- Source: ${GREENBOOK_URL}
-- Scope: active human drugs in fast-moving retail ATC categories.

BEGIN;

INSERT INTO public.dosage_forms (name)
VALUES ${dosageForms.map((form) => `(${sqlString(form)})`).join(', ')}
ON CONFLICT (name) DO NOTHING;

WITH greenbook (
  generic_name,
  brand_name,
  manufacturer,
  strength,
  dosage_form,
  category,
  pack_size,
  nafdac_number,
  atc_code,
  requires_prescription
) AS (
VALUES
${values}
)
INSERT INTO public.products (
  generic_name,
  brand_name,
  manufacturer,
  strength,
  dosage_form,
  category,
  pack_size,
  nafdac_number,
  atc_code,
  requires_prescription,
  is_verified
)
SELECT
  source.generic_name,
  source.brand_name,
  source.manufacturer,
  source.strength,
  source.dosage_form,
  source.category,
  source.pack_size,
  source.nafdac_number,
  source.atc_code,
  source.requires_prescription,
  TRUE
FROM greenbook AS source
WHERE NOT EXISTS (
  SELECT 1
  FROM public.products AS existing
  WHERE ${normalizedSql('existing.generic_name')} = ${normalizedSql('source.generic_name')}
    AND ${normalizedSql('existing.strength')} = ${normalizedSql('source.strength')}
    AND ${normalizedSql('existing.dosage_form')} = ${normalizedSql('source.dosage_form')}
    AND ${normalizedSql('existing.pack_size')} = ${normalizedSql('source.pack_size')}
    AND ${normalizedSql('existing.brand_name')} = ${normalizedSql('source.brand_name')}
)
ON CONFLICT DO NOTHING;

COMMIT;
`
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'StocMed Greenbook catalogue importer/1.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Greenbook request failed (${response.status}) for ${url}`)
  }
  return response.text()
}

async function fetchProducts() {
  const url = new URL(GREENBOOK_URL)
  url.searchParams.set('draw', '1')
  url.searchParams.set('start', '0')
  url.searchParams.set('length', '10000')
  url.searchParams.set('search[value]', '')
  url.searchParams.set('search[regex]', 'false')

  const response = await fetch(url, {
    headers: {
      'user-agent': 'StocMed Greenbook catalogue importer/1.0',
      'x-requested-with': 'XMLHttpRequest',
    },
  })
  if (!response.ok) {
    throw new Error(`Greenbook product request failed (${response.status})`)
  }

  const payload = await response.json()
  if (!Array.isArray(payload.data) || payload.data.length !== payload.recordsFiltered) {
    throw new Error(
      `Greenbook returned ${payload.data?.length ?? 0} of ${payload.recordsFiltered ?? 'unknown'} records`
    )
  }
  return payload
}

function parseManufacturers(html) {
  const manufacturers = new Map()
  const pattern = /manufacturer\/products\/(\d+)">[\s\S]*?<h5>([\s\S]*?)<\/h5>/g
  for (const match of html.matchAll(pattern)) {
    manufacturers.set(Number(match[1]), cleanText(match[2]))
  }
  return manufacturers
}

function manufacturerPageCount(html) {
  const pages = [...html.matchAll(/manufacturers\?page=(\d+)/g)]
    .map((match) => Number(match[1]))
  return Math.max(1, ...pages)
}

async function fetchManufacturers() {
  const firstPage = await fetchText(MANUFACTURERS_URL)
  const manufacturers = parseManufacturers(firstPage)
  const pageCount = manufacturerPageCount(firstPage)

  for (let page = 2; page <= pageCount; page += 1) {
    const pageManufacturers = parseManufacturers(
      await fetchText(`${MANUFACTURERS_URL}?page=${page}`)
    )
    for (const [id, name] of pageManufacturers) {
      manufacturers.set(id, name)
    }
  }

  return { manufacturers, pageCount }
}

function dedupeValue(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '')
}

function uniqueProducts(products) {
  const seenNafdacNumbers = new Set()
  const seenCatalogueKeys = new Set()
  let repeatedNafdacRows = 0
  let duplicateCatalogueRowsRemoved = 0

  const unique = products.filter((product) => {
    if (seenNafdacNumbers.has(product.nafdac_number)) {
      repeatedNafdacRows += 1
    }
    seenNafdacNumbers.add(product.nafdac_number)

    const catalogueKey = [
      product.generic_name,
      product.strength,
      product.dosage_form,
      product.pack_size,
      product.brand_name,
    ].map(dedupeValue).join('|')

    if (seenCatalogueKeys.has(catalogueKey)) {
      duplicateCatalogueRowsRemoved += 1
      return false
    }

    seenCatalogueKeys.add(catalogueKey)
    return true
  })

  unique.sort((left, right) => [
    left.category,
    left.generic_name,
    left.brand_name,
    left.strength,
    left.pack_size,
  ].join('|').localeCompare([
    right.category,
    right.generic_name,
    right.brand_name,
    right.strength,
    right.pack_size,
  ].join('|')))

  return {
    products: unique,
    repeatedNafdacRows,
    duplicateCatalogueRowsRemoved,
  }
}

async function main() {
  const outputFlag = process.argv.indexOf('--output')
  const outputPath = outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : 'supabase/migrations/20260724000000_nafdac_greenbook_catalogue.sql'

  const [{ manufacturers, pageCount }, payload] = await Promise.all([
    fetchManufacturers(),
    fetchProducts(),
  ])

  const rejected = new Map()
  const normalized = []
  for (const row of payload.data) {
    const { product, reason } = normalizeProduct(row, manufacturers)
    if (product) {
      normalized.push(product)
    } else {
      rejected.set(reason, (rejected.get(reason) ?? 0) + 1)
    }
  }

  const {
    products,
    repeatedNafdacRows,
    duplicateCatalogueRowsRemoved,
  } = uniqueProducts(normalized)
  await writeFile(outputPath, buildMigration(products), 'utf8')

  const categoryCounts = Object.fromEntries(
    CATEGORY_RULES.map(({ category }) => [
      category,
      products.filter((product) => product.category === category).length,
    ])
  )

  console.log(JSON.stringify({
    source: GREENBOOK_URL,
    sourceRecords: payload.recordsTotal,
    manufacturerPages: pageCount,
    manufacturersResolved: manufacturers.size,
    migrationRows: products.length,
    repeatedNafdacRows,
    duplicateCatalogueRowsRemoved,
    categoryCounts,
    rejected: Object.fromEntries([...rejected.entries()].sort()),
    outputPath,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
