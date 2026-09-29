import { createJiti } from 'jiti';

// Next loads .env files before its config. Validate before dev, build, or start.
const jiti = createJiti(import.meta.url);
await jiti.import('./env.ts');

const canonicalOrigin = 'https://dott.wtf';
const redirectHosts = ['cwru.wtf', 'www.cwru.wtf', 'www.dott.wtf'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  redirects() {
    return [
      ...redirectHosts.map((host) => ({
        source: '/:path*',
        has: [{ type: 'host', value: host }],
        destination: `${canonicalOrigin}/:path*`,
        permanent: true,
      })),
      { source: '/test-profile', destination: '/profile', permanent: true },
    ]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
