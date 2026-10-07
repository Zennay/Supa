import type { SourceSnapshotRef } from './ingestion.ts'
import {
  parseSchemaOrgProduct,
  type SchemaOrgParseResult,
} from './schemaOrgProduct.ts'

export type PlusRenderedProductEvidence = {
  version: 1
  evidenceType: 'plus-browser-rendered-schema-org-product'
  source: SourceSnapshotRef & { id: string }
  browserEvidence: {
    runId: number
    artifactId: number
    artifactDigest: string
    renderedHtmlSha256: string
    finalUrl: string
    supaSha: string
    safety: {
      login: false
      privateApiCalls: false
      networkInterception: false
      antiBotBypass: false
      targetCount: 1
    }
  }
  jsonLd: unknown
}

function safeSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function safeSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function safeArtifactDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value)
}

function safeSupaSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function safeCapturedAt(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !validCalendarDate(match[1])) return false

  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return false

  if (match[5] !== 'Z') {
    const [offsetHour, offsetMinute] = match[5]
      .slice(1)
      .split(':')
      .map(Number)
    if (offsetHour > 23 || offsetMinute > 59) return false
  }

  return Number.isFinite(Date.parse(value))
}

function safePlusProductUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.plus.nl' &&
      url.port === '' &&
      url.pathname.startsWith('/product/') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

function plusProductIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/(?:-|\/)(\d+)\/?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function schemaTypes(value: unknown): string[] {
  if (!isObject(value)) return []
  const raw = value['@type']
  if (Array.isArray(raw)) return raw.map(String)
  return raw == null ? [] : [String(raw)]
}

function productJsonLdNodes(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(productJsonLdNodes)
  if (!isObject(value)) return []

  const direct = schemaTypes(value).some(
    (candidate) => candidate.toLowerCase() === 'product',
  )
    ? [value]
    : []
  const graph = Array.isArray(value['@graph'])
    ? value['@graph'].flatMap(productJsonLdNodes)
    : []

  return [...direct, ...graph]
}

type DeclaredProductUrl =
  | { type: 'absent' }
  | { type: 'invalid' }
  | { type: 'value'; value: string }

function declaredProductUrl(jsonLd: unknown): DeclaredProductUrl {
  const products = productJsonLdNodes(jsonLd)
  if (products.length !== 1) return { type: 'invalid' }

  const raw = products[0].url
  if (raw === undefined || raw === null) return { type: 'absent' }
  if (typeof raw !== 'string' || !raw.trim()) return { type: 'invalid' }

  return { type: 'value', value: raw.trim() }
}

function matchesSourceProductUrl(
  declaredUrl: string,
  sourceUrl: string,
): boolean {
  if (!safePlusProductUrl(declaredUrl)) return false

  try {
    return new URL(declaredUrl).href === new URL(sourceUrl).href
  } catch {
    return false
  }
}

export function parsePlusRenderedProductEvidence(
  evidence: PlusRenderedProductEvidence,
): SchemaOrgParseResult {
  if (evidence?.version !== 1) {
    return { type: 'abstain', reason: 'PLUS rendered evidence must use version 1' }
  }
  if (evidence.evidenceType !== 'plus-browser-rendered-schema-org-product') {
    return { type: 'abstain', reason: 'unexpected PLUS rendered evidence type' }
  }
  if (!safeSourceId(evidence.source?.id)) {
    return { type: 'abstain', reason: 'PLUS rendered evidence has unsafe source id' }
  }
  if (evidence.source.supermarket !== 'plus' || evidence.source.kind !== 'product') {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence must be a PLUS product source',
    }
  }
  if (
    !safePlusProductUrl(evidence.source.url) ||
    !safeCapturedAt(evidence.source.capturedAt) ||
    !safeSha256(evidence.source.sha256)
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence has invalid source provenance',
    }
  }
  if (
    !safePositiveInteger(evidence.browserEvidence?.runId) ||
    !safePositiveInteger(evidence.browserEvidence?.artifactId) ||
    !safeArtifactDigest(evidence.browserEvidence?.artifactDigest) ||
    !safeSupaSha(evidence.browserEvidence?.supaSha)
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence has invalid browser artifact identity',
    }
  }
  if (
    !safeSha256(evidence.browserEvidence?.renderedHtmlSha256) ||
    evidence.browserEvidence.renderedHtmlSha256 !== evidence.source.sha256 ||
    evidence.browserEvidence?.finalUrl !== evidence.source.url
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence provenance does not match browser artifact',
    }
  }

  const safety = evidence.browserEvidence?.safety
  if (
    !safety ||
    safety.login !== false ||
    safety.privateApiCalls !== false ||
    safety.networkInterception !== false ||
    safety.antiBotBypass !== false ||
    safety.targetCount !== 1
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence violates the bounded browser safety contract',
    }
  }

  const parsed = parseSchemaOrgProduct(evidence.jsonLd, evidence.source)
  if (parsed.type !== 'observation') return parsed

  const expectedProductId = plusProductIdFromUrl(evidence.source.url)
  if (
    expectedProductId === null ||
    parsed.observation.sourceProductId !== expectedProductId
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence product identity does not match source URL',
    }
  }

  const productUrl = declaredProductUrl(evidence.jsonLd)
  if (
    productUrl.type === 'invalid' ||
    (productUrl.type === 'value' &&
      !matchesSourceProductUrl(productUrl.value, evidence.source.url))
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence Product JSON-LD URL does not match source URL',
    }
  }

  return parsed
}
