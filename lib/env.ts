import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  ORTHOGONAL_API_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

const _serverEnv = serverSchema.safeParse(process.env);
if (!_serverEnv.success) {
  const missing = _serverEnv.error.issues
    .map((i) => i.path.join("."))
    .join(", ");
  throw new Error(`Missing required environment variables: ${missing}`);
}

export const serverEnv = _serverEnv.data;

const _clientEnv = clientSchema.safeParse(process.env);
export const clientEnv = _clientEnv.success
  ? _clientEnv.data
  : { NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
