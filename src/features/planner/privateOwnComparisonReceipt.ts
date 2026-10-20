import { freshReviewedBaskets, type PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { ownStoreWeekComparison } from './ownStoreBudgetComparison.ts'

/**
 * A self-contained, portable, PRIVATE record of a fully reviewed local week.
 * Unlike a source snapshot, this derived report must never be re-imported as
 * original retailer data or cited as independent evidence of saving money.
 */
export function privateOwnComparisonReceipt(
  reviewed: PrivateReviewedBaskets | null,
  nowMs = Date.now(),
): string {
  const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', nowMs)
  const comparison = ownStoreWeekComparison(current)
  const plus = current?.stores.PLUS
  const deka = current?.stores.DekaMarkt
  if (!plus || !deka || comparison.status !== 'comparable' ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Voor een privérapport zijn twee actuele, fysiek gecontroleerde winkelmandjes nodig.')
  }

  const product = (line: typeof comparison.lines[number]['plus']) => ({
    sourceProductId: line.productId,
    sourceProductName: line.productName,
    packagesNeeded: line.packs,
    package: {
      amount: line.pack.amount,
      unit: line.pack.unit,
      count: line.pack.count,
    },
    pricePerPackageCents: line.pricePerPackCents,
    totalWholePackagesCents: line.lineTotalCents,
    advisoryUnitPrice: privateUnitPrice(line),
  })
  const receipt = {
    schemaVersion: 1,
    kind: 'supa-private-derived-two-store-week-report',
    generatedAt: new Date(nowMs).toISOString(),
    disclaimer: 'Eigen gecontroleerde lokale bronnen; geen kassagarantie of onafhankelijk besparingsbewijs.',
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    sourceImportable: false,
    currency: 'EUR',
    stores: {
      PLUS: {
        observedAt: plus.observedAt,
        totalWholePackagesCents: comparison.plusCents,
      },
      DekaMarkt: {
        observedAt: deka.observedAt,
        totalWholePackagesCents: comparison.dekaCents,
      },
    },
    wholeBasket: {
      samePhysicalDemand: true,
      observedWithin24Hours: true,
      cheapestStore: comparison.cheapest,
      absoluteDifferenceCents: comparison.differenceCents,
      // Gross product-only preview. A second visit can have additional cost.
      optionalMixedStoreProductCents: comparison.mixedRoute?.totalCents ?? null,
      optionalMixedRouteRequiresTwoStops: comparison.mixedRoute?.requiresTwoStops ?? null,
    },
    products: comparison.lines.map(line => ({
      ingredientId: line.id,
      ingredient: line.ingredientLabel,
      demand: {
        amount: line.plus.requirement.amount,
        unit: line.plus.requirement.unit,
      },
      PLUS: product(line.plus),
      DekaMarkt: product(line.deka),
      // Positive: PLUS cheaper; negative: DekaMarkt cheaper.
      dekaMinusPlusCents: line.deltaCents,
    })),
  }

  // A malformed or unexpectedly large private basket must not generate a
  // misleading, truncated export. The original local evidence is untouched.
  const encoded = JSON.stringify(receipt, null, 2) + '\n'
  if (new TextEncoder().encode(encoded).byteLength > 512_000) {
    throw new Error('Dit privérapport is te groot om lokaal te exporteren.')
  }
  return encoded
}

export function downloadPrivateOwnComparisonReceipt(
  reviewed: PrivateReviewedBaskets | null,
): void {
  const content = privateOwnComparisonReceipt(reviewed, Date.now())
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-prive-plus-deka-weekrapport.json'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
