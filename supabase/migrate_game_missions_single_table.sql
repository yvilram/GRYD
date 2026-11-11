begin;

alter table public.game_missions
    add column if not exists record_type text not null default 'mission';
alter table public.game_missions
    add column if not exists content jsonb not null default '{}'::jsonb;
alter table public.game_missions
    add column if not exists article_content text;
alter table public.game_missions
    add column if not exists article_format text not null default 'text';
alter table public.game_missions
    add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.game_missions
    add column if not exists content_fetched_at timestamptz;
alter table public.game_missions
    add column if not exists content_revision_id bigint;

update public.game_missions
set record_type = 'mission'
where record_type is null;
-- Recognize source/cache rows created by the earlier single-table draft.
update public.game_missions
set record_type = 'source'
where record_type = 'mission'
    and content ? 'wiki_base_url'
    and content ? 'page';
update public.game_missions
set record_type = 'cache'
where record_type = 'mission'
    and content ? 'fetched_at';
alter table public.game_missions
    alter column record_type set default 'mission',
    alter column record_type set not null;
update public.game_missions
set content = case
    when content is null then '{}'::jsonb
    when jsonb_typeof(content) = 'object' then content
    else jsonb_build_object('legacy_value', content)
end;

update public.game_missions
set content = coalesce(content, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'title', title,
    'category', category,
    'group_name', group_name,
    'description', description,
    'mission_url', mission_url,
    'links', jsonb_build_array(
        jsonb_build_object('rel', 'mission', 'url', mission_url),
        jsonb_build_object('rel', 'source', 'url', source_page_url)
    ),
    'source', jsonb_build_object(
        'name', source_name,
        'page_url', source_page_url,
        'license', source_license,
        'attribution', attribution
    ),
    'article_content', article_content,
    'article_format', article_format,
    'media', coalesce(media, '[]'::jsonb),
    'content_fetched_at', content_fetched_at,
    'content_revision_id', content_revision_id
))
where record_type = 'mission';
alter table public.game_missions
    alter column content set default '{}'::jsonb,
    alter column content set not null;

alter table public.game_missions
    drop constraint if exists game_missions_source_url_unique;
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.game_missions'::regclass
            and conname = 'game_missions_record_type_check'
    ) then
        alter table public.game_missions
            add constraint game_missions_record_type_check
            check (record_type in ('mission', 'source', 'cache'));
    end if;
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.game_missions'::regclass
            and conname = 'game_missions_content_object_check'
    ) then
        alter table public.game_missions
            add constraint game_missions_content_object_check
            check (jsonb_typeof(content) = 'object');
    end if;
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.game_missions'::regclass
            and conname = 'game_missions_record_source_url_unique'
    ) then
        alter table public.game_missions
            add constraint game_missions_record_source_url_unique
            unique (igdb_game_id, record_type, source_name, mission_url);
    end if;
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array['game_mission_sources', 'game_mission_source']
    loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format($query$
                insert into public.game_missions as current_mission (
                    igdb_game_id, record_type, category, title, mission_url,
                    source_name, source_page_url, source_license, attribution,
                    sort_order, content
                )
                select
                    igdb_game_id,
                    'source',
                    category,
                    page,
                    wiki_base_url || '/wiki/' || replace(page, ' ', '_'),
                    source_name,
                    wiki_base_url,
                    source_license,
                    attribution,
                    sort_order,
                    jsonb_build_object(
                        'wiki_base_url', wiki_base_url,
                        'api_url', api_url,
                        'page', page,
                        'group_name', group_name,
                        'parse_lists', parse_lists,
                        'enabled', enabled,
                        'sort_order', sort_order
                    )
                from public.%I
                on conflict (igdb_game_id, record_type, source_name, mission_url)
                do update set
                    category = excluded.category,
                    title = excluded.title,
                    source_page_url = excluded.source_page_url,
                    source_license = excluded.source_license,
                    attribution = excluded.attribution,
                    sort_order = excluded.sort_order,
                    content = current_mission.content || excluded.content
            $query$, table_name);
        end if;
    end loop;

    foreach table_name in array array['game_mission_cache', 'game_missions_cache']
    loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format($query$
                insert into public.game_missions as current_mission (
                    igdb_game_id, record_type, category, title, mission_url,
                    source_name, source_page_url, source_license, attribution,
                    content
                )
                select
                    igdb_game_id,
                    'cache',
                    'other',
                    source_name,
                    source_page_url,
                    source_name,
                    source_page_url,
                    source_license,
                    attribution,
                    jsonb_build_object('fetched_at', fetched_at)
                from public.%I
                on conflict (igdb_game_id, record_type, source_name, mission_url)
                do update set
                    source_page_url = excluded.source_page_url,
                    source_license = excluded.source_license,
                    attribution = excluded.attribution,
                    content = current_mission.content || excluded.content
            $query$, table_name);
        end if;
    end loop;
end;
$$;

drop table if exists public.game_mission_sources;
drop table if exists public.game_mission_source;
drop table if exists public.game_mission_cache;
drop table if exists public.game_missions_cache;

create index if not exists game_missions_game_type_category_order_idx
    on public.game_missions (igdb_game_id, record_type, category, sort_order);

alter table public.game_missions enable row level security;
revoke all on public.game_missions from anon, authenticated;
grant all on public.game_missions to service_role;

commit;
