import { useEffect } from 'react'

import { ProjectScreen } from './components/ProjectScreen'
import { Toasts } from './components/Toasts'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useProjectStore } from './store/useProjectStore'
import { checkServer, startServerPolling, stopServerPolling, useServerStatus } from './store/useServerStatus'

export default function App() {
  const project = useProjectStore((s) => s.project)
  const online = useServerStatus((s) => s.online)

  useEffect(() => {
    startServerPolling()
    const onOnline = () => void checkServer()
    window.addEventListener('online', onOnline)
    return () => {
      stopServerPolling()
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return (
    <div className="app">
      {!online && <div className="offline-banner">Server unreachable — reconnecting…</div>}
      {project ? <ProjectScreen /> : <WelcomeScreen />}
      <Toasts />
    </div>
  )
}
