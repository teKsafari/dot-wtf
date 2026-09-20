import { createJiti } from 'jiti';

// Next loads .env files before its config. Validate before dev, build, or start.
const jiti = createJiti(import.meta.url);
await jiti.import('./env.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
