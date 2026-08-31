import { ProjectScreen } from './components/ProjectScreen'
import { Toasts } from './components/Toasts'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useProjectStore } from './store/useProjectStore'

export default function App() {
  const project = useProjectStore((s) => s.project)

  return (
    <div className="app">
      {project ? <ProjectScreen /> : <WelcomeScreen />}
      <Toasts />
    </div>
  )
}
