import { pgTable, pgSequence, serial, text, timestamp, boolean, integer, jsonb, uuid, check, index } from 'drizzle-orm/pg-core';
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

// Logto authenticates the identity; all application relationships use local UUIDs.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tekidUserId: text('tekid_user_id').notNull().unique(),
  email: text('email').notNull().default(''),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
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
  check('memberships_status_check', sql`${table.status} in ('draft', 'pending', 'approved', 'rejected', 'suspended')`),
  check('memberships_role_check', sql`${table.role} in ('member', 'instance-lead', 'admin')`),
  check('memberships_number_check', sql`${table.memberNumber} is null or ${table.memberNumber} between 1 and 2147483646`),
  check('memberships_approval_check', sql`${table.status} <> 'approved' or (${table.memberNumber} is not null and ${table.approvedAt} is not null)`),
  index('memberships_review_idx').on(table.status, table.submittedAt),
]);

// No column default: draft/profile creation must never consume a member number.
// PostgreSQL sequences are bigint by default. The last value is an exhaustion sentinel.
export const memberNumberSequence = pgSequence('member_number_seq', {
  startWith: 1, minValue: 1, maxValue: 2147483647, increment: 1, cache: 1, cycle: false,
});

// Compatibility only for the deployed pre-split app. Migration 0012 bridges this
// table to the sequence; new runtime code must not read or write it. Remove in a
// later migration after the old deployment/rollback window has ended.
export const legacyMemberNumberCounter = pgTable('member_number_counter', {
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
