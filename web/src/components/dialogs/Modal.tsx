import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: Props) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}
