-- Central cache for IGDB game details and HowLongToBeat estimates.
create table if not exists public.games (
    igdb_game_id bigint primary key,
    igdb_data jsonb not null,
    details_loaded_at timestamptz,
    hltb_data jsonb,
    hltb_main_story_hours numeric,
    hltb_fetched_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;
grant all on public.games to service_role;

-- A result-page cache lets Explorer serve previously requested filter/page
-- combinations from Supabase without repeating the IGDB catalog query.
create table if not exists public.game_catalog_pages (
    query_hash text primary key,
    game_ids bigint[] not null,
    cached_at timestamptz not null default now()
);

alter table public.game_catalog_pages enable row level security;
revoke all on public.game_catalog_pages from anon, authenticated;
grant all on public.game_catalog_pages to service_role;

-- Preserve existing playtime data. The partial IGDB object is marked as not
-- fully loaded so the application fetches complete details on its next access.
insert into public.games as cached_game (
    igdb_game_id,
    igdb_data,
    hltb_data,
    hltb_main_story_hours,
    hltb_fetched_at
)
select
    igdb_game_id,
    jsonb_build_object('id', igdb_game_id, 'name', game_name),
    hltb_data,
    main_story_hours,
    fetched_at
from public.game_playtime_cache
on conflict (igdb_game_id) do update
set
    hltb_data = coalesce(cached_game.hltb_data, excluded.hltb_data),
    hltb_main_story_hours = coalesce(
        cached_game.hltb_main_story_hours,
        excluded.hltb_main_story_hours
    ),
    hltb_fetched_at = coalesce(
        cached_game.hltb_fetched_at,
        excluded.hltb_fetched_at
    );
