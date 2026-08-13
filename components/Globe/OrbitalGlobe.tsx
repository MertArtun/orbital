'use client';

import dynamic from 'next/dynamic';

import { GlobeLoading } from '@/components/Globe/GlobeLoading';

export const OrbitalGlobe = dynamic(
  () => import('@/components/Globe/GlobeScene').then((module) => module.GlobeScene),
  { ssr: false, loading: () => <GlobeLoading /> },
);
