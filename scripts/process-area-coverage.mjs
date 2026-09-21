import { PostgisAreaService } from '../server/postgis-area-service.mjs';

const workers = Number(process.argv[2] ?? 2);
const databaseUrl = process.env.AREA_DATABASE_URL;
if (!databaseUrl || !Number.isInteger(workers) || workers < 1 || workers > 4) {
  throw new Error('Usage: AREA_DATABASE_URL=... node scripts/process-area-coverage.mjs [1-4 workers]');
}

const services = Array.from({ length: workers }, () => new PostgisAreaService(databaseUrl));
try {
  console.log(`Processing queued area coverage with ${workers} workers.`);
  await Promise.all(services.map(service => service.run()));
  console.log('All queued area coverage calculations are complete.');
} finally {
  await Promise.all(services.map(service => service.close()));
}
