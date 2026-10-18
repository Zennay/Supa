import { useRef, useState } from 'react'
import { downloadPreparedWeekMenu } from './downloadWeekMenuText.ts'
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
      {selectFeedback?.sourceText === text && (
        <p role="status" aria-live="polite" className="disclaimer">{selectFeedback.message}</p>
      )}
      {saveFeedback?.sourceText === text && (
        <p role="status" aria-live="polite" className="disclaimer">{saveFeedback.message}</p>
      )}
    </div>
  )
}
