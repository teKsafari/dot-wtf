import { pgTable, serial, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

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

export const adminUsers = pgTable('admin_users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').default('admin').notNull(), // 'admin', 'super_admin'
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// tekID owns name and photo; this holds what members edit on their dot wtf profile.
export const memberProfiles = pgTable('member_profiles', {
  tekidUserId: text('tekid_user_id').primaryKey(),
  bio: text('bio').notNull().default(''),
  wtfIdea: text('wtf_idea').notNull().default(''),
  currentProject: text('current_project').notNull().default(''),
  youtubeLink: text('youtube_link').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type ActionLog = typeof actionLogs.$inferSelect;
export type NewActionLog = typeof actionLogs.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
