-- Keep the auth-user trigger privileged but unreachable through the Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Cover both foreign-key checks and account-scoped sync queries.
create index ride_session_points_session_user_idx on public.ride_session_points(session_id, user_id);
create index ride_session_points_user_id_idx on public.ride_session_points(user_id);
