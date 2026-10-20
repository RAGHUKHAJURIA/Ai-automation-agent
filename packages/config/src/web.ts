import { z } from 'zod';

const webConfigSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://localhost:3001'),
});

export type WebConfig = z.infer<typeof webConfigSchema>;

export function parseWebConfig(environment: Record<string, unknown>): WebConfig {
  const result = webConfigSchema.safeParse(environment);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid web configuration: ${issues.join('; ')}`);
  }
  return result.data;
}
