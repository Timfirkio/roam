import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), 'VITE_');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key || url.includes('your-project') || key === 'your-publishable-key') {
  console.error('Android sync stopped: cloud sign-in needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Check the tracked .env or a local override, then rerun corepack pnpm cap:sync.');
  process.exit(1);
}

if (!key.startsWith('sb_publishable_')) {
  console.error('Android sync stopped: VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key. Never bundle a secret or service-role key.');
  process.exit(1);
}

try {
  if (new URL(url).protocol !== 'https:') throw new Error('invalid protocol');
} catch {
  console.error('Android sync stopped: VITE_SUPABASE_URL must be a valid HTTPS URL.');
  process.exit(1);
}
