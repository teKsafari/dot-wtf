// The parts of a membership application the browser also needs. Keep this
// module free of server imports: the join form and the review queue are client
// components, and anything they import is bundled for the browser.
import { z } from 'zod';
import type { ProfileField, ProfileFields } from './member-profile-fields';

export type ApplicationField = ProfileField | 'email' | 'photo';

// An applicant's address becomes their tekID identity, so it is checked here
// rather than being discovered when the account is minted.
export const applicantEmailSchema = z.string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().min(6).max(254).email('Enter an email address you can open.'))
  .refine((value) => {
    const [local, domain] = value.split('@');
    if (!local || !domain || local.length > 64) return false;
    if (value.includes('..') || local.startsWith('.') || local.endsWith('.')) return false;
    const labels = domain.split('.');
    return labels.length >= 2 && labels.every((label) =>
      label.length >= 1 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
  }, 'Enter an email address you can open.');

// Spam guard: a hidden field no person fills, and a fixed window per address.
// Both, because a honeypot stops the cheap bots and the window stops a script
// that learned the field; neither sends the applicant to a third party.
export const applicationHoneypotField = 'website';
export const applicationsPerAddress = 5;
export const attemptsPerAddress = 30;
export const applicationWindowMilliseconds = 60 * 60 * 1000;

// How long an approved applicant stays on the review screen. Their sign-in link
// is single use, so the reviewer needs somewhere to mint another when it is lost.
export const recentlyApprovedWindowMilliseconds = 14 * 24 * 60 * 60 * 1000;

// Only these values cross into the review client.
export interface ApplicationView {
  userId: string;
  email: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  memberNumber: number | null;
  photoUrl: string | null;
  submittedAt: string | null;
  fields: ProfileFields;
}

export interface ApplicationQueue {
  pending: ApplicationView[];
  recentlyApproved: ApplicationView[];
}

export interface SignInLink {
  url: string;
  expiresAt: string;
}
