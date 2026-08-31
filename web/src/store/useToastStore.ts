import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

let nextId = 1

interface ToastStore {
  toasts: Toast[]
  push: (message: string, kind?: 'info' | 'error') => void
  dismiss: (id: number) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    if (kind === 'info') {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 4000)
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function pushToast(message: string, kind: 'info' | 'error' = 'info') {
  if (kind === 'error') {
    console.error('[mutr]', message)
  } else {
    console.log('[mutr]', message)
  }
  useToastStore.getState().push(message, kind)
}
