import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
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
let emailServer
let emailPort
const sentEmails = []

before(async () => {
  emailServer = createHttpServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      sentEmails.push(JSON.parse(Buffer.concat(chunks).toString()))
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'test-email-id' }))
    })
  })
  await new Promise((resolve, reject) => emailServer.listen(0, '127.0.0.1', resolve).once('error', reject))
  emailPort = emailServer.address().port
  netlifyDb = new NetlifyDB()
  const connectionString = await netlifyDb.start()
  await netlifyDb.applyMigrations(migrationPath)
  database = getDatabase({ connectionString })
  handler = createApiHandler(database, {
    TEAM_INVITE_CODE: inviteCode,
    DEV_INVITE_CODE: devInviteCode,
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM: 'Digem Test <test@example.com>',
    RESEND_API_URL: `http://127.0.0.1:${emailPort}`,
    APP_URL: 'https://Digem.example.netlify.app',
  })
})

after(async () => {
  await database?.pool.end()
  await netlifyDb?.stop()
  await new Promise((resolve, reject) => emailServer?.close((error) => error ? reject(error) : resolve()))
})

function jsonRequest(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'x-nf-client-connection-ip': '127.0.0.1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return new Request(`https://Digem.example.netlify.app${path}`, {
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
  const stlRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify STL Member',
      subteam: 'Controls',
      email: 'netlify-stl-member@example.com',
      password: 'a-long-netlify-stl-password',
      inviteCode,
    },
  }))
  assert.equal(stlRegistration.status, 201)
  const { user: stlUser } = await stlRegistration.clone().json()
  const stlCookie = stlRegistration.headers.get('set-cookie').split(';')[0]
  const grantStlTag = await handler(jsonRequest(`/api/management/users/${stlUser.id}`, {
    method: 'PATCH',
    body: { displayName: stlUser.displayName, email: stlUser.email, subteam: stlUser.subteam, tag: 'stl' },
    cookie: devCookie,
  }))
  assert.equal((await grantStlTag.json()).user.tag, 'stl')
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
  const execSession = await handler(jsonRequest('/api/auth/me', { cookie: execCookie }))
  assert.equal((await execSession.json()).user.subteam, 'Exec')

  const partInput = {
    item: 'Netlify Test Hydraulic Fitting', company: 'Test Supplier', link: '', contact: '', quantity: 2,
    value: 45, specs: '1/4 inch NPT', compatibility: 'Fits the test manifold', priority: 'High',
    subteam: 'Controls', relationship: 'Member introduction', communication: 'Not started',
    status: 'Needed', nextFollowUpAt: '2026-10-29', recurring: false, requestedBy: 'Netlify Test Member',
  }
  const createdPart = await handler(jsonRequest('/api/requests', { method: 'POST', body: partInput, cookie }))
  assert.equal(createdPart.status, 201)
  const { record: part } = await createdPart.json()
  assert.equal(part.requesterSubteam, loginResult.user.subteam)
  assert.equal(part.nextFollowUpAt, partInput.nextFollowUpAt)
  const partNote = await handler(jsonRequest(`/api/requests/${part.id}/activity`, {
    method: 'POST', body: { body: 'Confirm dimensions with the supplier.' }, cookie: devCookie,
  }))
  assert.equal((await partNote.json()).record.activity.at(-1).type, 'note')
  const emailsBeforeSelfAssignment = sentEmails.length
  const devSelfAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: devUser.id }, cookie: devCookie,
  }))
  assert.equal((await devSelfAssignment.json()).record.assigneeId, devUser.id)
  assert.equal(sentEmails.length, emailsBeforeSelfAssignment)
  const memberPartEdit = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { specs: 'Updated by a regular member', compatibility: 'Verified against the build' }, cookie,
  }))
  assert.equal(memberPartEdit.status, 403)
  const stlPartEdit = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { specs: 'Updated by STL', compatibility: 'Verified against the build' }, cookie: stlCookie,
  }))
  assert.equal((await stlPartEdit.json()).record.specs, 'Updated by STL')
  const selfAssignedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie,
  }))
  assert.equal(selfAssignedPart.status, 403)
  const nonExecAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie,
  }))
  assert.equal(nonExecAssignment.status, 403)
  const assignedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: businessCookie,
  }))
  assert.equal(assignedPart.status, 403)
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
  assert.equal(execAssignedPart.status, 403)
  const execFollowUpUpdate = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { nextFollowUpAt: '2026-10-30' }, cookie: execCookie,
  }))
  assert.equal(execFollowUpUpdate.status, 200, await execFollowUpUpdate.clone().text())
  const execUpdatedPart = (await execFollowUpUpdate.json()).record
  assert.equal(execUpdatedPart.nextFollowUpAt, '2026-10-30')
  assert.equal(execUpdatedPart.item, partInput.item)
  const execCannotChangeRequestStatus = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { status: 'Outreach' }, cookie: execCookie,
  }))
  assert.equal(execCannotChangeRequestStatus.status, 403)
  const execSelfAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: execUser.id }, cookie: execCookie,
  }))
  assert.equal(execSelfAssignment.status, 403)
  const ineligibleExecTarget = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: 'missing-target' }, cookie: execCookie,
  }))
  assert.equal(ineligibleExecTarget.status, 403)
  const updatedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { status: 'In transit' }, cookie: stlCookie,
  }))
  assert.equal((await updatedPart.json()).record.status, 'In transit')
  const emailsBeforeRequestAssignment = sentEmails.length
  const stlAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: stlCookie,
  }))
  assert.equal((await stlAssignment.json()).record.assigneeId, requester.id)
  assert.equal(sentEmails.length, emailsBeforeRequestAssignment + 1)
  assert.deepEqual(sentEmails.at(-1).to, [loginResult.user.email])
  assert.match(sentEmails.at(-1).subject, /Netlify Test Hydraulic Fitting/)
  assert.match(sentEmails.at(-1).text, /Next follow-up date: 2026-10-30/)
  const stlCannotAssignOutsideSubteam = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: stlCookie,
  }))
  assert.equal(stlCannotAssignOutsideSubteam.status, 400)
  await database.sql`UPDATE users SET tag = 'stl' WHERE id = ${execUser.id}`
  const execStlAssignment = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: execCookie,
  }))
  assert.equal((await execStlAssignment.json()).record.assigneeId, businessUser.id)
  const devUpdatedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { priority: 'Urgent' }, cookie: devCookie,
  }))
  assert.equal(devUpdatedPart.status, 200)
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
    method: 'PATCH', body: { status: 'Received' }, cookie: stlCookie,
  }))
  assert.equal((await updatedSponsor.json()).record.status, 'Received')
  const memberSponsorEdit = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { contact: 'Edited by a regular member' }, cookie,
  }))
  assert.equal(memberSponsorEdit.status, 403)
  const editedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { ...sponsorInput, company: 'Edited Netlify Sponsor', deliverables: ['Logo placement', 'Demo invitation'] }, cookie: stlCookie,
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
    cookie: stlCookie,
  }))
  assert.deepEqual((await sponsorDeliveryStatus.json()).record.deliverables, [
    { description: 'Logo placement', status: 'Completed' },
    { description: 'Demo invitation', status: 'In progress' },
  ])
  await database.sql`UPDATE users SET tag = 'member' WHERE id = ${execUser.id}`
  const execSponsorFollowUp = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { renewal: '2027-01-15' }, cookie: execCookie,
  }))
  assert.equal(execSponsorFollowUp.status, 200, await execSponsorFollowUp.clone().text())
  const execUpdatedSponsor = (await execSponsorFollowUp.json()).record
  assert.equal(execUpdatedSponsor.renewal, '2027-01-15')
  assert.equal(execUpdatedSponsor.company, 'Edited Netlify Sponsor')
  const execCannotEditSponsorAmount = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { amount: 1000 }, cookie: execCookie,
  }))
  assert.equal(execCannotEditSponsorAmount.status, 403)
  await database.sql`UPDATE users SET tag = 'stl' WHERE id = ${execUser.id}`
  const listedSponsors = await handler(jsonRequest('/api/sponsorships', { cookie }))
  assert.equal((await listedSponsors.json()).records[0].id, sponsor.id)
  const managedSponsor = await handler(jsonRequest(`/api/management/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { contact: 'Dev edited Netlify sponsor' }, cookie: devCookie,
  }))
  assert.equal(managedSponsor.status, 200, await managedSponsor.clone().text())
  assert.equal((await managedSponsor.json()).record.contact, 'Dev edited Netlify sponsor')
  const deniedSponsorDelete = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, { method: 'DELETE', cookie }))
  assert.equal(deniedSponsorDelete.status, 403)
  const deletedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, { method: 'DELETE', cookie: stlCookie }))
  assert.equal(deletedSponsor.status, 204)

  const input = {
    company: 'Netlify Test Sponsor', contactName: 'Jordan Contact', contactRole: 'Engineering Manager',
    contactEmail: 'jordan@example.com', contactPhone: '', subteam: 'Controls',
    relationship: 'A teammate can make an introduction.', details: 'They support student engineering.',
    supportTypes: ['Parts / materials', 'Equipment'], supportDetails: 'Could donate steel stock or loan equipment.',
    estimatedAmount: 0, canIntroduce: 'Yes', nextFollowUpAt: '2026-10-30',
  }
  const created = await handler(jsonRequest('/api/sponsor-leads', { method: 'POST', body: input, cookie }))
  assert.equal(created.status, 201)
  const { record } = await created.json()
  assert.equal(record.createdBy, 'Netlify Test Member')
  assert.equal(record.requesterSubteam, loginResult.user.subteam)
  assert.equal(record.nextFollowUpAt, input.nextFollowUpAt)
  const leadNote = await handler(jsonRequest(`/api/sponsor-leads/${record.id}/activity`, {
    method: 'POST', body: { body: 'Ask for an introduction next week.' }, cookie: devCookie,
  }))
  assert.equal((await leadNote.json()).record.activity.at(-1).type, 'note')
  const memberLeadEdit = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { details: 'Updated by a regular member', estimatedAmount: 250 }, cookie,
  }))
  assert.equal(memberLeadEdit.status, 403)
  const stlLeadEdit = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { details: 'Updated by STL', estimatedAmount: 250 }, cookie: stlCookie,
  }))
  assert.equal((await stlLeadEdit.json()).record.details, 'Updated by STL')
  const selfAssignedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie,
  }))
  assert.equal(selfAssignedLead.status, 403)
  const nonExecLeadAssignment = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie,
  }))
  assert.equal(nonExecLeadAssignment.status, 403)
  const emailsBeforeLeadAssignment = sentEmails.length
  const stlLeadAssignment = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: stlCookie,
  }))
  assert.equal((await stlLeadAssignment.json()).record.assigneeId, requester.id)
  assert.equal(sentEmails.length, emailsBeforeLeadAssignment + 1)
  assert.deepEqual(sentEmails.at(-1).to, [loginResult.user.email])
  assert.match(sentEmails.at(-1).subject, /Netlify Test Sponsor/)
  assert.match(sentEmails.at(-1).text, /Next follow-up date: 2026-10-30/)
  const stlLeadCannotAssignOutsideSubteam = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: stlCookie,
  }))
  assert.equal(stlLeadCannotAssignOutsideSubteam.status, 400)
  const assignedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: businessUser.id }, cookie: businessCookie,
  }))
  assert.equal(assignedLead.status, 403)
  const businessCannotAssignLeadToOthers = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: businessCookie,
  }))
  assert.equal(businessCannotAssignLeadToOthers.status, 403)
  const execAssignsLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: execCookie,
  }))
  assert.equal((await execAssignsLead.json()).record.assigneeId, requester.id)
  const execLeadFollowUpUpdate = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { nextFollowUpAt: '2026-10-31' }, cookie: execCookie,
  }))
  assert.equal(execLeadFollowUpUpdate.status, 200, await execLeadFollowUpUpdate.clone().text())
  const execUpdatedLead = (await execLeadFollowUpUpdate.json()).record
  assert.equal(execUpdatedLead.nextFollowUpAt, '2026-10-31')
  assert.equal(execUpdatedLead.details, 'Updated by STL')

  const updated = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { status: 'Following up' }, cookie: stlCookie,
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
  const assignedExecUser = (await assignedExec.json()).user
  assert.equal(assignedExecUser.subteam, 'Exec')
  assert.equal(assignedExecUser.tag, 'member')
  const invalidAccessTag = await handler(jsonRequest(`/api/management/users/${businessUser.id}`, {
    method: 'PATCH',
    body: { displayName: businessUser.displayName, email: businessUser.email, subteam: 'Exec', tag: 'admin' },
    cookie: devCookie,
  }))
  assert.equal(invalidAccessTag.status, 400)
  const emailsBeforeManagedRequestAssignment = sentEmails.length
  const managedPart = await handler(jsonRequest(`/api/management/requests/${part.id}`, {
    method: 'PATCH', body: { item: 'Dev edited netlify fitting', priority: 'Urgent', assigneeId: stlUser.id }, cookie: devCookie,
  }))
  assert.equal(managedPart.status, 200, await managedPart.clone().text())
  assert.equal((await managedPart.json()).record.item, 'Dev edited netlify fitting')
  assert.equal(sentEmails.length, emailsBeforeManagedRequestAssignment + 1)
  assert.deepEqual(sentEmails.at(-1).to, [stlUser.email])
  assert.match(sentEmails.at(-1).subject, /Dev edited netlify fitting/)
  const emailsBeforeManagedLeadAssignment = sentEmails.length
  const managedLead = await handler(jsonRequest(`/api/management/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { details: 'Dev edited Netlify lead', status: 'Following up', assigneeId: stlUser.id }, cookie: devCookie,
  }))
  assert.equal(managedLead.status, 200, await managedLead.clone().text())
  assert.equal((await managedLead.json()).record.details, 'Dev edited Netlify lead')
  assert.equal(sentEmails.length, emailsBeforeManagedLeadAssignment + 1)
  assert.deepEqual(sentEmails.at(-1).to, [stlUser.email])
  assert.match(sentEmails.at(-1).subject, /Netlify Test Sponsor/)
  const managedLeadReassignment = await handler(jsonRequest(`/api/management/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { assigneeId: requester.id }, cookie: devCookie,
  }))
  assert.equal(managedLeadReassignment.status, 200, await managedLeadReassignment.clone().text())
  const devAccountUpdate = await handler(jsonRequest('/api/account', {
    method: 'PATCH',
    body: { displayName: 'Updated Netlify Dev', email: devUser.email },
    cookie: devCookie,
  }))
  assert.equal((await devAccountUpdate.json()).user.tag, 'dev')

  const managedDeleteRegistration = await handler(jsonRequest('/api/auth/register', {
    method: 'POST',
    body: {
      displayName: 'Netlify Member for Admin Delete',
      subteam: 'Controls',
      email: 'netlify-admin-delete@example.com',
      password: 'a-long-netlify-delete-password',
      inviteCode,
    },
  }))
  assert.equal(managedDeleteRegistration.status, 201)
  const { user: managedDeleteUser } = await managedDeleteRegistration.clone().json()
  const managedDeleteCookie = managedDeleteRegistration.headers.get('set-cookie').split(';')[0]
  const memberCannotDeleteUsers = await handler(jsonRequest(`/api/management/users/${managedDeleteUser.id}`, {
    method: 'DELETE', cookie,
  }))
  assert.equal(memberCannotDeleteUsers.status, 403)
  const devCannotDeleteSelf = await handler(jsonRequest(`/api/management/users/${devUser.id}`, {
    method: 'DELETE', cookie: devCookie,
  }))
  assert.equal(devCannotDeleteSelf.status, 403)
  const assignedToManagedDeleteUser = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { assigneeId: managedDeleteUser.id }, cookie: devCookie,
  }))
  assert.equal(assignedToManagedDeleteUser.status, 200)
  const deletedManagedUser = await handler(jsonRequest(`/api/management/users/${managedDeleteUser.id}`, {
    method: 'DELETE', cookie: devCookie,
  }))
  assert.equal(deletedManagedUser.status, 204)
  const deletedManagedUserSession = await handler(jsonRequest('/api/auth/me', { cookie: managedDeleteCookie }))
  assert.equal(deletedManagedUserSession.status, 401)
  const remainingPartsAfterManagedDelete = await handler(jsonRequest('/api/requests', { cookie: businessCookie }))
  assert.equal((await remainingPartsAfterManagedDelete.json()).records.find((item) => item.id === part.id).assigneeId, undefined)

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
    active: true,
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
  const deniedPartDelete = await handler(jsonRequest(`/api/requests/${part.id}`, { method: 'DELETE', cookie: businessCookie }))
  assert.equal(deniedPartDelete.status, 403)
  const deletedPart = await handler(jsonRequest(`/api/requests/${part.id}`, { method: 'DELETE', cookie: stlCookie }))
  assert.equal(deletedPart.status, 204)
  const deniedLeadDelete = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, { method: 'DELETE', cookie: businessCookie }))
  assert.equal(deniedLeadDelete.status, 403)
  const deletedLead = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, { method: 'DELETE', cookie: stlCookie }))
  assert.equal(deletedLead.status, 204)
  const memberCannotResetPassword = await handler(jsonRequest(`/api/management/users/${stlUser.id}/password-reset`, {
    method: 'POST', cookie: businessCookie,
  }))
  assert.equal(memberCannotResetPassword.status, 403)
  const invalidPasswordReset = await handler(jsonRequest('/api/auth/password-reset', {
    method: 'POST', body: { token: 'invalid-reset-token-value', password: 'short' },
  }))
  assert.equal(invalidPasswordReset.status, 400)
  const sentResetEmail = await handler(jsonRequest(`/api/management/users/${stlUser.id}/password-reset`, {
    method: 'POST', cookie: devCookie,
  }))
  assert.equal(sentResetEmail.status, 204)
  const emailMessage = sentEmails.at(-1)
  assert.deepEqual(emailMessage.to, [stlUser.email])
  const resetToken = new URL(emailMessage.text.match(/https:\/\/Digem\.example\.netlify\.app\/#[^\s]+/)[0]).hash.slice(1).split('=')[1]
  assert.ok(resetToken)
  const [storedResetToken] = await database.sql`SELECT token_hash FROM password_reset_tokens WHERE user_id = ${stlUser.id}`
  assert.notEqual(storedResetToken.token_hash, resetToken)
  const resetPassword = await handler(jsonRequest('/api/auth/password-reset', {
    method: 'POST', body: { token: resetToken, password: 'a-new-temporary-password' },
  }))
  assert.equal(resetPassword.status, 204)
  const reusedResetLink = await handler(jsonRequest('/api/auth/password-reset', {
    method: 'POST', body: { token: resetToken, password: 'another-new-password-value' },
  }))
  assert.equal(reusedResetLink.status, 400)
  const revokedSession = await handler(jsonRequest('/api/auth/me', { cookie: stlCookie }))
  assert.equal(revokedSession.status, 401)
  const oldPasswordLogin = await handler(jsonRequest('/api/auth/login', {
    method: 'POST', body: { email: stlUser.email, password: 'a-long-netlify-stl-password' },
  }))
  assert.equal(oldPasswordLogin.status, 401)
  const newPasswordLogin = await handler(jsonRequest('/api/auth/login', {
    method: 'POST', body: { email: stlUser.email, password: 'a-new-temporary-password' },
  }))
  assert.equal(newPasswordLogin.status, 200)

  const sentEmailCount = sentEmails.length
  const unknownAccountReset = await handler(jsonRequest('/api/auth/password-reset/request', {
    method: 'POST', body: { email: 'unknown-account@example.com' },
  }))
  const knownAccountReset = await handler(jsonRequest('/api/auth/password-reset/request', {
    method: 'POST', body: { email: stlUser.email },
  }))
  assert.equal(unknownAccountReset.status, 202)
  assert.equal(knownAccountReset.status, 202)
  assert.deepEqual(await unknownAccountReset.json(), await knownAccountReset.json())
  assert.equal(sentEmails.length, sentEmailCount + 1)
  assert.deepEqual(sentEmails.at(-1).to, [stlUser.email])
  const activeStlLogin = await handler(jsonRequest('/api/auth/login', {
    method: 'POST', body: { email: stlUser.email, password: 'a-new-temporary-password' },
  }))
  const activeStlCookie = activeStlLogin.headers.get('set-cookie').split(';')[0]
  const deactivateStl = await handler(jsonRequest(`/api/management/users/${stlUser.id}`, {
    method: 'PATCH',
    body: { displayName: stlUser.displayName, email: stlUser.email, subteam: stlUser.subteam, active: false },
    cookie: devCookie,
  }))
  assert.equal((await deactivateStl.json()).user.active, false)
  const membersAfterDeactivation = await handler(jsonRequest('/api/team-members', { cookie: devCookie }))
  assert.equal((await membersAfterDeactivation.json()).members.find((member) => member.id === stlUser.id).active, false)
  assert.equal((await handler(jsonRequest('/api/auth/me', { cookie: activeStlCookie }))).status, 401)
  assert.equal((await handler(jsonRequest('/api/auth/login', {
    method: 'POST', body: { email: stlUser.email, password: 'a-new-temporary-password' },
  }))).status, 401)
  const reactivateStl = await handler(jsonRequest(`/api/management/users/${stlUser.id}`, {
    method: 'PATCH',
    body: { displayName: stlUser.displayName, email: stlUser.email, subteam: stlUser.subteam, active: true },
    cookie: devCookie,
  }))
  assert.equal((await reactivateStl.json()).user.active, true)
  assert.equal((await handler(jsonRequest('/api/auth/login', {
    method: 'POST', body: { email: stlUser.email, password: 'a-new-temporary-password' },
  }))).status, 200)
})