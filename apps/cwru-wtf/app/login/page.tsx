import { redirect } from 'next/navigation';

export default function LoginPage() {
  redirect('/api/tekid/sign-in?returnTo=/admin');
}
