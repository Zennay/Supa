import { useRef, useState } from 'react'
import { downloadPreparedWeekMenu } from './downloadWeekMenuText.ts'
import { downloadPreparedWeekCalendar } from './downloadWeekMenuCalendar.ts'
import { selectWeekMenuText, weekMenuSelectionFeedback } from './selectWeekMenuText.ts'

type WeekShareManualCopyProps = {
  text: string
  rows: number
}

/**
 * Show an intentional user-initiated select-all option instead of requesting
 * privileged Clipboard API access. Mobile browsers may ignore autofocus.
 */
export function WeekShareManualCopy({ text, rows }: WeekShareManualCopyProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [calendarMonday, setCalendarMonday] = useState('')
  const [calendarFeedback, setCalendarFeedback] = useState<{ sourceText: string; monday: string; message: string } | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<{ sourceText: string; message: string } | null>(null)
  const [selectFeedback, setSelectFeedback] = useState<{ sourceText: string; message: string } | null>(null)

  const selectText = () => {
    // This action is user initiated. On a restricted mobile browser, guide
    // manual copy instead of silently assuming native selection worked.
    const selected = selectWeekMenuText(textareaRef.current, text)
    setSaveFeedback(null)
    setSelectFeedback({
      sourceText: text,
      message: weekMenuSelectionFeedback(selected),
    })
  }

  const saveWeekMenu = () => {
    setSelectFeedback(null)
    const saved = downloadPreparedWeekMenu(textareaRef.current, text, {
      createObjectURL: (content) =>
        URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })),
      triggerDownload: (url, filename) => {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        try { anchor.click() } finally { anchor.remove() }
      },
      // Waiting one tick for the browser to begin its own download avoids
      // revoking the Blob before mobile browsers have consumed the URL.
      scheduleRevoke: (url) => {
        window.setTimeout(() => URL.revokeObjectURL(url), 3000)
      },
    })
    setSaveFeedback({
      sourceText: text,
      message: saved
        ? 'Download gestart. Controleer je downloads op dit apparaat.'
        : 'Download niet beschikbaar. Selecteer en kopieer de tekst handmatig.',
    })
  }

  const saveCalendar = () => {
    setSelectFeedback(null)
    const saved = downloadPreparedWeekCalendar(textareaRef.current, text, calendarMonday, {
      createObjectURL: (content) =>
        URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' })),
      triggerDownload: (url, filename) => {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        try { anchor.click() } finally { anchor.remove() }
      },
      scheduleRevoke: (url) => {
        window.setTimeout(() => URL.revokeObjectURL(url), 3000)
      },
    })
    setCalendarFeedback({
      sourceText: text,
      monday: calendarMonday,
      message: saved
        ? 'Agenda-bestand gemaakt. Open het .ics-bestand om de maaltijden in je agenda te zetten.'
        : 'Agenda-export niet beschikbaar. Kies de maandag van je week en controleer het weekmenu.',
    })
  }

  return (
    <div className="week-share-manual">
      <div className="week-share-copy-tools">
        <label htmlFor="week-share-text">Weekmenu om handmatig te kopiëren</label>
        <button type="button" className="ghost-button" onClick={selectText}>
          Selecteer alle tekst
        </button>
      </div>
      <textarea
        ref={textareaRef}
        id="week-share-text"
        readOnly
        rows={rows}
        value={text}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="ghost-button" onClick={saveWeekMenu}>
        Bewaar als tekstbestand
      </button>
      <div className="week-share-calendar">
        <label htmlFor="week-share-calendar-monday">Maandag van deze week (voor agenda-export)</label>
        <input
          id="week-share-calendar-monday"
          type="date"
          min="2000-01-01"
          max="2099-12-31"
          value={calendarMonday}
          onChange={(event) => setCalendarMonday(event.currentTarget.value)}
        />
        <button type="button" className="ghost-button" onClick={saveCalendar}>
          Voeg weekmenu toe aan agenda (.ics)
        </button>
        <p className="disclaimer">
          Kies zelf de juiste maandag. De export maakt alleen lokale, hele-dag
          maaltijden zonder winkelprijzen; er wordt niets automatisch gedeeld.
        </p>
      </div>
      {calendarFeedback?.sourceText === text && calendarFeedback.monday === calendarMonday && (
        <p role="status" aria-live="polite" className="disclaimer">{calendarFeedback.message}</p>
      )}
      {selectFeedback?.sourceText === text && (
        <p role="status" aria-live="polite" className="disclaimer">{selectFeedback.message}</p>
      )}
      {saveFeedback?.sourceText === text && (
        <p role="status" aria-live="polite" className="disclaimer">{saveFeedback.message}</p>
      )}
    </div>
  )
}
