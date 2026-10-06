import type { StoreProduct } from '../domain/basket.ts'
import type { Store } from '../domain/types.ts'
import { m2Products, m2Store } from './m2Fixture.ts'

export const m3BaselineStore: Store = { ...m2Store }

export const m3CandidateStore: Store = {
  id: 'm3-candidate-store',
  name: 'M3 testwinkel B',
}

function withGaramMasala(products: StoreProduct[], storeId: string): StoreProduct[] {
  return [
    ...products.map((product) => ({ ...product })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139,
    },
  ]
}

export const m3BaselineProducts = withGaramMasala(m2Products, m3BaselineStore.id)

export const m3CandidateProducts: StoreProduct[] = withGaramMasala(
  m2Products.map((product) => ({
    ...product,
    id: `m3-b-${product.id}`,
    storeId: m3CandidateStore.id,
    priceCents: Math.max(0, product.priceCents - 10),
  })),
  m3CandidateStore.id,
)
