import './ObservationView.css'
import { useMemo, useState } from 'react'
import {
  buildObservationSheet,
  observationSheetProgress,
  type ObservationSheet,
  type ObservationSource,
  type ObservedProduct,
  type StoreObservation,
} from '../../domain/m3ObservationSheet.ts'

type Side = 'baseline' | 'candidate'

const sideLabels: Record<Side, string> = {
  baseline: 'Winkel A · baseline',
  candidate: 'Winkel B · vergelijking',
}

const sourceOptions: { value: ObservationSource; label: string }[] = [
  { value: 'manual-cart', label: 'Handmatige winkelmand' },
  { value: 'receipt', label: 'Bon' },
  { value: 'consented-export', label: 'Export met toestemming' },
]

const packUnits = ['g', 'kg', 'ml', 'l', 'piece'] as const

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

function euroValue(priceCents: number | null) {
  return priceCents === null ? '' : (priceCents / 100).toFixed(2)
}

function priceCents(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100)
    : null
}

function safeFilePart(value: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return cleaned || 'draft'
}

export function ObservationView() {
  const [sheet, setSheet] = useState<ObservationSheet>(() =>
    buildObservationSheet(),
  )
  const progress = useMemo(() => observationSheetProgress(sheet), [sheet])

  const updateStudy = (
    field: keyof ObservationSheet['study'],
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

  const downloadDraft = () => {
    const blob = new Blob([`${JSON.stringify(sheet, null, 2)}\n`], {
      type: 'application/json',
    })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `supa-m3-observation-${safeFilePart(sheet.study.studyId)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
  }

  return (
    <section className="screen observation-screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">M3 · echte winkelobservatie</span>
          <h2>Meten zonder gokken.</h2>
        </div>
      </div>

      <div className="observation-status">
        <strong>
          {progress.availabilityRecorded}/{progress.totalLines} regels geobserveerd
        </strong>
        <span>
          {progress.metadataCompleted}/{progress.metadataTotal} verplichte metadata
          ingevuld
        </span>
        <p>
          Dit scherm verzamelt invoer. Pas de bestaande converter en assessment
          bepalen of de observatie geldig en vergelijkbaar is.
        </p>
      </div>

      <div className="observation-card">
        <div>
          <span className="eyebrow">Studie</span>
          <h3>Privacy-safe context</h3>
        </div>
        <div className="field-grid">
          <label>
            Study ID
            <input
              value={sheet.study.studyId}
              onChange={(event) => updateStudy('studyId', event.target.value)}
              placeholder="m3-week-001"
            />
          </label>
          <label>
            Pseudonieme participant key
            <input
              value={sheet.study.participantKey}
              onChange={(event) =>
                updateStudy('participantKey', event.target.value)
              }
              placeholder="student-001"
              autoComplete="off"
            />
          </label>
          <label>
            Populatie
            <input
              value={sheet.study.population}
              onChange={(event) => updateStudy('population', event.target.value)}
              placeholder="uitwonende student"
            />
          </label>
          <label>
            Regio
            <input
              value={sheet.study.region}
              onChange={(event) => updateStudy('region', event.target.value)}
              placeholder="Leiden"
            />
          </label>
          <label>
            Week start
            <input
              type="date"
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

        return (
          <div className="observation-card" key={side} data-observation-side={side}>
            <div className="observation-card-heading">
              <div>
                <span className="eyebrow">{sideLabels[side]}</span>
                <h3>{observation.store.name || 'Nog geen winkel ingevuld'}</h3>
              </div>
              <span className="observation-count">
                {
                  observation.lines.filter(
                    (line) =>
                      typeof line.observedProduct.available === 'boolean',
                  ).length
                }
                /{observation.lines.length}
              </span>
            </div>

            <div className="field-grid">
              <label>
                Winkelnaam
                <input
                  value={observation.store.name}
                  onChange={(event) =>
                    updateStore(side, 'name', event.target.value)
                  }
                  placeholder="Bijv. PLUS"
                />
              </label>
              <label>
                Winkel-ID
                <input
                  value={observation.store.id}
                  onChange={(event) =>
                    updateStore(side, 'id', event.target.value)
                  }
                  placeholder="plus-leiden-..."
                />
              </label>
              <label>
                Evidence ID
                <input
                  value={observation.evidenceId}
                  onChange={(event) =>
                    updateObservation(side, { evidenceId: event.target.value })
                  }
                  placeholder="obs-..."
                />
              </label>
              <label>
                Geobserveerd op
                <input
                  type="datetime-local"
                  value={toLocalDateTimeValue(observation.observedAt)}
                  onChange={(event) =>
                    updateObservation(side, {
                      observedAt: toIsoDateTime(event.target.value),
                    })
                  }
                />
              </label>
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
                Provenance-notitie
                <input
                  value={observation.provenanceNote}
                  onChange={(event) =>
                    updateObservation(side, {
                      provenanceNote: event.target.value,
                    })
                  }
                  placeholder="Hoe en waar deze prijzen echt zijn waargenomen"
                />
              </label>
            </div>

            <div className="observation-lines">
              {observation.lines.map((line, lineIndex) => {
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
                        <span>
                          nodig: {line.requirement.amount} {line.requirement.unit}
                        </span>
                      </div>
                      <span className="line-state">
                        {product.available === true
                          ? 'gevonden'
                          : product.available === false
                            ? 'niet beschikbaar'
                            : 'nog meten'}
                      </span>
                    </summary>

                    <div className="line-fields">
                      <label>
                        Beschikbaar?
                        <select
                          aria-label={`${side} ${line.ingredientLabel} beschikbaar`}
                          value={availability}
                          onChange={(event) =>
                            updateProduct(side, lineIndex, {
                              available:
                                event.target.value === ''
                                  ? null
                                  : event.target.value === 'true',
                            })
                          }
                        >
                          <option value="">Nog niet gemeten</option>
                          <option value="true">Ja</option>
                          <option value="false">Nee</option>
                        </select>
                      </label>

                      {product.available === true && (
                        <>
                          <label className="field-wide">
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
                          <label>
                            Verpakkingshoeveelheid
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={product.packAmount ?? ''}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  packAmount: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </label>
                          <label>
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
                              {packUnits.map((unit) => (
                                <option value={unit} key={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Aantal per verpakking
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={product.packCount}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  packCount: Math.max(
                                    1,
                                    Math.trunc(Number(event.target.value) || 1),
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Prijs per verpakking (€)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={euroValue(product.priceCents)}
                              onChange={(event) =>
                                updateProduct(side, lineIndex, {
                                  priceCents: priceCents(event.target.value),
                                })
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
                    </div>
                  </details>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="observation-actions">
        <button className="primary-button" type="button" onClick={downloadDraft}>
          JSON-concept bewaren
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={() => setSheet(buildObservationSheet())}
        >
          Alles wissen
        </button>
      </div>

      <p className="disclaimer">
        Vul alleen waarden in die je echt hebt waargenomen. Een gedownload
        concept blijft <strong>collection-template-not-evidence</strong> totdat
        de bestaande M3-converter en assessment het verwerken.
      </p>
    </section>
  )
}
