'use server';

import { signOut } from '@logto/next/server-actions';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import {
  profileFieldNames,
  applicationFieldsSchema,
  profileFieldsFromFormData,
  profileFieldsSchema,
  type ProfileFormState,
} from '@/lib/member-profile-fields';
import { ProfileSubmissionError, saveMemberProfile } from '@/lib/member-profiles';
import {
  getTekidConfig,
  tekidProfilePath,
} from '@/lib/tekid/config';
import { getTekidAuthContext } from '@/lib/tekid/server';
import { beginTekidSignIn } from '@/lib/tekid/sign-in';

export async function signInWithTekid(): Promise<void> {
  await beginTekidSignIn(tekidProfilePath);
}

export async function signOutFromTekid(): Promise<void> {
  const config = getTekidConfig();

  try {
    await signOut(config, new URL(tekidProfilePath, config.baseUrl).href);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-out`);
  }
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
      message: 'Your tekID session has ended. Sign in again, then save your profile.',
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
