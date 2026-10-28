export type RequestStatus = 'Needed' | 'Outreach' | 'In transit' | 'Received' | 'Closed'
export type CommunicationStatus = 'Not started' | 'Contacted' | 'Follow-up' | 'Confirmed'
export type SponsorStatus = 'Prospect' | 'Proposal sent' | 'Committed' | 'Received'
export type SponsorLeadStatus = 'New' | 'Following up' | 'Contacted' | 'Converted' | 'Not pursuing'
export type SponsorSupportType = 'Financial' | 'Parts / materials' | 'Equipment' | 'Services / expertise' | 'Other'
export type DeliverableStatus = 'Not started' | 'In progress' | 'Completed'

export const subteamOptions = [
  'Cutterhead/Chassis',
  'Extraction',
  'Propulsion',
  'Tunnel Lining',
  'Electronics',
  'Software',
  'Business',
  'Integration',
]

export type TeamUser = {
  id: string
  email: string
  displayName: string
  subteam: string
  tag: 'member' | 'dev' | 'stl'
  active: boolean
}

export type TeamMember = {
  id: string
  displayName: string
  subteam: string
  active: boolean
}

export type SubteamChangeRequest = {
  id: string
  userId: string
  requesterName: string
  currentSubteam: string
  requestedSubteam: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy: string | null
  createdAt: string
  reviewedAt: string | null
}

export type PartRequest = {
  id: string
  item: string
  company: string
  link: string
  contact: string
  quantity: number
  value: number
  specs: string
  compatibility: string
  priority: 'Urgent' | 'High' | 'Normal' | 'Low'
  subteam: string
  relationship: string
  communication: CommunicationStatus
  status: RequestStatus
  recurring: boolean
  requestedBy: string
  requesterSubteam?: string
  assigneeId?: string
  nextFollowUpAt?: string
  updatedAt?: string
  activity?: RecordActivity[]
  createdAt: string
  createdBy: string
}

export type PartRequestInput = Omit<PartRequest, 'id' | 'createdAt' | 'createdBy' | 'requesterSubteam' | 'assigneeId' | 'updatedAt' | 'activity'>

export type RecordActivity = {
  id: string
  type: 'update' | 'note'
  actor: string
  body: string
  createdAt: string
}

export type Sponsor = {
  id: string
  company: string
  contact: string
  amount: number
  status: SponsorStatus
  deliverables: { description: string; status: DeliverableStatus }[]
  relationship: string
  renewal: string
  updatedAt?: string
  activity?: RecordActivity[]
  createdAt: string
  createdBy: string
}

export type SponsorInput = Omit<Sponsor, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'activity'>

export type SponsorLead = {
  id: string
  company: string
  contactName: string
  contactRole: string
  contactEmail: string
  contactPhone: string
  subteam: string
  relationship: string
  details: string
  supportTypes: SponsorSupportType[]
  supportDetails: string
  estimatedAmount: number
  canIntroduce: 'Yes' | 'No' | 'Not sure'
  requesterSubteam?: string
  assigneeId?: string
  nextFollowUpAt?: string
  updatedAt?: string
  activity?: RecordActivity[]
  status: SponsorLeadStatus
  createdAt: string
  createdBy: string
}

export type SponsorLeadInput = Omit<SponsorLead, 'id' | 'status' | 'createdAt' | 'createdBy' | 'requesterSubteam' | 'assigneeId' | 'updatedAt' | 'activity'>

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const result = response.status === 204 ? undefined : await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(result?.error || 'The server could not complete that request.', response.status)
  return result as T
}

export async function getSession() {
  try {
    const result = await request<{ user: TeamUser }>('/api/auth/me')
    return result.user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function getRealtimeStatus() {
  return request<{ enabled: boolean }>('/api/realtime/status')
}

export async function signIn(email: string, password: string) {
  const result = await request<{ user: TeamUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return result.user
}

export async function signUp(displayName: string, email: string, password: string, subteam: string, inviteCode: string) {
  const result = await request<{ user: TeamUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, email, password, subteam, inviteCode }),
  })
  return result.user
}

export async function signOut() {
  await request<void>('/api/auth/logout', { method: 'POST' })
}

export async function updateAccount(changes: Pick<TeamUser, 'displayName' | 'email'>) {
  const result = await request<{ user: TeamUser }>('/api/account', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.user
}

export async function getManagementUsers() {
  const result = await request<{ users: TeamUser[] }>('/api/management/users')
  return result.users
}

export async function updateManagementUser(id: string, changes: Pick<TeamUser, 'displayName' | 'email' | 'subteam'> & { tag?: 'member' | 'stl'; active?: boolean }) {
  const result = await request<{ user: TeamUser }>(`/api/management/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.user
}

export async function emailManagementUserPasswordReset(id: string) {
  await request<void>(`/api/management/users/${encodeURIComponent(id)}/password-reset`, {
    method: 'POST',
  })
}

export async function resetPassword(token: string, password: string) {
  await request<void>('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export async function requestPasswordReset(email: string) {
  await request<{ message: string }>('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function updateManagementRequest(id: string, changes: Partial<PartRequestInput & Pick<PartRequest, 'assigneeId'>>) {
  const result = await request<{ record: PartRequest }>(`/api/management/requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export async function updateManagementSponsor(id: string, changes: Partial<SponsorInput>) {
  const result = await request<{ record: Sponsor }>(`/api/management/sponsorships/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export async function updateManagementSponsorLead(id: string, changes: Partial<SponsorLeadInput & Pick<SponsorLead, 'status' | 'assigneeId'>>) {
  const result = await request<{ record: SponsorLead }>(`/api/management/sponsor-leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export async function getSubteamChangeRequests() {
  const result = await request<{ requests: SubteamChangeRequest[] }>('/api/subteam-change-requests')
  return result.requests
}

export async function requestSubteamChange(subteam: string) {
  const result = await request<{ request: SubteamChangeRequest }>('/api/subteam-change-requests', {
    method: 'POST',
    body: JSON.stringify({ subteam }),
  })
  return result.request
}

export async function reviewSubteamChangeRequest(id: string, status: 'approved' | 'rejected') {
  const result = await request<{ request: SubteamChangeRequest }>(`/api/subteam-change-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return result.request
}

export async function cancelSubteamChangeRequest(id: string) {
  await request<void>(`/api/subteam-change-requests/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function deleteAccount(password: string): Promise<TeamUser | null> {
  const result = await request<{ user?: TeamUser }>('/api/account', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  })
  return result?.user ?? null
}

export async function getRequests() {
  const result = await request<{ records: PartRequest[] }>('/api/requests')
  return result.records
}

export async function getTeamMembers() {
  const result = await request<{ members: TeamMember[] }>('/api/team-members')
  return result.members
}

export async function createRequest(input: PartRequestInput) {
  const result = await request<{ record: PartRequest }>('/api/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.record
}

export async function updateRequest(id: string, changes: Partial<PartRequestInput & Pick<PartRequest, 'status' | 'communication' | 'assigneeId'>>) {
  const result = await request<{ record: PartRequest }>(`/api/requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export async function deleteRequest(id: string) {
  await request<void>(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getSponsors() {
  const result = await request<{ records: Sponsor[] }>('/api/sponsorships')
  return result.records
}

export async function createSponsor(input: SponsorInput) {
  const result = await request<{ record: Sponsor }>('/api/sponsorships', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.record
}

export async function updateSponsor(id: string, changes: Partial<SponsorInput>) {
  const result = await request<{ record: Sponsor }>(`/api/sponsorships/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export async function deleteSponsor(id: string) {
  await request<void>(`/api/sponsorships/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getSponsorLeads() {
  const result = await request<{ records: SponsorLead[] }>('/api/sponsor-leads')
  return result.records
}

export async function createSponsorLead(input: SponsorLeadInput) {
  const result = await request<{ record: SponsorLead }>('/api/sponsor-leads', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.record
}

export async function updateSponsorLead(id: string, changes: Partial<SponsorLeadInput & Pick<SponsorLead, 'status' | 'assigneeId'>>) {
  const result = await request<{ record: SponsorLead }>(`/api/sponsor-leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  return result.record
}

export function addRecordNote(kind: 'part_request', id: string, body: string): Promise<PartRequest>
export function addRecordNote(kind: 'sponsor_lead', id: string, body: string): Promise<SponsorLead>
export async function addRecordNote(kind: 'part_request' | 'sponsor_lead', id: string, body: string): Promise<PartRequest | SponsorLead> {
  const result = await request<{ record: PartRequest | SponsorLead }>(`/api/${kind === 'part_request' ? 'requests' : 'sponsor-leads'}/${encodeURIComponent(id)}/activity`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  return result.record
}

export async function addSponsorNote(id: string, body: string) {
  const result = await request<{ record: Sponsor }>(`/api/sponsorships/${encodeURIComponent(id)}/activity`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  return result.record
}

export async function deleteSponsorLead(id: string) {
  await request<void>(`/api/sponsor-leads/${encodeURIComponent(id)}`, { method: 'DELETE' })
}