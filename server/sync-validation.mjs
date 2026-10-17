// The rules live in src/lib/syncRecords.ts so the browser applies exactly the
// same ones before trusting a server snapshot.
export {
  PLANNER_KEY, RECIPE_LIBRARY_KEY, SHOPPING_PROGRESS_KEY,
  SYNC_KEYS, MAX_SNAPSHOT_BYTES, validateSyncEntries,
} from '../src/lib/syncRecords.ts'
