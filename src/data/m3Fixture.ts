import type { Store } from '../domain/types.ts'
import type { StoreProduct } from '../domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from './m2Fixture.ts'

export const m3BaselineStore = m2Store

export const m3CandidateStore: Store = {
  id: 'm3-second-store',
  name: 'M3 testwinkel B',
}

export const m3BaselineProducts: StoreProduct[] = [
  ...m2Products,
  {
    id: 'garam-50',
    storeId: m3BaselineStore.id,
    name: 'Garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139,
  },
]

export const m3CandidateProducts: StoreProduct[] = [
  { id: 'b-chicken-400', storeId: m3CandidateStore.id, name: 'Kippendij 400 g', packAmount: 400, packUnit: 'g', available: true, priceCents: 459 },
  { id: 'b-basmati-1kg', storeId: m3CandidateStore.id, name: 'Basmati rijst 1 kg', packAmount: 1, packUnit: 'kg', available: true, priceCents: 239 },
  { id: 'b-coconut-400', storeId: m3CandidateStore.id, name: 'Kokosmelk 400 ml', packAmount: 400, packUnit: 'ml', available: true, priceCents: 169 },
  { id: 'b-cauliflower-1', storeId: m3CandidateStore.id, name: 'Bloemkool', packAmount: 1, packUnit: 'piece', available: true, priceCents: 189 },
  { id: 'b-garam-50', storeId: m3CandidateStore.id, name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g', available: true, priceCents: 149 },
  { id: 'b-broccoli-500', storeId: m3CandidateStore.id, name: 'Broccoli 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 219 },
  { id: 'b-edamame-300', storeId: m3CandidateStore.id, name: 'Edamame 300 g', packAmount: 300, packUnit: 'g', available: true, priceCents: 289 },
  { id: 'b-teriyaki-250', storeId: m3CandidateStore.id, name: 'Teriyaki saus 250 ml', packAmount: 250, packUnit: 'ml', available: true, priceCents: 259 },
  { id: 'b-spaghetti-500', storeId: m3CandidateStore.id, name: 'Spaghetti 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 129 },
  { id: 'b-tomato-400', storeId: m3CandidateStore.id, name: 'Tomatenblokjes 400 g', packAmount: 400, packUnit: 'g', available: true, priceCents: 109 },
  { id: 'b-yogurt-500', storeId: m3CandidateStore.id, name: 'Griekse yoghurt 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 219 },
]

export {
  m2DefaultActiveDays as m3DefaultActiveDays,
  m2InitialPlan as m3InitialPlan,
  m2Recipes as m3Recipes,
}
