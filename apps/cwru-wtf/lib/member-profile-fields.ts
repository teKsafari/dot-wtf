import { z } from 'zod';

// Shared by the profile form and the server; keep this module free of server imports.
export const profileLimits = { bio: 500, text: 2000, link: 500 } as const;

const text = (max: number) =>
  z.string().trim().max(max, `Keep this under ${max} characters.`);

export const profileFieldsSchema = z.object({
  bio: text(profileLimits.bio),
  wtfIdea: text(profileLimits.text),
  currentProject: text(profileLimits.text),
  youtubeLink: text(profileLimits.link).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Enter a full link that starts with https://'),
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;
export type ProfileField = keyof ProfileFields;

export const profileFieldNames = Object.keys(profileFieldsSchema.shape) as ProfileField[];
export const emptyProfileFields: ProfileFields = { bio: '', wtfIdea: '', currentProject: '', youtubeLink: '' };

export interface ProfileFormState {
  status: 'idle' | 'saved' | 'invalid' | 'error';
  // The form re-renders from these after every submission, so rejected input is never lost.
  fields: ProfileFields;
  errors?: Partial<Record<ProfileField, string>>;
  message?: string;
}
