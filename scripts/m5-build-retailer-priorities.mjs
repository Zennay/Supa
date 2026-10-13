import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { reconcileRetailerRights } from './m5-reconcile-retailer-rights.mjs'
import { assessRetailerResearch, loadPrivateRetailerResearch } from './m5-assess-retailer-research.mjs'

const DISCOVERY = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const M1_GATE = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const EMPTY_REVIEW = new URL('../docs/m5-retailer-research-template.v1.json', import.meta.url)
// Reviewer preference only breaks ties inside a human-action/rights tier.
// It can never outrank a verified M1 blocker, denial or legal review.
const RESEARCH_PRIORITY_RANK = Object.freeze({ P1: 0, P2: 1, P3: 2, unprioritized: 3 })

const ACTIONS = Object.freeze({
  'independent-license-review': 'Have a human validate actual license scope; do not enable ingest',
  'resolve-m1-permission': 'Clarify written PLUS data-use permissions with retailer rights owner',
  'resolve-m1-uncertainty': 'Clarify written DekaMarkt licensing basis with retailer rights owner',
  'check-market-identity': 'Check current NL store identity, region and source type offline',
  'check-terms-and-robots': 'Record current terms and robots restrictions with verifiable evidence',
  'identify-owner': 'Identify rights holder and an official contact method',
  'request-authorization': 'Seek written data reuse rights without automated access',
  'await-human-reply': 'Wait for a genuine retailer rights decision; no retries or scraping',
  'do-not-ingest': 'Stop: rights rejected or source unavailable; do not ingest',
})

export function buildM5ResearchPriorities(discovery, canonicalM1, privateLedger) {
  const rights = reconcileRetailerRights(discovery, canonicalM1)
  const research = assessRetailerResearch(discovery, privateLedger)
  const reviews = new Map(research.retailers.map((item) => [item.id, item]))
  const queue = rights.sourceStatuses.map((source) => {
    const r = reviews.get(source.supermarket)
    let action, rank
    if (r.rightsState === 'denied') {
      action = 'do-not-ingest'; rank = 9
    } else if (r.rightsState === 'claimed-written-permission') {
      action = 'independent-license-review'; rank = 0
    } else if (source.m1PermissionStatus === 'permission_required') {
      action = 'resolve-m1-permission'; rank = 1
    } else if (source.m1PermissionStatus === 'unresolved') {
      action = 'resolve-m1-uncertainty'; rank = 2
    } else if (r.rightsState === 'request-pending') {
      action = 'await-human-reply'; rank = 8
    } else if (!r.researchReviewed || r.sourceKind === 'unassessed') {
      action = 'check-market-identity'; rank = 3
    } else if (r.termsReview === 'unreviewed' || r.robotsReview === 'unreviewed') {
      action = 'check-terms-and-robots'; rank = 4
    } else if (r.ownerContactStatus === 'unassessed') {
      action = 'identify-owner'; rank = 5
    } else {
      action = 'request-authorization'; rank = 6
    }
    return {
      retailerId: source.supermarket,
      status: r.rightsState,
      m1Status: source.m1PermissionStatus,
      researchReviewed: r.researchReviewed,
      reviewPriority: r.priority,
      nextActionCode: action,
      nextAction: ACTIONS[action],
      urgencyRank: rank,
      requiresHuman: true,
      productionEnabled: false,
      rightsVerified: false,
    }
  }).sort((a, b) => a.urgencyRank - b.urgencyRank ||
    RESEARCH_PRIORITY_RANK[a.reviewPriority] -
      RESEARCH_PRIORITY_RANK[b.reviewPriority] ||
    a.retailerId.localeCompare(b.retailerId))
  return {
    version: 1,
    purpose: 'offline human research prioritization; never source authorization',
    currentPhase: 'M3',
    productionReady: false,
    m5Eligible: false,
    total: queue.length,
    reviewedCount: research.reviewedCount,
    unreviewedCount: research.missingCount,
    m1BlockedCount: rights.m1BlockedCount,
    queue,
  }
}

export function renderM5ResearchPrioritiesMarkdown(result) {
  const lines = [
    '# Supa — offline retailer rights review queue',
    '',
    '**Human research only. M3 #78 remains open; never use this report as ingest permission.**',
    '',
    '| Retailer ID | Existing M1 rights | Local research | Next human action |',
    '| --- | --- | --- | --- |',
    ...result.queue.map((item) => '| ' + [
      item.retailerId,
      item.m1Status,
      item.researchReviewed ? 'reviewed claim only' : 'pending',
      item.nextAction,
    ].join(' | ') + ' |'),
    '',
    'All ' + result.total + ' sources remain disabled and permission-unverified.',
    '',
  ]
  return lines.join('\n')
}

export function parsePriorityArgs(args) {
  let format = 'json'
  let input = EMPTY_REVIEW
  let hasInput = false
  let hasFormat = false
  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      if (hasFormat) throw new Error('Duplicate format flag')
      format = arg.slice(9)
      hasFormat = true
      if (format !== 'json' && format !== 'markdown') throw new Error('Unknown format')
    } else if (arg.startsWith('-') || hasInput) {
      throw new Error('Unexpected research argument')
    } else {
      input = arg
      hasInput = true
    }
  }
  return { format, input }
}

export async function main(args = process.argv.slice(2)) {
  const { format, input } = parsePriorityArgs(args)
  const [d, m1, ledger] = await Promise.all([
    readFile(DISCOVERY, 'utf8'),
    readFile(M1_GATE, 'utf8'),
    loadPrivateRetailerResearch(input),
  ])
  const report = buildM5ResearchPriorities(JSON.parse(d), JSON.parse(m1), ledger)
  process.stdout.write(format === 'json'
    ? JSON.stringify(report, null, 2) + '\n'
    : renderM5ResearchPrioritiesMarkdown(report))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    process.stderr.write('Offline M5 research prioritization rejected the input.\n')
    process.exitCode = 2
  })
}
