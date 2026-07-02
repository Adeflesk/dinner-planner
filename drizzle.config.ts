import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js reads .env.local automatically; the standalone drizzle-kit CLI does not.
// Load .env.local first (real DATABASE_URL lives here), then fall back to .env.
config({ path: '.env.local' });
config();

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
