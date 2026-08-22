'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getClaims } from '../lib/auth';
import { homeRouteFor } from '../lib/claims';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Role decides the landing page: the platform owner has no store dashboard
    // to go to, and a store user has no business on the platform portal.
    getClaims().then((claims) => router.replace(homeRouteFor(claims)));
  }, [router]);
  return null;
}
