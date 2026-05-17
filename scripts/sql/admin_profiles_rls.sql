-- 1. Backfill profiles for any auth users who don't have one yet
--    (preserves existing rows, only fills gaps)
insert into public.profiles (id, email, created_at)
select
  u.id,
  u.email,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 2. RLS policy: allow the admin account to read ALL profiles
--    (the normal policy only allows users to read their own row)
drop policy if exists "admin_read_all_profiles" on public.profiles;
create policy "admin_read_all_profiles"
  on public.profiles
  for select
  to authenticated
  using (
    (select email from auth.users where id = auth.uid()) = 'robin22y@gmail.com'
    or auth.uid() = id
  );
