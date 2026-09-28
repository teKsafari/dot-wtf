import { z } from 'zod';

// Shared by the profile form and the server; keep this module free of server imports.
export const profileLimits = {
  name: 128, institution: 200, phone: 40, category: 200,
  bio: 500, text: 2000, applicationText: 600, link: 500, social: 200,
} as const;

// The live application form's labels, with its duplicate Research option removed.
export const categoryOptions = [
  'Research', 'Photography / Videography', 'Hardware / Electronics',
  'Software / Coding', 'Arts / Design', 'Architecture', 'Other',
] as const;

export type ApplicationStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';

export const socialPlatforms = ['github', 'instagram', 'linkedin', 'portfolio'] as const;
export type SocialPlatform = typeof socialPlatforms[number];
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export const socialLinkLabels: Record<SocialPlatform, string> = {
  github: 'GitHub',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  portfolio: 'Portfolio',
};

// Browsers submit textarea line breaks as CRLF, but maxLength counts each break once.
const text = (max: number) => z.preprocess(
  (value) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value),
  z.string().trim().max(max, `Keep this under ${max} characters.`)
);

// Accepts "example.com/path" as well as full links; only plain web links come back.
function webLink(value: string): URL | null {
  // A dot means a host ("ada.dev:8080"), not a scheme, even though schemes may contain dots.
  const candidate = /^[a-z][a-z0-9+-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    const plain = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    return plain && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

const profileSites = {
  github: {
    host: 'github.com',
    handle: /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    link: (handle: string) => `https://github.com/${handle}`,
  },
  instagram: {
    host: 'instagram.com',
    // Instagram usernames never start or end with a period or contain two in a row.
    handle: /^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/,
    link: (handle: string) => `https://www.instagram.com/${handle}/`,
  },
  linkedin: {
    host: 'linkedin.com',
    handle: /^[A-Za-z0-9_-]{3,100}$/,
    link: (handle: string) => `https://www.linkedin.com/in/${handle}`,
  },
};

// Normalizing can lengthen a link, so the stored href itself must fit the limit.
function withinLimit(href: string, max: number, context: z.RefinementCtx) {
  if (href.length <= max) return href;
  context.addIssue({ code: z.ZodIssueCode.custom, message: 'This link is too long.' });
  return z.NEVER;
}

// Other members open these links, so each one is normalized to https on the platform's own site.
const profileLink = (platform: keyof typeof profileSites) =>
  text(profileLimits.social).transform((value, context) => {
    if (!value) return '';
    const site = profileSites[platform];
    const url = webLink(value);
    if (url && (url.hostname === site.host || url.hostname.endsWith(`.${site.host}`))) {
      url.protocol = 'https:';
      if (url.pathname.length > 1 && !url.port) return withinLimit(url.href, profileLimits.social, context);
    } else {
      const handle = value.replace(/^@/, '');
      if (site.handle.test(handle)) return withinLimit(site.link(handle), profileLimits.social, context);
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Enter your ${socialLinkLabels[platform]} username or profile link.`,
    });
    return z.NEVER;
  });

export const profileFieldsSchema = z.object({
  name: text(profileLimits.name),
  institution: text(profileLimits.institution),
  categories: z.array(z.enum(categoryOptions))
    .max(categoryOptions.length, 'Choose from the listed categories.')
    .transform((values): string[] => [...new Set(values)]),
  otherCategory: text(profileLimits.category),
  whatsapp: text(profileLimits.phone).refine((value) => {
    if (!value) return true;
    const digits = value.replace(/\D/g, '');
    return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }, 'Enter a phone number with its country code, like +1 555 000 0000.'),
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
  github: profileLink('github'),
  instagram: profileLink('instagram'),
  linkedin: profileLink('linkedin'),
  portfolio: text(profileLimits.link).transform((value, context) => {
    if (!value) return '';
    const url = webLink(value);
    if (url) return withinLimit(url.href, profileLimits.link, context);
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a link to your site, like example.com.' });
    return z.NEVER;
  }),
});

// Drafts may be incomplete. Only submitting an application requires these answers.
export const applicationFieldsSchema = profileFieldsSchema.superRefine((fields, context) => {
  const requiredFields = {
    name: 'Add your name.',
    institution: 'Add your institution name and location.',
    whatsapp: 'Add your WhatsApp number so we can reach you.',
    wtfIdea: 'Tell us what you want to explore, create, or build.',
    currentProject: 'Tell us about something you have built or are building.',
    youtubeLink: 'Share a video you find interesting.',
    portfolio: 'Add a link to your portfolio or personal website.',
  } as const;
  for (const [field, message] of Object.entries(requiredFields)) {
    if (!fields[field as keyof typeof requiredFields]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  }
  if (fields.categories.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Choose at least one thing you are into.' });
  }
  if (fields.categories.includes('Other') && !fields.otherCategory) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['otherCategory'], message: 'Tell us what else you are into.' });
  }
  for (const field of ['wtfIdea', 'currentProject'] as const) {
    if (fields[field].length > profileLimits.applicationText) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `Keep your application answer to ${profileLimits.applicationText} characters or fewer.` });
    }
  }
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;
export type ProfileField = keyof ProfileFields;

export const profileFieldNames = Object.keys(profileFieldsSchema.shape) as ProfileField[];
export const emptyProfileFields: ProfileFields = {
  name: '', institution: '', categories: [], otherCategory: '', whatsapp: '',
  bio: '', wtfIdea: '', currentProject: '', youtubeLink: '',
  github: '', instagram: '', linkedin: '', portfolio: '',
};

export function profileFieldsFromFormData(formData: FormData): ProfileFields {
  return Object.fromEntries(profileFieldNames.map((name) => {
    if (name === 'categories') {
      return [name, formData.getAll(name).filter((value): value is string => typeof value === 'string')];
    }
    const value = formData.get(name);
    return [name, typeof value === 'string' ? value : ''];
  })) as ProfileFields;
}

// Stored links are checked again on the way out, since they end up as hrefs.
export function safeSocialLinks(value: unknown): SocialLinks {
  if (typeof value !== 'object' || value === null) return {};
  const links: SocialLinks = {};
  for (const platform of socialPlatforms) {
    const stored = (value as Record<string, unknown>)[platform];
    if (typeof stored !== 'string' || !stored) continue;
    const parsed = profileFieldsSchema.shape[platform].safeParse(stored);
    if (parsed.success && parsed.data) links[platform] = parsed.data;
  }
  return links;
}

export interface ProfileFormState {
  status: 'idle' | 'saved' | 'invalid' | 'error';
  // The form re-renders from these after every submission, so rejected input is never lost.
  fields: ProfileFields;
  applicationStatus?: ApplicationStatus;
  memberNumber?: number | null;
  errors?: Partial<Record<ProfileField, string>>;
  message?: string;
}
