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

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validPublicPlusProductUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.plus.nl' &&
      url.pathname.startsWith('/product/')
    )
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
    !validPublicPlusProductUrl(evidence.source.url) ||
    !validIso(evidence.source.capturedAt) ||
    !/^[a-f0-9]{64}$/.test(evidence.source.sha256)
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence source provenance is invalid',
    }
  }

  const browserEvidence = evidence.browserEvidence
  if (
    !Number.isInteger(browserEvidence?.runId) ||
    browserEvidence.runId <= 0 ||
    !Number.isInteger(browserEvidence?.artifactId) ||
    browserEvidence.artifactId <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(browserEvidence?.artifactDigest ?? '') ||
    !/^[a-f0-9]{40}$/.test(browserEvidence?.supaSha ?? '')
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered browser artifact identity is invalid',
    }
  }

  if (
    browserEvidence.renderedHtmlSha256 !== evidence.source.sha256 ||
    browserEvidence.finalUrl !== evidence.source.url
  ) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered evidence provenance does not match browser artifact',
    }
  }

  const safety = browserEvidence.safety
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

  return parseSchemaOrgProduct(evidence.jsonLd, evidence.source)
}
