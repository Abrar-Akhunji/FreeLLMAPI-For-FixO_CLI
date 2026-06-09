import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { AuthProvider, useAuth } from '@/components/AuthContext'
import LoginPage from '@/pages/LoginPage'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import AgentPage from '@/pages/AgentPage'
import SettingsPage from '@/pages/SettingsPage'
import TeamPage from '@/pages/TeamPage'
import AliasesPage from '@/pages/AliasesPage'

const queryClient = new QueryClient()

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative text-sm px-1 py-4 transition-colors ${
          isActive
            ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      )}
    </Button>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block size-2 rounded-full bg-foreground" />
      <span className="font-semibold tracking-tight text-sm">free LLM API for FIXO CLI</span>
    </div>
  )
}

function AppContent() {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="size-8 border-2 border-foreground border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-xs text-muted-foreground animate-pulse">Initializing free LLM API for FIXO CLI...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {user && (
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b">
          <div className="max-w-6xl mx-auto px-6 flex items-center">
            <Brand />
            <nav className="flex items-center gap-6 ml-10">
              <NavItem to="/playground">Playground</NavItem>
              <NavItem to="/keys">Keys</NavItem>
              <NavItem to="/fallback">Fallback</NavItem>
              <NavItem to="/analytics">Analytics</NavItem>
              <NavItem to="/agent">Agent Hub</NavItem>
              <NavItem to="/team">Team</NavItem>
              <NavItem to="/aliases">Aliases</NavItem>
              <NavItem to="/settings">Settings</NavItem>
            </nav>
            <div className="ml-auto flex items-center gap-4 py-2">
              <DarkModeToggle />
              
              <div className="flex items-center gap-2 border-l pl-4 border-border/80">
                {user.photoURL && (
                  <img src={user.photoURL} alt="Profile" className="size-6 rounded-full border border-border shadow-sm" />
                )}
                <div className="hidden md:flex flex-col items-start leading-none gap-0.5">
                  <span className="text-xs font-semibold text-foreground">{user.displayName}</span>
                  <span className="text-[9px] text-muted-foreground">{user.email}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={logout} className="text-xs h-7 px-2 border hover:bg-muted font-medium ml-1">
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </header>
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/playground" replace />} />
          
          {/* Protected routes */}
          <Route path="/" element={user ? <Navigate to="/playground" replace /> : <Navigate to="/login" replace />} />
          <Route path="/playground" element={user ? <PlaygroundPage /> : <Navigate to="/login" replace />} />
          <Route path="/keys" element={user ? <KeysPage /> : <Navigate to="/login" replace />} />
          <Route path="/fallback" element={user ? <FallbackPage /> : <Navigate to="/login" replace />} />
          <Route path="/analytics" element={user ? <AnalyticsPage /> : <Navigate to="/login" replace />} />
          <Route path="/agent" element={user ? <AgentPage /> : <Navigate to="/login" replace />} />
          <Route path="/team" element={user ? <TeamPage /> : <Navigate to="/login" replace />} />
          <Route path="/aliases" element={user ? <AliasesPage /> : <Navigate to="/login" replace />} />
          <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login" replace />} />
          <Route path="/test" element={<Navigate to="/playground" replace />} />
          <Route path="/health" element={<Navigate to="/keys" replace />} />
          <Route path="*" element={<Navigate to={user ? "/playground" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App

