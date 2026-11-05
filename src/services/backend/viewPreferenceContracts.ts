import { z } from 'zod';

export const viewPreferencesSchema = z.object({ values: z.record(z.string(), z.string()) });
export const viewPreferenceSchema = z.object({
  key: z.string(), value: z.string(), updatedAt: z.string().datetime({ offset: true }),
});
