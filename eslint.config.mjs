import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // Timers, geolocation, ResizeObserver and the imperative WebGL bridge are external systems.
      // Their state synchronization is intentional and covered by focused effects/tests.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.artifacts/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'public/textures/**',
    'next-env.d.ts',
  ]),
]);
