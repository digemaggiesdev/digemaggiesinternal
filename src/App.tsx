import { useCallback, useEffect, useRef, useState } from 'react'
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
  addRecordNote,
  addSponsorNote,
  deleteSponsor as removeSponsor,
  getRequests,
  getSession,
  getSponsorLeads,
  getSponsors,
  getTeamMembers,
  getSubteamChangeRequests,
  getManagementUsers,
  deleteAccount,
  emailManagementUserPasswordReset,
  cancelSubteamChangeRequest,
  requestSubteamChange,
  requestPasswordReset,
  reviewSubteamChangeRequest,
  resetPassword,
  signIn,
  signOut,
  signUp,
  subteamOptions,
  updateAccount,
  updateManagementSponsor,
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
  RecordActivity,
} from './api'
import './App.css'

type View = 'overview' | 'parts' | 'sponsors' | 'sponsor-leads' | 'account' | 'management'
type ManagementEdit =
  | { kind: 'user'; user: TeamUser }
  | { kind: 'request'; record: PartRequest }
  | { kind: 'sponsor'; record: Sponsor }
  | { kind: 'lead'; record: SponsorLead }

type AttentionItem = {
  id: string
  kind: 'part_request' | 'sponsorship' | 'sponsor_lead'
  title: string
  subtitle: string
  reasons: string[]
  nextFollowUpAt: string
  assigneeId: string
  status: RequestStatus | SponsorStatus | SponsorLeadStatus
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function recordAttention(
  requests: PartRequest[],
  sponsors: Sponsor[],
  leads: SponsorLead[],
  members: TeamMember[],
  now = new Date(),
): AttentionItem[] {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const staleBefore = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const activeRequests = requests.filter((request) => !['Received', 'Closed'].includes(request.status))
  const activeSponsors = sponsors.filter((sponsor) => sponsor.status !== 'Received')
  const activeLeads = leads.filter((lead) => !['Converted', 'Not pursuing'].includes(lead.status))
  return [
    ...activeRequests.map((request): AttentionItem => {
      const reasons: string[] = []
      if (request.nextFollowUpAt && request.nextFollowUpAt < today) reasons.push('Follow-up overdue')
      if (!request.assigneeId) reasons.push('Unassigned')
      else if (!members.some((member) => member.id === request.assigneeId && member.active)) reasons.push('Assigned member inactive')
      if (!request.nextFollowUpAt) reasons.push('Set follow-up date')
      if (new Date(request.updatedAt || request.createdAt).getTime() < staleBefore) reasons.push('No recent activity')
      const assignee = members.find((member) => member.id === request.assigneeId)
      return { id: request.id, kind: 'part_request', title: request.item, subtitle: `${request.subteam} · ${assignee ? `${assignee.displayName}${assignee.active ? '' : ' (inactive)'}` : 'Unassigned'}`, reasons, nextFollowUpAt: request.nextFollowUpAt || '', assigneeId: request.assigneeId || '', status: request.status }
    }),
    ...activeSponsors.map((sponsor): AttentionItem => {
      const reasons: string[] = []
      if (sponsor.renewal && sponsor.renewal < today) reasons.push('Follow-up overdue')
      if (!sponsor.renewal) reasons.push('Set renewal / follow-up date')
      if (new Date(sponsor.updatedAt || sponsor.createdAt).getTime() < staleBefore) reasons.push('No recent activity')
      return { id: sponsor.id, kind: 'sponsorship', title: sponsor.company, subtitle: `Sponsorship · ${sponsor.status} · ${money(sponsor.amount)}`, reasons, nextFollowUpAt: sponsor.renewal || '', assigneeId: '', status: sponsor.status }
    }),
    ...activeLeads.map((lead): AttentionItem => {
      const reasons: string[] = []
      if (lead.nextFollowUpAt && lead.nextFollowUpAt < today) reasons.push('Follow-up overdue')
      if (!lead.assigneeId) reasons.push('Unassigned')
      else if (!members.some((member) => member.id === lead.assigneeId && member.active)) reasons.push('Assigned member inactive')
      if (!lead.nextFollowUpAt) reasons.push('Set follow-up date')
      if (new Date(lead.updatedAt || lead.createdAt).getTime() < staleBefore) reasons.push('No recent activity')
      const assignee = members.find((member) => member.id === lead.assigneeId)
      return { id: lead.id, kind: 'sponsor_lead', title: lead.company, subtitle: `Sponsor lead · ${assignee ? `${assignee.displayName}${assignee.active ? '' : ' (inactive)'}` : 'Unassigned'}`, reasons, nextFollowUpAt: lead.nextFollowUpAt || '', assigneeId: lead.assigneeId || '', status: lead.status }
    }),
  ].filter((item) => item.reasons.length > 0)
    .sort((first, second) => {
      const firstOverdue = first.reasons.includes('Follow-up overdue') ? 0 : 1
      const secondOverdue = second.reasons.includes('Follow-up overdue') ? 0 : 1
      return firstOverdue - secondOverdue || first.title.localeCompare(second.title)
    })
}

function ActivityPanel({ activity = [], canEdit, onAddNote }: {
  activity?: RecordActivity[]
  canEdit: boolean
  onAddNote: (body: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = note.trim()
    if (!body) return
    setError('')
    setSaving(true)
    try {
      await onAddNote(body)
      setNote('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this note.')
    } finally {
      setSaving(false)
    }
  }
  return <section className="lead-details-section activity-section">
    <h3>Activity & notes</h3>
    {canEdit && <form className="activity-note-form" onSubmit={(event) => void submit(event)}>
      <textarea aria-label="Add a note" rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a handoff note or follow-up context..." />
      <button className="button secondary" disabled={saving || !note.trim()}>{saving ? 'Saving...' : 'Add note'}</button>
    </form>}
    {error && <div className="action-error" role="alert">{error}</div>}
    {activity.length ? <ol className="activity-list">{[...activity].reverse().map((entry) => <li key={entry.id}>
      <div><strong>{entry.actor}</strong><span>{entry.type === 'note' ? ' · Note' : ''}</span></div>
      <p>{entry.body}</p><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
    </li>)}</ol> : <p className="activity-empty">No history yet.</p>}
  </section>
}

function NeedsAttentionQueue({ items, user, members, onOpen, onFollowUpChange, onRequestStatusChange, onLeadStatusChange, onAssigneeChange }: {
  items: AttentionItem[]
  user: TeamUser
  members: TeamMember[]
  onOpen: (item: AttentionItem) => void
  onFollowUpChange: (item: AttentionItem, date: string) => void
  onRequestStatusChange: (id: string, status: RequestStatus) => void
  onLeadStatusChange: (id: string, status: SponsorLeadStatus) => void
  onAssigneeChange: (item: AttentionItem, assigneeId: string) => void
}) {
  const [category, setCategory] = useState<'all' | AttentionItem['kind']>('all')
  const canEditStatusAndAssignee = user.tag === 'dev' || user.tag === 'stl'
  const canEditFollowUp = canEditStatusAndAssignee || user.subteam.trim().toLowerCase() === 'exec'
  const categoryItems = category === 'all' ? items : items.filter((item) => item.kind === category)
  const categories: { value: typeof category; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: items.length },
    { value: 'part_request', label: 'Part requests', count: items.filter((item) => item.kind === 'part_request').length },
    { value: 'sponsorship', label: 'Sponsors', count: items.filter((item) => item.kind === 'sponsorship').length },
    { value: 'sponsor_lead', label: 'Leads', count: items.filter((item) => item.kind === 'sponsor_lead').length },
  ]
  return <section className="section-block attention-queue" aria-label="Needs attention">
    <div className="section-heading">
      <div><span className="section-kicker">TEAM FOLLOW-UP</span><h2>Needs attention</h2></div>
      <span className="attention-count">{categoryItems.length} {categoryItems.length === 1 ? 'item' : 'items'}</span>
    </div>
    <div className="attention-filters" role="group" aria-label="Filter needs attention by record type">
      {categories.map((option) => <button type="button" key={option.value} className={category === option.value ? 'active' : ''} aria-pressed={category === option.value} onClick={() => setCategory(option.value)}>{option.label}<span>{option.count}</span></button>)}
    </div>
    {categoryItems.length ? <ul>{categoryItems.map((item) => <li key={`${item.kind}-${item.id}`}>
      <div className="attention-item">
        <button type="button" className="attention-item-open" onClick={() => onOpen(item)}>
          <span className="attention-item-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
          <span className="attention-reasons">{item.reasons.map((reason) => <span key={reason} className={reason === 'Follow-up overdue' ? 'overdue' : ''}>{reason}</span>)}</span>
          <ArrowUpRight size={15} />
        </button>
        <div className="attention-controls">
          <label><span>{item.kind === 'sponsorship' ? 'Renewal / follow-up' : 'Next follow-up'}</span><input type="date" aria-label={`${item.kind === 'sponsorship' ? 'Renewal or follow-up' : 'Next follow-up'} date for ${item.title}`} value={item.nextFollowUpAt} disabled={!canEditFollowUp} onChange={(event) => onFollowUpChange(item, event.target.value)} /></label>
          {item.kind !== 'sponsorship' && <>
            <label><span>Assigned to</span><select aria-label={`Assignment for ${item.title}`} value={item.assigneeId} disabled={!canEditStatusAndAssignee} onChange={(event) => onAssigneeChange(item, event.target.value)}>
              <option value="">Unassigned</option>
              {members.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.subteam}</option>)}
              {item.assigneeId && !members.some((member) => member.id === item.assigneeId && member.active) && <option value={item.assigneeId} disabled>{members.find((member) => member.id === item.assigneeId)?.displayName || 'Inactive member'} · inactive</option>}
            </select></label>
            {canEditStatusAndAssignee && <label><span>Status</span><select aria-label={`Status for ${item.title}`} value={item.status} onChange={(event) => item.kind === 'part_request'
              ? onRequestStatusChange(item.id, event.target.value as RequestStatus)
              : onLeadStatusChange(item.id, event.target.value as SponsorLeadStatus)}>
              {(item.kind === 'part_request'
                ? ['Needed', 'Outreach', 'In transit', 'Received', 'Closed'] as RequestStatus[]
                : ['New', 'Following up', 'Contacted', 'Converted', 'Not pursuing'] as SponsorLeadStatus[]).map((status) => <option key={status}>{status}</option>)}
            </select></label>}
          </>}
        </div>
      </div>
    </li>)}</ul> : <p className="attention-empty">{category === 'all' ? 'Nothing is overdue, unassigned, or waiting for a follow-up date.' : `No ${categories.find((option) => option.value === category)?.label.toLowerCase()} need attention.`}</p>}
  </section>
}

function AssignmentSelect({ assignedId, user, members, requesterSubteam, label, onChange }: {
  assignedId?: string
  user: TeamUser | null
  members: TeamMember[]
  requesterSubteam: string
  label: string
  onChange: (assigneeId: string) => void
}) {
  const userSubteam = user?.subteam.trim().toLowerCase() || ''
  const sourceSubteam = requesterSubteam.trim().toLowerCase()
  const activeMembers = members.filter((member) => member.active)
  const canClaim = user?.tag === 'member'
    && !assignedId
    && (userSubteam === 'business' || userSubteam === sourceSubteam)
  const canEdit = user?.tag === 'dev' || user?.tag === 'stl' || canClaim
  const visibleMembers = user?.tag === 'dev'
    ? activeMembers
    : user?.tag === 'stl' && userSubteam === 'exec'
      ? activeMembers.filter((member) => member.id === user.id || ['business', sourceSubteam].includes(member.subteam.trim().toLowerCase()))
      : user?.tag === 'stl'
        ? activeMembers.filter((member) => member.subteam.trim().toLowerCase() === userSubteam)
        : canClaim
          ? activeMembers.filter((member) => member.id === user?.id)
          : []
  const currentAssignee = members.find((member) => member.id === assignedId)
  const currentAssigneeLabel = currentAssignee
    ? `${currentAssignee.displayName} · ${currentAssignee.subteam}${currentAssignee.active ? '' : ' (inactive)'}`
    : assignedId ? 'Assigned member' : 'Unassigned'

  return <select
    className="inline-select assignee-select"
    aria-label={label}
    value={assignedId || ''}
    disabled={!canEdit}
    onChange={(event) => onChange(event.target.value)}
  >
    <option value="">{canClaim ? 'Unassigned' : (user?.tag === 'dev' || user?.tag === 'stl') ? 'Unassigned' : currentAssigneeLabel}</option>
    {visibleMembers.map((member) => <option key={member.id} value={member.id}>{canClaim && member.id === user?.id ? 'Claim this task' : `${member.displayName} · ${member.subteam}${member.id === user?.id ? ' (You)' : ''}`}</option>)}
    {assignedId && !visibleMembers.some((member) => member.id === assignedId) && <option value={assignedId} disabled>{currentAssigneeLabel}</option>}
  </select>
}

type MemberTask = {
  id: string
  kind: 'part_request' | 'sponsor_lead'
  title: string
  sourceSubteam: string
  status: RequestStatus | SponsorLeadStatus
  communication?: CommunicationStatus
  nextFollowUpAt: string
}

function MemberTaskOverview({ user, requests, leads, onClaim, onRequestUpdate, onLeadStatusChange, onLeadFollowUpChange }: {
  user: TeamUser
  requests: PartRequest[]
  leads: SponsorLead[]
  onClaim: (kind: MemberTask['kind'], id: string) => void
  onRequestUpdate: (id: string, field: 'status' | 'communication' | 'nextFollowUpAt', value: string) => void
  onLeadStatusChange: (id: string, status: SponsorLeadStatus) => void
  onLeadFollowUpChange: (id: string, date: string) => void
}) {
  const isBusiness = user.subteam.trim().toLowerCase() === 'business'
  const isActiveRequest = (request: PartRequest) => !['Received', 'Closed'].includes(request.status)
  const isActiveLead = (lead: SponsorLead) => !['Converted', 'Not pursuing'].includes(lead.status)
  const assignedTasks: MemberTask[] = [
    ...requests.filter((request) => request.assigneeId === user.id).map((request) => ({
      id: request.id,
      kind: 'part_request' as const,
      title: request.item,
      sourceSubteam: request.requesterSubteam || request.subteam,
      status: request.status,
      communication: request.communication,
      nextFollowUpAt: request.nextFollowUpAt || '',
    })),
    ...leads.filter((lead) => lead.assigneeId === user.id).map((lead) => ({
      id: lead.id,
      kind: 'sponsor_lead' as const,
      title: lead.company,
      sourceSubteam: lead.requesterSubteam || lead.subteam || 'Business',
      status: lead.status,
      nextFollowUpAt: lead.nextFollowUpAt || '',
    })),
  ]
  const availableTasks: MemberTask[] = [
    ...requests.filter((request) => !request.assigneeId && isActiveRequest(request)
      && (isBusiness || (request.requesterSubteam || request.subteam).trim().toLowerCase() === user.subteam.trim().toLowerCase()))
      .map((request) => ({
        id: request.id,
        kind: 'part_request' as const,
        title: request.item,
        sourceSubteam: request.requesterSubteam || request.subteam,
        status: request.status,
        communication: request.communication,
        nextFollowUpAt: request.nextFollowUpAt || '',
      })),
    ...leads.filter((lead) => !lead.assigneeId && isActiveLead(lead)
      && (isBusiness || (lead.requesterSubteam || lead.subteam).trim().toLowerCase() === user.subteam.trim().toLowerCase()))
      .map((lead) => ({
        id: lead.id,
        kind: 'sponsor_lead' as const,
        title: lead.company,
        sourceSubteam: lead.requesterSubteam || lead.subteam || 'Business',
        status: lead.status,
        nextFollowUpAt: lead.nextFollowUpAt || '',
      })),
  ]

  const renderTask = (task: MemberTask, canClaim: boolean) => <article className="member-task-row" key={`${task.kind}-${task.id}`}>
    <div className="member-task-main">
      <strong>{task.title}</strong>
      <span>{task.kind === 'part_request' ? 'Part request' : 'Sponsor lead'} · Posted by {task.sourceSubteam}</span>
    </div>
    {canClaim
      ? <button className="button secondary member-task-claim" type="button" onClick={() => onClaim(task.kind, task.id)}>Claim task</button>
      : <div className="member-task-controls">
        <label><span>Status</span><select className="inline-select" aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => task.kind === 'part_request'
          ? onRequestUpdate(task.id, 'status', event.target.value)
          : onLeadStatusChange(task.id, event.target.value as SponsorLeadStatus)}>
          {(task.kind === 'part_request'
            ? ['Needed', 'Outreach', 'In transit', 'Received', 'Closed']
            : ['New', 'Following up', 'Contacted', 'Converted', 'Not pursuing']).map((status) => <option key={status}>{status}</option>)}
        </select></label>
        {task.kind === 'part_request' && <label><span>Communication</span><select className="inline-select" aria-label={`Communication status for ${task.title}`} value={task.communication} onChange={(event) => onRequestUpdate(task.id, 'communication', event.target.value)}>
          <option>Not started</option><option>Contacted</option><option>Follow-up</option><option>Confirmed</option>
        </select></label>}
        <label><span>Next follow-up</span><input type="date" aria-label={`Next follow-up date for ${task.title}`} value={task.nextFollowUpAt} onChange={(event) => task.kind === 'part_request'
          ? onRequestUpdate(task.id, 'nextFollowUpAt', event.target.value)
          : onLeadFollowUpChange(task.id, event.target.value)} /></label>
      </div>}
  </article>

  return <div className="member-task-overview">
    <section className="section-block member-task-section">
      <div className="section-heading"><div><span className="section-kicker">YOUR WORK</span><h2>Assigned to me</h2></div><span className="member-task-count">{assignedTasks.length}</span></div>
      <p className="member-task-help">Update each task as you make progress. Changes are recorded in the task activity.</p>
      {assignedTasks.length ? <div className="member-task-list">{assignedTasks.map((task) => renderTask(task, false))}</div> : <p className="member-task-empty">You do not have any assigned tasks yet.</p>}
    </section>
    <section className="section-block member-task-section">
      <div className="section-heading"><div><span className="section-kicker">AVAILABLE WORK</span><h2>Tasks you can claim</h2></div><span className="member-task-count">{availableTasks.length}</span></div>
      <p className="member-task-help">{isBusiness ? 'As a Business member, you can claim any unassigned task.' : `You can claim unassigned tasks posted by ${user.subteam}.`}</p>
      {availableTasks.length ? <div className="member-task-list">{availableTasks.map((task) => renderTask(task, true))}</div> : <p className="member-task-empty">There are no unassigned tasks available to you right now.</p>}
    </section>
  </div>
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

function ManagementTab({ users, members, currentUserId, requests, sponsors, leads, onEditUser, onToggleUserActive, onEditRequest, onEditSponsor, onEditLead, onBulkRequestUpdate, onBulkLeadUpdate }: {
  users: TeamUser[]
  members: TeamMember[]
  currentUserId: string
  requests: PartRequest[]
  sponsors: Sponsor[]
  leads: SponsorLead[]
  onEditUser: (user: TeamUser) => void
  onToggleUserActive: (user: TeamUser) => void
  onEditRequest: (request: PartRequest) => void
  onEditSponsor: (sponsor: Sponsor) => void
  onEditLead: (lead: SponsorLead) => void
  onBulkRequestUpdate: (ids: string[], changes: { assigneeId?: string; status?: RequestStatus }) => Promise<void>
  onBulkLeadUpdate: (ids: string[], changes: { assigneeId?: string; status?: SponsorLeadStatus }) => Promise<void>
}) {
  const [section, setSection] = useState<'users' | 'requests' | 'sponsors' | 'leads'>('users')
  const [userFilter, setUserFilter] = useState('all')
  const [requestFilter, setRequestFilter] = useState('all')
  const [sponsorFilter, setSponsorFilter] = useState('all')
  const [leadFilter, setLeadFilter] = useState('all')
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [bulkRequestAssignee, setBulkRequestAssignee] = useState('__unchanged')
  const [bulkRequestStatus, setBulkRequestStatus] = useState('__unchanged')
  const [bulkLeadAssignee, setBulkLeadAssignee] = useState('__unchanged')
  const [bulkLeadStatus, setBulkLeadStatus] = useState('__unchanged')
  const [bulkError, setBulkError] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const subteams = [...new Map(users.filter((member) => member.subteam.trim()).map((member) => [
    member.subteam.trim().toLocaleLowerCase(),
    member.subteam.trim(),
  ])).values()].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
  const requestSubteams = [...new Map(requests.filter((record) => record.subteam.trim()).map((record) => [
    record.subteam.trim().toLocaleLowerCase(),
    record.subteam.trim(),
  ])).values()].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
  const leadSubteams = [...new Map(leads.filter((record) => record.subteam.trim()).map((record) => [
    record.subteam.trim().toLocaleLowerCase(),
    record.subteam.trim(),
  ])).values()].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
  const requestStatuses: PartRequest['status'][] = ['Needed', 'Outreach', 'In transit', 'Received', 'Closed']
  const leadStatuses: SponsorLead['status'][] = ['New', 'Following up', 'Contacted', 'Converted', 'Not pursuing']
  const sponsorStatuses: Sponsor['status'][] = ['Prospect', 'Proposal sent', 'Committed', 'Received']
  const visibleRequests = requests
    .filter((record) => {
      if (requestFilter.startsWith('subteam:')) return record.subteam.trim().toLocaleLowerCase() === requestFilter.slice('subteam:'.length)
      if (requestFilter.startsWith('status:')) return record.status === requestFilter.slice('status:'.length)
      return true
    })
    .sort((first, second) => first.item.localeCompare(second.item, undefined, { sensitivity: 'base' }))
  const visibleSponsors = sponsors
    .filter((record) => sponsorFilter === 'all' || record.status === sponsorFilter)
    .sort((first, second) => first.company.localeCompare(second.company, undefined, { sensitivity: 'base' }))
  const visibleLeads = leads
    .filter((record) => {
      if (leadFilter.startsWith('subteam:')) return record.subteam.trim().toLocaleLowerCase() === leadFilter.slice('subteam:'.length)
      if (leadFilter.startsWith('status:')) return record.status === leadFilter.slice('status:'.length)
      return true
    })
    .sort((first, second) => first.company.localeCompare(second.company, undefined, { sensitivity: 'base' }))
  const accessTags: TeamUser['tag'][] = ['member', 'stl', 'dev']
  const visibleUsers = users
    .filter((member) => {
      if (userFilter.startsWith('subteam:')) {
        return member.subteam.trim().toLocaleLowerCase() === userFilter.slice('subteam:'.length)
      }
      if (userFilter.startsWith('tag:')) return member.tag === userFilter.slice('tag:'.length)
      return true
    })
    .sort((first, second) => first.displayName.localeCompare(second.displayName, undefined, { sensitivity: 'base' }))
  const sections = [
    { id: 'users' as const, label: 'Users', count: users.length },
    { id: 'requests' as const, label: 'Part requests', count: requests.length },
    { id: 'sponsors' as const, label: 'Sponsorships', count: sponsors.length },
    { id: 'leads' as const, label: 'Sponsor leads', count: leads.length },
  ]
  const applyBulkRequestUpdate = async () => {
    const changes = {
      ...(bulkRequestAssignee !== '__unchanged' ? { assigneeId: bulkRequestAssignee } : {}),
      ...(bulkRequestStatus !== '__unchanged' ? { status: bulkRequestStatus as RequestStatus } : {}),
    }
    if (!selectedRequestIds.length || !Object.keys(changes).length) return
    setBulkSaving(true)
    setBulkError('')
    try {
      await onBulkRequestUpdate(selectedRequestIds, changes)
      setSelectedRequestIds([])
      setBulkRequestAssignee('__unchanged')
      setBulkRequestStatus('__unchanged')
    } catch (caught) {
      setBulkError(caught instanceof Error ? caught.message : 'Could not update selected requests.')
    } finally {
      setBulkSaving(false)
    }
  }
  const applyBulkLeadUpdate = async () => {
    const changes = {
      ...(bulkLeadAssignee !== '__unchanged' ? { assigneeId: bulkLeadAssignee } : {}),
      ...(bulkLeadStatus !== '__unchanged' ? { status: bulkLeadStatus as SponsorLeadStatus } : {}),
    }
    if (!selectedLeadIds.length || !Object.keys(changes).length) return
    setBulkSaving(true)
    setBulkError('')
    try {
      await onBulkLeadUpdate(selectedLeadIds, changes)
      setSelectedLeadIds([])
      setBulkLeadAssignee('__unchanged')
      setBulkLeadStatus('__unchanged')
    } catch (caught) {
      setBulkError(caught instanceof Error ? caught.message : 'Could not update selected sponsor leads.')
    } finally {
      setBulkSaving(false)
    }
  }

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
    {section === 'users' && <>
      <div className="management-sort-row">
        <label className="select-control"><span>Show users</span><select aria-label="Filter users" value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
          <option value="all">All users · alphabetical</option>
          <optgroup label="Subteam">
            {subteams.map((subteam) => <option key={subteam} value={`subteam:${subteam.toLocaleLowerCase()}`}>{subteam}</option>)}
          </optgroup>
          <optgroup label="Access tag">
            {accessTags.map((tag) => <option key={tag} value={`tag:${tag}`}>{accessTagLabel(tag)}</option>)}
          </optgroup>
        </select><ChevronDown size={15} /></label>
      </div>
      <section className="workload-summary" aria-label="Open work by member">
        <div className="workload-heading"><span className="section-kicker">OPEN WORK BY MEMBER</span><strong>Current workload</strong></div>
        {members.filter((member) => member.active).map((member) => {
          const requestCount = requests.filter((record) => record.assigneeId === member.id && !['Received', 'Closed'].includes(record.status)).length
          const leadCount = leads.filter((record) => record.assigneeId === member.id && !['Converted', 'Not pursuing'].includes(record.status)).length
          return <div className="workload-member" key={member.id}><strong>{member.displayName}</strong><span>{requestCount} requests · {leadCount} leads</span></div>
        })}
        {!members.length && <p>No active team members found.</p>}
      </section>
      <div className="table-scroll"><table>
      <thead><tr><th>NAME</th><th>EMAIL</th><th>SUBTEAM</th><th>ACCESS TAG</th><th>ACCOUNT</th><th>ACTIONS</th></tr></thead>
      <tbody>{visibleUsers.map((member) => <tr key={member.id}>
        <td>{member.displayName}</td><td>{member.email}</td><td>{member.subteam || 'Not set'}</td>
        <td>{accessTagLabel(member.tag)}</td><td><span className={`account-state ${member.active ? 'active' : 'inactive'}`}>{member.active ? 'Active' : 'Deactivated'}</span></td>
        <td><div className="management-user-actions">
          <button className="button secondary management-edit-button" type="button" onClick={() => onEditUser(member)}><Pencil size={14} /> Edit</button>
          {member.id !== currentUserId && <button className={`button ${member.active ? 'danger-button' : 'secondary'} management-edit-button`} type="button" onClick={() => onToggleUserActive(member)}>{member.active ? 'Deactivate' : 'Reactivate'}</button>}
        </div></td>
      </tr>)}</tbody>
      </table></div>
      {visibleUsers.length === 0 && <div className="empty-state">No users match this subteam or access tag.</div>}
    </>}
    {section === 'requests' && <>
      <div className="management-sort-row">
        <label className="select-control"><span>Show requests</span><select aria-label="Filter managed part requests" value={requestFilter} onChange={(event) => setRequestFilter(event.target.value)}>
          <option value="all">All subteams · alphabetical</option>
          <optgroup label="Subteam">
            {requestSubteams.map((subteam) => <option key={subteam} value={`subteam:${subteam.toLocaleLowerCase()}`}>{subteam}</option>)}
          </optgroup>
          <optgroup label="Status">
            {requestStatuses.map((status) => <option key={status} value={`status:${status}`}>{status}</option>)}
          </optgroup>
        </select><ChevronDown size={15} /></label>
      </div>
      <div className="bulk-toolbar">
        <strong>{selectedRequestIds.length} selected</strong>
        <label className="select-control"><span className="sr-only">Assign selected requests</span><select aria-label="Assign selected requests" value={bulkRequestAssignee} onChange={(event) => setBulkRequestAssignee(event.target.value)}>
          <option value="__unchanged">Assignment: no change</option><option value="">Unassigned</option>
          {members.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.subteam}</option>)}
        </select><ChevronDown size={15} /></label>
        <label className="select-control"><span className="sr-only">Set selected request status</span><select aria-label="Set selected request status" value={bulkRequestStatus} onChange={(event) => setBulkRequestStatus(event.target.value)}>
          <option value="__unchanged">Status: no change</option>{requestStatuses.map((status) => <option key={status}>{status}</option>)}
        </select><ChevronDown size={15} /></label>
        <button type="button" className="button secondary management-edit-button" disabled={bulkSaving || !selectedRequestIds.length || (bulkRequestAssignee === '__unchanged' && bulkRequestStatus === '__unchanged')} onClick={() => void applyBulkRequestUpdate()}>{bulkSaving ? 'Updating...' : 'Apply to selected'}</button>
      </div>
      {bulkError && <div className="action-error" role="alert">{bulkError}</div>}
      <div className="table-scroll"><table>
      <thead><tr><th><input type="checkbox" aria-label="Select all visible requests" checked={visibleRequests.length > 0 && visibleRequests.every((record) => selectedRequestIds.includes(record.id))} onChange={(event) => setSelectedRequestIds(event.target.checked ? [...new Set([...selectedRequestIds, ...visibleRequests.map((record) => record.id)])] : selectedRequestIds.filter((id) => !visibleRequests.some((record) => record.id === id)))} /></th><th>ITEM</th><th>COMPANY</th><th>SUBTEAM</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{visibleRequests.map((record) => <tr key={record.id}>
        <td><input type="checkbox" aria-label={`Select request ${record.item}`} checked={selectedRequestIds.includes(record.id)} onChange={(event) => setSelectedRequestIds(event.target.checked ? [...new Set([...selectedRequestIds, record.id])] : selectedRequestIds.filter((id) => id !== record.id))} /></td><td>{record.item}</td><td>{record.company || '—'}</td><td>{record.subteam}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditRequest(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
      </table></div>
      {visibleRequests.length === 0 && requests.length > 0 && <div className="empty-state">No part requests match this subteam.</div>}
    </>}
    {section === 'sponsors' && <>
      <div className="management-sort-row">
        <label className="select-control"><span>Show sponsorships</span><select aria-label="Filter managed sponsorships" value={sponsorFilter} onChange={(event) => setSponsorFilter(event.target.value)}>
          <option value="all">All statuses · alphabetical</option>
          {sponsorStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select><ChevronDown size={15} /></label>
      </div>
      <div className="table-scroll"><table>
      <thead><tr><th>COMPANY</th><th>CONTACT</th><th>AMOUNT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{visibleSponsors.map((record) => <tr key={record.id}>
        <td>{record.company}</td><td>{record.contact || '—'}</td><td>{money(record.amount)}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditSponsor(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
      </table></div>
      {visibleSponsors.length === 0 && sponsors.length > 0 && <div className="empty-state">No sponsorships match this status.</div>}
    </>}
    {section === 'leads' && <>
      <div className="management-sort-row">
        <label className="select-control"><span>Show leads</span><select aria-label="Filter managed sponsor leads" value={leadFilter} onChange={(event) => setLeadFilter(event.target.value)}>
          <option value="all">All subteams · alphabetical</option>
          <optgroup label="Subteam">
            {leadSubteams.map((subteam) => <option key={subteam} value={`subteam:${subteam.toLocaleLowerCase()}`}>{subteam}</option>)}
          </optgroup>
          <optgroup label="Status">
            {leadStatuses.map((status) => <option key={status} value={`status:${status}`}>{status}</option>)}
          </optgroup>
        </select><ChevronDown size={15} /></label>
      </div>
      <div className="bulk-toolbar">
        <strong>{selectedLeadIds.length} selected</strong>
        <label className="select-control"><span className="sr-only">Assign selected sponsor leads</span><select aria-label="Assign selected sponsor leads" value={bulkLeadAssignee} onChange={(event) => setBulkLeadAssignee(event.target.value)}>
          <option value="__unchanged">Assignment: no change</option><option value="">Unassigned</option>
          {members.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.subteam}</option>)}
        </select><ChevronDown size={15} /></label>
        <label className="select-control"><span className="sr-only">Set selected sponsor lead status</span><select aria-label="Set selected sponsor lead status" value={bulkLeadStatus} onChange={(event) => setBulkLeadStatus(event.target.value)}>
          <option value="__unchanged">Status: no change</option>{leadStatuses.map((status) => <option key={status}>{status}</option>)}
        </select><ChevronDown size={15} /></label>
        <button type="button" className="button secondary management-edit-button" disabled={bulkSaving || !selectedLeadIds.length || (bulkLeadAssignee === '__unchanged' && bulkLeadStatus === '__unchanged')} onClick={() => void applyBulkLeadUpdate()}>{bulkSaving ? 'Updating...' : 'Apply to selected'}</button>
      </div>
      {bulkError && <div className="action-error" role="alert">{bulkError}</div>}
      <div className="table-scroll"><table>
      <thead><tr><th><input type="checkbox" aria-label="Select all visible sponsor leads" checked={visibleLeads.length > 0 && visibleLeads.every((record) => selectedLeadIds.includes(record.id))} onChange={(event) => setSelectedLeadIds(event.target.checked ? [...new Set([...selectedLeadIds, ...visibleLeads.map((record) => record.id)])] : selectedLeadIds.filter((id) => !visibleLeads.some((record) => record.id === id)))} /></th><th>COMPANY</th><th>CONTACT</th><th>SUBTEAM</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{visibleLeads.map((record) => <tr key={record.id}>
        <td><input type="checkbox" aria-label={`Select sponsor lead ${record.company}`} checked={selectedLeadIds.includes(record.id)} onChange={(event) => setSelectedLeadIds(event.target.checked ? [...new Set([...selectedLeadIds, record.id])] : selectedLeadIds.filter((id) => id !== record.id))} /></td><td>{record.company}</td><td>{record.contactName || '—'}</td><td>{record.subteam || '—'}</td><td>{record.status}</td>
        <td><button className="button secondary management-edit-button" type="button" onClick={() => onEditLead(record)}><Pencil size={14} /> Edit</button></td>
      </tr>)}</tbody>
      </table></div>
      {visibleLeads.length === 0 && leads.length > 0 && <div className="empty-state">No sponsor leads match this subteam.</div>}
    </>}
    {((section === 'users' && users.length === 0)
      || (section === 'requests' && requests.length === 0)
      || (section === 'sponsors' && sponsors.length === 0)
      || (section === 'leads' && leads.length === 0)) && <div className="empty-state">No records to manage.</div>}
  </section>
}

function accessTagLabel(tag: TeamUser['tag']) {
  return tag === 'dev' ? 'Dev' : tag === 'stl' ? 'STL' : 'Member'
}

function ManagementUserModal({ user, onClose, onSave, onSendPasswordReset }: {
  user: TeamUser
  onClose: () => void
  onSave: (changes: Pick<TeamUser, 'displayName' | 'email' | 'subteam'> & { tag?: 'member' | 'stl'; active?: boolean }) => Promise<void>
  onSendPasswordReset: () => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [email, setEmail] = useState(user.email)
  const [subteam, setSubteam] = useState(user.subteam)
  const [tag, setTag] = useState<'member' | 'stl'>(user.tag === 'stl' ? 'stl' : 'member')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const subteams = [...subteamOptions, 'Exec']

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ displayName, email, subteam, ...(user.tag === 'dev' ? {} : { tag }) })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this member.')
      setSaving(false)
    }
  }

  const sendPasswordReset = async () => {
    setPasswordError('')
    setPasswordNotice('')
    setResettingPassword(true)
    try {
      await onSendPasswordReset()
      setPasswordNotice(`A one-time reset link was sent to ${user.email}. It expires in 30 minutes.`)
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Could not send a password reset email.')
    } finally {
      setResettingPassword(false)
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
          {user.tag === 'dev'
            ? <div className="field"><span>Access tag</span><strong>Dev (invite-assigned)</strong></div>
            : <label className="field"><span>Access tag</span><select value={tag} onChange={(event) => setTag(event.target.value === 'stl' ? 'stl' : 'member')}><option value="member">Member</option><option value="stl">STL</option></select></label>}
        </div>
        {error && <div className="action-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Save member'}</button></div>
      </form>
      <div>
        <div className="section-heading"><div><span className="section-kicker">ACCOUNT RECOVERY</span><h3>Email a password reset link</h3></div></div>
        <p>Send a one-time link to <strong>{user.email}</strong>. The user sets their own password; the link expires in 30 minutes.</p>
        {passwordError && <div className="action-error" role="alert">{passwordError}</div>}
        {passwordNotice && <div className="action-success" role="status">{passwordNotice}</div>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={resettingPassword} onClick={() => void sendPasswordReset()}>{resettingPassword ? 'Sending email...' : 'Email password reset link'}</button></div>
      </div>
    </section>
  </div>
}

function downloadCsv(requests: PartRequest[], sponsors: Sponsor[], leads: SponsorLead[], members: TeamMember[]) {
  const memberNames = new Map(members.map((member) => [member.id, member.displayName]))
  const rows = [
    ['Type', 'Company / entity', 'Item / contact', 'Contact info', 'Amount', 'Quantity', 'Subteam', 'Priority / status', 'Assigned to', 'Compatibility / relationship', 'Communication', 'Next follow-up', 'Renewal / required specs'],
    ...requests.map((request) => ['Part request', request.company, request.item, request.contact, request.value, request.quantity, request.subteam, `${request.priority} / ${request.status}`, memberNames.get(request.assigneeId || '') || '', request.compatibility, request.communication, request.nextFollowUpAt || '', request.specs]),
    ...sponsors.map((sponsor) => ['Sponsorship', sponsor.company, sponsor.contact, '', sponsor.amount, '', '', sponsor.status, '', sponsor.relationship, '', sponsor.renewal, sponsor.deliverables.map((deliverable) => `${deliverable.description} (${deliverable.status})`).join('; ')]),
    ...leads.map((lead) => ['Sponsor lead', lead.company, lead.contactName, [lead.contactRole, lead.contactEmail, lead.contactPhone].filter(Boolean).join('; '), lead.estimatedAmount || '', '', lead.subteam, lead.status, memberNames.get(lead.assigneeId || '') || '', lead.relationship, `Support: ${(lead.supportTypes || []).join(', ')}; can introduce: ${lead.canIntroduce}`, lead.nextFollowUpAt || '', `${lead.supportDetails || ''} ${lead.details}`.trim()]),
  ]
  const csv = rows.map((row) => row.map((cell) => {
    const safe = String(cell ?? '').replace(/^[=+\-@]/, "'$&")
    return `"${safe.replace(/"/g, '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'Digem-sponsorship-tracker.csv'
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
  const [modal, setModal] = useState<'request' | 'lead' | 'lead-detail' | 'part-detail' | null>(null)
  const [sponsorModal, setSponsorModal] = useState<'sponsor' | 'sponsor-edit' | 'sponsor-detail' | null>(null)
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [managementEdit, setManagementEdit] = useState<ManagementEdit | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [subteamFilter, setSubteamFilter] = useState('')
  const [requestSort, setRequestSort] = useState<'newest' | 'urgency'>('newest')
  const [leadStatusFilter, setLeadStatusFilter] = useState('All lead statuses')
  const workspaceRefreshInProgress = useRef(false)

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

  const refreshWorkspace = useCallback(async (includeManagement = user?.tag === 'dev') => {
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
  }, [user?.tag])

  useEffect(() => {
    if (!user) return
    let active = true
    const refreshVisibleWorkspace = async () => {
      if (!active || document.visibilityState === 'hidden' || workspaceRefreshInProgress.current) return
      workspaceRefreshInProgress.current = true
      try {
        await refreshWorkspace(user.tag === 'dev' && view === 'management')
      } catch (error) {
        if (active) setActionError(error instanceof Error ? error.message : 'Could not refresh shared team records.')
      } finally {
        workspaceRefreshInProgress.current = false
      }
    }
    const interval = window.setInterval(() => void refreshVisibleWorkspace(), 15_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshVisibleWorkspace()
    }
    window.addEventListener('focus', refreshVisibleWorkspace)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisibleWorkspace)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshWorkspace, user, view])

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

  const saveManagementUser = async (id: string, changes: Pick<TeamUser, 'displayName' | 'email' | 'subteam'> & { tag?: 'member' | 'stl'; active?: boolean }) => {
    try {
      const updated = await updateManagementUser(id, changes)
      setManagementUsers((current) => current.map((member) => member.id === updated.id ? updated : member))
      setTeamMembers((current) => updated.active
        ? current.some((member) => member.id === updated.id)
          ? current.map((member) => member.id === updated.id ? { ...member, displayName: updated.displayName, subteam: updated.subteam, active: true } : member)
          : [...current, { id: updated.id, displayName: updated.displayName, subteam: updated.subteam, active: true }]
        : current.map((member) => member.id === updated.id ? { ...member, active: false } : member))
      if (user?.id === updated.id) setUser(updated)
      setManagementEdit(null)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this member.')
      throw error
    }
  }

  const sendManagementPasswordReset = async (id: string) => {
    await emailManagementUserPasswordReset(id)
  }

  const bulkUpdateRequests = async (ids: string[], changes: { assigneeId?: string; status?: RequestStatus }) => {
    const results = await Promise.allSettled(ids.map(async (id) => updatePartRequest(id, changes)))
    const updated = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    setRequests((current) => current.map((record) => updated.find((next) => next.id === record.id) || record))
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed) {
      await refreshWorkspace()
      throw new Error(`Updated ${updated.length} requests; ${failed} could not be updated.`)
    }
    setActionError('')
  }

  const bulkUpdateLeads = async (ids: string[], changes: { assigneeId?: string; status?: SponsorLeadStatus }) => {
    const results = await Promise.allSettled(ids.map(async (id) => updateSponsorLead(id, changes)))
    const updated = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    setSponsorLeads((current) => current.map((record) => updated.find((next) => next.id === record.id) || record))
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed) {
      await refreshWorkspace()
      throw new Error(`Updated ${updated.length} sponsor leads; ${failed} could not be updated.`)
    }
    setActionError('')
  }

  const finishPasswordReset = async (token: string, password: string) => {
    await resetPassword(token, password)
  }

  const toggleManagementUserActive = async (member: TeamUser) => {
    const active = !member.active
    if (!window.confirm(`${active ? 'Reactivate' : 'Deactivate'} ${member.displayName}'s account? ${active ? 'They will be able to sign in again.' : 'They will be signed out, but their past activity and assignments will remain.'}`)) return
    try {
      await saveManagementUser(member.id, { displayName: member.displayName, email: member.email, subteam: member.subteam, active })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${active ? 'reactivate' : 'deactivate'} this member.`)
    }
  }

  const editManagementRequest = async (id: string, changes: PartRequestInput) => {
    try {
      const updated = await updatePartRequest(id, changes)
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
      const updated = await updateSponsorLead(id, changes)
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
  const requestSubteams = [...new Set([...subteamOptions, ...requests.map((request) => request.subteam.trim()).filter(Boolean)])]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  const filteredRequests = requests.filter((request) => {
    const matchesQuery = `${request.item} ${request.company} ${request.subteam} ${request.requestedBy}`.toLowerCase().includes(query.toLowerCase())
    const matchesSubteam = !subteamFilter || request.subteam.trim().toLowerCase() === subteamFilter.toLowerCase()
    return matchesQuery && matchesSubteam && (statusFilter === 'All statuses' || request.status === statusFilter)
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
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null
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

  const updateRequest = async (id: string, field: 'status' | 'communication' | 'nextFollowUpAt', value: string) => {
    const changes = field === 'status'
      ? { status: value as RequestStatus }
      : field === 'communication'
        ? { communication: value as CommunicationStatus }
        : { nextFollowUpAt: value }
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

  const updateRequestFollowUp = async (id: string, nextFollowUpAt: string) => {
    try {
      const updated = await updatePartRequest(id, { nextFollowUpAt })
      setRequests((current) => current.map((request) => request.id === id ? updated : request))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the request follow-up date.')
    }
  }

  const updateSponsorLeadFollowUp = async (id: string, nextFollowUpAt: string) => {
    try {
      const updated = await updateSponsorLead(id, { nextFollowUpAt })
      setSponsorLeads((current) => current.map((lead) => lead.id === id ? updated : lead))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the sponsor lead follow-up date.')
    }
  }

  const updateSponsorFollowUp = async (id: string, renewal: string) => {
    try {
      const updated = await updateSponsorship(id, { renewal })
      setSponsors((current) => current.map((sponsor) => sponsor.id === id ? updated : sponsor))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the sponsorship follow-up date.')
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

  const addRecordNoteTo = async (kind: 'part_request' | 'sponsor_lead' | 'sponsorship', id: string, body: string) => {
    try {
      if (kind === 'sponsorship') {
        const updated = await addSponsorNote(id, body)
        setSponsors((current) => current.map((record) => record.id === id ? updated : record))
      } else if (kind === 'part_request') {
        const updated = await addRecordNote(kind, id, body)
        setRequests((current) => current.map((record) => record.id === id ? updated : record))
      } else {
        const updated = await addRecordNote(kind, id, body)
        setSponsorLeads((current) => current.map((record) => record.id === id ? updated : record))
      }
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save this note.')
      throw error
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
  const pageTitle = view === 'overview' ? user?.tag === 'member' ? 'My tasks' : 'Internal Requests' : view === 'parts' ? 'Part requests' : view === 'sponsors' ? 'Sponsorships' : view === 'sponsor-leads' ? 'Sponsor leads' : view === 'management' ? 'Management' : 'Account'
  const pageDescription = view === 'overview' ? user?.tag === 'member' ? 'See your assignments, claim eligible work, and keep task progress up to date.' : 'A clear view of what the team needs and who is helping.' : view === 'parts' ? 'Requests submitted by subteams, from first ask to received.' : view === 'sponsors' ? 'Track proposals, commitments, deliverables, and renewals.' : view === 'sponsor-leads' ? 'Potential sponsor connections submitted for the business team to follow up.' : view === 'management' ? 'Manage team members and shared workspace data.' : 'Update your profile or permanently delete your account.'
  if (!authReady) return <main className="auth-shell"><div className="auth-panel auth-loading"><img className="auth-logo" src="https://Digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" /><p>Connecting to the team workspace...</p></div></main>
  if (!user) return <AuthScreen onAuthenticate={authenticate} onResetPassword={finishPasswordReset} onRequestPasswordReset={requestPasswordReset} initialError={authError} />
  const pendingSubteamRequestCount = subteamRequests.filter((request) => request.status === 'pending' && request.userId !== user.id).length
  const showSubteamRequestCount = user.tag !== 'dev' && user.subteam.trim().toLowerCase() === 'exec'
  const canEditSharedRecords = user.tag === 'dev' || user.tag === 'stl'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setView('overview')} aria-label="Dig 'Em Aggies Internal Requests">
          <img className="brand-logo" src="https://Digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" />
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setView('overview')}><ClipboardList size={18} /> {user.tag === 'member' ? 'My tasks' : 'Overview'}</button>
          <button className={view === 'parts' ? 'nav-item active' : 'nav-item'} onClick={() => setView('parts')}><Box size={18} /> Part requests <span className="nav-count">{openRequests.length}</span></button>
          <button className={view === 'sponsor-leads' ? 'nav-item active' : 'nav-item'} onClick={() => setView('sponsor-leads')}><ContactRound size={18} /> Sponsor leads <span className="nav-count">{openSponsorLeadCount}</span></button>
          <button className={view === 'sponsors' ? 'nav-item active' : 'nav-item'} onClick={() => setView('sponsors')}><Handshake size={18} /> Sponsorships</button>
          <button className={view === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setView('account')}><Settings size={18} /> Account{showSubteamRequestCount && pendingSubteamRequestCount > 0 && <span className="nav-count" aria-label={`${pendingSubteamRequestCount} pending subteam change request${pendingSubteamRequestCount === 1 ? '' : 's'}`}>{pendingSubteamRequestCount}</span>}</button>
          {user.tag === 'dev' && <button className={view === 'management' ? 'nav-item active' : 'nav-item'} onClick={() => setView('management')}><Shield size={18} /> Management</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-status"><span className="status-dot" /> Team workspace</div>
          <div className="workspace-user">{user.displayName} · {user.subteam || 'Subteam not set'} · {accessTagLabel(user.tag)}</div>
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
            members={teamMembers}
            currentUserId={user.id}
            requests={requests}
            sponsors={sponsors}
            leads={sponsorLeads}
            onEditUser={(member) => setManagementEdit({ kind: 'user', user: member })}
            onToggleUserActive={(member) => void toggleManagementUserActive(member)}
            onEditRequest={(record) => setManagementEdit({ kind: 'request', record })}
            onEditSponsor={(record) => setManagementEdit({ kind: 'sponsor', record })}
            onEditLead={(record) => setManagementEdit({ kind: 'lead', record })}
            onBulkRequestUpdate={bulkUpdateRequests}
            onBulkLeadUpdate={bulkUpdateLeads}
          />}

          {view === 'overview' && (user.tag === 'member' ? <MemberTaskOverview
            user={user}
            requests={requests}
            leads={sponsorLeads}
            onClaim={(kind, id) => {
              if (kind === 'part_request') void updateRequestAssignee(id, user.id)
              else void updateSponsorLeadAssignee(id, user.id)
            }}
            onRequestUpdate={(id, field, value) => void updateRequest(id, field, value)}
            onLeadStatusChange={(id, status) => void updateSponsorLeadStatus(id, status)}
            onLeadFollowUpChange={(id, date) => void updateSponsorLeadFollowUp(id, date)}
          /> : <>
            <section className="metrics" aria-label="Workspace summary">
              <article className="metric"><div className="metric-top"><span>OPEN PART REQUESTS</span><Box size={17} /></div><strong>{openRequests.length}</strong><small>{requests.filter((request) => request.priority === 'Urgent' && !['Received', 'Closed'].includes(request.status)).length} urgent needs</small></article>
              <article className="metric"><div className="metric-top"><span>IN SELLER OUTREACH</span><ArrowUpRight size={17} /></div><strong>{requests.filter((request) => request.communication !== 'Not started' && request.communication !== 'Confirmed').length}</strong><small>Requests with active contact</small></article>
              <article className="metric"><div className="metric-top"><span>COMMITTED SUPPORT</span><BadgeDollarSign size={17} /></div><strong>{money(activeValue)}</strong><small>Committed or received</small></article>
              <article className="metric accent-metric"><div className="metric-top"><span>SPONSOR LEADS TO FOLLOW</span><ContactRound size={17} /></div><strong>{openSponsorLeadCount}</strong><small>{sponsorLeads.filter((lead) => lead.status === 'New').length} new for the business team</small></article>
            </section>
            {(user.tag === 'dev' || user.subteam.trim().toLowerCase() === 'exec') && <NeedsAttentionQueue
              items={recordAttention(requests, sponsors, sponsorLeads, teamMembers)}
              user={user}
              members={teamMembers}
              onOpen={(item) => {
                if (item.kind === 'part_request') {
                  setSelectedRequestId(item.id)
                  setModal('part-detail')
                } else if (item.kind === 'sponsorship') {
                  setSelectedSponsorId(item.id)
                  setSponsorModal('sponsor-detail')
                } else {
                  setSelectedLeadId(item.id)
                  setModal('lead-detail')
                }
              }}
              onFollowUpChange={(item, date) => {
                if (item.kind === 'part_request') void updateRequestFollowUp(item.id, date)
                else if (item.kind === 'sponsorship') void updateSponsorFollowUp(item.id, date)
                else void updateSponsorLeadFollowUp(item.id, date)
              }}
              onRequestStatusChange={(id, status) => void updateRequest(id, 'status', status)}
              onLeadStatusChange={(id, status) => void updateSponsorLeadStatus(id, status)}
              onAssigneeChange={(item, assigneeId) => {
                if (item.kind === 'part_request') void updateRequestAssignee(item.id, assigneeId)
                else if (item.kind === 'sponsor_lead') void updateSponsorLeadAssignee(item.id, assigneeId)
              }}
            />}

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
          </>)}

          {view === 'parts' && <section className="section-block data-section">
            <div className="table-toolbar">
              <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item, company, subteam..." aria-label="Search part requests" /></div>
              <div className="table-toolbar-controls">
                <label className="select-control"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select><ChevronDown size={15} /></label>
                <label className="select-control"><span className="sr-only">Filter by subteam</span><select value={subteamFilter} onChange={(event) => setSubteamFilter(event.target.value)}><option value="">All subteams</option>{requestSubteams.map((subteam) => <option key={subteam} value={subteam}>{subteam}</option>)}</select><ChevronDown size={15} /></label>
                <label className="select-control"><span className="sr-only">Sort part requests</span><select value={requestSort} onChange={(event) => setRequestSort(event.target.value as 'newest' | 'urgency')}><option value="newest">Sort: newest</option><option value="urgency">Sort: urgency</option></select><ChevronDown size={15} /></label>
              </div>
            </div>
            <div className="table-scroll"><table className="part-request-table"><thead><tr><th>PART / COMPANY</th><th>SUBTEAM</th><th>PRIORITY</th><th>ASSIGNED TO</th><th>COMPATIBILITY</th><th>COMMUNICATION</th><th>PART STATUS</th><th>VALUE</th><th className="row-actions">ACTIONS</th></tr></thead><tbody>
              {filteredRequests.map((request) => <tr key={request.id}>
                <td><button type="button" className="sponsor-detail-trigger" onClick={() => { setSelectedRequestId(request.id); setModal('part-detail') }} aria-label={`View details for ${request.item}`}><span className="table-title">{request.item} <Eye size={12} /></span><span className="table-subtitle">{request.company} · {request.quantity} requested</span></button></td>
                <td>{request.subteam}</td><td><span className={`priority-label ${request.priority.toLowerCase()}`}><span />{request.priority}</span></td>
                <td><AssignmentSelect assignedId={request.assigneeId} user={user} members={teamMembers} requesterSubteam={request.requesterSubteam || request.subteam} label={`Assignment for request ${request.item}`} onChange={(assigneeId) => void updateRequestAssignee(request.id, assigneeId)} /></td>
                <td className="compat-cell" title={request.compatibility}>{request.compatibility || 'Not provided'}</td>
                <td><select className="inline-select" aria-label={`Communication status for ${request.item}`} value={request.communication} disabled={!canEditSharedRecords} onChange={(event) => updateRequest(request.id, 'communication', event.target.value)}><option>Not started</option><option>Contacted</option><option>Follow-up</option><option>Confirmed</option></select></td>
                <td><select className="inline-select" aria-label={`Part status for ${request.item}`} value={request.status} disabled={!canEditSharedRecords} onChange={(event) => updateRequest(request.id, 'status', event.target.value)}><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select></td>
                <td className="amount-cell">{money(request.value)}</td><td className="row-actions">{canEditSharedRecords && <><button type="button" className="icon-button row-action-button" title={`Edit ${request.item}`} aria-label={`Edit part request for ${request.item}`} onClick={() => setManagementEdit({ kind: 'request', record: request })}><Pencil size={15} /></button><button type="button" className="icon-button row-action-button" title={`Delete ${request.item}`} aria-label={`Delete part request for ${request.item}`} onClick={() => void deleteRequest(request)}><Trash2 size={15} /></button></>}</td>
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
                <td><select className="inline-select" aria-label={`Sponsorship status for ${sponsor.company}`} value={sponsor.status} disabled={!canEditSharedRecords} onChange={(event) => updateSponsorStatus(sponsor.id, event.target.value as SponsorStatus)}><option>Prospect</option><option>Proposal sent</option><option>Committed</option><option>Received</option></select></td>
                <td><button type="button" className="sponsor-deliverables-trigger" onClick={() => { setSelectedSponsorId(sponsor.id); setSponsorModal('sponsor-detail') }}>{sponsor.deliverables.length ? `${sponsor.deliverables.length} agreed` : 'View details'}</button></td><td>{sponsor.relationship}</td><td>{sponsor.renewal || 'Not set'}</td>
                <td>{canEditSharedRecords && <button type="button" className="button secondary sponsor-row-edit" onClick={() => { setSelectedSponsorId(sponsor.id); setSponsorModal('sponsor-edit') }} aria-label={`Edit sponsorship details for ${sponsor.company}`}><Pencil size={14} /> Edit</button>}</td>
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
                  <select className="inline-select lead-status-select" aria-label={`Follow-up status for ${lead.company}`} value={lead.status} disabled={!canEditSharedRecords} onChange={(event) => void updateSponsorLeadStatus(lead.id, event.target.value as SponsorLeadStatus)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select>
                  {canEditSharedRecords && <><button type="button" className="icon-button row-action-button" title={`Edit ${lead.company}`} aria-label={`Edit sponsor lead for ${lead.company}`} onClick={() => setManagementEdit({ kind: 'lead', record: lead })}><Pencil size={15} /></button>
                  <button type="button" className="icon-button row-action-button" title={`Delete ${lead.company}`} aria-label={`Delete sponsor lead for ${lead.company}`} onClick={() => void deleteSponsorLead(lead)}><Trash2 size={15} /></button></>}
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
      {sponsorModal === 'sponsor-detail' && selectedSponsor && <SponsorDetailsModal sponsor={selectedSponsor} canEdit={canEditSharedRecords} onClose={() => setSponsorModal(null)} onEdit={() => setSponsorModal('sponsor-edit')} onDelete={() => void deleteSponsor(selectedSponsor)} onDeliverableStatusChange={updateDeliverableStatus} onAddNote={(body) => addRecordNoteTo('sponsorship', selectedSponsor.id, body)} />}
      {modal === 'lead' && <SponsorLeadModal onClose={() => setModal(null)} onSave={addSponsorLead} />}
      {modal === 'lead-detail' && selectedSponsorLead && <SponsorLeadDetailsModal lead={selectedSponsorLead} canEdit={canEditSharedRecords} onClose={() => setModal(null)} onStatusChange={updateSponsorLeadStatus} onAddNote={(body) => addRecordNoteTo('sponsor_lead', selectedSponsorLead.id, body)} />}
      {modal === 'part-detail' && selectedRequest && <PartRequestDetailsModal request={selectedRequest} assignee={teamMembers.find((member) => member.id === selectedRequest.assigneeId)} canEdit={canEditSharedRecords} onClose={() => setModal(null)} onAddNote={(body) => addRecordNoteTo('part_request', selectedRequest.id, body)} />}
      {managementEdit?.kind === 'user' && <ManagementUserModal
        key={managementEdit.user.id}
        user={managementEdit.user}
        onClose={() => setManagementEdit(null)}
        onSave={(changes) => saveManagementUser(managementEdit.user.id, changes)}
        onSendPasswordReset={() => sendManagementPasswordReset(managementEdit.user.id)}
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
    nextFollowUpAt: request?.nextFollowUpAt ?? '',
    recurring: request?.recurring ?? false,
    requestedBy: request?.requestedBy ?? '',
  })
  const change = (field: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }))
  const requestSubteams = subteamOptions.includes(form.subteam) ? subteamOptions : [...subteamOptions, form.subteam].filter(Boolean)

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
    <div className="modal-heading"><div><span className="section-kicker">{request ? 'PART REQUEST' : 'TEAM INTAKE'}</span><h2 id="request-title">{request ? 'Edit part request' : 'Submit a part request'}</h2><p>Share enough context for the team to assess fit and reach out.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
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
        <label className="field"><span>Next follow-up date</span><input type="date" value={form.nextFollowUpAt} onChange={(event) => change('nextFollowUpAt', event.target.value)} /></label>
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

function SponsorDetailsModal({ sponsor, canEdit, onClose, onEdit, onDelete, onDeliverableStatusChange, onAddNote }: { sponsor: Sponsor; canEdit: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void; onDeliverableStatusChange: (sponsor: Sponsor, index: number, status: DeliverableStatus) => Promise<void>; onAddNote: (body: string) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-details-modal" role="dialog" aria-modal="true" aria-labelledby="sponsor-details-title">
    <div className="modal-heading"><div><span className="section-kicker">FULL SPONSORSHIP RECORD</span><h2 id="sponsor-details-title">{sponsor.company}</h2><p>Added by {sponsor.createdBy} · {sponsor.createdAt}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <div className="lead-details-content">
      <section className="lead-details-section"><h3>Agreement</h3><p>{sponsor.status} · {money(sponsor.amount)}</p></section>
      <section className="lead-details-section"><h3>Contact</h3><p>{sponsor.contact || 'No contact provided'}</p></section>
      <section className="lead-details-section"><h3>Agreed deliverables ({sponsor.deliverables.length})</h3>{sponsor.deliverables.length ? <ul className="sponsor-deliverables-list">{sponsor.deliverables.map((deliverable, index) => <li key={`${deliverable.description}-${index}`}><span>{deliverable.description}</span><select className="inline-select deliverable-status-select" aria-label={`Tracking status for ${deliverable.description}`} value={deliverable.status} disabled={!canEdit} onChange={(event) => void onDeliverableStatusChange(sponsor, index, event.target.value as DeliverableStatus)}><option>Not started</option><option>In progress</option><option>Completed</option></select></li>)}</ul> : <p>No deliverables listed.</p>}</section>
      <section className="lead-details-section"><h3>Relationship</h3><p>{sponsor.relationship || 'No relationship details provided.'}</p></section>
      <section className="lead-details-section"><h3>Renewal / follow-up</h3><p>{sponsor.renewal || 'Not set'}</p></section>
      <ActivityPanel activity={sponsor.activity} canEdit={canEdit} onAddNote={onAddNote} />
    </div>
    <div className="modal-actions sponsor-detail-actions">{canEdit && <button type="button" className="button secondary delete-sponsor-button" onClick={onDelete}><Trash2 size={15} /> Delete sponsorship</button>}<button type="button" className="button secondary" onClick={onClose}>Close</button>{canEdit && <button type="button" className="button primary" onClick={onEdit}>Edit sponsorship</button>}</div>
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
    nextFollowUpAt: lead?.nextFollowUpAt ?? '',
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
    <div className="modal-heading"><div><span className="section-kicker">{lead ? 'SPONSOR LEAD' : 'BUSINESS TEAM INTAKE'}</span><h2 id="lead-title">{lead ? 'Edit sponsor lead' : 'Submit a sponsor lead'}</h2><p>Share a company connection for the business team to follow up.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!form.supportTypes.length) { setFormError('Choose at least one type of support.'); return } setFormError(''); void onSave({ ...form, estimatedAmount: Number(form.estimatedAmount) || 0, ...(lead ? { status: form.status } : {}) }) }}>
      <div className="form-grid">
        <label className="field"><span>Company or business <b>*</b></span><input required value={form.company} onChange={(event) => change('company', event.target.value)} placeholder="Organization name" /></label>
        <label className="field"><span>Contact name</span><input value={form.contactName} onChange={(event) => change('contactName', event.target.value)} placeholder="Person you know" /></label>
        <label className="field"><span>Contact role</span><input value={form.contactRole} onChange={(event) => change('contactRole', event.target.value)} placeholder="Title or department" /></label>
        <label className="field"><span>Contact email</span><input type="email" value={form.contactEmail} onChange={(event) => change('contactEmail', event.target.value)} placeholder="name@company.com" /></label>
        <label className="field"><span>Contact phone</span><input type="tel" value={form.contactPhone} onChange={(event) => change('contactPhone', event.target.value)} placeholder="Optional" /></label>
        <label className="field"><span>Your subteam</span><select value={form.subteam} onChange={(event) => change('subteam', event.target.value)}><option value="">Select a subteam</option>{leadSubteams.map((option) => <option key={option}>{option}</option>)}</select></label>
        {lead && <label className="field"><span>Follow-up status</span><select value={form.status} onChange={(event) => change('status', event.target.value)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select></label>}
        <label className="field"><span>Next follow-up date</span><input type="date" value={form.nextFollowUpAt} onChange={(event) => change('nextFollowUpAt', event.target.value)} /></label>
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

function SponsorLeadDetailsModal({ lead, canEdit, onClose, onStatusChange, onAddNote }: { lead: SponsorLead; canEdit: boolean; onClose: () => void; onStatusChange: (id: string, status: SponsorLeadStatus) => Promise<void>; onAddNote: (body: string) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-details-modal" role="dialog" aria-modal="true" aria-labelledby="lead-details-title">
    <div className="modal-heading"><div><span className="section-kicker">SPONSOR LEAD · SUBMITTED BY {lead.createdBy.toUpperCase()}</span><h2 id="lead-details-title">{lead.company}</h2><p>{lead.subteam || 'Team connection'} · Submitted {lead.createdAt}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close lead details"><X size={19} /></button></div>
    <div className="lead-details-content">
      <section className="lead-details-section"><h3>Potential support</h3><div className="lead-detail-categories">{(lead.supportTypes || []).map((supportType) => <span className="lead-category" key={supportType}>{supportType}</span>)}</div><p>{lead.supportDetails || 'No offer details provided.'}</p><div className="lead-detail-cash">Estimated cash: <strong>{lead.estimatedAmount ? money(lead.estimatedAmount) : 'Not specified'}</strong></div></section>
      <section className="lead-details-section"><h3>Contact</h3><p>{lead.contactName || 'No named contact'}{lead.contactRole ? ` · ${lead.contactRole}` : ''}</p><div className="lead-contact-links">{lead.contactEmail && <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a>}{lead.contactPhone && <a href={`tel:${lead.contactPhone}`}>{lead.contactPhone}</a>}</div></section>
      <section className="lead-details-section"><h3>Connection</h3><p>{lead.relationship}</p><div className="lead-detail-cash">Can introduce: <strong>{lead.canIntroduce}</strong></div></section>
      <section className="lead-details-section"><h3>Why they might support the team</h3><p>{lead.details}</p></section>
      <section className="lead-details-section"><h3>Next follow-up</h3><p>{lead.nextFollowUpAt || 'Not scheduled'}</p></section>
      <label className="lead-detail-status"><span>Business team follow-up</span><select className="inline-select" value={lead.status} disabled={!canEdit} onChange={(event) => void onStatusChange(lead.id, event.target.value as SponsorLeadStatus)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select></label>
      <ActivityPanel activity={lead.activity} canEdit={canEdit} onAddNote={onAddNote} />
    </div>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
  </section></div>
}

function PartRequestDetailsModal({ request, assignee, canEdit, onClose, onAddNote }: { request: PartRequest; assignee?: TeamMember; canEdit: boolean; onClose: () => void; onAddNote: (body: string) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-details-modal" role="dialog" aria-modal="true" aria-labelledby="part-details-title">
    <div className="modal-heading"><div><span className="section-kicker">PART REQUEST</span><h2 id="part-details-title">{request.item}</h2><p>Submitted by {request.createdBy} · {request.createdAt}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close part request details"><X size={19} /></button></div>
    <div className="lead-details-content">
      <section className="lead-details-section"><h3>Request</h3><p>{request.company || 'No company specified'} · {request.quantity} requested · {money(request.value)}</p><p>Requested by {request.requestedBy || 'Not specified'} · {request.subteam}{request.requesterSubteam && request.requesterSubteam !== request.subteam ? ` · Submitted from ${request.requesterSubteam}` : ''}</p></section>
      <section className="lead-details-section"><h3>Status and priority</h3><p>{request.status} · {request.priority} priority · Communication: {request.communication} · {request.recurring ? 'Recurring need' : 'One-time need'}</p></section>
      <section className="lead-details-section"><h3>Seller</h3><p>{request.contact || 'No seller contact specified'}</p><p>{request.relationship || 'No relationship details provided.'}</p>{request.link && <div className="lead-contact-links"><a href={request.link} target="_blank" rel="noreferrer">Open product link <ArrowUpRight size={12} /></a></div>}</section>
      <section className="lead-details-section"><h3>Required specifications</h3><p>{request.specs || 'No required specifications provided.'}</p></section>
      <section className="lead-details-section"><h3>Compatibility</h3><p>{request.compatibility || 'No compatibility details provided.'}</p></section>
      <section className="lead-details-section"><h3>Assignment</h3><p>{assignee ? assignee.displayName : 'Unassigned'} · Request ID: {request.id}</p></section>
      <section className="lead-details-section"><h3>Next follow-up</h3><p>{request.nextFollowUpAt || 'Not scheduled'}</p></section>
      <ActivityPanel activity={request.activity} canEdit={canEdit} onAddNote={onAddNote} />
    </div>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
  </section></div>
}

export default App
