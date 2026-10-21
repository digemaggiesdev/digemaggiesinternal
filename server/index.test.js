import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = await mkdtemp(join(tmpdir(), 'digem-api-test-'))
const databasePath = join(directory, 'test.sqlite')
const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const serverPath = fileURLToPath(new URL('./index.js', import.meta.url))
const server = spawn(process.execPath, [serverPath], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_PATH: databasePath, TEAM_INVITE_CODE: 'integration-test-invite', DEV_INVITE_CODE: 'integration-test-dev-invite' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

async function getFreePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve an API test port.')
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test API exited early: ${serverOutput}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Test API did not start: ${serverOutput}`)
}

after(async () => {
  server.kill('SIGTERM')
  await once(server, 'exit').catch(() => {})
  await rm(directory, { recursive: true, force: true })
})

test('invite auth and shared records persist through the API', async () => {
  await waitForServer()

  const account = {
    displayName: 'Test Member',
    subteam: 'Controls',
    email: 'test-member@example.com',
    password: 'a-long-test-password',
    inviteCode: 'integration-test-invite',
  }
  const unauthenticated = await fetch(`${baseUrl}/api/requests`)
  assert.equal(unauthenticated.status, 401)

  const invalidInvite = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, inviteCode: 'not-the-invite' }),
  })
  assert.equal(invalidInvite.status, 403)

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  assert.equal(registration.status, 201)
  const accountUser = (await registration.clone().json()).user
  assert.equal(accountUser.subteam, account.subteam)
  assert.equal(accountUser.tag, 'member')
  const cookie = registration.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/i)
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await sessionResponse.json()).user.subteam, account.subteam)
  const devInviteRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Dev Administrator', subteam: 'Business',
      email: 'test-dev@example.com', password: 'a-long-dev-password', inviteCode: 'integration-test-dev-invite',
    }),
  })
  assert.equal(devInviteRegistration.status, 403)
  const devRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Dev Administrator', subteam: 'Business',
      email: 'test-dev@example.com', password: 'a-long-dev-password', inviteCode: 'integration-test-invite',
    }),
  })
  assert.equal(devRegistration.status, 201)
  const { user: registeredDevCandidate } = await devRegistration.clone().json()
  assert.equal(registeredDevCandidate.tag, 'member')
  const devCookie = devRegistration.headers.get('set-cookie')?.split(';')[0]
  const devPromotion = await fetch(`${baseUrl}/api/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ password: 'integration-test-dev-invite' }),
  })
  assert.equal(devPromotion.status, 200)
  const { user: devUser } = await devPromotion.json()
  assert.equal(devUser.subteam, 'Business')
  assert.equal(devUser.tag, 'dev')
  const promotedSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: devCookie } })
  assert.equal((await promotedSession.json()).user.tag, 'dev')
  const ordinaryCodeCannotGrantDev = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Ordinary Member', subteam: 'Business',
      email: 'ordinary-member@example.com', password: 'a-long-ordinary-password', inviteCode: 'integration-test-invite',
    }),
  })
  assert.equal((await ordinaryCodeCannotGrantDev.json()).user.tag, 'member')
  const regularMemberManagement = await fetch(`${baseUrl}/api/management/users`, { headers: { Cookie: cookie } })
  assert.equal(regularMemberManagement.status, 403)
  const forbiddenExecRequest = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ subteam: 'Exec' }),
  })
  assert.equal(forbiddenExecRequest.status, 400)

  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  assert.equal(duplicate.status, 409)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
  assert.equal(login.status, 200)
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i)

  const partInput = {
    item: 'Test hydraulic fitting', company: 'Test Supplier', link: '', contact: '', quantity: 2,
    value: 45, specs: '1/4 inch NPT', compatibility: 'Fits test manifold', priority: 'High',
    subteam: 'Hydraulics', relationship: 'Member introduction', communication: 'Contacted',
    status: 'Needed', recurring: false, requestedBy: 'Test Member',
  }
  const createdPartResponse = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(partInput),
  })
  assert.equal(createdPartResponse.status, 201)
  const { record: part } = await createdPartResponse.json()
  assert.equal(part.createdBy, account.displayName)
  assert.equal(part.requesterSubteam, account.subteam)

  const businessAccount = {
    ...account,
    displayName: 'Business Member',
    subteam: 'Business',
    email: 'business-member@example.com',
  }
  const businessRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(businessAccount),
  })
  assert.equal(businessRegistration.status, 201)
  const businessUser = (await businessRegistration.clone().json()).user
  const businessCookie = businessRegistration.headers.get('set-cookie')?.split(';')[0]
  const teamMembersResponse = await fetch(`${baseUrl}/api/team-members`, { headers: { Cookie: cookie } })
  const { members } = await teamMembersResponse.json()
  assert.ok(members.some((member) => member.id === businessUser.id))
  assert.ok(members.some((member) => member.displayName === businessAccount.displayName && member.subteam === 'Business'))
  assert.ok(members.every((member) => !Object.hasOwn(member, 'email')))

  const updatedPartResponse = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'In transit' }),
  })
  assert.equal((await updatedPartResponse.json()).record.status, 'In transit')
  const unauthorizedAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ assigneeId: 'not-a-member' }),
  })
  assert.equal(unauthorizedAssignment.status, 403)
  const selfAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal((await selfAssignment.json()).record.assigneeId, accountUser.id)
  const nonExecAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ assigneeId: businessUser.id }),
  })
  assert.equal(nonExecAssignment.status, 403)
  const businessAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: businessCookie },
    body: JSON.stringify({ assigneeId: businessUser.id }),
  })
  assert.equal((await businessAssignment.json()).record.assigneeId, businessUser.id)
  const businessCannotAssignOthers = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: businessCookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal(businessCannotAssignOthers.status, 403)
  const execAccount = { ...account, displayName: 'Exec Member', subteam: 'Exec', email: 'exec-member@example.com' }
  const unauthorizedExecRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(execAccount),
  })
  assert.equal(unauthorizedExecRegistration.status, 400)
  const execRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...execAccount, subteam: 'Controls' }),
  })
  assert.equal(execRegistration.status, 201)
  const execUser = (await execRegistration.clone().json()).user
  const execCookie = execRegistration.headers.get('set-cookie')?.split(';')[0]
  const provisioningDb = new Database(databasePath)
  provisioningDb.prepare('UPDATE users SET subteam = ? WHERE id = ?').run('Exec', execUser.id)
  provisioningDb.close()
  const execAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal((await execAssignment.json()).record.assigneeId, accountUser.id)
  const invalidTargetAssignment = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ assigneeId: execUser.id }),
  })
  assert.equal(invalidTargetAssignment.status, 400)
  const listedParts = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: cookie } })
  assert.equal((await listedParts.json()).records[0].status, 'In transit')

  const sponsorInput = {
    company: 'Test Engineering Donor', contact: 'Test Contact', amount: 500, status: 'Committed',
    deliverables: ['Demo invitation'], relationship: 'Alumni connection', renewal: '2027-01-15',
  }
  const createdSponsorResponse = await fetch(`${baseUrl}/api/sponsorships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(sponsorInput),
  })
  assert.equal(createdSponsorResponse.status, 201)
  const { record: sponsor } = await createdSponsorResponse.json()
  assert.deepEqual(sponsor.deliverables, [{ description: 'Demo invitation', status: 'Not started' }])

  const sponsorUpdate = await fetch(`${baseUrl}/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'Received' }),
  })
  assert.equal((await sponsorUpdate.json()).record.status, 'Received')
  const sponsorEdit = await fetch(`${baseUrl}/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ...sponsorInput, company: 'Edited Test Sponsor', deliverables: ['Logo placement', 'Demo invitation'] }),
  })
  const { record: editedSponsor } = await sponsorEdit.json()
  assert.equal(editedSponsor.company, 'Edited Test Sponsor')
  assert.deepEqual(editedSponsor.deliverables, [
    { description: 'Logo placement', status: 'Not started' },
    { description: 'Demo invitation', status: 'Not started' },
  ])
  const sponsorDeliveryStatus = await fetch(`${baseUrl}/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      deliverables: [
        { description: 'Logo placement', status: 'Completed' },
        { description: 'Demo invitation', status: 'In progress' },
      ],
    }),
  })
  assert.deepEqual((await sponsorDeliveryStatus.json()).record.deliverables, [
    { description: 'Logo placement', status: 'Completed' },
    { description: 'Demo invitation', status: 'In progress' },
  ])
  const listedSponsors = await fetch(`${baseUrl}/api/sponsorships`, { headers: { Cookie: cookie } })
  assert.equal((await listedSponsors.json()).records[0].company, 'Edited Test Sponsor')
  const managedSponsor = await fetch(`${baseUrl}/api/management/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ contact: 'Dev edited sponsor contact' }),
  })
  assert.equal(managedSponsor.status, 200, await managedSponsor.clone().text())
  assert.equal((await managedSponsor.json()).record.contact, 'Dev edited sponsor contact')

  const teammateRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, displayName: 'Test Teammate', email: 'test-teammate@example.com' }),
  })
  assert.equal(teammateRegistration.status, 201)
  const teammateCookie = teammateRegistration.headers.get('set-cookie')?.split(';')[0]
  const sharedParts = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedParts.json()).records[0].item, partInput.item)
  const sharedSponsors = await fetch(`${baseUrl}/api/sponsorships`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedSponsors.json()).records[0].company, 'Edited Test Sponsor')
  const deletedSponsor = await fetch(`${baseUrl}/api/sponsorships/${sponsor.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
  assert.equal(deletedSponsor.status, 204)
  const sponsorsAfterDelete = await fetch(`${baseUrl}/api/sponsorships`, { headers: { Cookie: cookie } })
  assert.equal((await sponsorsAfterDelete.json()).records.some((record) => record.id === sponsor.id), false)

  const sponsorLeadInput = {
    company: 'Test Potential Sponsor', contactName: 'Jordan Contact', contactRole: 'Engineering Manager',
    contactEmail: 'jordan@example.com', contactPhone: '', subteam: 'Outreach',
    relationship: 'A teammate can introduce us', details: 'Interested in supporting student engineering.',
    supportTypes: ['Parts / materials', 'Equipment'], supportDetails: 'May donate steel stock or loan a portable welder.',
    estimatedAmount: 0, canIntroduce: 'Yes',
  }
  const createdLeadResponse = await fetch(`${baseUrl}/api/sponsor-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(sponsorLeadInput),
  })
  assert.equal(createdLeadResponse.status, 201)
  const { record: lead } = await createdLeadResponse.json()
  assert.equal(lead.createdBy, account.displayName)
  assert.equal(lead.requesterSubteam, account.subteam)
  assert.equal(lead.status, 'New')
  assert.deepEqual(lead.supportTypes, sponsorLeadInput.supportTypes)
  const selfAssignedLeadResponse = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal((await selfAssignedLeadResponse.json()).record.assigneeId, accountUser.id)
  const nonExecLeadAssignment = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ assigneeId: businessUser.id }),
  })
  assert.equal(nonExecLeadAssignment.status, 403)
  const assignedLeadResponse = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: businessCookie },
    body: JSON.stringify({ assigneeId: businessUser.id }),
  })
  assert.equal((await assignedLeadResponse.json()).record.assigneeId, businessUser.id)
  const businessCannotAssignLeadToOthers = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: businessCookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal(businessCannotAssignLeadToOthers.status, 403)
  const execAssignsLead = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ assigneeId: accountUser.id }),
  })
  assert.equal((await execAssignsLead.json()).record.assigneeId, accountUser.id)
  const leadStatusResponse = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'Following up' }),
  })
  assert.equal((await leadStatusResponse.json()).record.status, 'Following up')
  const sharedLeads = await fetch(`${baseUrl}/api/sponsor-leads`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedLeads.json()).records[0].company, sponsorLeadInput.company)
  const directSubteamChange = await fetch(`${baseUrl}/api/account`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ displayName: account.displayName, email: account.email, subteam: 'Exec' }),
  })
  assert.equal(directSubteamChange.status, 400)
  const unchangedSubteam = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await unchangedSubteam.json()).user.subteam, account.subteam)

  const subteamRequestResponse = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ subteam: 'Software' }),
  })
  assert.equal(subteamRequestResponse.status, 201)
  const { request: subteamRequest } = await subteamRequestResponse.json()
  assert.equal(subteamRequest.status, 'pending')
  assert.equal(subteamRequest.currentSubteam, account.subteam)
  assert.equal(subteamRequest.requestedSubteam, 'Software')
  const duplicateSubteamRequest = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ subteam: 'Hydraulics' }),
  })
  assert.equal(duplicateSubteamRequest.status, 409)
  const pendingRequests = await fetch(`${baseUrl}/api/subteam-change-requests`, { headers: { Cookie: cookie } })
  assert.equal((await pendingRequests.json()).requests[0].id, subteamRequest.id)

  const nonExecReview = await fetch(`${baseUrl}/api/subteam-change-requests/${subteamRequest.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: businessCookie },
    body: JSON.stringify({ status: 'approved' }),
  })
  assert.equal(nonExecReview.status, 403)
  const execReview = await fetch(`${baseUrl}/api/subteam-change-requests/${subteamRequest.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ status: 'approved' }),
  })
  assert.equal((await execReview.json()).request.status, 'approved')
  const approvedSubteamSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await approvedSubteamSession.json()).user.subteam, 'Software')
  const secondSubteamRequest = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ subteam: 'Controls' }),
  })
  assert.equal(secondSubteamRequest.status, 201)
  const { request: rejectedRequest } = await secondSubteamRequest.json()
  const execReject = await fetch(`${baseUrl}/api/subteam-change-requests/${rejectedRequest.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ status: 'rejected' }),
  })
  assert.equal((await execReject.json()).request.status, 'rejected')
  const rejectedSubteamSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await rejectedSubteamSession.json()).user.subteam, 'Software')

  const execOwnRequest = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ subteam: 'Business' }),
  })
  const { request: execSubteamRequest } = await execOwnRequest.json()
  const execSelfReview = await fetch(`${baseUrl}/api/subteam-change-requests/${execSubteamRequest.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: execCookie },
    body: JSON.stringify({ status: 'approved' }),
  })
  assert.equal(execSelfReview.status, 403)
  const cancelExecRequest = await fetch(`${baseUrl}/api/subteam-change-requests/${execSubteamRequest.id}`, {
    method: 'DELETE',
    headers: { Cookie: execCookie },
  })
  assert.equal(cancelExecRequest.status, 204)

  const devApprovedRequestResponse = await fetch(`${baseUrl}/api/subteam-change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: teammateCookie },
    body: JSON.stringify({ subteam: 'Software' }),
  })
  const { request: devApprovedRequest } = await devApprovedRequestResponse.json()
  const devApproval = await fetch(`${baseUrl}/api/subteam-change-requests/${devApprovedRequest.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ status: 'approved' }),
  })
  assert.equal((await devApproval.json()).request.reviewedBy, devUser.displayName)
  const adminUsers = await fetch(`${baseUrl}/api/management/users`, { headers: { Cookie: devCookie } })
  assert.equal(adminUsers.status, 200)
  const { users: managedUsers } = await adminUsers.json()
  assert.ok(managedUsers.some((member) => member.id === accountUser.id && member.tag === 'member'))
  const assignedExec = await fetch(`${baseUrl}/api/management/users/${businessUser.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ displayName: businessAccount.displayName, email: businessAccount.email, subteam: 'Exec' }),
  })
  assert.equal((await assignedExec.json()).user.subteam, 'Exec')
  assert.equal((await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: businessCookie } })).json()).user.tag, 'member')
  const managedPart = await fetch(`${baseUrl}/api/management/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ item: 'Dev edited hydraulic fitting', priority: 'Urgent' }),
  })
  assert.equal((await managedPart.json()).record.item, 'Dev edited hydraulic fitting')
  const managedLead = await fetch(`${baseUrl}/api/management/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ details: 'Dev edited sponsor lead details', status: 'Following up' }),
  })
  assert.equal((await managedLead.json()).record.details, 'Dev edited sponsor lead details')
  const devAccountUpdate = await fetch(`${baseUrl}/api/account`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: devCookie },
    body: JSON.stringify({ displayName: 'Updated Dev Administrator', email: 'test-dev@example.com' }),
  })
  assert.equal((await devAccountUpdate.json()).user.tag, 'dev')

  const accountUpdate = await fetch(`${baseUrl}/api/account`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ displayName: 'Updated Test Member', email: 'updated-test-member@example.com' }),
  })
  assert.deepEqual((await accountUpdate.json()).user, {
    id: accountUser.id,
    email: 'updated-test-member@example.com',
    displayName: 'Updated Test Member',
    subteam: 'Software',
    tag: 'member',
  })
  const updatedSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await updatedSession.json()).user.displayName, 'Updated Test Member')
  const duplicateEmail = await fetch(`${baseUrl}/api/account`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ displayName: 'Updated Test Member', email: 'business-member@example.com' }),
  })
  assert.equal(duplicateEmail.status, 409)
  const rejectedDeletion = await fetch(`${baseUrl}/api/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ password: 'incorrect-password' }),
  })
  assert.equal(rejectedDeletion.status, 401)
  const accountDeletion = await fetch(`${baseUrl}/api/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ password: account.password }),
  })
  assert.equal(accountDeletion.status, 204)
  const deletedAccountSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal(deletedAccountSession.status, 401)

  const remainingParts = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: teammateCookie } })
  const remainingPart = (await remainingParts.json()).records.find((record) => record.id === part.id)
  assert.ok(remainingPart)
  assert.equal(remainingPart.assigneeId, undefined)
  const remainingLeads = await fetch(`${baseUrl}/api/sponsor-leads`, { headers: { Cookie: teammateCookie } })
  const remainingLead = (await remainingLeads.json()).records.find((record) => record.id === lead.id)
  assert.ok(remainingLead)
  assert.equal(remainingLead.assigneeId, undefined)
  const teamMembersAfterDeletion = await fetch(`${baseUrl}/api/team-members`, { headers: { Cookie: teammateCookie } })
  assert.equal((await teamMembersAfterDeletion.json()).members.some((member) => member.id === accountUser.id), false)
  const deletedPart = await fetch(`${baseUrl}/api/requests/${part.id}`, { method: 'DELETE', headers: { Cookie: teammateCookie } })
  assert.equal(deletedPart.status, 204)
  const deletedLead = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, { method: 'DELETE', headers: { Cookie: teammateCookie } })
  assert.equal(deletedLead.status, 204)
})