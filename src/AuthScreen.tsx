import { useState } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { subteamOptions } from './api'
import './AuthScreen.css'

type AuthMode = 'signin' | 'signup'

export type AuthValues = {
  mode: AuthMode
  displayName: string
  subteam: string
  email: string
  password: string
  inviteCode: string
}

type AuthScreenProps = {
  onAuthenticate: (values: AuthValues) => Promise<void>
  initialError?: string
}

export function AuthScreen({ onAuthenticate, initialError = '' }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [displayName, setDisplayName] = useState('')
  const [subteam, setSubteam] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onAuthenticate({ mode, displayName, subteam, email, password, inviteCode })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in right now.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-panel">
      <img className="auth-logo" src="https://digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" />
      <div className="auth-eyebrow">TEAM OPERATIONS</div>
      <h1>{mode === 'signin' ? 'Internal Requests' : 'Join the workspace'}</h1>
      <p className="auth-description">{mode === 'signin' ? 'Sign in to manage part requests and sponsor relationships.' : 'Create your team account with the invite code shared by your lead.'}</p>
      <form onSubmit={submit}>
        {mode === 'signup' && <label className="field"><span>Your name</span><input required autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Full name" /></label>}
        {mode === 'signup' && <label className="field"><span>Subteam</span><select required autoComplete="organization-title" value={subteam} onChange={(event) => setSubteam(event.target.value)}><option value="">Select a subteam</option>{subteamOptions.map((option) => <option key={option}>{option}</option>)}</select></label>}
        <label className="field"><span>Email address</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label className="field"><span>Password</span><input required type="password" minLength={mode === 'signup' ? 12 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your password'} /></label>
        {mode === 'signup' && <label className="field"><span>Team or Dev invite code</span><input required autoComplete="off" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Provided by your team lead or administrator" /></label>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          {mode === 'signin' ? <LockKeyhole size={16} /> : <ArrowRight size={16} />}
        </button>
      </form>
      <div className="auth-switch">
        {mode === 'signin' ? 'New to the team workspace?' : 'Already have an account?'}
        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}>
          {mode === 'signin' ? 'Create account' : 'Sign in'}
        </button>
      </div>
      <div className="auth-footnote">Team members only · Data is shared securely after sign-in</div>
    </section>
  </main>
}