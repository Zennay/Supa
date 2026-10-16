import { useRef } from 'react'
import { selectWeekMenuText } from './selectWeekMenuText.ts'

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

  const selectText = () => {
    const textarea = textareaRef.current
    selectWeekMenuText(textarea, text)
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
    </div>
  )
}
