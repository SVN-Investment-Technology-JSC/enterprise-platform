import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadServerSession, rootDestination, type ServerSession } from './_components/server-session';

/** Trang gốc: đã đăng nhập thì về trang chính (dashboard tenant hoặc Platform), chưa thì về đăng nhập. */
export default async function RootPage() {
  const store = await cookies();
  const session: ServerSession = store.has('ep_access')
    ? await loadServerSession(store.toString())
    : { status: 'unauthenticated' };
  redirect(rootDestination(session));
}
