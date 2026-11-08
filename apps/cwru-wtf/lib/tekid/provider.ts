import 'server-only';

import { discovery, type Configuration } from 'openid-client';

import { getTekidConfig, type TekidConfig } from './config';

// One discovery request per provider and client, reused by every later request.
let cached: { key: string; configuration: Promise<Configuration> } | null = null;

export function getTekidProvider(config: TekidConfig = getTekidConfig()): Promise<Configuration> {
  const key = `${config.endpoint} ${config.appId}`;
  if (cached?.key !== key) {
    const configuration = discovery(new URL(config.endpoint), config.appId, config.appSecret);
    // A failed discovery must not stay cached, or one outage would outlive itself.
    configuration.catch(() => { if (cached?.key === key) cached = null; });
    cached = { key, configuration };
  }

  return cached.configuration;
}
