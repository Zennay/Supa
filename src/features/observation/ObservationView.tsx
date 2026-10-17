import './ObservationView.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  OBSERVATION_DRAFT_STORAGE_KEY,
  observationLineCollectionComplete,
  observationSheetHasUserInput,
  observationSheetProgress,
  observationSheetReadiness,
  observationStoreProgress,
  observationWindowSummary,
  restoreObservationSheetDraft,
  withObservedProductAvailability,
  type ObservationSheet,
  type ObservationSource,
  type ObservedProduct,
  type StoreObservation,
} from '../../domain/m3ObservationSheet.ts'
import { observationRetailerCopy } from './observationPresentation.ts'
import { ObservationPackUnitOptions, ObservationRequirementText } from './ObservationQuantityFields'
import {
  nextObservationActionLabel,
  observationTimestampFromDate,
} from './observationCollectionUi.ts'
import {
} from './observationNumericInput.ts'
import {
  persistObservationDraft,
  removeObservationDraft,
} from './observationDraftPersistence.ts'
import { observationDraftFileSizeAllowed } from './observationDraftImport.ts'
import { observationNextAction, observationNextTaskSelector } from './observationNextStep.ts'
import { readableObservationIssue } from './observationReadinessCopy.ts'
import { ObservationNextActionCard } from './ObservationNextActionCard.tsx'
import { ObservationPriceInput } from './ObservationPriceInput.tsx'
import { ObservationPackAmountInput } from './ObservationPackAmountInput.tsx'
import { ObservationPackCountInput } from './ObservationPackCountInput.tsx'
import {
  observationNextRequiredProductField,
  observationRequiredFieldLabels,
} from './observationRequiredLineField.ts'
import { observationVisibleRows } from './observationVisibleRows.ts'
import { downloadBlankM3PaperWorksheet } from './downloadBlankM3PaperWorksheet.ts'

type Side = 'baseline' | 'candidate'
type StudyTextField = Exclude<
  keyof ObservationSheet['study'],
  'maxObservationWindowHours' | 'priceContext'
>

const sourceOptions: { value: ObservationSource; label: string }[] = [
  { value: 'manual-cart', label: 'Handmatige winkelmand' },
  { value: 'receipt', label: 'Bon' },
  { value: 'consented-export', label: 'Export met toestemming' },
]

function toLocalDateTimeValue(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toIsoDateTime(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function safeFilePart(value: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return cleaned || 'draft'
}

function formatLocalDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('nl-NL', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function ObservationView({
  plannerWeekMatchesTemplate,
}: {
  /** Undefined for standalone/SSR field-form consumers. */
  plannerWeekMatchesTemplate?: boolean
} = {}) {
  const [sheet, setSheet] = useState<ObservationSheet>(() => {
    const fresh = buildObservationSheet()
    if (typeof window === 'undefined') return fresh

    try {
      return (
        restoreObservationSheetDraft(
          window.localStorage.getItem(OBSERVATION_DRAFT_STORAGE_KEY),
        ) ?? fresh
      )
    } catch {
      return fresh
    }
  })
  const [importStatus, setImportStatus] = useState<{
    kind: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const [pendingImport, setPendingImport] = useState<ObservationSheet | null>(null)
  const [draftPersistenceFailed, setDraftPersistenceFailed] = useState(false)
  const [draftResetRemovalFailed, setDraftResetRemovalFailed] = useState(false)
  const [showOnlyOpenLines, setShowOnlyOpenLines] = useState(false)
  const [paperRevision, setPaperRevision] = useState('')
  // Never overwrite stored observations that this version cannot safely read.
  // The normal sheet is still usable in memory, but auto-save is quarantined.
  const [draftRecoveryNeeded, setDraftRecoveryNeeded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = window.localStorage.getItem(OBSERVATION_DRAFT_STORAGE_KEY)
      return saved !== null && saved !== '' && restoreObservationSheetDraft(saved) === null
    } catch {
      // A denied storage getter may be hiding a real previous observation.
      return true
    }
  })
  const [recoveryResetArmed, setRecoveryResetArmed] = useState(false)
  // The awaited file read must check the latest *committed* observations,
  // never the sheet captured when the user originally chose the file.
  const latestSheetRef = useRef(sheet)
  const sheetRevisionRef = useRef(0)
  const importRequestRef = useRef(0)
  useLayoutEffect(() => {
    if (latestSheetRef.current !== sheet) {
      latestSheetRef.current = sheet
      sheetRevisionRef.current += 1
    }
  }, [sheet])
  // A draft can remain open across midnight or a future observation timestamp.
  // Keep guidance/readiness synchronized to one clock even without an input edit.
  const [referenceNowMs, setReferenceNowMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setReferenceNowMs(Date.now())
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  // The user's next field task is derived from the current draft; readiness remains authoritative.
  const nextAction = useMemo(
    () => observationNextAction(sheet, referenceNowMs), [sheet, referenceNowMs],
  )
  const progress = useMemo(() => observationSheetProgress(sheet), [sheet])
  const readiness = useMemo(
    () => observationSheetReadiness(sheet, referenceNowMs), [sheet, referenceNowMs],
  )
  const windowSummary = useMemo(
    () => observationWindowSummary(sheet, referenceNowMs), [sheet, referenceNowMs],
  )
  const nextIncomplete = useMemo(
    () => nextIncompleteObservationLine(sheet),
    [sheet],
  )
  const nextTaskSelector = observationNextTaskSelector(nextAction)
  const canNavigateReview = nextAction.stage === 'review'
  const canNavigateExport = nextAction.stage === 'export' && readiness.ready
  const canJumpToNextLine =
    nextAction.stage === 'line' && nextIncomplete !== null &&
    nextIncomplete.side === nextAction.side &&
    nextIncomplete.ingredientId === nextAction.ingredientId

  useEffect(() => {
    if (draftRecoveryNeeded) {
      setDraftPersistenceFailed(true)
      return
    }
    setDraftPersistenceFailed(
      !persistObservationDraft(
        () => window.localStorage,
        OBSERVATION_DRAFT_STORAGE_KEY,
        sheet,
        () => setDraftResetRemovalFailed(false),
      ),
    )
  }, [sheet, draftRecoveryNeeded])

  useEffect(() => {
    setResetArmed(false)
  }, [sheet])

  const downloadUnrecognizedDraft = () => {
    let href: string | null = null
    let anchor: HTMLAnchorElement | null = null
    try {
      const saved = window.localStorage.getItem(OBSERVATION_DRAFT_STORAGE_KEY)
      if (!saved) throw new Error('no saved bytes')
      // Download only on this user's device. Never put original observations
      // into page text, analytics, URL parameters, or a remote service.
      href = URL.createObjectURL(new Blob([saved], {
        type: 'application/octet-stream',
      }))
      anchor = document.createElement('a')
      anchor.href = href
      anchor.download = 'supa-m3-lokaal-herstelorigineel.txt'
      document.body.append(anchor)
      anchor.click()
      setImportStatus({
        kind: 'success',
        message: 'Download van het oorspronkelijke lokale bestand gestart. Controleer of het bestand echt is opgeslagen voordat je het oude concept verwijdert.',
      })
    } catch {
      setImportStatus({
        kind: 'error',
        message: 'De reservekopie kon niet worden gedownload. Het bestaande lokale concept is niet verwijderd; probeer opnieuw voordat je dit wist.',
      })
    } finally {
      anchor?.remove()
      if (href !== null) URL.revokeObjectURL(href)
    }
  }

  const clearUnrecognizedDraft = () => {
    if (!recoveryResetArmed) {
      setRecoveryResetArmed(true)
      setImportStatus({ kind: 'warning', message: 'Bevestig nogmaals: het oude, onleesbare lokale concept wordt definitief verwijderd. Bewaar eerst een reservekopie als je dit wilt herstellen.' })
      return
    }
    const removed = removeObservationDraft(
      () => window.localStorage,
      OBSERVATION_DRAFT_STORAGE_KEY,
    )
    setRecoveryResetArmed(false)
    if (!removed) {
      setImportStatus({ kind: 'error', message: 'Verwijderen is geweigerd. Het bestaande lokale concept is behouden en wordt niet overschreven.' })
      return
    }
    setSheet(buildObservationSheet())
    setPendingImport(null)
    setDraftRecoveryNeeded(false)
    setDraftResetRemovalFailed(false)
    setImportStatus({ kind: 'success', message: 'Oude lokale concept verwijderd. Je kunt een nieuwe meting beginnen; dit is geen besparingsbewijs.' })
  }

  const clearDraft = () => {
    if (observationSheetHasUserInput(sheet) && !resetArmed) {
      setResetArmed(true)
      setImportStatus({
        kind: 'warning',
        message:
          'Wissen is beveiligd: klik nogmaals op “Bevestig wissen” om dit lokale concept definitief leeg te maken.',
      })
      return
    }

    const removed = removeObservationDraft(
      () => window.localStorage,
      OBSERVATION_DRAFT_STORAGE_KEY,
    )
    setDraftResetRemovalFailed(!removed)
    if (!removed) {
      // Browser storage may reject removeItem while a later setItem still
      // succeeds. Never clear the screen: the autosave effect would otherwise
      // overwrite a real human observation with an empty 11+11 template.
      setResetArmed(false)
      setImportStatus({
        kind: 'error',
        message:
          'Wissen is niet gelukt: je ingevulde meting is behouden. Exporteer eerst een JSON-concept of probeer opnieuw.',
      })
      return
    }
    setSheet(buildObservationSheet())
    setResetArmed(false)
    setPendingImport(null)
    setImportStatus(
      removed
        ? {
            kind: 'success',
            message: 'Lokaal concept gewist. Je kunt een nieuwe winkelmeting beginnen.',
          }
        : null,
    )
  }

  const jumpToNextIncomplete = () => {
    // Review navigation only reveals existing validation messages. Never submit data.
    if (canNavigateReview) {
      const review = document.querySelector<HTMLElement>('[data-observation-review-target]')
      review?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      review?.focus({ preventScroll: true })
      return
    }
    // Export navigation focuses an existing explicit download button; never clicks it.
    if (canNavigateExport) {
      const exportButton = document.querySelector<HTMLButtonElement>('[data-observation-export-target]')
      exportButton?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      exportButton?.focus({ preventScroll: true })
      return
    }
    // The selector is generated from literal whitelists, never a user-supplied ID.
    if (nextTaskSelector !== null) {
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(nextTaskSelector)
      if (!input) return
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input.focus({ preventScroll: true })
      return
    }
    // A line jump never skips required study/store metadata or guesses the task.
    if (!canJumpToNextLine || !nextIncomplete) return

    const side = document.querySelector<HTMLElement>(
      `[data-observation-side="${nextIncomplete.side}"]`,
    )
    const line = Array.from(
      side?.querySelectorAll<HTMLDetailsElement>('[data-observation-line]') ?? [],
    ).find(
      (candidate) =>
        candidate.dataset.observationLine === nextIncomplete.ingredientId,
    )

    if (!line) return

    line.open = true
    line.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const currentLine = sheet[nextIncomplete.side].lines.find(
      (candidate) => candidate.ingredientId === nextIncomplete.ingredientId,
    )
    const missingField = currentLine
      ? observationNextRequiredProductField(currentLine)
      : null
    // A missing target remains fail-closed and only focuses availability.
    // These selector values come from a closed product-field union, never IDs.
    const target = missingField
      ? line.querySelector<HTMLInputElement | HTMLSelectElement>(
          `[data-observation-product-field="${missingField}"] input, [data-observation-product-field="${missingField}"] select`,
        )
      : null
    ;(target ?? line.querySelector<HTMLSelectElement>('select'))?.focus({
      preventScroll: true,
    })
  }

  const updateStudy = (
    field: StudyTextField,
    value: string,
  ) => {
    setSheet((current) => ({
      ...current,
      study: {
        ...current.study,
        [field]: value,
      },
    }))
  }

  const updatePriceContext = (
    value: ObservationSheet['study']['priceContext'],
  ) => {
    setSheet((current) => ({
      ...current,
      study: {
        ...current.study,
        priceContext: value,
      },
    }))
  }

  const updateObservation = (
    side: Side,
    patch: Partial<Omit<StoreObservation, 'store' | 'lines'>>,
  ) => {
    setSheet((current) => ({
      ...current,
      [side]: {
        ...current[side],
        ...patch,
      },
    }))
  }

  const updateStore = (
    side: Side,
    field: keyof StoreObservation['store'],
    value: string,
  ) => {
    setSheet((current) => ({
      ...current,
      [side]: {
        ...current[side],
        store: {
          ...current[side].store,
          [field]: value,
        },
      },
    }))
  }

  const updateProduct = (
    side: Side,
    lineIndex: number,
    patch: Partial<ObservedProduct>,
  ) => {
    setSheet((current) => ({
      ...current,
      [side]: {
        ...current[side],
        lines: current[side].lines.map((line, index) =>
          index === lineIndex
            ? {
                ...line,
                observedProduct: {
                  ...line.observedProduct,
                  ...patch,
                },
              }
            : line,
        ),
      },
    }))
  }

  const downloadPaperWorksheet = () => {
    // A version is operator-provided only; never infer HEAD or read draft
    // storage. Reject malformed values BEFORE producing any paper file.
    if (paperRevision !== '' && !/^[0-9a-f]{40}$/.test(paperRevision)) {
      setImportStatus({
        kind: 'error',
        message: 'Codeversie ongeldig: vul exact 40 kleine hextekens in (0-9, a-f), of laat leeg en vul het papieren vakje later zelf in.',
      })
      return
    }
    // Generates only the canonical blank 11+11 paper worksheet, not the
    // current person's private draft, prices, provenance or participant key.
    const started = downloadBlankM3PaperWorksheet(paperRevision)
    setImportStatus({
      kind: started ? 'success' : 'error',
      message: started
        ? 'Het lege PLUS- en DekaMarkt-veldformulier wordt gedownload. Controleer of het bestand is opgeslagen. Print A4 liggend op 100% (precies twee bladen). De opgegeven softwareversie is niet automatisch geverifieerd; dit is geen meetbewijs.'
        : 'Het lege veldformulier kon niet worden gedownload. Je huidige meetconcept is niet veranderd.',
    })
  }

  const downloadDraft = () => {
    let href: string | null = null
    let anchor: HTMLAnchorElement | null = null
    try {
      const blob = new Blob([`${JSON.stringify(sheet, null, 2)}\n`], {
        type: 'application/json',
      })
      href = URL.createObjectURL(blob)
      anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `supa-m3-observation-${safeFilePart(sheet.study.studyId)}.json`
      document.body.append(anchor)
      anchor.click()
      // A click only starts a browser download; it cannot prove disk storage.
      setImportStatus({
        kind: 'success',
        message: 'Download van je JSON-concept gestart. Controleer of het bestand echt is opgeslagen op je apparaat.',
      })
    } catch {
      setImportStatus({
        kind: 'error',
        message: 'Download van je JSON-concept is mislukt. De ingevulde meting is behouden; controleer de downloadrechten van je browser en probeer opnieuw.',
      })
    } finally {
      anchor?.remove()
      if (href !== null) URL.revokeObjectURL(href)
    }
  }

  const applyImportedDraft = (restored: ObservationSheet) => {
    if (draftRecoveryNeeded) {
      setImportStatus({
        kind: 'error',
        message: 'Import is gepauzeerd: bewaar of verwijder eerst het onleesbare lokale concept om overschrijven te voorkomen.',
      })
      return
    }
    setSheet(restored)
    setPendingImport(null)
    setImportStatus({
      kind: 'success',
      message:
        'Concept veilig geïmporteerd. Bewaar de werkelijke gegevens; een aparte controle bepaalt pas later of beide winkelmetingen vergelijkbaar zijn.',
    })
  }

  const importDraft = async (file: File | undefined) => {
    if (!file) return
    const requestId = ++importRequestRef.current
    const revisionAtStart = sheetRevisionRef.current

    if (!observationDraftFileSizeAllowed(file.size)) {
      setPendingImport(null)
      setImportStatus({
        kind: 'error',
        message: 'Import geweigerd: het JSON-concept is groter dan 1 MB.',
      })
      return
    }

    try {
      const restored = restoreObservationSheetDraft(await file.text())
      // When two local reads finish out of order, only the newest selection
      // may request replacement. An older file cannot undo newer field work.
      if (requestId !== importRequestRef.current) return
      if (!restored) {
        setPendingImport(null)
        setImportStatus({
          kind: 'error',
          message:
            'Import geweigerd: het bestand past niet bij de vereiste meting of voldoet niet aan de controles.',
        })
        return
      }

      if (
        sheetRevisionRef.current !== revisionAtStart ||
        observationSheetHasUserInput(latestSheetRef.current)
      ) {
        setPendingImport(restored)
        setImportStatus({
          kind: 'warning',
          message:
            'Dit apparaat bevat al een ingevuld concept. Kies expliciet of het geïmporteerde concept dit lokale werk mag vervangen.',
        })
        return
      }

      applyImportedDraft(restored)
    } catch {
      if (requestId !== importRequestRef.current) return
      setPendingImport(null)
      setImportStatus({
        kind: 'error',
        message: 'Import mislukt: het JSON-bestand kon niet worden gelezen.',
      })
    }
  }

  return (
    <section className="screen observation-screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Echte winkelprijzen verzamelen</span>
          <h2>Meten zonder gokken.</h2>
        </div>
      </div>

      <p className="disclaimer" data-observation-fixed-week-note>
        Deze meting gebruikt altijd de vaste onderzoeksweek: vier maaltijden en
        elf dezelfde ingrediënten bij PLUS en DekaMarkt. Dit formulier volgt
        wijzigingen in Planner niet automatisch en is nog geen besparingsbewijs.
      </p>
      {plannerWeekMatchesTemplate === false && (
        <div className="attention-card" role="alert" data-observation-planner-week-mismatch>
          <strong>Je Planner wijkt af van de vaste meetweek</strong>
          <span>
            Je gewijzigde dagen of recepten zijn niet overgenomen. De 22 regels
            hieronder meten uitsluitend de oorspronkelijke onderzoeksweek.
            Vergelijk dit concept niet met de boodschappenlijst van je aangepaste
            week. Je invoer blijft intact; pas nooit winkelmetingen aan om ze
            passend te maken bij de Planner.
          </span>
        </div>
      )}

      <ObservationNextActionCard action={nextAction} />

      <div className="observation-status">
        <strong>
          {progress.completeLines}/{progress.totalLines} regels compleet
        </strong>
        <span>
          {progress.availabilityRecorded}/{progress.totalLines} beschikbaarheid gemeten ·{' '}
          {progress.metadataCompleted}/{progress.metadataTotal} verplichte metadata ingevuld
        </span>
        <button
          className="ghost-button"
          type="button"
          data-observation-open-lines-toggle
          aria-pressed={showOnlyOpenLines}
          onClick={() => setShowOnlyOpenLines((current) => !current)}
        >
          {showOnlyOpenLines ? 'Toon alle regels' : 'Toon alleen open regels'}
        </button>
        <small className="observation-field-hint">
          Dit filter verandert geen meetgegevens. Toon alle regels om een eerdere meting aan te passen.
        </small>
        <div className="observation-paper-tools">
          <label htmlFor="m3-paper-revision">
            Codeversie voor veldformulier (optioneel; exacte Git commit SHA)
          </label>
          <input
            id="m3-paper-revision"
            type="text"
            data-observation-paper-revision
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            placeholder="40 kleine hextekens of leeg laten"
            value={paperRevision}
            onChange={(event) => setPaperRevision(event.target.value)}
          />
          <button
            className="ghost-button"
            type="button"
            data-observation-paper-worksheet
            onClick={downloadPaperWorksheet}
          >
            Download leeg veldformulier (PLUS + DekaMarkt)
          </button>
          <small className="observation-field-hint">
            Twee lege A4-liggende bladen met dezelfde 11 boodschappen. De codeversie
            wordt niet automatisch gecontroleerd tegen GitHub. Er worden geen
            ingevulde metingen of prijzen meegestuurd; dit is geen meetbewijs.
          </small>
        </div>
        <p>
          Vul alleen gegevens in die je zelf hebt waargenomen. Een aparte controle
          moet daarna bepalen of beide winkelmetingen echt vergelijkbaar zijn.
        </p>
        {draftRecoveryNeeded ? (
          <p role="status" data-observation-save-status="protected">
            Automatisch bewaren staat uit: dit apparaat bevat een eerder
            concept dat niet veilig kan worden gelezen. Nieuwe invoer blijft
            tijdelijk totdat je het oorspronkelijke bestand hebt veiliggesteld
            en expliciet opnieuw begint.
          </p>
        ) : draftPersistenceFailed ? (
          <p role="status" data-observation-save-status="failed">
            Je nieuwste invoer is niet lokaal opgeslagen. Bewaar het
            JSON-concept handmatig voordat je deze pagina sluit of vernieuwt.
          </p>
        ) : (
          <p data-observation-save-status="normal">
            Je concept wordt automatisch lokaal op dit apparaat bewaard, zodat een
            refresh of gesloten tab je winkelmeting niet wist.
          </p>
        )}
        <button
          className="ghost-button observation-next-button"
          type="button"
          onClick={jumpToNextIncomplete}
          disabled={nextTaskSelector === null && !canJumpToNextLine && !canNavigateReview && !canNavigateExport}
        >
          {nextAction.stage === 'line'
            ? nextObservationActionLabel(sheet, nextIncomplete)
            : nextTaskSelector !== null ? `Ga naar: ${nextAction.title}`
            : canNavigateReview ? 'Ga naar: controlepunten'
            : canNavigateExport ? 'Ga naar: JSON-concept bewaren'
            : 'Geen volgende invoerstap'}
        </button>
        {windowSummary.state === 'single-observation' && (
          <p>
            <strong>24u-venster:</strong> meet de andere winkel uiterlijk{' '}
            {formatLocalDateTime(windowSummary.deadlineAt)}. De deadline wordt
            berekend vanaf de eerste geldige observatietijd.
          </p>
        )}
        {windowSummary.state === 'within-window' && (
          <p>
            <strong>24u-venster geldig:</strong> de twee observaties liggen{' '}
            {windowSummary.deltaHours.toFixed(1)} uur uit elkaar.
          </p>
        )}
        {windowSummary.state === 'outside-window' && (
          <p>
            <strong>24u-venster overschreden:</strong> de twee observaties liggen{' '}
            {windowSummary.deltaHours.toFixed(1)} uur uit elkaar. Deze combinatie
            is niet geschikt voor een eerlijke winkelvergelijking.
          </p>
        )}
      </div>

      <div
        className={`observation-readiness ${readiness.ready ? 'is-ready' : ''}`}
        data-observation-review-target
        tabIndex={-1}
        aria-live="polite"
      >
        <div>
          <span className="eyebrow">Controle voor bewaren</span>
          <strong>
            {readiness.ready
              ? 'Invoer klaar om apart te controleren'
              : `Nog ${readiness.issues.length} controle${readiness.issues.length === 1 ? '' : 's'} open`}
          </strong>
        </div>
        {readiness.ready ? (
          <p>
            Je hebt de verplichte velden ingevuld. Bewaar het concept en laat het
            apart beoordelen. Dit bewijst nog geen prijsverschil of besparing.
          </p>
        ) : (
          <>
            <p>
              Controleer de volgende gegevens voordat je het concept bewaart:
            </p>
            <ul>
              {readiness.issues.slice(0, 6).map((issue) => (
                <li key={issue}>{readableObservationIssue(issue)}</li>
              ))}
            </ul>
            {readiness.issues.length > 6 && (
              <p>+ {readiness.issues.length - 6} extra controles.</p>
            )}
          </>
        )}
      </div>

      <div className="observation-card">
        <div>
          <span className="eyebrow">Studie</span>
          <h3>Gegevens van deze meting</h3>
        </div>
        <div className="field-grid">
          <label>
            Metingcode
            <input
              data-observation-study-field="studyId"
              value={sheet.study.studyId}
              onChange={(event) => updateStudy('studyId', event.target.value)}
              placeholder="weekmeting-001"
            />
          </label>
          <label>
            Anonieme deelnemerscode
            <input
              data-observation-study-field="participantKey"
              value={sheet.study.participantKey}
              onChange={(event) =>
                updateStudy('participantKey', event.target.value)
              }
              placeholder="student-001"
              autoComplete="off"
            />
            <small className="observation-field-hint">Gebruik geen naam of e-mailadres. Kies een anonieme code.</small>
          </label>
          <label>
            Doelgroep
            <input
              data-observation-study-field="population"
              value={sheet.study.population}
              onChange={(event) => updateStudy('population', event.target.value)}
              placeholder="uitwonende student"
            />
          </label>
          <label>
            Gebied
            <input
              data-observation-study-field="region"
              value={sheet.study.region}
              onChange={(event) => updateStudy('region', event.target.value)}
              placeholder="Leiden"
            />
          </label>
          <label>
            Hoe zijn de prijzen gemeten?
            <select
              data-observation-study-field="priceContext"
              value={sheet.study.priceContext}
              onChange={(event) =>
                updatePriceContext(
                  event.target.value as ObservationSheet['study']['priceContext'],
                )
              }
            >
              <option value="">Kies dezelfde context voor beide winkels</option>
              <option value="in-store">In de winkel</option>
              <option value="online-order">Online bestelling</option>
            </select>
          </label>
          <label>
            Startdatum van je planweek
            <input
              type="date"
              data-observation-study-field="weekStart"
              value={sheet.study.weekStart}
              onChange={(event) => updateStudy('weekStart', event.target.value)}
            />
          </label>
          <div className="readonly-field">
            <span>Max. observatievenster</span>
            <strong>{sheet.study.maxObservationWindowHours} uur</strong>
          </div>
        </div>
      </div>

      {(['baseline', 'candidate'] as Side[]).map((side) => {
        const observation = sheet[side]
        const storeProgress = observationStoreProgress(observation)
        const retailerCopy = observationRetailerCopy(side)

        return (
          <div className="observation-card" key={side} data-observation-side={side}>
            <div className="observation-card-heading">
              <div>
                <span className="eyebrow">{retailerCopy.eyebrow}</span>
                <h3>{observation.store.name || retailerCopy.emptyStoreLabel}</h3>
              </div>
              <span className="observation-count">
                {storeProgress.completeLines}/{storeProgress.totalLines} compleet
              </span>
            </div>

            <p className="disclaimer">
              {retailerCopy.guidance}
            </p>

            <div className="field-grid">
              <label>
                Winkelnaam
                <input
                  data-observation-store-field="name"
                  value={observation.store.name}
                  onChange={(event) =>
                    updateStore(side, 'name', event.target.value)
                  }
                  placeholder={retailerCopy.storePlaceholder}
                />
              </label>
              <label>
                Vestigingscode
                <input
                  data-observation-store-field="id"
                  value={observation.store.id}
                  onChange={(event) =>
                    updateStore(side, 'id', event.target.value)
                  }
                  placeholder={retailerCopy.storeIdPlaceholder}
                />
              </label>
              <label>
                Code van deze winkelmeting
                <input
                  data-observation-store-field="evidenceId"
                  value={observation.evidenceId}
                  onChange={(event) =>
                    updateObservation(side, { evidenceId: event.target.value })
                  }
                  placeholder="obs-..."
                />
              </label>
              <div className="observation-field-with-action">
                <label>
                  Geobserveerd op
                  <input
                    type="datetime-local"
                    data-observation-store-field="observedAt"
                    value={toLocalDateTimeValue(observation.observedAt)}
                    onChange={(event) =>
                      updateObservation(side, {
                        observedAt: toIsoDateTime(event.target.value),
                      })
                    }
                  />
                </label>
                <button
                  className="ghost-button observation-now-button"
                  type="button"
                  aria-label={`Gebruik huidige tijd voor ${retailerCopy.expectedRetailer}`}
                  onClick={() =>
                    updateObservation(side, {
                      observedAt: observationTimestampFromDate(new Date()),
                    })
                  }
                >
                  Gebruik huidige tijd
                </button>
              </div>
              <label>
                Bron
                <select
                  value={observation.source}
                  onChange={(event) =>
                    updateObservation(side, {
                      source: event.target.value as ObservationSource,
                    })
                  }
                >
                  {sourceOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-wide">
                Hoe heb je de prijzen vastgelegd?
                <input
                  data-observation-store-field="provenanceNote"
                  value={observation.provenanceNote}
                  onChange={(event) =>
                    updateObservation(side, {
                      provenanceNote: event.target.value,
                    })
                  }
                  placeholder="Bijv. prijzen op het schap gecontroleerd"
                />
                <small className="observation-field-hint">Beschrijf de bron en het meetmoment; noteer geen persoonsgegevens.</small>
              </label>
            </div>

            <div className="observation-lines">
              {showOnlyOpenLines && observationVisibleRows(observation, true).length === 0 && (
                <p className="observation-field-hint" data-observation-no-open-lines>
                  Alle regels van deze winkel zijn gemeten. Toon alle regels om ze te controleren.
                </p>
              )}
              {observationVisibleRows(observation, showOnlyOpenLines).map(({ line, lineIndex }) => {
                const product = line.observedProduct
                const availability =
                  product.available === null ? '' : String(product.available)

                return (
                  <details
                    className="observation-line"
                    key={line.ingredientId}
                    data-observation-line={line.ingredientId}
                  >
                    <summary>
                      <div>
                        <strong>{line.ingredientLabel}</strong>
                        <ObservationRequirementText
                          amount={line.requirement.amount}
                          unit={line.requirement.unit}
                        />
                      </div>
                      <span className="line-state">
                        {product.available === true
                          ? observationLineCollectionComplete(line)
                            ? 'compleet'
                            : 'details aanvullen'
                          : product.available === false
                            ? 'niet beschikbaar'
                            : 'nog meten'}
                      </span>
                    </summary>

                    <div className="line-fields">
                      {product.available === true &&
                        !observationLineCollectionComplete(line) &&
                        observationNextRequiredProductField(line) !== null && (
                          <p className="observation-field-hint field-wide" role="status">
                            Nog invullen: {observationRequiredFieldLabels[
                              observationNextRequiredProductField(line)!
                            ]}.
                          </p>
                        )}
                      <label data-observation-product-field="available">
                        Beschikbaar?
                        <select
                          aria-label={`${side} ${line.ingredientLabel} beschikbaar`}
                          value={availability}
                          onChange={(event) => {
                            const available =
                              event.target.value === ''
                                ? null
                                : event.target.value === 'true'

                            setSheet((current) => ({
                              ...current,
                              [side]: {
                                ...current[side],
                                lines: current[side].lines.map((currentLine, index) =>
                                  index === lineIndex
                                    ? {
                                        ...currentLine,
                                        observedProduct: withObservedProductAvailability(
                                          currentLine.observedProduct,
                                          available,
                                        ),
                                      }
                                    : currentLine,
                                ),
                              },
                            }))
                          }}
                        >
                          <option value="">Nog niet gemeten</option>
                          <option value="true">Ja</option>
                          <option value="false">Nee</option>
                        </select>
                      </label>

                      {product.available === true && (
                        <>
                          <label className="field-wide" data-observation-product-field="productName">
                            Productnaam
                            <input
                              value={product.productName}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  productName: event.target.value,
                                })
                              }
                              placeholder="Exacte productnaam"
                            />
                          </label>
                          <label>
                            Product-ID optioneel
                            <input
                              value={product.productId}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  productId: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label data-observation-product-field="packAmount">
                            Verpakkingshoeveelheid
                            <ObservationPackAmountInput
                              key={`${side}:${line.ingredientId}`}
                              amount={product.packAmount}
                              label={`${side === 'baseline' ? 'PLUS' : 'DekaMarkt'} · ${line.ingredientLabel} · verpakkingshoeveelheid`}
                              onAmountChange={(packAmount) =>
                                updateProduct(side, lineIndex, { packAmount })
                              }
                            />
                          </label>
                          <label data-observation-product-field="packUnit">
                            Eenheid
                            <select
                              value={product.packUnit ?? ''}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  packUnit: event.target.value
                                    ? (event.target.value as ObservedProduct['packUnit'])
                                    : null,
                                })
                              }
                            >
                              <option value="">Kies</option>
                              <ObservationPackUnitOptions />
                            </select>
                          </label>
                          <label data-observation-product-field="packCount">
                            Aantal per verpakking
                            <ObservationPackCountInput
                              key={`${side}:${line.ingredientId}`}
                              count={product.packCount}
                              label={`${side === 'baseline' ? 'PLUS' : 'DekaMarkt'} · ${line.ingredientLabel} · aantal per verpakking`}
                              onCountChange={(packCount) =>
                                updateProduct(side, lineIndex, { packCount })
                              }
                            />
                          </label>
                          <label data-observation-product-field="priceCents">
                            Prijs per verpakking (€)
                            <ObservationPriceInput
                              label={`${side === 'baseline' ? 'PLUS' : 'DekaMarkt'} · ${line.ingredientLabel} · prijs per verpakking`}
                              key={`${side}:${line.ingredientId}`}
                              priceCents={product.priceCents}
                              onPriceChange={(priceCents) =>
                                updateProduct(side, lineIndex, { priceCents })
                              }
                            />
                          </label>
                          <label className="field-wide">
                            Bron-URL optioneel
                            <input
                              type="url"
                              value={product.sourceUrl}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  sourceUrl: event.target.value,
                                })
                              }
                              placeholder="https://..."
                            />
                          </label>
                          <label className="field-wide">
                            Notitie optioneel
                            <input
                              value={product.note}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  note: event.target.value,
                                })
                              }
                              placeholder="Bijv. aanbieding alleen met kaart"
                            />
                          </label>
                        </>
                      )}

                      <button
                        className="ghost-button observation-line-next field-wide"
                        type="button"
                        onClick={jumpToNextIncomplete}
                        disabled={
                          !observationLineCollectionComplete(line) ||
                          !nextIncomplete
                        }
                      >
                        {observationLineCollectionComplete(line)
                          ? nextObservationActionLabel(sheet, nextIncomplete)
                          : 'Vul deze regel eerst af'}
                      </button>
                    </div>
                  </details>
                )
              })}
            </div>
          </div>
        )
      })}

      {draftRecoveryNeeded && (
        <div className="observation-import-status is-warning" role="alert" data-observation-recovery-warning>
          <strong>Ouder lokaal meetconcept niet veilig te lezen</strong>
          <p>
            Automatisch bewaren is uitgeschakeld om eerder ingevulde winkelprijzen
            niet te overschrijven. Nieuwe invoer is tijdelijk totdat je een
            reservekopie maakt en expliciet opnieuw begint.
          </p>
          <button className="ghost-button" type="button" onClick={downloadUnrecognizedDraft}>
            Bewaar oorspronkelijk lokaal bestand
          </button>
          <button className={`ghost-button ${recoveryResetArmed ? 'is-danger' : ''}`}
            type="button" onClick={clearUnrecognizedDraft}>
            {recoveryResetArmed ? 'Bevestig definitief verwijderen' : 'Oud concept verwijderen en opnieuw beginnen'}
          </button>
        </div>
      )}

      <div className="observation-actions">
        <button className="primary-button" type="button" data-observation-export-target onClick={downloadDraft}>
          JSON-concept bewaren
        </button>
        <label className="ghost-button observation-import-button">
          JSON-concept openen
          <input
            aria-label="JSON-concept openen"
            type="file"
            disabled={draftRecoveryNeeded}
            accept=".json,application/json"
            onChange={async (event) => {
              await importDraft(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        <button
          className={`ghost-button ${resetArmed ? 'is-danger' : ''}`}
          type="button"
          onClick={clearDraft}
          disabled={draftRecoveryNeeded}
        >
          {resetArmed ? 'Bevestig wissen' : 'Alles wissen'}
        </button>
      </div>

      {draftPersistenceFailed && (
        <p className="observation-import-status is-warning" role="status">
          Automatisch bewaren is mislukt. Bewaar dit concept handmatig als JSON
          voordat je deze pagina sluit.
        </p>
      )}

      {draftResetRemovalFailed && (
        <p className="observation-import-status is-warning" role="status">
          Het scherm is niet leeggemaakt; het eerder opgeslagen lokale concept
          kon niet worden verwijderd. Bewaar zo nodig handmatig een JSON-kopie
          en probeer opnieuw; een volgende succesvolle lokale opslag herstelt
          deze waarschuwing automatisch.
        </p>
      )}

      {importStatus && (
        <p
          className={`observation-import-status is-${importStatus.kind}`}
          role="status"
        >
          {importStatus.message}
        </p>
      )}

      {pendingImport && (
        <div className="observation-import-confirmation" role="group" aria-label="Import bevestigen">
          <button
            className="primary-button"
            type="button"
            onClick={() => applyImportedDraft(pendingImport)}
          >
            Huidig concept vervangen
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setPendingImport(null)
              setImportStatus(null)
            }}
          >
            Import annuleren
          </button>
        </div>
      )}

      <p className="disclaimer">
        Vul alleen waarden in die je echt hebt waargenomen. Een gedownload
        concept is nog geen bewijs van besparing. Bewaar de originele waarnemingen;
        een aparte controle moet de twee winkelmetingen vergelijken.
      </p>
    </section>
  )
}
