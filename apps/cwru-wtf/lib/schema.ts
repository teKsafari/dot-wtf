import { pgTable, serial, text, timestamp, boolean, integer, jsonb, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SocialLinks } from './member-profile-fields';

export const submissions = pgTable('submissions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  categories: text('categories').notNull(), // JSON string of selected categories
  otherCategory: text('other_category'), // If "Other" is selected
  wtfIdea: text('wtf_idea').notNull(), // What do you want to build that would make you go WTF?
  currentProject: text('current_project').notNull(), // What you have built or are building
  youtubeLink: text('youtube_link').notNull(), // YouTube link
  whatsapp: text('whatsapp'), // Optional WhatsApp phone number
  tallySubmissionId: text('tally_submission_id').unique(),
  interests: text('interests'), // Keep for backward compatibility, can be removed later
  isApproved: boolean('is_approved'), // Default is null (pending)
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const actionLogs = pgTable('action_logs', {
  id: serial('id').primaryKey(),
  submissionId: integer('submission_id').references(() => submissions.id),
  action: text('action').notNull(), // 'approved', 'waitlisted', 'archived', etc.
  details: text('details'), // Additional information about the action
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Logto authenticates the user; profile data and every authorization decision live here.
export const memberProfiles = pgTable('member_profiles', {
  tekidUserId: text('tekid_user_id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  emailVerified: boolean('email_verified').notNull().default(false),
  picture: text('picture'),
  categories: jsonb('categories').$type<string[]>().notNull().default([]),
  institution: text('institution').notNull().default(''),
  otherCategory: text('other_category').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  bio: text('bio').notNull().default(''),
  wtfIdea: text('wtf_idea').notNull().default(''),
  currentProject: text('current_project').notNull().default(''),
  youtubeLink: text('youtube_link').notNull().default(''),
  socialLinks: jsonb('social_links').$type<SocialLinks>().notNull().default({}),
  status: text('status').$type<'draft' | 'pending' | 'approved' | 'rejected' | 'suspended'>().notNull().default('draft'),
  role: text('role').$type<'member' | 'instance-lead' | 'admin'>().notNull().default('member'),
  memberNumber: integer('member_number').unique(),
  submittedAt: timestamp('submitted_at'),
  approvedAt: timestamp('approved_at'),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: text('reviewed_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  check('member_profiles_status_check', sql`${table.status} in ('draft', 'pending', 'approved', 'rejected', 'suspended')`),
  check('member_profiles_role_check', sql`${table.role} in ('member', 'instance-lead', 'admin')`),
  check('member_profiles_number_check', sql`${table.memberNumber} is null or ${table.memberNumber} between 1 and 2147483646`),
  check('member_profiles_approval_check', sql`${table.status} <> 'approved' or (${table.memberNumber} is not null and ${table.approvedAt} is not null)`),
  index('member_profiles_review_idx').on(table.status, table.submittedAt),
]);

export const memberNumberCounter = pgTable('member_number_counter', {
  id: integer('id').primaryKey(),
  nextNumber: integer('next_number').notNull().default(1),
}, (table) => [
  check('member_number_counter_singleton', sql`${table.id} = 1`),
  check('member_number_counter_positive', sql`${table.nextNumber} > 0`),
]);

export const memberAuditLogs = pgTable('member_audit_logs', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  targetId: text('target_id').notNull(),
  action: text('action').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type ActionLog = typeof actionLogs.$inferSelect;
export type NewActionLog = typeof actionLogs.$inferInsert;
