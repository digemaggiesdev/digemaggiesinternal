import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  BadgeDollarSign,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ContactRound,
  Eye,
  Handshake,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { AuthScreen, type AuthValues } from './AuthScreen'
import {
  deleteRequest as deletePartRequest,
  deleteSponsorLead as removeSponsorLead,
  createRequest as createPartRequest,
  createSponsorLead,
  createSponsor as createSponsorship,
  deleteSponsor as removeSponsor,
  getRequests,
  getSession,
  getSponsorLeads,
  getSponsors,
  getTeamMembers,
  getSubteamChangeRequests,
  getManagementUsers,
  deleteAccount,
  deleteManagementUser,
  cancelSubteamChangeRequest,
  requestSubteamChange,
  reviewSubteamChangeRequest,
  signIn,
  signOut,
  signUp,
  subteamOptions,
  updateAccount,
  updateManagementRequest,
  updateManagementSponsor,
  updateManagementSponsorLead,
  updateManagementUser,
  updateRequest as updatePartRequest,
  updateSponsorLead,
  updateSponsor as updateSponsorship,
} from './api'
import type {
  CommunicationStatus,
  DeliverableStatus,
  PartRequest,
  PartRequestInput,
  RequestStatus,
  Sponsor,
  SponsorLead,
  SponsorLeadInput,
  SponsorLeadStatus,
  SponsorInput,
  SponsorStatus,
  SubteamChangeRequest,
  TeamMember,
  TeamUser,
} from './api'
import './App.css'

type View = 'overview' | 'parts' | 'sponsors' | 'sponsor-leads' | 'account' | 'management'
type ManagementEdit =
  | { kind: 'user'; user: TeamUser }
  | { kind: 'request'; record: PartRequest }
  | { kind: 'sponsor'; record: Sponsor }
  | { kind: 'lead'; record: SponsorLead }

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function AssignmentSelect({ assignedId, user, members, requesterSubteam, label, onChange }: {
  assignedId?: string
  user: TeamUser | null
  members: TeamMember[]
  requesterSubteam: string
  label: string
  onChange: (assigneeId: string) => void
}) {
  const eligibleMembers = members.filter((member) => {
    const subteam = member.subteam.trim().toLowerCase()
    return user?.tag === 'dev' || subteam === 'business' || subteam === requesterSubteam.trim().toLowerCase()
  })
  const currentAssignee = members.find((member) => member.id === assignedId)
  const isExec = user?.tag === 'dev' || user?.subteam.trim().toLowerCase() === 'exec'
  const canAssignSelf = Boolean(user && (
    user.subteam.trim().toLowerCase() === 'business'
    || user.subteam.trim().toLowerCase() === requesterSubteam.trim().toLowerCase()
  ))
  const canEdit = Boolean(isExec || canAssignSelf)
  const currentAssigneeLabel = currentAssignee
    ? `${currentAssignee.displayName} · ${currentAssignee.subteam}`
    : assignedId ? 'Assigned member' : 'Unassigned'

  return <select
    className="inline-select assignee-select"
    aria-label={label}
    value={assignedId || ''}
    disabled={!canEdit}
    onChange={(event) => onChange(event.target.value)}
  >
    {isExec
      ? <>
        <option value="">Unassigned</option>
        {eligibleMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.subteam}</option>)}
        {assignedId && !eligibleMembers.some((member) => member.id === assignedId) && <option value={assignedId} disabled>{currentAssigneeLabel}</option>}
      </>
      : <>
        <option value={assignedId || ''} disabled={Boolean(assignedId && assignedId !== user?.id)}>{currentAssigneeLabel}</option>
        {canAssignSelf && user && assignedId !== user.id && <option value={user.id}>Assign to me ({user.displayName})</option>}
      </>}
  </select>
}

function AccountSettings({ user, subteamRequests, onSave, onRequestSubteamChange, onReviewSubteamChange, onCancelSubteamChange, onDelete }: {
  user: TeamUser
  subteamRequests: SubteamChangeRequest[]
  onSave: (changes: Pick<TeamUser, 'displayName' | 'email'>) => Promise<void>
  onRequestSubteamChange: (subteam: string) => Promise<void>
  onReviewSubteamChange: (id: string, status: 'approved' | 'rejected') => Promise<void>
  onCancelSubteamChange: (id: string) => Promise<void>
  onDelete: (password: string) => Promise<boolean>
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [subteam, setSubteam] = useState(user.subteam)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [subteamError, setSubteamError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingSubteam, setSavingSubteam] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState('')
  const ownRequest = subteamRequests.find((request) => request.userId === user.id)
  const pendingRequests = subteamRequests.filter((request) => request.status === 'pending')
  const reviewableRequests = pendingRequests.filter((request) => request.userId !== user.id)
  const canReviewRequests = user.tag === 'dev' || user.subteam.trim().toLowerCase() === 'exec'

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onSave({ displayName, email })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update your account.')
    } finally {
      setSaving(false)
    }
  }

  const requestSubteam = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubteamError('')
    setSavingSubteam(true)
    try {
      await onRequestSubteamChange(subteam)
    } catch (caught) {
      setSubteamError(caught instanceof Error ? caught.message : 'Could not request a subteam change.')
    } finally {
      setSavingSubteam(false)
    }
  }

  const reviewRequest = async (id: string, status: 'approved' | 'rejected') => {
    setSubteamError('')
    setBusyRequestId(id)
    try {
      await onReviewSubteamChange(id, status)
    } catch (caught) {
      setSubteamError(caught instanceof Error ? caught.message : 'Could not review the subteam change request.')
    } finally {
      setBusyRequestId('')
    }
  }

  const cancelRequest = async (id: string) => {
    setSubteamError('')
    setBusyRequestId(id)
    try {
      await onCancelSubteamChange(id)
    } catch (caught) {
      setSubteamError(caught instanceof Error ? caught.message : 'Could not cancel the subteam change request.')
    } finally {
      setBusyRequestId('')
    }
  }

  const removeAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setDeleting(true)
    try {
      const promoted = await onDelete(password)
      if (promoted) {
        setPassword('')
        setDeleting(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete your account.')
      setDeleting(false)
    }
  }

  return <div className="account-settings">
    <section className="section-block account-section">
      <div className="section-heading"><div><span className="section-kicker">YOUR PROFILE</span><h2>Account information</h2></div></div>
      <form onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label className="field"><span>Name</span><input required minLength={2} maxLength={100} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field"><span>Email address</span><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        </div>
        {error && <div className="action-error" role="alert">{error}</div>}
        <div className="modal-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save account information'}</button></div>
      </form>
    </section>
    <section className="section-block account-section">
      <div className="section-heading"><div><span className="section-kicker">TEAM MEMBERSHIP</span><h2>Subteam</h2></div></div>
      <p>Subteam changes take effect only after an Exec member or Dev administrator approves your request.</p>
      {subteamError && <div className="action-error" role="alert">{subteamError}</div>}
      {ownRequest?.status === 'pending' ? <div>
        <p>Your request to move from <strong>{ownRequest.currentSubteam}</strong> to <strong>{ownRequest.requestedSubteam}</strong> is awaiting Exec approval.</p>
        <button className="button secondary" type="button" disabled={busyRequestId === ownRequest.id} onClick={() => void cancelRequest(ownRequest.id)}>Cancel request</button>
      </div> : <form onSubmit={(event) => void requestSubteam(event)}>
        <label className="field"><span>Request a subteam change</span><select required value={subteam} onChange={(event) => setSubteam(event.target.value)}>{!subteamOptions.includes(subteam) && <option value={subteam}>{subteam}</option>}{subteamOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        {ownRequest && <p>Your previous request to join {ownRequest.requestedSubteam} was {ownRequest.status}{ownRequest.reviewedBy ? ` by ${ownRequest.reviewedBy}` : ''}.</p>}
        <div className="modal-actions"><button className="button primary" type="submit" disabled={savingSubteam || subteam.trim().toLowerCase() === user.subteam.trim().toLowerCase()}>{savingSubteam ? 'Submitting...' : 'Request subteam change'}</button></div>
      </form>}
      {canReviewRequests && <div>
        <h3>Requests awaiting approval</h3>
        {reviewableRequests.length ? reviewableRequests.map((request) => <div className="account-section" key={request.id}>
          <p><strong>{request.requesterName}</strong> requests to move from {request.currentSubteam} to {request.requestedSubteam}.</p>
          <p>Requested {new Date(request.createdAt).toLocaleDateString()}</p>
          <div className="modal-actions">
            <button className="button primary" type="button" disabled={busyRequestId === request.id} onClick={() => void reviewRequest(request.id, 'approved')}>{busyRequestId === request.id ? 'Saving...' : 'Approve'}</button>
            <button className="button secondary" type="button" disabled={busyRequestId === request.id} onClick={() => void reviewRequest(request.id, 'rejected')}>Reject</button>
          </div>
        </div>) : <p>There are no pending requests from other members.</p>}
        {pendingRequests.some((request) => request.userId === user.id) && <p>Your own request must be reviewed by another Exec member or Dev administrator.</p>}
      </div>}
    </section>
    <section className="section-block account-section danger-section">
      <div className="section-heading"><div><span className="section-kicker">PERMANENT ACTION</span><h2>Delete account</h2></div></div>
      <p>Deleting your account signs you out and removes your profile. Requests and sponsor leads you submitted remain shared; any tasks assigned to you will become unassigned.</p>
      <form onSubmit={(event) => void removeAccount(event)}>
        <label className="field"><span>Confirm with your current password</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="modal-actions"><button className="button danger-button" type="submit" disabled={deleting}>{deleting ? 'Deleting account...' : 'Delete my account'}</button></div>
      </form>
    </section>
  </div>
}

function ManagementTab({ users, currentUserId, requests, sponsors, leads, onEditUser, onDeleteUser, onEditRequest, onEditSponsor, onEditLead }: {
  users: TeamUser[]
  currentUserId: string
  requests: PartRequest[]
  sponsors: Sponsor[]
  leads: SponsorLead[]
  onEditUser: (user: TeamUser) => void
  onDeleteUser: (user: TeamUser) => void
  onEditRequest: (request: PartRequest) => void
  onEditSponsor: (sponsor: Sponsor) => void
  onEditLead: (lead: SponsorLead) => void
}) {
  const [section, setSection] = useState<'users' | 'requests' | 'sponsors' | 'leads'>('users')
  const sections = [
    { id: 'users' as const, label: 'Users', count: users.length },
    { id: 'requests' as const, label: 'Part requests', count: requests.length },
    { id: 'sponsors' as const, label: 'Sponsorships', count: sponsors.length },
    { id: 'leads' as const, label: 'Sponsor leads', count: leads.length },
  ]

  return <section className="section-block management-panel">
    <div className="section-heading"><div><span className="section-kicker">DEV ADMINISTRATION</span><h2>Manage workspace</h2></div></div>
    <p>Edit team member profiles and subteam assignments, or edit any shared workspace record.</p>
    <div className="management-tabs" role="tablist" aria-label="Management categories">
      {sections.map((item) => <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={section === item.id}
        className={section === item.id ? 'management-tab active' : 'management-tab'}
        onClick={() => setSection(item.id)}
      >{item.id === 'users' && <Users size={15} />}{item.label}<span>{item.count}</span></button>)}
    </div>
    {section === 'users' && <div className="table-scroll"><table>
      <thead><tr><th>NAME</th><th>EMAIL</th><th>SUBTEAM</th><th>ACCESS TAG</th><th>ACTIONS</th></tr></thead>
      <tbody>{users.map((member) => <tr key={member.id}>
        <td>{member.displayName}</td><td>{member.email}</td><td>{member.subteam || 'Not set'}</td>
        <td>{member.tag === 'dev' ? 'Dev' : 'Member'}</td>
        <td><div className="management-user-actions">
          <button className="button secondary management-edit-button" type="button" onClick={() => onEditUser(member)}><Pencil size={14} /> Edit</button>
          {member.id !== currentUserId && <button className="button danger-button management-edit-button" type="button" onClick={() => onDeleteUser(member)}><Trash2 size={14} /> Delete</button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
    {section === 'requests' && <div className="table-scroll"><table>
      <thead><tr><th>ITEM</th><th>COMPANY</th><th>SUBTEAM</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{requests.map((record) => <tr key={record.id}>
        <td>{record.item}</td><td>{record.company || '—'}</td><td>{record.subteam}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditRequest(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
    </table></div>}
    {section === 'sponsors' && <div className="table-scroll"><table>
      <thead><tr><th>COMPANY</th><th>CONTACT</th><th>AMOUNT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{sponsors.map((record) => <tr key={record.id}>
        <td>{record.company}</td><td>{record.contact || '—'}</td><td>{money(record.amount)}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditSponsor(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
    </table></div>}
    {section === 'leads' && <div className="table-scroll"><table>
      <thead><tr><th>COMPANY</th><th>CONTACT</th><th>SUBTEAM</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{leads.map((record) => <tr key={record.id}>
        <td>{record.company}</td><td>{record.contactName || '—'}</td><td>{record.subteam || '—'}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditLead(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
    </table></div>}
    {((section === 'users' && users.length === 0)
      || (section === 'requests' && requests.length === 0)
      || (section === 'sponsors' && sponsors.length === 0)
      || (section === 'leads' && leads.length === 0)) && <div className="empty-state">No records to manage.</div>}
  </section>
}

function ManagementUserModal({ user, onClose, onSave }: {
  user: TeamUser
  onClose: () => void
  onSave: (changes: Pick<TeamUser, 'displayName' | 'email' | 'subteam'>) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [subteam, setSubteam] = useState(user.subteam)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const subteams = [...subteamOptions, 'Exec']

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ displayName, email, subteam })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this member.')
      setSaving(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="management-user-title">
      <div className="modal-heading"><div><span className="section-kicker">DEV ADMINISTRATION</span><h2 id="management-user-title">Edit team member</h2></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
      <form onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label className="field"><span>Name</span><input required minLength={2} maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field"><span>Email</span><input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field"><span>Subteam</span><select required value={subteam} onChange={(event) => setSubteam(event.target.value)}>{!subteams.includes(subteam) && <option value={subteam}>{subteam}</option>}{subteams.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div className="field"><span>Access tag</span><strong>{user.tag === 'dev' ? 'Dev (invite-assigned)' : 'Member'}</strong></div>
        </div>
        {error && <div className="action-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Save member'}</button></div>
      </form>
    </section>
  </div>
}

function downloadCsv(requests: PartRequest[], sponsors: Sponsor[], leads: SponsorLead[], members: TeamMember[]) {
  const memberNames = new Map(members.map((member) => [member.id, member.displayName]))
  const rows = [
    ['Type', 'Company / entity', 'Item / contact', 'Contact info', 'Amount', 'Quantity', 'Subteam', 'Priority / status', 'Assigned to', 'Compatibility / relationship', 'Communication', 'Renewal / required specs'],
    ...requests.map((request) => ['Part request', request.company, request.item, request.contact, request.value, request.quantity, request.subteam, `${request.priority} / ${request.status}`, memberNames.get(request.assigneeId || '') || '', request.compatibility, request.communication, request.specs]),
    ...sponsors.map((sponsor) => ['Sponsorship', sponsor.company, sponsor.contact, '', sponsor.amount, '', '', sponsor.status, '', sponsor.relationship, '', `${sponsor.renewal} / ${sponsor.deliverables.map((deliverable) => `${deliverable.description} (${deliverable.status})`).join('; ')}`]),
    ...leads.map((lead) => ['Sponsor lead', lead.company, lead.contactName, [lead.contactRole, lead.contactEmail, lead.contactPhone].filter(Boolean).join('; '), lead.estimatedAmount || '', '', lead.subteam, lead.status, memberNames.get(lead.assigneeId || '') || '', lead.relationship, `Support: ${(lead.supportTypes || []).join(', ')}; can introduce: ${lead.canIntroduce}`, `${lead.supportDetails || ''} ${lead.details}`.trim()]),
  ]
  const csv = rows.map((row) => row.map((cell) => {
    const safe = String(cell ?? '').replace(/^[=+\-@]/, "'$&")
    return `"${safe.replace(/"/g, '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'digem-sponsorship-tracker.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [requests, setRequests] = useState<PartRequest[]>([])
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [sponsorLeads, setSponsorLeads] = useState<SponsorLead[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [managementUsers, setManagementUsers] = useState<TeamUser[]>([])
  const [subteamRequests, setSubteamRequests] = useState<SubteamChangeRequest[]>([])
  const [user, setUser] = useState<TeamUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [actionError, setActionError] = useState('')
  const [view, setView] = useState<View>('overview')
  const [modal, setModal] = useState<'request' | 'lead' | 'lead-detail' | null>(null)
  const [sponsorModal, setSponsorModal] = useState<'sponsor' | 'sponsor-edit' | 'sponsor-detail' | null>(null)
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [managementEdit, setManagementEdit] = useState<ManagementEdit | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [requestSort, setRequestSort] = useState<'newest' | 'urgency'>('newest')
  const [leadStatusFilter, setLeadStatusFilter] = useState('All lead statuses')

  useEffect(() => {
    let active = true
    void getSession().then(async (currentUser) => {
      if (!active) return
      setUser(currentUser)
      if (currentUser) {
        const [savedRequests, savedSponsors, savedLeads, savedMembers, savedSubteamRequests] = await Promise.all([
          getRequests(), getSponsors(), getSponsorLeads(), getTeamMembers(), getSubteamChangeRequests(),
        ])
        const savedManagementUsers = currentUser.tag === 'dev' ? await getManagementUsers() : []
        if (active) {
          setRequests(savedRequests)
          setSponsors(savedSponsors)
          setSponsorLeads(savedLeads)
          setTeamMembers(savedMembers)
          setSubteamRequests(savedSubteamRequests)
          setManagementUsers(savedManagementUsers)
        }
      }
    }).catch((error: unknown) => {
      if (active) setAuthError(error instanceof Error ? error.message : 'The team server is unavailable.')
    }).finally(() => {
      if (active) setAuthReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user || user.tag === 'dev' || user.subteam.trim().toLowerCase() !== 'exec') return
    const interval = window.setInterval(() => {
      void getSubteamChangeRequests().then(setSubteamRequests).catch(() => undefined)
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [user])

  const refreshWorkspace = async (includeManagement = user?.tag === 'dev') => {
    const [savedRequests, savedSponsors, savedLeads, savedMembers, savedSubteamRequests] = await Promise.all([
      getRequests(), getSponsors(), getSponsorLeads(), getTeamMembers(), getSubteamChangeRequests(),
    ])
    const savedManagementUsers = includeManagement ? await getManagementUsers() : []
    setRequests(savedRequests)
    setSponsors(savedSponsors)
    setSponsorLeads(savedLeads)
    setTeamMembers(savedMembers)
    setSubteamRequests(savedSubteamRequests)
    setManagementUsers(savedManagementUsers)
  }

  const authenticate = async (values: AuthValues) => {
    const nextUser = values.mode === 'signin'
      ? await signIn(values.email, values.password)
      : await signUp(values.displayName, values.email, values.password, values.subteam, values.inviteCode)
    setUser(nextUser)
    setAuthError('')
    try {
      await refreshWorkspace(nextUser.tag === 'dev')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load shared team records.')
    }
  }

  const logout = async () => {
    try {
      await signOut()
      setUser(null)
      setRequests([])
      setSponsors([])
      setSponsorLeads([])
      setTeamMembers([])
      setManagementUsers([])
      setSubteamRequests([])
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  const saveAccount = async (changes: Pick<TeamUser, 'displayName' | 'email'>) => {
    const updatedUser = await updateAccount(changes)
    setUser(updatedUser)
    setTeamMembers((current) => current.map((member) => member.id === updatedUser.id
      ? { ...member, displayName: updatedUser.displayName, subteam: updatedUser.subteam }
      : member))
  }

  const saveManagementUser = async (id: string, changes: Pick<TeamUser, 'displayName' | 'email' | 'subteam'>) => {
    try {
      const updated = await updateManagementUser(id, changes)
      setManagementUsers((current) => current.map((member) => member.id === updated.id ? updated : member))
      setTeamMembers((current) => current.map((member) => member.id === updated.id
        ? { ...member, displayName: updated.displayName, subteam: updated.subteam }
        : member))
      if (user?.id === updated.id) setUser(updated)
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this member.')
      throw error
    }
  }

  const removeManagementUser = async (id: string) => {
    try {
      await deleteManagementUser(id)
      setManagementUsers((current) => current.filter((member) => member.id !== id))
      setTeamMembers((current) => current.filter((member) => member.id !== id))
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete this member.')
    }
  }

  const confirmDeleteManagementUser = (member: TeamUser) => {
    if (!window.confirm(`Delete ${member.displayName}'s account? Their assigned tasks will be unassigned; shared records will remain.`)) return
    void removeManagementUser(member.id)
  }

  const editManagementRequest = async (id: string, changes: PartRequestInput) => {
    try {
      const updated = await updateManagementRequest(id, changes)
      setRequests((current) => current.map((request) => request.id === id ? updated : request))
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this request.')
    }
  }

  const editManagementSponsor = async (id: string, changes: SponsorInput) => {
    try {
      const updated = await updateManagementSponsor(id, changes)
      setSponsors((current) => current.map((sponsor) => sponsor.id === id ? updated : sponsor))
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsorship.')
    }
  }

  const editManagementLead = async (id: string, changes: SponsorLeadInput & { status?: SponsorLeadStatus }) => {
    try {
      const updated = await updateManagementSponsorLead(id, changes)
      setSponsorLeads((current) => current.map((lead) => lead.id === id ? updated : lead))
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsor lead.')
    }
  }

  const requestAccountSubteamChange = async (subteam: string) => {
    await requestSubteamChange(subteam)
    setSubteamRequests(await getSubteamChangeRequests())
  }

  const reviewAccountSubteamChange = async (id: string, status: 'approved' | 'rejected') => {
    await reviewSubteamChangeRequest(id, status)
    await refreshWorkspace()
    const currentUser = await getSession()
    setUser(currentUser)
  }

  const cancelAccountSubteamChange = async (id: string) => {
    await cancelSubteamChangeRequest(id)
    setSubteamRequests(await getSubteamChangeRequests())
  }

  const removeAccount = async (password: string) => {
    const promotedUser = await deleteAccount(password)
    if (promotedUser) {
      setUser(promotedUser)
      setActionError('')
      setAuthError('')
      return true
    }
    setUser(null)
    setRequests([])
    setSponsors([])
    setSponsorLeads([])
    setTeamMembers([])
    setManagementUsers([])
    setSubteamRequests([])
    setActionError('')
    setAuthError('')
    return false
  }

  const openRequests = requests.filter((request) => !['Received', 'Closed'].includes(request.status))
  const activeValue = sponsors.filter((sponsor) => sponsor.status === 'Committed' || sponsor.status === 'Received').reduce((sum, sponsor) => sum + sponsor.amount, 0)
  const filteredRequests = requests.filter((request) => {
    const matchesQuery = `${request.item} ${request.company} ${request.subteam} ${request.requestedBy}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'All statuses' || request.status === statusFilter)
  }).sort((left, right) => {
    if (requestSort === 'newest') return 0
    const urgency = { Urgent: 0, High: 1, Normal: 2, Low: 3 }
    return urgency[left.priority] - urgency[right.priority]
  })
  const filteredSponsors = sponsors.filter((sponsor) => `${sponsor.company} ${sponsor.contact}`.toLowerCase().includes(query.toLowerCase()))
  const filteredSponsorLeads = sponsorLeads.filter((lead) => {
    const matchesQuery = `${lead.company} ${lead.contactName} ${lead.contactEmail} ${lead.relationship} ${lead.details} ${lead.createdBy}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (leadStatusFilter === 'All lead statuses' || lead.status === leadStatusFilter)
  })
  const selectedSponsorLead = sponsorLeads.find((lead) => lead.id === selectedLeadId) ?? null
  const selectedSponsor = sponsors.find((sponsor) => sponsor.id === selectedSponsorId) ?? null
  const openSponsorLeadCount = sponsorLeads.filter((lead) => !['Converted', 'Not pursuing'].includes(lead.status)).length

  const addRequest = async (request: PartRequestInput) => {
    setActionError('')
    try {
      const created = await createPartRequest(request)
      setRequests((current) => [created, ...current])
      setModal(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save this request.')
    }
  }

  const addSponsor = async (sponsor: SponsorInput) => {
    setActionError('')
    try {
      const created = await createSponsorship(sponsor)
      setSponsors((current) => [created, ...current])
      setSponsorModal(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save this sponsor.')
    }
  }

  const editSponsor = async (id: string, changes: SponsorInput) => {
    setActionError('')
    try {
      const updated = await updateSponsorship(id, changes)
      setSponsors((current) => current.map((sponsor) => sponsor.id === id ? updated : sponsor))
      setSponsorModal(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsor.')
    }
  }

  const updateSponsorStatus = async (id: string, status: SponsorStatus) => {
    try {
      const updated = await updateSponsorship(id, { status })
      setSponsors((current) => current.map((sponsor) => sponsor.id === id ? updated : sponsor))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsorship.')
    }
  }

  const updateDeliverableStatus = async (sponsor: Sponsor, index: number, status: DeliverableStatus) => {
    const deliverables = sponsor.deliverables.map((deliverable, deliverableIndex) => deliverableIndex === index
      ? { ...deliverable, status }
      : deliverable)
    try {
      const updated = await updateSponsorship(sponsor.id, { deliverables })
      setSponsors((current) => current.map((item) => item.id === sponsor.id ? updated : item))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this deliverable.')
    }
  }

  const deleteSponsor = async (sponsor: Sponsor) => {
    if (!window.confirm(`Delete the sponsorship for "${sponsor.company}"? This cannot be undone.`)) return
    try {
      await removeSponsor(sponsor.id)
      setSponsors((current) => current.filter((item) => item.id !== sponsor.id))
      setSponsorModal(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete this sponsorship.')
    }
  }

  const addSponsorLead = async (lead: SponsorLeadInput) => {
    setActionError('')
    try {
      const created = await createSponsorLead(lead)
      setSponsorLeads((current) => [created, ...current])
      setModal(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not submit this sponsor lead.')
    }
  }

  const updateRequest = async (id: string, field: 'status' | 'communication', value: string) => {
    const changes = field === 'status' ? { status: value as RequestStatus } : { communication: value as CommunicationStatus }
    try {
      const updated = await updatePartRequest(id, changes)
      setRequests((current) => current.map((request) => request.id === id ? updated : request))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this request.')
    }
  }

  const updateRequestAssignee = async (id: string, assigneeId: string) => {
    try {
      const updated = await updatePartRequest(id, { assigneeId })
      setRequests((current) => current.map((request) => request.id === id ? updated : request))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delegate this request.')
    }
  }

  const updateSponsorLeadStatus = async (id: string, status: SponsorLeadStatus) => {
    try {
      const updated = await updateSponsorLead(id, { status })
      setSponsorLeads((current) => current.map((lead) => lead.id === id ? updated : lead))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsor lead.')
    }
  }

  const updateSponsorLeadAssignee = async (id: string, assigneeId: string) => {
    try {
      const updated = await updateSponsorLead(id, { assigneeId })
      setSponsorLeads((current) => current.map((lead) => lead.id === id ? updated : lead))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delegate this sponsor lead.')
    }
  }

  const deleteRequest = async (request: PartRequest) => {
    if (!window.confirm(`Delete the request for "${request.item}"? This cannot be undone.`)) return
    try {
      await deletePartRequest(request.id)
      setRequests((current) => current.filter((item) => item.id !== request.id))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete this request.')
    }
  }

  const deleteSponsorLead = async (lead: SponsorLead) => {
    if (!window.confirm(`Delete the sponsor lead for "${lead.company}"? This cannot be undone.`)) return
    try {
      await removeSponsorLead(lead.id)
      setSponsorLeads((current) => current.filter((item) => item.id !== lead.id))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete this sponsor lead.')
    }
  }
  const pageTitle = view === 'overview' ? 'Internal Requests' : view === 'parts' ? 'Part requests' : view === 'sponsors' ? 'Sponsorships' : view === 'sponsor-leads' ? 'Sponsor leads' : view === 'management' ? 'Management' : 'Account'
  const pageDescription = view === 'overview' ? 'A clear view of what the team needs and who is helping.' : view === 'parts' ? 'Requests submitted by subteams, from first ask to received.' : view === 'sponsors' ? 'Track proposals, commitments, deliverables, and renewals.' : view === 'sponsor-leads' ? 'Potential sponsor connections submitted for the business team to follow up.' : view === 'management' ? 'Manage team members and shared workspace data.' : 'Update your profile or permanently delete your account.'
  if (!authReady) return <main className="auth-shell"><div className="auth-panel auth-loading"><img className="auth-logo" src="https://digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" /><p>Connecting to the team workspace...</p></div></main>
  if (!user) return <AuthScreen onAuthenticate={authenticate} initialError={authError} />
  const pendingSubteamRequestCount = subteamRequests.filter((request) => request.status === 'pending' && request.userId !== user.id).length
  const showSubteamRequestCount = user.tag !== 'dev' && user.subteam.trim().toLowerCase() === 'exec'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setView('overview')} aria-label="Dig 'Em Aggies Internal Requests">
          <img className="brand-logo" src="https://digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" />
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setView('overview')}><ClipboardList size={18} /> Overview</button>
          <button className={view === 'parts' ? 'nav-item active' : 'nav-item'} onClick={() => setView('parts')}><Box size={18} /> Part requests <span className="nav-count">{openRequests.length}</span></button>
          <button className={view === 'sponsor-leads' ? 'nav-item active' : 'nav-item'} onClick={() => setView('sponsor-leads')}><ContactRound size={18} /> Sponsor leads <span className="nav-count">{openSponsorLeadCount}</span></button>
          <button className={view === 'sponsors' ? 'nav-item active' : 'nav-item'} onClick={() => setView('sponsors')}><Handshake size={18} /> Sponsorships</button>
          <button className={view === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setView('account')}><Settings size={18} /> Account{showSubteamRequestCount && pendingSubteamRequestCount > 0 && <span className="nav-count" aria-label={`${pendingSubteamRequestCount} pending subteam change request${pendingSubteamRequestCount === 1 ? '' : 's'}`}>{pendingSubteamRequestCount}</span>}</button>
          {user.tag === 'dev' && <button className={view === 'management' ? 'nav-item active' : 'nav-item'} onClick={() => setView('management')}><Shield size={18} /> Management</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-status"><span className="status-dot" /> Team workspace</div>
          <div className="workspace-user">{user.displayName} · {user.subteam || 'Subteam not set'}{user.tag === 'dev' ? ' · Dev' : ''}</div>
          <p>Requests and sponsorship records are shared with signed-in team members.</p>
          <button className="sidebar-link" onClick={() => downloadCsv(requests, sponsors, sponsorLeads, teamMembers)}><ArrowDownToLine size={16} /> Export spreadsheet</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">TEAM OPERATIONS <span>/</span> Digem Aggies</div>
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={18} /></button>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">FALL 2026 · SPONSORSHIP & PROCUREMENT</div>
              <h1>{pageTitle}</h1>
              <p>{pageDescription}</p>
            </div>
            <div className="heading-actions">
              {view === 'sponsors' && <button className="button secondary" onClick={() => setSponsorModal('sponsor')}><Plus size={17} /> Add sponsor</button>}
              {view === 'sponsor-leads' && <button className="button primary" onClick={() => setModal('lead')}><Plus size={18} /> Submit sponsor lead</button>}
              {view === 'overview' && <button className="button secondary" onClick={() => setModal('lead')}><Plus size={17} /> Sponsor lead</button>}
              {view !== 'sponsor-leads' && view !== 'account' && view !== 'management' && <button className="button primary" onClick={() => setModal('request')}><Plus size={18} /> New request</button>}
            </div>
          </section>
          {actionError && <div className="action-error" role="alert">{actionError}</div>}

          {view === 'account' && <AccountSettings
            key={`${user.id}-${user.subteam}-${user.tag}`}
            user={user}
            subteamRequests={subteamRequests}
            onSave={saveAccount}
            onRequestSubteamChange={requestAccountSubteamChange}
            onReviewSubteamChange={reviewAccountSubteamChange}
            onCancelSubteamChange={cancelAccountSubteamChange}
            onDelete={removeAccount}
          />}
          {view === 'management' && user.tag === 'dev' && <ManagementTab
            users={managementUsers}
            currentUserId={user.id}
            requests={requests}
            sponsors={sponsors}
            leads={sponsorLeads}
            onEditUser={(member) => setManagementEdit({ kind: 'user', user: member })}
            onDeleteUser={confirmDeleteManagementUser}
            onEditRequest={(record) => setManagementEdit({ kind: 'request', record })}
            onEditSponsor={(record) => setManagementEdit({ kind: 'sponsor', record })}
            onEditLead={(record) => setManagementEdit({ kind: 'lead', record })}
          />}

          {view === 'overview' && <>
            <section className="metrics" aria-label="Workspace summary">
              <article className="metric"><div className="metric-top"><span>OPEN PART REQUESTS</span><Box size={17} /></div><strong>{openRequests.length}</strong><small>{requests.filter((request) => request.priority === 'Urgent' && !['Received', 'Closed'].includes(request.status)).length} urgent needs</small></article>
              <article className="metric"><div className="metric-top"><span>IN SELLER OUTREACH</span><ArrowUpRight size={17} /></div><strong>{requests.filter((request) => request.communication !== 'Not started' && request.communication !== 'Confirmed').length}</strong><small>Requests with active contact</small></article>
              <article className="metric"><div className="metric-top"><span>COMMITTED SUPPORT</span><BadgeDollarSign size={17} /></div><strong>{money(activeValue)}</strong><small>Committed or received</small></article>
              <article className="metric accent-metric"><div className="metric-top"><span>SPONSOR LEADS TO FOLLOW</span><ContactRound size={17} /></div><strong>{openSponsorLeadCount}</strong><small>{sponsorLeads.filter((lead) => lead.status === 'New').length} new for the business team</small></article>
            </section>

            <div className="overview-grid">
              <section className="section-block request-overview">
                <div className="section-heading"><div><span className="section-kicker">TEAM INTAKE</span><h2>Latest part requests</h2></div><button className="text-button" onClick={() => setView('parts')}>View all <ArrowUpRight size={15} /></button></div>
                <div className="request-list">
                  {requests.slice(0, 4).map((request) => <article className="request-row" key={request.id}>
                    <span className={`priority-mark ${request.priority.toLowerCase()}`} />
                    <div className="request-main"><strong>{request.item}</strong><span>{request.company} <i>·</i> {request.subteam}</span></div>
                    <span className={`status-pill ${request.status.toLowerCase().replace(' ', '-')}`}>{request.status}</span>
                    <span className="request-value">{money(request.value)}</span>
                  </article>)}
                  {requests.length === 0 && <div className="empty-state">No requests yet. Add the first need from a subteam.</div>}
                </div>
                <div className="priority-note"><CircleHelp size={17} /><span><strong>Priority reflects fit and urgency.</strong> Compatibility and seller relationship are captured on every request.</span></div>
              </section>
              <section className="section-block sponsor-overview">
                <div className="section-heading"><div><span className="section-kicker">FUNDING PIPELINE</span><h2>Donor activity</h2></div><button className="text-button" onClick={() => setView('sponsors')}>View all <ArrowUpRight size={15} /></button></div>
                <div className="sponsor-list">
                  {sponsors.slice(0, 4).map((sponsor) => <article className="sponsor-row" key={sponsor.id}>
                    <span className="sponsor-avatar">{sponsor.company.slice(0, 1).toUpperCase()}</span>
                    <div className="sponsor-main"><strong>{sponsor.company}</strong><span>{sponsor.relationship}</span></div>
                    <div className="sponsor-amount"><strong>{money(sponsor.amount)}</strong><span className={`status-text ${sponsor.status.toLowerCase().replace(' ', '-')}`}>{sponsor.status}</span></div>
                  </article>)}
                  {sponsors.length === 0 && <div className="empty-state">No sponsors yet. Add a prospect or record a commitment.</div>}
                </div>
                <button className="add-sponsor-link" onClick={() => setSponsorModal('sponsor')}><Plus size={16} /> Add sponsorship record</button>
              </section>
            </div>
          </>}

          {view === 'parts' && <section className="section-block data-section">
            <div className="table-toolbar">
              <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item, company, subteam..." aria-label="Search part requests" /></div>
              <div className="table-toolbar-controls">
                <label className="select-control"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select><ChevronDown size={15} /></label>
                <label className="select-control"><span className="sr-only">Sort part requests</span><select value={requestSort} onChange={(event) => setRequestSort(event.target.value as 'newest' | 'urgency')}><option value="newest">Sort: newest</option><option value="urgency">Sort: urgency</option></select><ChevronDown size={15} /></label>
              </div>
            </div>
            <div className="table-scroll"><table><thead><tr><th>PART / COMPANY</th><th>SUBTEAM</th><th>PRIORITY</th><th>ASSIGNED TO</th><th>COMPATIBILITY</th><th>COMMUNICATION</th><th>PART STATUS</th><th>VALUE</th><th>ACTIONS</th></tr></thead><tbody>
              {filteredRequests.map((request) => <tr key={request.id}>
                <td><div className="table-title">{request.link ? <a href={request.link} target="_blank" rel="noreferrer">{request.item} <ArrowUpRight size={12} /></a> : request.item}</div><div className="table-subtitle">{request.company} · {request.quantity} requested</div></td>
                <td>{request.subteam}</td><td><span className={`priority-label ${request.priority.toLowerCase()}`}><span />{request.priority}</span></td>
                <td><AssignmentSelect assignedId={request.assigneeId} user={user} members={teamMembers} requesterSubteam={request.requesterSubteam || request.subteam} label={`Assignment for request ${request.item}`} onChange={(assigneeId) => void updateRequestAssignee(request.id, assigneeId)} /></td>
                <td className="compat-cell" title={request.compatibility}>{request.compatibility || 'Not provided'}</td>
                <td><select className="inline-select" aria-label={`Communication status for ${request.item}`} value={request.communication} onChange={(event) => updateRequest(request.id, 'communication', event.target.value)}><option>Not started</option><option>Contacted</option><option>Follow-up</option><option>Confirmed</option></select></td>
                <td><select className="inline-select" aria-label={`Part status for ${request.item}`} value={request.status} onChange={(event) => updateRequest(request.id, 'status', event.target.value)}><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select></td>
                <td className="amount-cell">{money(request.value)}</td><td className="row-actions"><button type="button" className="icon-button row-action-button" title={`Delete ${request.item}`} aria-label={`Delete part request for ${request.item}`} onClick={() => void deleteRequest(request)}><Trash2 size={15} /></button></td>
              </tr>)}
              {filteredRequests.length === 0 && <tr><td colSpan={9} className="empty-table">No requests match this search.</td></tr>}
            </tbody></table></div>
            <div className="table-footer">Showing {filteredRequests.length} of {requests.length} requests <span>Changes are shared with the team</span></div>
          </section>}

          {view === 'sponsors' && <section className="section-block data-section">
            <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or contact..." aria-label="Search sponsors" /></div><button className="button secondary" onClick={() => downloadCsv(requests, sponsors, sponsorLeads, teamMembers)}><ArrowDownToLine size={16} /> Export CSV</button></div>
            <div className="table-scroll"><table><thead><tr><th>COMPANY / ENTITY</th><th>CONTACT</th><th>AMOUNT</th><th>STATUS</th><th>DELIVERABLES</th><th>RELATIONSHIP</th><th>RENEWAL</th><th>ACTIONS</th></tr></thead><tbody>
              {filteredSponsors.map((sponsor) => <tr key={sponsor.id}>
                <td><button type="button" className="sponsor-detail-trigger" onClick={() => { setSelectedSponsorId(sponsor.id); setSponsorModal('sponsor-detail') }}><span className="table-title">{sponsor.company}</span><span className="table-subtitle"><Eye size={12} /> View full sponsorship</span></button></td><td>{sponsor.contact || 'Not provided'}</td><td className="amount-cell">{money(sponsor.amount)}</td>
                <td><select className="inline-select" aria-label={`Sponsorship status for ${sponsor.company}`} value={sponsor.status} onChange={(event) => updateSponsorStatus(sponsor.id, event.target.value as SponsorStatus)}><option>Prospect</option><option>Proposal sent</option><option>Committed</option><option>Received</option></select></td>
                <td><button type="button" className="sponsor-deliverables-trigger" onClick={() => { setSelectedSponsorId(sponsor.id); setSponsorModal('sponsor-detail') }}>{sponsor.deliverables.length ? `${sponsor.deliverables.length} agreed` : 'View details'}</button></td><td>{sponsor.relationship}</td><td>{sponsor.renewal || 'Not set'}</td>
                <td><button type="button" className="button secondary sponsor-row-edit" onClick={() => { setSelectedSponsorId(sponsor.id); setSponsorModal('sponsor-edit') }} aria-label={`Edit sponsorship details for ${sponsor.company}`}><Pencil size={14} /> Edit</button></td>
              </tr>)}
              {filteredSponsors.length === 0 && <tr><td colSpan={8} className="empty-table">No sponsors match this search.</td></tr>}
            </tbody></table></div>
            <div className="table-footer">Showing {filteredSponsors.length} of {sponsors.length} sponsorships <span>Track the promise as well as the amount</span></div>
          </section>}

          {view === 'sponsor-leads' && <section className="section-block data-section">
            <div className="lead-queue-heading"><div><span className="section-kicker">BUSINESS TEAM FOLLOW-UP</span><strong>Member-submitted sponsor connections</strong></div><span>{openSponsorLeadCount} open</span></div>
            <div className="table-toolbar">
              <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, contact, or connection..." aria-label="Search sponsor leads" /></div>
              <label className="select-control"><span className="sr-only">Filter sponsor leads by status</span><select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}><option>All lead statuses</option><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select><ChevronDown size={15} /></label>
            </div>
            <div className="sponsor-lead-list">
              {filteredSponsorLeads.map((lead) => <article className="sponsor-lead-row" key={lead.id}>
                <button type="button" className="lead-summary-main" onClick={() => { setSelectedLeadId(lead.id); setModal('lead-detail') }} aria-label={`Open full sponsor lead for ${lead.company}`}>
                  <span className="lead-summary-company"><span>{lead.company}</span><small><Eye size={13} /> View full lead</small></span>
                  <span className="lead-summary-categories" aria-label="Potential support categories">{(lead.supportTypes || []).length ? lead.supportTypes.map((supportType) => <span className="lead-category" key={supportType}>{supportType}</span>) : <span className="lead-category">Not specified</span>}</span>
                  <span className="lead-summary-meta"><span>{lead.createdBy}{lead.subteam ? ` · ${lead.subteam}` : ''}</span><span>{lead.estimatedAmount ? `Cash: ${money(lead.estimatedAmount)}` : 'Cash estimate unknown'}</span></span>
                </button>
                <div className="lead-summary-tools">
                  <AssignmentSelect assignedId={lead.assigneeId} user={user} members={teamMembers} requesterSubteam={lead.requesterSubteam || lead.subteam} label={`Assignment for sponsor lead ${lead.company}`} onChange={(assigneeId) => void updateSponsorLeadAssignee(lead.id, assigneeId)} />
                  <select className="inline-select lead-status-select" aria-label={`Follow-up status for ${lead.company}`} value={lead.status} onChange={(event) => void updateSponsorLeadStatus(lead.id, event.target.value as SponsorLeadStatus)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select>
                  <button type="button" className="icon-button row-action-button" title={`Delete ${lead.company}`} aria-label={`Delete sponsor lead for ${lead.company}`} onClick={() => void deleteSponsorLead(lead)}><Trash2 size={15} /></button>
                </div>
              </article>)}
              {filteredSponsorLeads.length === 0 && <div className="empty-state lead-empty-state">No sponsor leads yet. Submit a business connection for follow-up.</div>}
            </div>
            <div className="table-footer">Showing {filteredSponsorLeads.length} of {sponsorLeads.length} sponsor leads <span>New leads are shared with all signed-in members</span></div>
          </section>}

          <footer className="page-footer"><span><Check size={14} /> Shared team records</span><button onClick={() => downloadCsv(requests, sponsors, sponsorLeads, teamMembers)}><ArrowDownToLine size={14} /> Download CSV</button></footer>
        </div>
      </main>

      {modal === 'request' && <RequestModal onClose={() => setModal(null)} onSave={addRequest} />}
      {sponsorModal === 'sponsor' && <SponsorModal onClose={() => setSponsorModal(null)} onSave={addSponsor} />}
      {sponsorModal === 'sponsor-edit' && selectedSponsor && <SponsorModal sponsor={selectedSponsor} onClose={() => setSponsorModal('sponsor-detail')} onSave={(input) => editSponsor(selectedSponsor.id, input)} />}
      {sponsorModal === 'sponsor-detail' && selectedSponsor && <SponsorDetailsModal sponsor={selectedSponsor} onClose={() => setSponsorModal(null)} onEdit={() => setSponsorModal('sponsor-edit')} onDelete={() => void deleteSponsor(selectedSponsor)} onDeliverableStatusChange={updateDeliverableStatus} />}
      {modal === 'lead' && <SponsorLeadModal onClose={() => setModal(null)} onSave={addSponsorLead} />}
      {modal === 'lead-detail' && selectedSponsorLead && <SponsorLeadDetailsModal lead={selectedSponsorLead} onClose={() => setModal(null)} onStatusChange={updateSponsorLeadStatus} />}
      {managementEdit?.kind === 'user' && <ManagementUserModal
        key={managementEdit.user.id}
        user={managementEdit.user}
        onClose={() => setManagementEdit(null)}
        onSave={(changes) => saveManagementUser(managementEdit.user.id, changes)}
      />}
      {managementEdit?.kind === 'request' && <RequestModal
        key={managementEdit.record.id}
        request={managementEdit.record}
        onClose={() => setManagementEdit(null)}
        onSave={(changes) => editManagementRequest(managementEdit.record.id, changes)}
      />}
      {managementEdit?.kind === 'sponsor' && <SponsorModal
        key={managementEdit.record.id}
        sponsor={managementEdit.record}
        onClose={() => setManagementEdit(null)}
        onSave={(changes) => editManagementSponsor(managementEdit.record.id, changes)}
      />}
      {managementEdit?.kind === 'lead' && <SponsorLeadModal
        key={managementEdit.record.id}
        lead={managementEdit.record}
        onClose={() => setManagementEdit(null)}
        onSave={(changes) => editManagementLead(managementEdit.record.id, changes)}
      />}
    </div>
  )
}

function RequestModal({ request, onClose, onSave }: { request?: PartRequest; onClose: () => void; onSave: (request: PartRequestInput) => Promise<void> }) {
  const [form, setForm] = useState({
    item: request?.item ?? '',
    company: request?.company ?? '',
    link: request?.link ?? '',
    contact: request?.contact ?? '',
    quantity: String(request?.quantity ?? 1),
    value: request ? String(request.value) : '',
    specs: request?.specs ?? '',
    compatibility: request?.compatibility ?? '',
    priority: request?.priority ?? 'Normal' as PartRequest['priority'],
    subteam: request?.subteam ?? '',
    relationship: request?.relationship ?? '',
    communication: request?.communication ?? 'Not started' as CommunicationStatus,
    status: request?.status ?? 'Needed' as RequestStatus,
    recurring: request?.recurring ?? false,
    requestedBy: request?.requestedBy ?? '',
  })
  const change = (field: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }))
  const requestSubteams = subteamOptions.includes(form.subteam) ? subteamOptions : [...subteamOptions, form.subteam].filter(Boolean)

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
    <div className="modal-heading"><div><span className="section-kicker">{request ? 'DEV ADMINISTRATION' : 'TEAM INTAKE'}</span><h2 id="request-title">{request ? 'Edit part request' : 'Submit a part request'}</h2><p>Share enough context for the team to assess fit and reach out.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, quantity: Math.max(1, Number(form.quantity) || 1), value: Number(form.value) || 0 }) }}>
      <div className="form-grid">
        <label className="field"><span>Part or product <b>*</b></span><input required value={form.item} onChange={(event) => change('item', event.target.value)} placeholder="What does your team need?" /></label>
        <label className="field"><span>Company / entity</span><input value={form.company} onChange={(event) => change('company', event.target.value)} placeholder="Potential supplier or donor" /></label>
        <label className="field"><span>Subteam <b>*</b></span><select required value={form.subteam} onChange={(event) => change('subteam', event.target.value)}><option value="">Select a subteam</option>{requestSubteams.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="field"><span>Requested by</span><input value={form.requestedBy} onChange={(event) => change('requestedBy', event.target.value)} placeholder="Your name" /></label>
        <label className="field"><span>Product link</span><input type="url" value={form.link} onChange={(event) => change('link', event.target.value)} placeholder="https://" /></label>
        <label className="field"><span>Seller contact</span><input value={form.contact} onChange={(event) => change('contact', event.target.value)} placeholder="Name, email, or phone" /></label>
        <label className="field"><span>Quantity</span><input type="number" min="1" value={form.quantity} onChange={(event) => change('quantity', event.target.value)} /></label>
        <label className="field"><span>Estimated value (USD)</span><input type="number" min="0" value={form.value} onChange={(event) => change('value', event.target.value)} placeholder="0" /></label>
        <label className="field"><span>Priority</span><select value={form.priority} onChange={(event) => change('priority', event.target.value)}><option>Urgent</option><option>High</option><option>Normal</option><option>Low</option></select></label>
        <label className="field"><span>Repeat need?</span><select value={String(form.recurring)} onChange={(event) => change('recurring', event.target.value === 'true')}><option value="false">One-time</option><option value="true">Recurring</option></select></label>
        <label className="field full-field"><span>Required specifications</span><textarea rows={2} value={form.specs} onChange={(event) => change('specs', event.target.value)} placeholder="Key dimensions, ratings, standards, or constraints" /></label>
        <label className="field full-field"><span>Compatibility with current build</span><textarea rows={2} value={form.compatibility} onChange={(event) => change('compatibility', event.target.value)} placeholder="How does this fit the current design? What is still unverified?" /></label>
        <label className="field"><span>Relationship to seller</span><input value={form.relationship} onChange={(event) => change('relationship', event.target.value)} placeholder="Who knows them, and how?" /></label>
        <label className="field"><span>Communication status</span><select value={form.communication} onChange={(event) => change('communication', event.target.value)}><option>Not started</option><option>Contacted</option><option>Follow-up</option><option>Confirmed</option></select></label>
        {request && <label className="field"><span>Request status</span><select value={form.status} onChange={(event) => change('status', event.target.value)}><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select></label>}
      </div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> {request ? 'Save changes' : 'Submit request'}</button></div>
    </form>
  </section></div>
}

function SponsorModal({ sponsor, onClose, onSave }: { sponsor?: Sponsor; onClose: () => void; onSave: (sponsor: SponsorInput) => Promise<void> }) {
  const [form, setForm] = useState({
    company: sponsor?.company ?? '',
    contact: sponsor?.contact ?? '',
    amount: sponsor ? String(sponsor.amount) : '',
    status: sponsor?.status ?? 'Prospect' as SponsorStatus,
    relationship: sponsor?.relationship ?? '',
    renewal: sponsor?.renewal ?? '',
    deliverables: sponsor?.deliverables.length ? sponsor.deliverables.map((item) => ({ ...item })) : [{ description: '', status: 'Not started' as DeliverableStatus }],
  })
  const changeDeliverable = (index: number, value: string) => setForm((current) => ({ ...current, deliverables: current.deliverables.map((item, itemIndex) => itemIndex === index ? { ...item, description: value } : item) }))
  const addDeliverable = () => setForm((current) => current.deliverables.length < 20 ? { ...current, deliverables: [...current.deliverables, { description: '', status: 'Not started' }] } : current)
  const removeDeliverable = (index: number) => setForm((current) => ({ ...current, deliverables: current.deliverables.length > 1 ? current.deliverables.filter((_, itemIndex) => itemIndex !== index) : [{ description: '', status: 'Not started' }] }))

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal sponsor-modal" role="dialog" aria-modal="true" aria-labelledby="sponsor-title">
    <div className="modal-heading"><div><span className="section-kicker">FUNDING PIPELINE</span><h2 id="sponsor-title">{sponsor ? 'Edit sponsorship' : 'Add sponsorship'}</h2><p>Record the relationship, agreement, and what the team owes the donor.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ company: form.company, contact: form.contact, amount: Number(form.amount) || 0, status: form.status, relationship: form.relationship, renewal: form.renewal, deliverables: form.deliverables.filter((item) => item.description.trim()) }) }}>
      <div className="form-grid">
        <label className="field"><span>Company / entity <b>*</b></span><input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Organization name" /></label>
        <label className="field"><span>Contact info</span><input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="Name, email, or phone" /></label>
        <label className="field"><span>Amount (USD)</span><input type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /></label>
        <label className="field"><span>Agreement status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SponsorStatus })}><option>Prospect</option><option>Proposal sent</option><option>Committed</option><option>Received</option></select></label>
        <label className="field"><span>Relationship to donor</span><input value={form.relationship} onChange={(event) => setForm({ ...form, relationship: event.target.value })} placeholder="Who knows them, and how?" /></label>
        <label className="field"><span>Renewal / follow-up date</span><input type="date" value={form.renewal} onChange={(event) => setForm({ ...form, renewal: event.target.value })} /></label>
      </div>
      <div className="deliverables-heading"><div><strong>Agreed deliverables</strong><span>Add up to 20 commitments to the sponsor.</span></div><button type="button" className="icon-button add-deliverable-button" onClick={addDeliverable} disabled={form.deliverables.length >= 20} aria-label="Add deliverable" title="Add deliverable"><Plus size={17} /></button></div>
      <div className="deliverables-grid">{form.deliverables.map((deliverable, index) => <div className="deliverable-field" key={index}><label className="field"><span>Deliverable {index + 1}</span><input value={deliverable.description} onChange={(event) => changeDeliverable(index, event.target.value)} placeholder="e.g. Logo placement" /></label>{form.deliverables.length > 1 && <button type="button" className="icon-button remove-deliverable-button" onClick={() => removeDeliverable(index)} aria-label={`Remove deliverable ${index + 1}`} title={`Remove deliverable ${index + 1}`}><X size={15} /></button>}</div>)}</div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> {sponsor ? 'Save changes' : 'Save sponsor'}</button></div>
    </form>
  </section></div>
}

function SponsorDetailsModal({ sponsor, onClose, onEdit, onDelete, onDeliverableStatusChange }: { sponsor: Sponsor; onClose: () => void; onEdit: () => void; onDelete: () => void; onDeliverableStatusChange: (sponsor: Sponsor, index: number, status: DeliverableStatus) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-details-modal" role="dialog" aria-modal="true" aria-labelledby="sponsor-details-title">
    <div className="modal-heading"><div><span className="section-kicker">FULL SPONSORSHIP RECORD</span><h2 id="sponsor-details-title">{sponsor.company}</h2><p>Added by {sponsor.createdBy} · {sponsor.createdAt}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <div className="lead-details-content">
      <section className="lead-details-section"><h3>Agreement</h3><p>{sponsor.status} · {money(sponsor.amount)}</p></section>
      <section className="lead-details-section"><h3>Contact</h3><p>{sponsor.contact || 'No contact provided'}</p></section>
      <section className="lead-details-section"><h3>Agreed deliverables ({sponsor.deliverables.length})</h3>{sponsor.deliverables.length ? <ul className="sponsor-deliverables-list">{sponsor.deliverables.map((deliverable, index) => <li key={`${deliverable.description}-${index}`}><span>{deliverable.description}</span><select className="inline-select deliverable-status-select" aria-label={`Tracking status for ${deliverable.description}`} value={deliverable.status} onChange={(event) => void onDeliverableStatusChange(sponsor, index, event.target.value as DeliverableStatus)}><option>Not started</option><option>In progress</option><option>Completed</option></select></li>)}</ul> : <p>No deliverables listed.</p>}</section>
      <section className="lead-details-section"><h3>Relationship</h3><p>{sponsor.relationship || 'No relationship details provided.'}</p></section>
      <section className="lead-details-section"><h3>Renewal / follow-up</h3><p>{sponsor.renewal || 'Not set'}</p></section>
    </div>
    <div className="modal-actions sponsor-detail-actions"><button type="button" className="button secondary delete-sponsor-button" onClick={onDelete}><Trash2 size={15} /> Delete sponsorship</button><button type="button" className="button secondary" onClick={onClose}>Close</button><button type="button" className="button primary" onClick={onEdit}>Edit sponsorship</button></div>
  </section></div>
}

function SponsorLeadModal({ lead, onClose, onSave }: { lead?: SponsorLead; onClose: () => void; onSave: (lead: SponsorLeadInput & { status?: SponsorLeadStatus }) => Promise<void> }) {
  const supportOptions: SponsorLeadInput['supportTypes'] = ['Financial', 'Parts / materials', 'Equipment', 'Services / expertise', 'Other']
  const [form, setForm] = useState({
    company: lead?.company ?? '',
    contactName: lead?.contactName ?? '',
    contactRole: lead?.contactRole ?? '',
    contactEmail: lead?.contactEmail ?? '',
    contactPhone: lead?.contactPhone ?? '',
    subteam: lead?.subteam ?? '',
    relationship: lead?.relationship ?? '',
    details: lead?.details ?? '',
    supportTypes: lead?.supportTypes ?? [] as SponsorLeadInput['supportTypes'],
    supportDetails: lead?.supportDetails ?? '',
    estimatedAmount: lead ? String(lead.estimatedAmount) : '',
    canIntroduce: lead?.canIntroduce ?? 'Not sure' as SponsorLeadInput['canIntroduce'],
    status: lead?.status ?? 'New' as SponsorLeadStatus,
  })
  const [formError, setFormError] = useState('')
  const change = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const leadSubteams = subteamOptions.includes(form.subteam) ? subteamOptions : [...subteamOptions, form.subteam].filter(Boolean)
  const toggleSupportType = (supportType: SponsorLeadInput['supportTypes'][number]) => setForm((current) => ({
    ...current,
    supportTypes: current.supportTypes.includes(supportType)
      ? current.supportTypes.filter((selected) => selected !== supportType)
      : [...current.supportTypes, supportType],
  }))

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-title">
    <div className="modal-heading"><div><span className="section-kicker">{lead ? 'DEV ADMINISTRATION' : 'BUSINESS TEAM INTAKE'}</span><h2 id="lead-title">{lead ? 'Edit sponsor lead' : 'Submit a sponsor lead'}</h2><p>Share a company connection for the business team to follow up.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!form.supportTypes.length) { setFormError('Choose at least one type of support.'); return } setFormError(''); void onSave({ ...form, estimatedAmount: Number(form.estimatedAmount) || 0, ...(lead ? { status: form.status } : {}) }) }}>
      <div className="form-grid">
        <label className="field"><span>Company or business <b>*</b></span><input required value={form.company} onChange={(event) => change('company', event.target.value)} placeholder="Organization name" /></label>
        <label className="field"><span>Contact name</span><input value={form.contactName} onChange={(event) => change('contactName', event.target.value)} placeholder="Person you know" /></label>
        <label className="field"><span>Contact role</span><input value={form.contactRole} onChange={(event) => change('contactRole', event.target.value)} placeholder="Title or department" /></label>
        <label className="field"><span>Contact email</span><input type="email" value={form.contactEmail} onChange={(event) => change('contactEmail', event.target.value)} placeholder="name@company.com" /></label>
        <label className="field"><span>Contact phone</span><input type="tel" value={form.contactPhone} onChange={(event) => change('contactPhone', event.target.value)} placeholder="Optional" /></label>
        <label className="field"><span>Your subteam</span><select value={form.subteam} onChange={(event) => change('subteam', event.target.value)}><option value="">Select a subteam</option>{leadSubteams.map((option) => <option key={option}>{option}</option>)}</select></label>
        {lead && <label className="field"><span>Follow-up status</span><select value={form.status} onChange={(event) => change('status', event.target.value)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select></label>}
        <label className="field"><span>Estimated cash amount (USD)</span><input type="number" min="0" value={form.estimatedAmount} onChange={(event) => change('estimatedAmount', event.target.value)} placeholder="Optional; leave blank if unknown" /></label>
        <label className="field"><span>Can you introduce us?</span><select value={form.canIntroduce} onChange={(event) => change('canIntroduce', event.target.value as SponsorLeadInput['canIntroduce'])}><option>Not sure</option><option>Yes</option><option>No</option></select></label>
        <div className="field full-field"><span>What could they provide? <b>*</b></span><div className="support-options">{supportOptions.map((supportType) => <label className="support-option" key={supportType}><input type="checkbox" checked={form.supportTypes.includes(supportType)} onChange={() => toggleSupportType(supportType)} /><span>{supportType}</span></label>)}</div></div>
        <label className="field full-field"><span>What parts, materials, equipment, or services could they offer? <b>*</b></span><textarea required rows={2} value={form.supportDetails} onChange={(event) => change('supportDetails', event.target.value)} placeholder="Describe the possible in-kind or financial support" /></label>
        <label className="field full-field"><span>How do you know them, or who can connect us? <b>*</b></span><textarea required rows={2} value={form.relationship} onChange={(event) => change('relationship', event.target.value)} placeholder="Explain the relationship or possible introduction" /></label>
        <label className="field full-field"><span>Why might they support the team? <b>*</b></span><textarea required rows={3} value={form.details} onChange={(event) => change('details', event.target.value)} placeholder="Share relevant interests, prior support, or context for an outreach proposal" /></label>
      </div>
      {formError && <div className="lead-form-error" role="alert">{formError}</div>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> {lead ? 'Save changes' : 'Submit sponsor lead'}</button></div>
    </form>
  </section></div>
}

function SponsorLeadDetailsModal({ lead, onClose, onStatusChange }: { lead: SponsorLead; onClose: () => void; onStatusChange: (id: string, status: SponsorLeadStatus) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-details-modal" role="dialog" aria-modal="true" aria-labelledby="lead-details-title">
    <div className="modal-heading"><div><span className="section-kicker">SPONSOR LEAD · SUBMITTED BY {lead.createdBy.toUpperCase()}</span><h2 id="lead-details-title">{lead.company}</h2><p>{lead.subteam || 'Team connection'} · Submitted {lead.createdAt}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close lead details"><X size={19} /></button></div>
    <div className="lead-details-content">
      <section className="lead-details-section"><h3>Potential support</h3><div className="lead-detail-categories">{(lead.supportTypes || []).map((supportType) => <span className="lead-category" key={supportType}>{supportType}</span>)}</div><p>{lead.supportDetails || 'No offer details provided.'}</p><div className="lead-detail-cash">Estimated cash: <strong>{lead.estimatedAmount ? money(lead.estimatedAmount) : 'Not specified'}</strong></div></section>
      <section className="lead-details-section"><h3>Contact</h3><p>{lead.contactName || 'No named contact'}{lead.contactRole ? ` · ${lead.contactRole}` : ''}</p><div className="lead-contact-links">{lead.contactEmail && <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a>}{lead.contactPhone && <a href={`tel:${lead.contactPhone}`}>{lead.contactPhone}</a>}</div></section>
      <section className="lead-details-section"><h3>Connection</h3><p>{lead.relationship}</p><div className="lead-detail-cash">Can introduce: <strong>{lead.canIntroduce}</strong></div></section>
      <section className="lead-details-section"><h3>Why they might support the team</h3><p>{lead.details}</p></section>
      <label className="lead-detail-status"><span>Business team follow-up</span><select className="inline-select" value={lead.status} onChange={(event) => void onStatusChange(lead.id, event.target.value as SponsorLeadStatus)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select></label>
    </div>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
  </section></div>
}

export default App
