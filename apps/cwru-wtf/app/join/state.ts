// A 'use server' module may only export async functions, so the form's state
// shape lives beside it.
import { emptyProfileFields, type ProfileFields } from '@/lib/member-profile-fields';
import type { ApplicationField } from '@/lib/application-fields';

export interface JoinFormState {
  status: 'idle' | 'submitted' | 'invalid' | 'error';
  email: string;
  fields: ProfileFields;
  errors?: Partial<Record<ApplicationField, string>>;
  message?: string;
}

export const emptyJoinFormState: JoinFormState = {
  status: 'idle', email: '', fields: emptyProfileFields,
};
