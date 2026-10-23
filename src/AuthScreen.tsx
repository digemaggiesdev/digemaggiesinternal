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
  onResetPassword: (token: string, password: string) => Promise<void>
  onRequestPasswordReset: (email: string) => Promise<void>
  initialError?: string
}

export function AuthScreen({ onAuthenticate, onResetPassword, onRequestPasswordReset, initialError = '' }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const resetToken = new URLSearchParams(window.location.hash.slice(1)).get('reset') || ''
  const [resetMode, setResetMode] = useState(Boolean(resetToken))
  const [forgotMode, setForgotMode] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [subteam, setSubteam] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (forgotMode) {
        await onRequestPasswordReset(email)
        setNotice('If an account exists for that email, a password reset link has been sent.')
        return
      }
      if (resetMode) {
        if (password !== confirmPassword) throw new Error('The passwords do not match.')
        await onResetPassword(resetToken, password)
        window.history.replaceState({}, '', window.location.pathname)
        setResetMode(false)
        setPassword('')
        setConfirmPassword('')
        setNotice('Your password has been updated. Sign in with your new password.')
        return
      }
      await onAuthenticate({ mode, displayName, subteam, email, password, inviteCode })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in right now.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-panel">
      <img className="auth-logo" src="https://Digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" />
      <div className="auth-eyebrow">TEAM OPERATIONS</div>
      <h1>{resetMode ? 'Choose a new password' : forgotMode ? 'Reset your password' : mode === 'signin' ? 'Internal Requests' : 'Join the workspace'}</h1>
      <p className="auth-description">{resetMode ? 'Choose a new password for your team workspace account.' : forgotMode ? 'Enter your account email and we will send a password reset link if an account exists.' : mode === 'signin' ? 'Sign in to manage part requests and sponsor relationships.' : 'Create your team account with the invite code shared by your lead.'}</p>
      <form onSubmit={submit}>
        {!resetMode && !forgotMode && mode === 'signup' && <label className="field"><span>Your name</span><input required autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Full name" /></label>}
        {!resetMode && !forgotMode && mode === 'signup' && <label className="field"><span>Subteam</span><select required autoComplete="organization-title" value={subteam} onChange={(event) => setSubteam(event.target.value)}><option value="">Select a subteam</option>{subteamOptions.map((option) => <option key={option}>{option}</option>)}</select></label>}
        {!resetMode && <label className="field"><span>Email address</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {!resetMode && !forgotMode && <label className="field"><span>Password</span><input required type="password" minLength={mode === 'signup' ? 12 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your password'} /></label>}
        {resetMode && <label className="field"><span>New password</span><input required type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></label>}
        {resetMode && <label className="field"><span>Confirm new password</span><input required type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
        {!resetMode && !forgotMode && mode === 'signup' && <label className="field"><span>Team invite code</span><input required autoComplete="off" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Provided by your team lead or administrator" /></label>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {notice && <div className="auth-notice" role="status">{notice}</div>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait...' : resetMode ? 'Update password' : forgotMode ? 'Send reset link' : mode === 'signin' ? 'Sign in' : 'Create account'}
          {resetMode || (!forgotMode && mode === 'signin') ? <LockKeyhole size={16} /> : <ArrowRight size={16} />}
        </button>
      </form>
      <div className="auth-switch">
        {resetMode || forgotMode
          ? <button type="button" onClick={() => { if (resetMode) window.history.replaceState({}, '', window.location.pathname); setResetMode(false); setForgotMode(false); setError(''); setNotice('') }}>Back to sign in</button>
          : mode === 'signin' ? <>
            <button type="button" onClick={() => { setForgotMode(true); setError(''); setNotice('') }}>Forgot password?</button>
            <span>New to the team workspace?</span>
            <button type="button" onClick={() => { setMode('signup'); setError(''); setNotice('') }}>Create account</button>
          </> : <>
            <span>Already have an account?</span>
            <button type="button" onClick={() => { setMode('signin'); setError(''); setNotice('') }}>Sign in</button>
          </>}
      </div>
      <div className="auth-footnote">Team members only · Data is shared securely after sign-in</div>
    </section>
  </main>
}