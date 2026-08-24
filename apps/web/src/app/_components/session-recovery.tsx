'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { principalHome, restoreAuthenticatedSession } from './auth-session';

export function SessionRecovery() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    async function redirectAuthenticatedUser() {
      const principal = await restoreAuthenticatedSession();
      if (!active || !principal) return;
      router.replace(principalHome(principal));
      router.refresh();
    }

    void redirectAuthenticatedUser();
    const restoreFromBackForwardCache = (event: PageTransitionEvent) => {
      if (event.persisted) void redirectAuthenticatedUser();
    };
    window.addEventListener('pageshow', restoreFromBackForwardCache);
    return () => {
      active = false;
      window.removeEventListener('pageshow', restoreFromBackForwardCache);
    };
  }, [router]);

  return null;
}
