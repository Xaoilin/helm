import { createPrayerProviderHandler } from './handler.ts';

Deno.serve(createPrayerProviderHandler(Deno.env.get('PRAYER_PROVIDER_PROXY_TOKEN') || ''));
