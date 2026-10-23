import { z } from 'zod'

const requestStatuses = ['Needed', 'Outreach', 'In transit', 'Received', 'Closed']
const communicationStatuses = ['Not started', 'Contacted', 'Follow-up', 'Confirmed']
const sponsorStatuses = ['Prospect', 'Proposal sent', 'Committed', 'Received']
const deliverableStatuses = ['Not started', 'In progress', 'Completed']
const sponsorLeadStatuses = ['New', 'Following up', 'Contacted', 'Converted', 'Not pursuing']
const sponsorSupportTypes = ['Financial', 'Parts / materials', 'Equipment', 'Services / expertise', 'Other']
const memberSubteam = z.string().trim().min(1).max(100)
  .refine((value) => value.toLowerCase() !== 'exec', 'Exec membership must be assigned by an administrator.')
const optionalText = (max = 500) => z.string().trim().max(max).default('')
const optionalTextPatch = (max = 500) => z.string().trim().max(max).optional()
const followUpDatePatch = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional()
const sponsorDeliverables = z.preprocess(
  (value) => Array.isArray(value) ? value.map((deliverable) => typeof deliverable === 'string' ? { description: deliverable, status: 'Not started' } : deliverable) : value,
  z.array(z.object({
    description: z.string().trim().min(1).max(500),
    status: z.enum(deliverableStatuses).default('Not started'),
  })).max(20),
)

export const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  subteam: memberSubteam,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  inviteCode: z.string().min(1).max(200),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
})

export const accountPatchSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict()

export const managementUserPatchSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  subteam: z.string().trim().min(1).max(100),
  tag: z.enum(['member', 'stl']).optional(),
  active: z.boolean().optional(),
}).strict()

export const recordActivitySchema = z.object({
  body: z.string().trim().min(1).max(2000),
}).strict()

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(128),
}).strict()

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict()

export const subteamChangeRequestSchema = z.object({
  subteam: memberSubteam,
})

export const subteamChangeReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

export const accountDeleteSchema = z.object({
  password: z.string().min(1).max(128),
})

export const partRequestSchema = z.object({
  item: z.string().trim().min(1).max(200),
  company: optionalText(200),
  link: z.union([z.literal(''), z.string().url().max(2000)]).default(''),
  contact: optionalText(300),
  quantity: z.number().int().min(1).max(100000),
  value: z.number().min(0).max(100000000),
  specs: optionalText(5000),
  compatibility: optionalText(5000),
  priority: z.enum(['Urgent', 'High', 'Normal', 'Low']),
  subteam: z.string().trim().min(1).max(100),
  relationship: optionalText(2000),
  communication: z.enum(communicationStatuses),
  status: z.enum(requestStatuses),
  nextFollowUpAt: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
  recurring: z.boolean(),
  requestedBy: optionalText(100),
})

const partRequestPatchFields = {
  company: optionalTextPatch(200),
  link: z.union([z.literal(''), z.string().url().max(2000)]).optional(),
  contact: optionalTextPatch(300),
  specs: optionalTextPatch(5000),
  compatibility: optionalTextPatch(5000),
  relationship: optionalTextPatch(2000),
  nextFollowUpAt: followUpDatePatch,
  requestedBy: optionalTextPatch(100),
}

export const managementPartRequestPatchSchema = partRequestSchema.partial().extend({
  ...partRequestPatchFields,
  assigneeId: z.string().trim().max(100).optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide request details to update.')

export const partRequestPatchSchema = partRequestSchema.partial().extend({
  ...partRequestPatchFields,
  assigneeId: z.string().trim().max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide request details to update.')

export const sponsorshipSchema = z.object({
  company: z.string().trim().min(1).max(200),
  contact: optionalText(300),
  amount: z.number().min(0).max(100000000),
  status: z.enum(sponsorStatuses),
  deliverables: sponsorDeliverables,
  relationship: optionalText(2000),
  renewal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
})

export const sponsorshipPatchSchema = z.object({
  company: z.string().trim().min(1).max(200).optional(),
  contact: optionalTextPatch(300),
  amount: z.number().min(0).max(100000000).optional(),
  status: z.enum(sponsorStatuses).optional(),
  deliverables: sponsorDeliverables.optional(),
  relationship: optionalTextPatch(2000),
  renewal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide sponsorship details to update.')

export const sponsorLeadSchema = z.object({
  company: z.string().trim().min(1).max(200),
  contactName: optionalText(200),
  contactRole: optionalText(200),
  contactEmail: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  contactPhone: optionalText(100),
  subteam: optionalText(100),
  relationship: z.string().trim().min(1).max(2000),
  details: z.string().trim().min(1).max(5000),
  supportTypes: z.array(z.enum(sponsorSupportTypes)).min(1).max(sponsorSupportTypes.length),
  supportDetails: z.string().trim().min(1).max(3000),
  estimatedAmount: z.number().min(0).max(100000000),
  canIntroduce: z.enum(['Yes', 'No', 'Not sure']),
  nextFollowUpAt: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
})

const sponsorLeadPatchFields = {
  contactName: optionalTextPatch(200),
  contactRole: optionalTextPatch(200),
  contactEmail: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(),
  contactPhone: optionalTextPatch(100),
  subteam: optionalTextPatch(100),
  nextFollowUpAt: followUpDatePatch,
}

export const managementSponsorLeadPatchSchema = sponsorLeadSchema.partial().extend({
  ...sponsorLeadPatchFields,
  status: z.enum(sponsorLeadStatuses).optional(),
  assigneeId: z.string().trim().max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide sponsor lead details to update.')

export const sponsorLeadPatchSchema = managementSponsorLeadPatchSchema