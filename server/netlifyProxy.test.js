import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NetlifyDB } from '@netlify/database-dev'
import { getDatabase } from '@netlify/database'
import { createApiHandler } from '../netlify/functions/api.mjs'

const migrationPath = fileURLToPath(new URL('../netlify/database/migrations/', import.meta.url))
const inviteCode = 'netlify-function-test-invite'
const devInviteCode = 'netlify-function-dev-invite'
let netlifyDb
let database
let handler

before(async () => {
  netlifyDb = new NetlifyDB()
  const connectionString = await netlifyDb.start()
  await netlifyDb.applyMigrations(migrationPath)
  database = getDatabase({ connectionString })
  handler = createApiHandler(database, { TEAM_INVITE_CODE: inviteCode, DEV_INVITE_CODE: devInviteCode })
})

after(async () => {
  await database?.pool.end()
  await netlifyDb?.stop()
})

function jsonRequest(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'x-nf-client-connection-ip': '127.0.0.1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return new Request(`https://digem.example.netlify.app${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('Netlify API health and authentication use the managed database', async () => {
  const health = await handler(jsonRequest('/api/health'))
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const protectedResponse = await handler(jsonRequest('/api/requests'))
  assert.equal(protectedResponse.status, 401)

  const account = {
    displayName: 'Netlify Test Member',
    subteam: 'Controls',
    email: 'netlify-test-member@example.com',
    password: 'a-long-netlify-test-password',
    inviteCode,
  }
  const invalidInvite = await handler(jsonRequest('/api/auth/register', { method: 'POST', body: { ...account, inviteCode: 'wrong-code' } }))
  assert.equal(invalidInvite.status, 403)

  const created = await handler(jsonRequest('/api/auth/register', { method: 'POST', body: account }))
  assert.equal(created.status, 201)
  assert.match(created.headers.get('set-cookie'), /HttpOnly/)
  const { user } = await created.json()
  assert.equal(user.subteam, account.subteam)
  assert.equal(user.tag, 'member')
  const cookie = created.headers.get('set-cookie').split(';')[0]

  const session = await handler(jsonRequest('/api/auth/me', { cookie }))
  assert.equal((await session.json()).user.email, account.email)
  const directory = await handler(jsonRequest('/api/team-members', { cookie }))
  const { members } = await directory.json()
  assert.ok(members.some((member) => member.id === user.id && member.subteam === account.subteam))
  assert.ok(members.every((member) => !Object.hasOwn(member, 'email')))
})

test('Netlify API creates, updates, shares, and deletes sponsor leads', async () => {
  const login = await handler(jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { email: 'netlify-test-member@example.com', password: 'a-long-netlify-test-password' },
  }))
  assert.equal(login.status, 200)
  const loginResult = await login.clone().json()
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const directory = await handler(jsonRequest('/api/team-members', { cookie }))
  const { members } = await directory.json()
  const requester = members.find((member) => member.displayName === 'Netlify Test Member')
  assert.ok(requester)
  const businessRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify Business Member',
      subteam: 'Business',
      email: 'netlify-business-member@example.com',
      password: 'a-long-netlify-business-password',
      inviteCode,
    },
  }))
  assert.equal(businessRegistration.status, 201)
  const { user: businessUser } = await businessRegistration.clone().json()
  const businessCookie = businessRegistration.headers.get('set-cookie').split(';')[0]
  const devInviteRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify Dev Administrator',
      subteam: 'Business',
      email: 'netlify-dev@example.com',
      password: 'a-long-netlify-dev-password',
      inviteCode: devInviteCode,
    },
  }))
  assert.equal(devInviteRegistration.status, 403)
  const devRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify Dev Administrator',
      subteam: 'Business',
      email: 'netlify-dev@example.com',
      password: 'a-long-netlify-dev-password',
      inviteCode,
    },
  }))
  assert.equal(devRegistration.status, 201)
  const { user: registeredDevCandidate } = await devRegistration.clone().json()
  assert.equal(registeredDevCandidate.tag, 'member')
  const devCookie = devRegistration.headers.get('set-cookie').split(';')[0]
  const devPromotion = await handler(jsonRequest('/api/account', {
    method: 'DELETE', body: { password: devInviteCode }, cookie: devCookie,
  }))
  assert.equal(devPromotion.status, 200)
  const { user: devUser } = await devPromotion.json()
  assert.equal(devUser.tag, 'dev')
  assert.equal(devUser.subteam, 'Business')
  const promotedSession = await handler(jsonRequest('/api/auth/me', { cookie: devCookie }))
  assert.equal((await promotedSession.json()).user.tag, 'dev')
  const regularMemberCannotManage = await handler(jsonRequest('/api/management/users', { cookie }))
  assert.equal(regularMemberCannotManage.status, 403)
  const unauthorizedExecRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Unapproved Netlify Exec',
      subteam: 'Exec',
      email: 'unapproved-netlify-exec@example.com',
      password: 'a-long-unapproved-exec-password',
      inviteCode,
    },
  }))
  assert.equal(unauthorizedExecRegistration.status, 400)
  const execRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify Exec Member',
      subteam: 'Controls',
      email: 'netlify-exec-member@example.com',
      password: 'a-long-netlify-exec-password',
      inviteCode,
    },
  }))
  assert.equal(execRegistration.status, 201)
  const { user: execUser } = await execRegistration.clone().json()
  const execCookie = execRegistration.headers.get('set-cookie').split(';')[0]
  await database.sql`UPDATE users SET subteam = 'Exec' WHERE id = ${execUser.id}`

  const partInput = {
    item: 'Netlify Test Hydraulic Fitting', company: 'Test Supplier', link: '', contact: '', quantity: 2,
    value: 45, specs: '1/4 inch NPT', compatibility: 'Fits the test manifold', priority: 'High',
    subteam: 'Controls', relationship: 'Member introduction', communication: 'Not started',
    status: 'Needed', recurring: false, requestedBy: 'Netlify Test Member',
  }
  const createdPart = await handler(jsonRequest('/api/requests', { method: 'POST', body: partInput, cookie }))
  assert.equal(createdPart.status, 201)
  const { record: part } = await createdPart.json()
  assert.equal(part.requesterSubteam, loginResult.user.subteam)
  const selfAssignedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie,
  }))
  assert.equal((await selfAssignedPart.json()).record.assigneeId, requester.id)
  const nonExecAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie,
  }))
  assert.equal(nonExecAssignment.status, 403)
  const assignedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: businessCookie,
  }))
  assert.equal((await assignedPart.json()).record.assigneeId, businessUser.id)
  const businessCannotAssignOthers = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: businessCookie,
  }))
  assert.equal(businessCannotAssignOthers.status, 403)
  const unauthorizedAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie,
  }))
  assert.equal(unauthorizedAssignment.status, 403)
  const execAssignedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: execCookie,
  }))
  assert.equal((await execAssignedPart.json()).record.assigneeId, requester.id)
  const ineligibleExecTarget = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: execUser.id }, cookie: execCookie,
  }))
  assert.equal(ineligibleExecTarget.status, 400)
  const updatedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { status: 'In transit' }, cookie,
  }))
  assert.equal((await updatedPart.json()).record.status, 'In transit')
  const listedParts = await handler(jsonRequest('/api/requests', { cookie }))
  assert.equal((await listedParts.json()).records[0].id, part.id)

  const sponsorInput = {
    company: 'Netlify Test Sponsor Record', contact: 'Test Contact', amount: 500, status: 'Committed',
    deliverables: ['Demo invitation'], relationship: 'Alumni connection', renewal: '2027-01-15',
  }
  const createdSponsor = await handler(jsonRequest('/api/sponsorships', { method: 'POST', body: sponsorInput, cookie }))
  assert.equal(createdSponsor.status, 201)
  const { record: sponsor } = await createdSponsor.json()
  assert.deepEqual(sponsor.deliverables, [{ description: 'Demo invitation', status: 'Not started' }])
  const updatedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { status: 'Received' }, cookie,
  }))
  assert.equal((await updatedSponsor.json()).record.status, 'Received')
  const editedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { ...sponsorInput, company: 'Edited Netlify Sponsor', deliverables: ['Logo placement', 'Demo invitation'] }, cookie,
  }))
  const editedSponsorRecord = (await editedSponsor.json()).record
  assert.equal(editedSponsorRecord.company, 'Edited Netlify Sponsor')
  assert.deepEqual(editedSponsorRecord.deliverables, [
    { description: 'Logo placement', status: 'Not started' },
    { description: 'Demo invitation', status: 'Not started' },
  ])
  const sponsorDeliveryStatus = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    body: { deliverables: [
      { description: 'Logo placement', status: 'Completed' },
      { description: 'Demo invitation', status: 'In progress' },
    ] },
    cookie,
  }))
  assert.deepEqual((await sponsorDeliveryStatus.json()).record.deliverables, [
    { description: 'Logo placement', status: 'Completed' },
    { description: 'Demo invitation', status: 'In progress' },
  ])
  const listedSponsors = await handler(jsonRequest('/api/sponsorships', { cookie }))
  assert.equal((await listedSponsors.json()).records[0].id, sponsor.id)
  const managedSponsor = await handler(jsonRequest(`/api/management/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { contact: 'Dev edited Netlify sponsor' }, cookie: devCookie,
  }))
  assert.equal(managedSponsor.status, 200, await managedSponsor.clone().text())
  assert.equal((await managedSponsor.json()).record.contact, 'Dev edited Netlify sponsor')
  const deletedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, { method: 'DELETE', cookie }))
  assert.equal(deletedSponsor.status, 204)

  const input = {
    company: 'Netlify Test Sponsor', contactName: 'Jordan Contact', contactRole: 'Engineering Manager',
    contactEmail: 'jordan@example.com', contactPhone: '', subteam: 'Controls',
    relationship: 'A teammate can make an introduction.', details: 'They support student engineering.',
    supportTypes: ['Parts / materials', 'Equipment'], supportDetails: 'Could donate steel stock or loan equipment.',
    estimatedAmount: 0, canIntroduce: 'Yes',
  }
  const created = await handler(jsonRequest('/api/sponsor-leads', { method: 'POST', body: input, cookie }))
  assert.equal(created.status, 201)
  const { record } = await created.json()
  assert.equal(record.createdBy, 'Netlify Test Member')
  assert.equal(record.requesterSubteam, loginResult.user.subteam)
  const selfAssignedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie,
  }))
  assert.equal((await selfAssignedLead.json()).record.assigneeId, requester.id)
  const nonExecLeadAssignment = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie,
  }))
  assert.equal(nonExecLeadAssignment.status, 403)
  const assignedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: businessCookie,
  }))
  assert.equal((await assignedLead.json()).record.assigneeId, businessUser.id)
  const businessCannotAssignLeadToOthers = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: businessCookie,
  }))
  assert.equal(businessCannotAssignLeadToOthers.status, 403)
  const execAssignsLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: execCookie,
  }))
  assert.equal((await execAssignsLead.json()).record.assigneeId, requester.id)

  const updated = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { status: 'Following up' }, cookie,
  }))
  assert.equal((await updated.json()).record.status, 'Following up')

  const listed = await handler(jsonRequest('/api/sponsor-leads', { cookie }))
  assert.equal((await listed.json()).records[0].company, input.company)

  const directSubteamChange = await handler(jsonRequest('/api/account', {
    method: 'PATCH',
    body: { displayName: requester.displayName, email: requester.email, subteam: 'Exec' },
    cookie,
  }))
  assert.equal(directSubteamChange.status, 400)
  const forbiddenExecRequest = await handler(jsonRequest('/api/subteam-change-requests', {
    method: 'POST', body: { subteam: 'Exec' }, cookie,
  }))
  assert.equal(forbiddenExecRequest.status, 400)
  const subteamRequestResponse = await handler(jsonRequest('/api/subteam-change-requests', {
    method: 'POST', body: { subteam: 'Software' }, cookie,
  }))
  assert.equal(subteamRequestResponse.status, 201)
  const { request: subteamRequest } = await subteamRequestResponse.json()
  assert.equal(subteamRequest.status, 'pending')
  const nonExecReview = await handler(jsonRequest(`/api/subteam-change-requests/${subteamRequest.id}`, {
    method: 'PATCH', body: { status: 'approved' }, cookie: businessCookie,
  }))
  assert.equal(nonExecReview.status, 403)
  const execReview = await handler(jsonRequest(`/api/subteam-change-requests/${subteamRequest.id}`, {
    method: 'PATCH', body: { status: 'approved' }, cookie: execCookie,
  }))
  assert.equal((await execReview.json()).request.status, 'approved')
  const updatedSubteam = await handler(jsonRequest('/api/auth/me', { cookie }))
  assert.equal((await updatedSubteam.json()).user.subteam, 'Software')
  const rejectedSubteamRequest = await handler(jsonRequest('/api/subteam-change-requests', {
    method: 'POST', body: { subteam: 'Controls' }, cookie,
  }))
  assert.equal(rejectedSubteamRequest.status, 201)
  const { request: rejectedRequest } = await rejectedSubteamRequest.json()
  const execReject = await handler(jsonRequest(`/api/subteam-change-requests/${rejectedRequest.id}`, {
    method: 'PATCH', body: { status: 'rejected' }, cookie: execCookie,
  }))
  assert.equal((await execReject.json()).request.status, 'rejected')
  const unchangedSubteam = await handler(jsonRequest('/api/auth/me', { cookie }))
  assert.equal((await unchangedSubteam.json()).user.subteam, 'Software')
  const execOwnRequest = await handler(jsonRequest('/api/subteam-change-requests', {
    method: 'POST', body: { subteam: 'Business' }, cookie: execCookie,
  }))
  const { request: execSubteamRequest } = await execOwnRequest.json()
  const execSelfReview = await handler(jsonRequest(`/api/subteam-change-requests/${execSubteamRequest.id}`, {
    method: 'PATCH', body: { status: 'approved' }, cookie: execCookie,
  }))
  assert.equal(execSelfReview.status, 403)
  const cancelExecRequest = await handler(jsonRequest(`/api/subteam-change-requests/${execSubteamRequest.id}`, {
    method: 'DELETE', cookie: execCookie,
  }))
  assert.equal(cancelExecRequest.status, 204)

  const devReviewRequestResponse = await handler(jsonRequest('/api/subteam-change-requests', {
    method: 'POST', body: { subteam: 'Software' }, cookie: businessCookie,
  }))
  const { request: devReviewRequest } = await devReviewRequestResponse.json()
  const devReview = await handler(jsonRequest(`/api/subteam-change-requests/${devReviewRequest.id}`, {
    method: 'PATCH', body: { status: 'approved' }, cookie: devCookie,
  }))
  assert.equal((await devReview.json()).request.reviewedBy, devUser.displayName)
  const managedUsersResponse = await handler(jsonRequest('/api/management/users', { cookie: devCookie }))
  assert.equal(managedUsersResponse.status, 200)
  const { users: managedUsers } = await managedUsersResponse.json()
  assert.ok(managedUsers.some((member) => member.id === requester.id && member.tag === 'member'))
  const assignedExec = await handler(jsonRequest(`/api/management/users/${businessUser.id}`, {
    method: 'PATCH',
    body: { displayName: businessUser.displayName, email: businessUser.email, subteam: 'Exec' },
    cookie: devCookie,
  }))
  assert.equal((await assignedExec.json()).user.subteam, 'Exec')
  const managedPart = await handler(jsonRequest(`/api/management/requests/${part.id}`, {
    method: 'PATCH', body: { item: 'Dev edited netlify fitting', priority: 'Urgent' }, cookie: devCookie,
  }))
  assert.equal((await managedPart.json()).record.item, 'Dev edited netlify fitting')
  const managedLead = await handler(jsonRequest(`/api/management/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { details: 'Dev edited Netlify lead', status: 'Following up' }, cookie: devCookie,
  }))
  assert.equal((await managedLead.json()).record.details, 'Dev edited Netlify lead')
  const devAccountUpdate = await handler(jsonRequest('/api/account', {
    method: 'PATCH',
    body: { displayName: 'Updated Netlify Dev', email: devUser.email },
    cookie: devCookie,
  }))
  assert.equal((await devAccountUpdate.json()).user.tag, 'dev')

  const accountUpdate = await handler(jsonRequest('/api/account', {
    method: 'PATCH',
    body: { displayName: 'Updated Netlify Member', email: 'updated-netlify-member@example.com' },
    cookie,
  }))
  assert.deepEqual((await accountUpdate.json()).user, {
    id: requester.id,
    email: 'updated-netlify-member@example.com',
    displayName: 'Updated Netlify Member',
    subteam: 'Software',
    tag: 'member',
  })
  const duplicateEmail = await handler(jsonRequest('/api/account', {
    method: 'PATCH',
    body: { displayName: 'Updated Netlify Member', email: 'netlify-business-member@example.com' },
    cookie,
  }))
  assert.equal(duplicateEmail.status, 409)
  const rejectedDeletion = await handler(jsonRequest('/api/account', {
    method: 'DELETE', body: { password: 'incorrect-password' }, cookie,
  }))
  assert.equal(rejectedDeletion.status, 401)
  const accountDeletion = await handler(jsonRequest('/api/account', {
    method: 'DELETE', body: { password: 'a-long-netlify-test-password' }, cookie,
  }))
  assert.equal(accountDeletion.status, 204)
  const deletedSession = await handler(jsonRequest('/api/auth/me', { cookie }))
  assert.equal(deletedSession.status, 401)

  const remainingParts = await handler(jsonRequest('/api/requests', { cookie: businessCookie }))
  const remainingPart = (await remainingParts.json()).records.find((item) => item.id === part.id)
  assert.ok(remainingPart)
  assert.equal(remainingPart.assigneeId, undefined)
  const remainingLeads = await handler(jsonRequest('/api/sponsor-leads', { cookie: businessCookie }))
  const remainingLead = (await remainingLeads.json()).records.find((item) => item.id === record.id)
  assert.ok(remainingLead)
  assert.equal(remainingLead.assigneeId, undefined)
  const membersAfterDeletion = await handler(jsonRequest('/api/team-members', { cookie: businessCookie }))
  assert.equal((await membersAfterDeletion.json()).members.some((member) => member.id === requester.id), false)
  const deletedPart = await handler(jsonRequest(`/api/requests/${part.id}`, { method: 'DELETE', cookie: businessCookie }))
  assert.equal(deletedPart.status, 204)
  const deletedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, { method: 'DELETE', cookie: businessCookie }))
  assert.equal(deletedLead.status, 204)
})