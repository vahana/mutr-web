import { Modal } from './Modal'

interface Props {
  title: string
  message: string
  confirmLabel: string
  secondLabel?: string
  onConfirm: () => void
  onSecond?: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  secondLabel,
  onConfirm,
  onSecond,
  onCancel,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="dialog-message">{message}</p>
      <div className="dialog-row right">
        <button className="text-btn" onClick={onCancel}>
          Cancel
        </button>
        {secondLabel && onSecond && (
          <button className="text-btn danger" onClick={onSecond}>
            {secondLabel}
          </button>
        )}
        <button className="text-btn primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
