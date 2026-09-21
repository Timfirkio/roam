-- The catalog is served only by the authenticated area backend. Explicitly
-- deny browser Data API roles, while retaining RLS as defence in depth.
create policy "No direct catalog API access" on osm.import_regions as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.boundaries as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.roads as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.coverage_jobs as restrictive for all to anon, authenticated using (false) with check (false);
