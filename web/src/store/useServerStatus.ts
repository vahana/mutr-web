import { create } from 'zustand'

import { api } from '../api/client'

interface ServerStatus {
  online: boolean
}

export const useServerStatus = create<ServerStatus>(() => ({ online: true }))

let timer: number | null = null

export async function checkServer() {
  try {
    await api.health()
    useServerStatus.setState({ online: true })
  } catch {
    useServerStatus.setState({ online: false })
  }
}

export function startServerPolling(intervalMs = 15_000) {
  if (timer !== null) return
  void checkServer()
  timer = window.setInterval(() => void checkServer(), intervalMs)
}

export function stopServerPolling() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
