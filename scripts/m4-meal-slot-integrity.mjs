/** Opt-in M4 evidence-integrity guard; NOT an M3 closure or beta approval. */
import {
  buildBetaSessionSummary,
  validateBetaSession,
} from './m4-validate-beta-session.mjs'

const MAX_INPUT_NODES = 20_000
const MAX_TOTAL_JSON_UTF8_BYTES = 1_048_576
const MAX_EVENTS = 2_000
const MAX_SLOT_BYTES = 256

function snapshotPlainJson(input) {
  const state = { count: 0, bytes: 0 }

  function addBytes(value) {
    state.bytes += Buffer.byteLength(value, 'utf8')
    if (state.bytes > MAX_TOTAL_JSON_UTF8_BYTES) {
      throw new Error('M4 JSON evidence exceeds aggregate UTF-8 byte budget')
    }
  }

  function visit(value, depth) {
    state.count += 1
    if (state.count > MAX_INPUT_NODES || depth > 32) {
      throw new Error('M4 session exceeds the bounded JSON evidence budget')
    }
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > 16_384) {
        throw new Error('M4 evidence string exceeds the bounded JSON budget')
      }
      addBytes(value)
      return value
    }
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
      return value
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_EVENTS) {
        throw new Error('M4 evidence array exceeds the bounded JSON budget')
      }
      const descriptors = Object.getOwnPropertyDescriptors(value)
      if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
        throw new Error('M4 evidence arrays must be dense data arrays')
      }
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !('value' in descriptor)) {
          throw new Error('M4 evidence arrays must be dense data arrays')
        }
        return visit(descriptor.value, depth + 1)
      })
    }
    if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const result = Object.create(null)
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new Error('M4 evidence object has an invalid key')
        }
        addBytes(key)
        const descriptor = descriptors[key]
        if (!('value' in descriptor)) {
          throw new Error('M4 evidence accessors are not accepted')
        }
        result[key] = visit(descriptor.value, depth + 1)
      }
      return result
    }
    throw new Error('M4 evidence must contain only plain JSON data')
  }

  return visit(input, 0)
}

function slotKey(value) {
  if (typeof value !== 'string' || value.length === 0 ||
      value !== value.trim() || Buffer.byteLength(value, 'utf8') > MAX_SLOT_BYTES) {
    throw new Error('M4 meal outcome slot must be canonical bounded text')
  }
  for (const ch of value) {
    if (/\p{Cc}|\p{Cf}|\p{Cs}|\p{Co}|\p{Cn}|\p{Zl}|\p{Zp}/u.test(ch)) {
      throw new Error('M4 meal outcome slot contains unsafe characters')
    }
  }
  return value.normalize('NFKC')
}

export function validateM4MealSlotIntegrity(input) {
  // Capture all fields before consulting the existing source-owned validator.
  // This is only a synthetic read boundary. It does not authenticate the M3
  // evidence reference, participant, consent or event origins.
  const session = snapshotPlainJson(input)
  validateBetaSession(session)
  if (session.events.length > MAX_EVENTS) {
    throw new Error('M4 event budget exceeded')
  }

  const seen = new Set()
  for (const event of session.events) {
    if (event.type !== 'meal_outcome_recorded') continue
    const key = slotKey(event.meal_slot)
    if (seen.has(key)) {
      throw new Error('M4 meal outcome slot must have exactly one final outcome')
    }
    seen.add(key)
  }

  return session
}

export function buildM4SummaryWithMealSlotIntegrity(input) {
  const session = validateM4MealSlotIntegrity(input)
  return buildBetaSessionSummary(session)
}
