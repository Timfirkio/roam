-- The catalog migration also defends against Supabase's PostgREST roles. This
-- standalone Postgres deployment has no PostgREST process, but defining these
-- inert no-login roles lets the same schema migration run unchanged.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;
