import { useState } from 'react'

import { Modal } from './Modal'

interface Props {
  title: string
  initial: string
  confirmLabel: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({ title, initial, confirmLabel, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initial)

  const apply = () => {
    const v = value.trim()
    if (!v) return
    onConfirm(v)
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="dialog-row">
        <input
          className="prompt-input"
          value={value}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
        />
      </div>
      <div className="dialog-row right">
        <button className="text-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="text-btn primary" disabled={!value.trim()} onClick={apply}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
