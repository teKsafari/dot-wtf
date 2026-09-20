import { loadEnvConfig } from '@next/env';

// CLI entry points load the same .env files as Next before importing app modules.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
