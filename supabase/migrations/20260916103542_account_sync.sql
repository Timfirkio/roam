-- Roam account, ride-history, and progress-sync schema (applied to Supabase).
-- Run through the Supabase CLI or SQL Editor before enabling cloud sync.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  avatar_path text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discoveries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  segment_id text not null,
  region_id text,
  region_name text,
  road_type text not null check (road_type in ('paved-road', 'cycleway', 'unpaved-path')),
  geometry jsonb not null,
  length_meters integer not null check (length_meters >= 0),
  discovered_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, segment_id)
);

create table public.ride_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  district_names text[] not null default '{}',
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  distance_meters double precision not null check (distance_meters >= 0),
  new_distance_meters double precision not null check (new_distance_meters >= 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.ride_session_points (
  session_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision not null check (accuracy >= 0),
  recorded_at timestamptz not null,
  speed double precision,
  bearing double precision,
  primary key (session_id, sequence),
  foreign key (session_id, user_id) references public.ride_sessions(id, user_id) on delete cascade
);

create index discoveries_user_id_idx on public.discoveries(user_id);
create index ride_sessions_user_started_at_idx on public.ride_sessions(user_id, started_at desc);
create index ride_session_points_session_id_idx on public.ride_session_points(session_id, sequence);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.discoveries enable row level security;
alter table public.ride_sessions enable row level security;
alter table public.ride_session_points enable row level security;

grant select, insert, update, delete on public.profiles, public.discoveries, public.ride_sessions, public.ride_session_points to authenticated;
revoke all on public.profiles, public.discoveries, public.ride_sessions, public.ride_session_points from anon;

create policy "Players manage their own profile" on public.profiles
  for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Players manage their own discoveries" on public.discoveries
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Players manage their own rides" on public.ride_sessions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Players manage their own ride points" on public.ride_session_points
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "Players manage their own avatars" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
