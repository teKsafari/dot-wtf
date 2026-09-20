import { createApplicationEnv } from './lib/env-schema';

// The runtime loads .env files; this module only validates and types the values.
export const env = createApplicationEnv(process.env);
