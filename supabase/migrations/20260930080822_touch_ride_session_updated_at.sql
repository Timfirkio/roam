-- Incremental sync needs a server-authored timestamp for every ride edit,
-- including renames, route repairs, and explicit deletions.
create or replace function public.touch_ride_session_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_ride_session_updated_at
before update on public.ride_sessions
for each row execute function public.touch_ride_session_updated_at();
