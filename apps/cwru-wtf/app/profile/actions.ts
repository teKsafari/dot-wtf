'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { applicationHoneypotField } from '@/lib/application-fields';
import { ApplicationError } from '@/lib/applications';
import { getApplicationService } from '@/lib/applications-server';
import { clientAddress } from '@/lib/rate-limit';
import {
  emptyProfileFields,
  profileFieldNames,
  applicationFieldsSchema,
  profileFieldsFromFormData,
  profileFieldsSchema,
  type ProfileFormState,
} from '@/lib/member-profile-fields';
import { ProfileSubmissionError, saveMemberProfile } from '@/lib/member-profiles';
import { tekidProfilePath } from '@/lib/tekid/config';
import { getTekidAuthContext } from '@/lib/tekid/server';
import { beginTekidSignIn } from '@/lib/tekid/sign-in';
import { endTekidSession } from '@/lib/tekid/sign-out';

export async function signInWithTekid(): Promise<void> {
  await beginTekidSignIn(tekidProfilePath);
}

export async function signOutFromTekid(): Promise<void> {
  await endTekidSession(tekidProfilePath);
}

export async function saveProfile(
  _previous: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const submitted = profileFieldsFromFormData(formData);
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'save';

  let auth;
  try {
    auth = await getTekidAuthContext();
  } catch (error) {
    unstable_rethrow(error);
    auth = null;
  }
  // The signed-in member can only ever write their own profile.
  if (!auth?.isAuthenticated) {
    return {
      status: 'error',
      fields: submitted,
      message: 'Your session has ended. Sign in again, then save your profile.',
    };
  }

  const result = (intent === 'submit' ? applicationFieldsSchema : profileFieldsSchema).safeParse(submitted);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      status: 'invalid',
      fields: submitted,
      errors: Object.fromEntries(
        profileFieldNames.flatMap((name) => fieldErrors[name]?.[0] ? [[name, fieldErrors[name][0]]] : [])
      ),
      message: 'Check the highlighted fields.',
    };
  }

  try {
    const profile = await saveMemberProfile(auth.claims, result.data, intent);
    revalidatePath('/profile');
    revalidatePath('/members');
    revalidatePath('/admin');
    return {
      status: 'saved', fields: profile.fields,
      applicationStatus: profile.status, memberNumber: profile.memberNumber,
      message: intent === 'submit' && profile.status === 'pending'
        ? 'Application submitted. An admin will review your profile.' : 'Profile saved.',
    };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ProfileSubmissionError) {
      return { status: 'error', fields: submitted, message: error.message };
    }
    console.error('Unable to save a member profile');
    return { status: 'error', fields: submitted, message: 'We couldn’t save your profile. Please try again.' };
  }
}

// The same form, filled in by somebody with no account. Membership is the
// output of review, so this path signs nobody in: it records a pending
// application and an admin mints the Club ID when they approve it.
export async function submitApplication(
  _previous: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const fields = profileFieldsFromFormData(formData);
  const submittedEmail = formData.get('email');
  const email = typeof submittedEmail === 'string' ? submittedEmail : '';

  try {
    await getApplicationService().submit({
      email,
      fields,
      photo: formData.get('photo'),
      honeypot: formData.get(applicationHoneypotField),
      clientAddress: clientAddress(await headers()),
    });
    revalidatePath('/admin');
    return { status: 'submitted', email: '', fields: emptyProfileFields };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApplicationError) {
      // A filled honeypot is answered like a success, so a script learns nothing.
      if (error.status === 400 && Object.keys(error.errors).length === 0) {
        return { status: 'submitted', email: '', fields: emptyProfileFields };
      }
      return {
        status: error.status === 400 ? 'invalid' : 'error',
        email, fields, errors: error.errors, message: error.message,
      };
    }
    console.error('Unable to record a membership application');
    return { status: 'error', email, fields, message: 'We couldn’t save your application. Please try again.' };
  }
}
