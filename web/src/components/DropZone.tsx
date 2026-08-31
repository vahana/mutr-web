import { useEffect, useState } from 'react'

import { ALLOWED_EXTS, useProjectStore } from '../store/useProjectStore'
import { pushToast } from '../store/useToastStore'

export function DropZone() {
  const addFiles = useProjectStore((s) => s.addFiles)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        ALLOWED_EXTS.has(`.${f.name.split('.').pop()?.toLowerCase()}`),
      )
      if (files.length === 0) {
        pushToast('No supported audio/video files in drop', 'error')
        return
      }
      void addFiles(files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  if (!dragging) return null
  return <div className="dropzone-overlay">Drop files to add tracks</div>
}
