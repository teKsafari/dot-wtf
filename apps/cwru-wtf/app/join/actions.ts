'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { ApplicationError, applicationFieldsFromFormData } from '@/lib/applications';
import { applicationHoneypotField } from '@/lib/application-fields';
import { getApplicationService } from '@/lib/applications-server';
import { clientAddress } from '@/lib/rate-limit';
import { emptyProfileFields } from '@/lib/member-profile-fields';
import type { JoinFormState } from './state';

export async function submitApplication(
  _previous: JoinFormState,
  formData: FormData
): Promise<JoinFormState> {
  const fields = applicationFieldsFromFormData(formData);
  const email = typeof formData.get('email') === 'string' ? (formData.get('email') as string) : '';

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
