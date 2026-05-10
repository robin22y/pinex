-- Run this in Supabase SQL Editor (or psql) before `populate_sectors.py`
-- if the `industry` column does not exist yet.

alter table public.companies
  add column if not exists industry text;

comment on column public.companies.industry is 'Coarse industry within sector (from populate_sectors mapping).';
