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
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { AuthScreen, type AuthValues } from './AuthScreen'
import {
  deleteRequest as deletePartRequest,
  deleteSponsorLead as removeSponsorLead,
  createRequest as createPartRequest,
  createSponsorLead,
  createSponsor as createSponsorship,
  getRequests,
  getSession,
  getSponsorLeads,
  getSponsors,
  signIn,
  signOut,
  signUp,
  subteamOptions,
  updateRequest as updatePartRequest,
  updateSponsorLead,
  updateSponsor as updateSponsorship,
} from './api'
import type {
  CommunicationStatus,
  PartRequest,
  PartRequestInput,
  RequestStatus,
  Sponsor,
  SponsorLead,
  SponsorLeadInput,
  SponsorLeadStatus,
  SponsorInput,
  SponsorStatus,
  TeamUser,
} from './api'
import './App.css'

type View = 'overview' | 'parts' | 'sponsors' | 'sponsor-leads'

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function downloadCsv(requests: PartRequest[], sponsors: Sponsor[], leads: SponsorLead[]) {
  const rows = [
    ['Type', 'Company / entity', 'Item / contact', 'Contact info', 'Amount', 'Quantity', 'Subteam', 'Priority / status', 'Compatibility / relationship', 'Communication', 'Renewal / required specs'],
    ...requests.map((request) => ['Part request', request.company, request.item, request.contact, request.value, request.quantity, request.subteam, `${request.priority} / ${request.status}`, request.compatibility, request.communication, request.specs]),
    ...sponsors.map((sponsor) => ['Sponsorship', sponsor.company, sponsor.contact, '', sponsor.amount, '', '', sponsor.status, sponsor.relationship, '', `${sponsor.renewal} / ${sponsor.deliverables.join('; ')}`]),
    ...leads.map((lead) => ['Sponsor lead', lead.company, lead.contactName, [lead.contactRole, lead.contactEmail, lead.contactPhone].filter(Boolean).join('; '), lead.estimatedAmount || '', '', lead.subteam, lead.status, lead.relationship, `Support: ${(lead.supportTypes || []).join(', ')}; can introduce: ${lead.canIntroduce}`, `${lead.supportDetails || ''} ${lead.details}`.trim()]),
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
  const [user, setUser] = useState<TeamUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [actionError, setActionError] = useState('')
  const [view, setView] = useState<View>('overview')
  const [modal, setModal] = useState<'request' | 'sponsor' | 'lead' | 'lead-detail' | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [leadStatusFilter, setLeadStatusFilter] = useState('All lead statuses')

  useEffect(() => {
    let active = true
    void getSession().then(async (currentUser) => {
      if (!active) return
      setUser(currentUser)
      if (currentUser) {
        const [savedRequests, savedSponsors, savedLeads] = await Promise.all([getRequests(), getSponsors(), getSponsorLeads()])
        if (active) {
          setRequests(savedRequests)
          setSponsors(savedSponsors)
          setSponsorLeads(savedLeads)
        }
      }
    }).catch((error: unknown) => {
      if (active) setAuthError(error instanceof Error ? error.message : 'The team server is unavailable.')
    }).finally(() => {
      if (active) setAuthReady(true)
    })
    return () => { active = false }
  }, [])

  const refreshWorkspace = async () => {
    const [savedRequests, savedSponsors, savedLeads] = await Promise.all([getRequests(), getSponsors(), getSponsorLeads()])
    setRequests(savedRequests)
    setSponsors(savedSponsors)
    setSponsorLeads(savedLeads)
  }

  const authenticate = async (values: AuthValues) => {
    const nextUser = values.mode === 'signin'
      ? await signIn(values.email, values.password)
      : await signUp(values.displayName, values.email, values.password, values.subteam, values.inviteCode)
    setUser(nextUser)
    setAuthError('')
    try {
      await refreshWorkspace()
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
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  const openRequests = requests.filter((request) => !['Received', 'Closed'].includes(request.status))
  const activeValue = sponsors.filter((sponsor) => sponsor.status === 'Committed' || sponsor.status === 'Received').reduce((sum, sponsor) => sum + sponsor.amount, 0)
  const filteredRequests = requests.filter((request) => {
    const matchesQuery = `${request.item} ${request.company} ${request.subteam} ${request.requestedBy}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'All statuses' || request.status === statusFilter)
  })
  const filteredSponsors = sponsors.filter((sponsor) => `${sponsor.company} ${sponsor.contact}`.toLowerCase().includes(query.toLowerCase()))
  const filteredSponsorLeads = sponsorLeads.filter((lead) => {
    const matchesQuery = `${lead.company} ${lead.contactName} ${lead.contactEmail} ${lead.relationship} ${lead.details} ${lead.createdBy}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (leadStatusFilter === 'All lead statuses' || lead.status === leadStatusFilter)
  })
  const selectedSponsorLead = sponsorLeads.find((lead) => lead.id === selectedLeadId) ?? null
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
      setModal(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save this sponsor.')
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

  const updateSponsorStatus = async (id: string, status: SponsorStatus) => {
    try {
      const updated = await updateSponsorship(id, status)
      setSponsors((current) => current.map((sponsor) => sponsor.id === id ? updated : sponsor))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsorship.')
    }
  }


  const updateSponsorLeadStatus = async (id: string, status: SponsorLeadStatus) => {
    try {
      const updated = await updateSponsorLead(id, status)
      setSponsorLeads((current) => current.map((lead) => lead.id === id ? updated : lead))
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this sponsor lead.')
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
  const pageTitle = view === 'overview' ? 'Internal Requests' : view === 'parts' ? 'Part requests' : view === 'sponsors' ? 'Sponsorships' : 'Sponsor leads'
  const pageDescription = view === 'overview' ? 'A clear view of what the team needs and who is helping.' : view === 'parts' ? 'Requests submitted by subteams, from first ask to received.' : view === 'sponsors' ? 'Track proposals, commitments, deliverables, and renewals.' : 'Potential sponsor connections submitted for the business team to follow up.'
  if (!authReady) return <main className="auth-shell"><div className="auth-panel auth-loading"><img className="auth-logo" src="https://digemaggies.org/assets/logo/Dig_Em_Logo.png" alt="Dig 'Em Aggies" /><p>Connecting to the team workspace...</p></div></main>
  if (!user) return <AuthScreen onAuthenticate={authenticate} initialError={authError} />

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
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-status"><span className="status-dot" /> Team workspace</div>
          <div className="workspace-user">{user.displayName} · {user.subteam || 'Subteam not set'}</div>
          <p>Requests and sponsorship records are shared with signed-in team members.</p>
          <button className="sidebar-link" onClick={() => downloadCsv(requests, sponsors, sponsorLeads)}><ArrowDownToLine size={16} /> Export spreadsheet</button>
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
              {view === 'sponsors' && <button className="button secondary" onClick={() => setModal('sponsor')}><Plus size={17} /> Add sponsor</button>}
              {view === 'sponsor-leads' && <button className="button primary" onClick={() => setModal('lead')}><Plus size={18} /> Submit sponsor lead</button>}
              {view === 'overview' && <button className="button secondary" onClick={() => setModal('lead')}><Plus size={17} /> Sponsor lead</button>}
              {view !== 'sponsor-leads' && <button className="button primary" onClick={() => setModal('request')}><Plus size={18} /> New request</button>}
            </div>
          </section>
          {actionError && <div className="action-error" role="alert">{actionError}</div>}

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
                <button className="add-sponsor-link" onClick={() => setModal('sponsor')}><Plus size={16} /> Add sponsorship record</button>
              </section>
            </div>
          </>}

          {view === 'parts' && <section className="section-block data-section">
            <div className="table-toolbar">
              <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item, company, subteam..." aria-label="Search part requests" /></div>
              <label className="select-control"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select><ChevronDown size={15} /></label>
            </div>
            <div className="table-scroll"><table><thead><tr><th>PART / COMPANY</th><th>SUBTEAM</th><th>PRIORITY</th><th>COMPATIBILITY</th><th>COMMUNICATION</th><th>PART STATUS</th><th>VALUE</th><th>ACTIONS</th></tr></thead><tbody>
              {filteredRequests.map((request) => <tr key={request.id}>
                <td><div className="table-title">{request.link ? <a href={request.link} target="_blank" rel="noreferrer">{request.item} <ArrowUpRight size={12} /></a> : request.item}</div><div className="table-subtitle">{request.company} · {request.quantity} requested</div></td>
                <td>{request.subteam}</td><td><span className={`priority-label ${request.priority.toLowerCase()}`}><span />{request.priority}</span></td>
                <td className="compat-cell" title={request.compatibility}>{request.compatibility || 'Not provided'}</td>
                <td><select className="inline-select" aria-label={`Communication status for ${request.item}`} value={request.communication} onChange={(event) => updateRequest(request.id, 'communication', event.target.value)}><option>Not started</option><option>Contacted</option><option>Follow-up</option><option>Confirmed</option></select></td>
                <td><select className="inline-select" aria-label={`Part status for ${request.item}`} value={request.status} onChange={(event) => updateRequest(request.id, 'status', event.target.value)}><option>Needed</option><option>Outreach</option><option>In transit</option><option>Received</option><option>Closed</option></select></td>
                <td className="amount-cell">{money(request.value)}</td><td className="row-actions"><button type="button" className="icon-button row-action-button" title={`Delete ${request.item}`} aria-label={`Delete part request for ${request.item}`} onClick={() => void deleteRequest(request)}><Trash2 size={15} /></button></td>
              </tr>)}
              {filteredRequests.length === 0 && <tr><td colSpan={8} className="empty-table">No requests match this search.</td></tr>}
            </tbody></table></div>
            <div className="table-footer">Showing {filteredRequests.length} of {requests.length} requests <span>Changes are shared with the team</span></div>
          </section>}

          {view === 'sponsors' && <section className="section-block data-section">
            <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or contact..." aria-label="Search sponsors" /></div><button className="button secondary" onClick={() => downloadCsv(requests, sponsors, sponsorLeads)}><ArrowDownToLine size={16} /> Export CSV</button></div>
            <div className="table-scroll"><table><thead><tr><th>COMPANY / ENTITY</th><th>CONTACT</th><th>AMOUNT</th><th>STATUS</th><th>DELIVERABLES</th><th>RELATIONSHIP</th><th>RENEWAL</th></tr></thead><tbody>
              {filteredSponsors.map((sponsor) => <tr key={sponsor.id}>
                <td><div className="table-title">{sponsor.company}</div><div className="table-subtitle">Sponsorship record</div></td><td>{sponsor.contact || 'Not provided'}</td><td className="amount-cell">{money(sponsor.amount)}</td>
                <td><select className="inline-select" aria-label={`Sponsorship status for ${sponsor.company}`} value={sponsor.status} onChange={(event) => updateSponsorStatus(sponsor.id, event.target.value as SponsorStatus)}><option>Prospect</option><option>Proposal sent</option><option>Committed</option><option>Received</option></select></td>
                <td>{sponsor.deliverables.length ? `${sponsor.deliverables.length} agreed` : 'None listed'}</td><td>{sponsor.relationship}</td><td>{sponsor.renewal || 'Not set'}</td>
              </tr>)}
              {filteredSponsors.length === 0 && <tr><td colSpan={7} className="empty-table">No sponsors match this search.</td></tr>}
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
                  <select className="inline-select lead-status-select" aria-label={`Follow-up status for ${lead.company}`} value={lead.status} onChange={(event) => void updateSponsorLeadStatus(lead.id, event.target.value as SponsorLeadStatus)}><option>New</option><option>Following up</option><option>Contacted</option><option>Converted</option><option>Not pursuing</option></select>
                  <button type="button" className="icon-button row-action-button" title={`Delete ${lead.company}`} aria-label={`Delete sponsor lead for ${lead.company}`} onClick={() => void deleteSponsorLead(lead)}><Trash2 size={15} /></button>
                </div>
              </article>)}
              {filteredSponsorLeads.length === 0 && <div className="empty-state lead-empty-state">No sponsor leads yet. Submit a business connection for follow-up.</div>}
            </div>
            <div className="table-footer">Showing {filteredSponsorLeads.length} of {sponsorLeads.length} sponsor leads <span>New leads are shared with all signed-in members</span></div>
          </section>}

          <footer className="page-footer"><span><Check size={14} /> Shared team records</span><button onClick={() => downloadCsv(requests, sponsors, sponsorLeads)}><ArrowDownToLine size={14} /> Download CSV</button></footer>
        </div>
      </main>

      {modal === 'request' && <RequestModal onClose={() => setModal(null)} onSave={addRequest} />}
      {modal === 'sponsor' && <SponsorModal onClose={() => setModal(null)} onSave={addSponsor} />}
      {modal === 'lead' && <SponsorLeadModal onClose={() => setModal(null)} onSave={addSponsorLead} />}
      {modal === 'lead-detail' && selectedSponsorLead && <SponsorLeadDetailsModal lead={selectedSponsorLead} onClose={() => setModal(null)} onStatusChange={updateSponsorLeadStatus} />}
    </div>
  )
}

function RequestModal({ onClose, onSave }: { onClose: () => void; onSave: (request: PartRequestInput) => Promise<void> }) {
  const [form, setForm] = useState({ item: '', company: '', link: '', contact: '', quantity: '1', value: '', specs: '', compatibility: '', priority: 'Normal' as PartRequest['priority'], subteam: '', relationship: '', communication: 'Not started' as CommunicationStatus, status: 'Needed' as RequestStatus, recurring: false, requestedBy: '' })
  const change = (field: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }))

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
    <div className="modal-heading"><div><span className="section-kicker">TEAM INTAKE</span><h2 id="request-title">Submit a part request</h2><p>Share enough context for the team to assess fit and reach out.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, quantity: Math.max(1, Number(form.quantity) || 1), value: Number(form.value) || 0 }) }}>
      <div className="form-grid">
        <label className="field"><span>Part or product <b>*</b></span><input required value={form.item} onChange={(event) => change('item', event.target.value)} placeholder="What does your team need?" /></label>
        <label className="field"><span>Company / entity</span><input value={form.company} onChange={(event) => change('company', event.target.value)} placeholder="Potential supplier or donor" /></label>
        <label className="field"><span>Subteam <b>*</b></span><select required value={form.subteam} onChange={(event) => change('subteam', event.target.value)}><option value="">Select a subteam</option>{subteamOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
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
      </div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> Submit request</button></div>
    </form>
  </section></div>
}

function SponsorModal({ onClose, onSave }: { onClose: () => void; onSave: (sponsor: SponsorInput) => Promise<void> }) {
  const [form, setForm] = useState({ company: '', contact: '', amount: '', status: 'Prospect' as SponsorStatus, relationship: '', renewal: '', deliverables: Array.from({ length: 8 }, () => '') })
  const changeDeliverable = (index: number, value: string) => setForm((current) => ({ ...current, deliverables: current.deliverables.map((item, itemIndex) => itemIndex === index ? value : item) }))

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal sponsor-modal" role="dialog" aria-modal="true" aria-labelledby="sponsor-title">
    <div className="modal-heading"><div><span className="section-kicker">FUNDING PIPELINE</span><h2 id="sponsor-title">Add sponsorship</h2><p>Record the relationship, agreement, and what the team owes the donor.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ company: form.company, contact: form.contact, amount: Number(form.amount) || 0, status: form.status, relationship: form.relationship, renewal: form.renewal, deliverables: form.deliverables.filter((item) => item.trim()) }) }}>
      <div className="form-grid">
        <label className="field"><span>Company / entity <b>*</b></span><input required value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Organization name" /></label>
        <label className="field"><span>Contact info</span><input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="Name, email, or phone" /></label>
        <label className="field"><span>Amount (USD)</span><input type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /></label>
        <label className="field"><span>Agreement status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SponsorStatus })}><option>Prospect</option><option>Proposal sent</option><option>Committed</option><option>Received</option></select></label>
        <label className="field"><span>Relationship to donor</span><input value={form.relationship} onChange={(event) => setForm({ ...form, relationship: event.target.value })} placeholder="Who knows them, and how?" /></label>
        <label className="field"><span>Renewal / follow-up date</span><input type="date" value={form.renewal} onChange={(event) => setForm({ ...form, renewal: event.target.value })} /></label>
      </div>
      <div className="deliverables-heading"><div><strong>Agreed deliverables</strong><span>List up to 8 commitments to the sponsor.</span></div><span>OPTIONAL</span></div>
      <div className="deliverables-grid">{form.deliverables.map((deliverable, index) => <label className="field" key={index}><span>Deliverable {index + 1}</span><input value={deliverable} onChange={(event) => changeDeliverable(index, event.target.value)} placeholder={index === 0 ? 'e.g. Logo placement' : 'Add commitment'} /></label>)}</div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> Save sponsor</button></div>
    </form>
  </section></div>
}

function SponsorLeadModal({ onClose, onSave }: { onClose: () => void; onSave: (lead: SponsorLeadInput) => Promise<void> }) {
  const supportOptions: SponsorLeadInput['supportTypes'] = ['Financial', 'Parts / materials', 'Equipment', 'Services / expertise', 'Other']
  const [form, setForm] = useState({ company: '', contactName: '', contactRole: '', contactEmail: '', contactPhone: '', subteam: '', relationship: '', details: '', supportTypes: [] as SponsorLeadInput['supportTypes'], supportDetails: '', estimatedAmount: '', canIntroduce: 'Not sure' as SponsorLeadInput['canIntroduce'] })
  const [formError, setFormError] = useState('')
  const change = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const toggleSupportType = (supportType: SponsorLeadInput['supportTypes'][number]) => setForm((current) => ({
    ...current,
    supportTypes: current.supportTypes.includes(supportType)
      ? current.supportTypes.filter((selected) => selected !== supportType)
      : [...current.supportTypes, supportType],
  }))

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-title">
    <div className="modal-heading"><div><span className="section-kicker">BUSINESS TEAM INTAKE</span><h2 id="lead-title">Submit a sponsor lead</h2><p>Share a company connection for the business team to follow up.</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!form.supportTypes.length) { setFormError('Choose at least one type of support.'); return } setFormError(''); void onSave({ ...form, estimatedAmount: Number(form.estimatedAmount) || 0 }) }}>
      <div className="form-grid">
        <label className="field"><span>Company or business <b>*</b></span><input required value={form.company} onChange={(event) => change('company', event.target.value)} placeholder="Organization name" /></label>
        <label className="field"><span>Contact name</span><input value={form.contactName} onChange={(event) => change('contactName', event.target.value)} placeholder="Person you know" /></label>
        <label className="field"><span>Contact role</span><input value={form.contactRole} onChange={(event) => change('contactRole', event.target.value)} placeholder="Title or department" /></label>
        <label className="field"><span>Contact email</span><input type="email" value={form.contactEmail} onChange={(event) => change('contactEmail', event.target.value)} placeholder="name@company.com" /></label>
        <label className="field"><span>Contact phone</span><input type="tel" value={form.contactPhone} onChange={(event) => change('contactPhone', event.target.value)} placeholder="Optional" /></label>
        <label className="field"><span>Your subteam</span><select value={form.subteam} onChange={(event) => change('subteam', event.target.value)}><option value="">Select a subteam</option>{subteamOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="field"><span>Estimated cash amount (USD)</span><input type="number" min="0" value={form.estimatedAmount} onChange={(event) => change('estimatedAmount', event.target.value)} placeholder="Optional; leave blank if unknown" /></label>
        <label className="field"><span>Can you introduce us?</span><select value={form.canIntroduce} onChange={(event) => change('canIntroduce', event.target.value as SponsorLeadInput['canIntroduce'])}><option>Not sure</option><option>Yes</option><option>No</option></select></label>
        <div className="field full-field"><span>What could they provide? <b>*</b></span><div className="support-options">{supportOptions.map((supportType) => <label className="support-option" key={supportType}><input type="checkbox" checked={form.supportTypes.includes(supportType)} onChange={() => toggleSupportType(supportType)} /><span>{supportType}</span></label>)}</div></div>
        <label className="field full-field"><span>What parts, materials, equipment, or services could they offer? <b>*</b></span><textarea required rows={2} value={form.supportDetails} onChange={(event) => change('supportDetails', event.target.value)} placeholder="Describe the possible in-kind or financial support" /></label>
        <label className="field full-field"><span>How do you know them, or who can connect us? <b>*</b></span><textarea required rows={2} value={form.relationship} onChange={(event) => change('relationship', event.target.value)} placeholder="Explain the relationship or possible introduction" /></label>
        <label className="field full-field"><span>Why might they support the team? <b>*</b></span><textarea required rows={3} value={form.details} onChange={(event) => change('details', event.target.value)} placeholder="Share relevant interests, prior support, or context for an outreach proposal" /></label>
      </div>
      {formError && <div className="lead-form-error" role="alert">{formError}</div>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary"><Plus size={16} /> Submit sponsor lead</button></div>
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
