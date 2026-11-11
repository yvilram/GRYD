# Database schema

User accounts are managed by **Supabase Auth** (`auth.users`). The redundant `public.users` table has been removed. Registration and login were smoke-tested successfully after its removal.

## `user_game_list`

Games each user has added to their list, with a status. `user_id` stores the corresponding Supabase Auth user UUID. The database currently has no foreign-key constraint from this column to `auth.users`.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | Supabase Auth user UUID. Part of the primary key. |
| `id` | `int8` | **IGDB game id** (not an auto-increment row id). Part of the primary key. |
| `game_name` | `text` | Game name, stored as a copy to avoid querying IGDB when listing. |
| `status` | `text` | Game status. Values seen so far: `completed`, `backlog`. |
| `created_at` | `timestamptz` | When the game was added to the list. |

### Relationships

- A game cannot appear twice for the same user (composite primary key: `user_id` + `id`).

## `games`

Central cache for the complete IGDB data used by cards and game detail pages,
plus shared HowLongToBeat data. The SQL setup is in
[create_games.sql](../supabase/create_games.sql).

| Column | Type | Notes |
|--------|------|-------|
| `igdb_game_id` | `int8` | IGDB game ID and primary key. |
| `igdb_data` | `jsonb` | Full IGDB game response, including editions used by the detail page. |
| `details_loaded_at` | `timestamptz` | Non-null when the complete IGDB record has been cached. |
| `hltb_data` | `jsonb` | Complete estimate data returned by Fous/HowLongToBeat. |
| `hltb_main_story_hours` | `numeric` | Main-story estimate in hours, when available. |
| `hltb_fetched_at` | `timestamptz` | Non-null after a successful lookup, including a lookup with no result. |
| `updated_at` | `timestamptz` | Last cache write. |

Explorer and Library cache complete IGDB records when they first encounter a
game. Explorer pages are cached by filter/sort/page for six hours. HLTB is
looked up when a game detail's playtime is requested, then stored in the same
row for future users. The backend uses `SUPABASE_SECRET_KEY` server-side; never
expose it to the frontend.

Related-content entries (expansions, DLC, bundles, editions, ports, remakes,
and remasters) are IGDB games with their own IGDB IDs. Their detail pages reuse
the same `games` cache and `/api/games/:id` route; a separate related-content
table is not needed.

The existing `game_playtime_cache` data is copied into `games` by the SQL
script. Its rows are marked as partial IGDB records and will be completed on
their next access. Keep the old table until the migration is verified; it is
not used by the updated backend.

## `game_missions`

For a new database, apply
[create_game_missions.sql](../supabase/create_game_missions.sql) after
`create_games.sql`. For a database that already has the mission tables, apply
[migrate_game_missions_single_table.sql](../supabase/migrate_game_missions_single_table.sql)
once before deploying the updated backend. The migration copies existing
missions, source configuration and cache metadata into `game_missions`, then
drops the legacy `game_mission_cache` and `game_mission_sources` tables.

Every row belongs to a game and has a `record_type`: `mission`, `source` or
`cache`. Mission rows keep searchable/indexed columns and store the complete
mission payload, article content, media and source attribution in `content`
(`jsonb`). Source configuration and cache timestamps are also JSONB payloads
in the same table. Mission lists are fetched on demand and served from
Supabase on later requests. Failed or empty upstream results are not cached.

Mission data is imported only for games explicitly configured by an
administrator. Add one `record_type = 'source'` row per list page to
`game_missions`; without an enabled source row, the API reports the game as
unsupported and does not search IGDB or contact an external wiki.

Store `page`, `wiki_base_url`, `api_url`, `parse_lists` and `enabled` in
`content`; the existing scalar columns hold the game, category, source name,
license, attribution and ordering. The `category` must be one of `main`,
`side`, `contract`, `gig`, `minor`, `treasure_hunt`, `expansion` or `other`.
URLs must use HTTPS and share the same origin. The license and attribution
must reflect the actual source terms; do not assume all wikis use the same
license. Set `parse_lists` only for list-based mission pages; tables are
parsed by default.

The importer supports standard MediaWiki API parse responses and rendered
`.mw-parser-output` pages containing mission tables or lists. This is not
automatic support for arbitrary wiki platforms; configure only sources with a
compatible MediaWiki API and verified usage terms.

Opening a mission lazily caches sanitized article HTML, its source revision
ID, and media metadata in `game_missions`. Older article formats are re-imported
when opened. Images with a verified Creative Commons or public-domain license
are copied to the public `game-mission-media` Storage bucket; other images and
embedded videos remain external links. Source attribution and license
information are displayed with the mission content.

## `game_catalog_pages`

Stores Explorer result IDs for normalized filter/sort/page combinations so
repeat requests can be served from `games` without querying IGDB.

| Column | Type | Notes |
|--------|------|-------|
| `query_hash` | `text` | SHA-256 hash of normalized Explorer query parameters; primary key. |
| `game_ids` | `int8[]` | Ordered IGDB IDs returned for the page. |
| `cached_at` | `timestamptz` | Page cache time; entries expire after six hours. |

## Security (RLS)

- `user_game_list` has RLS enabled. The verified policy applies to `authenticated` for `ALL` commands, with both `USING` and `WITH CHECK` enforcing that `user_id` matches `auth.uid()`:

```sql
create policy "User manager their own game list"
on public.user_game_list
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

- The backend must forward the signed-in user's access token on database requests. The session-scoped Supabase client does this; do not use the publishable key alone for `user_game_list` queries or replace it with a service-role key.
- `FORCE ROW LEVEL SECURITY` is not enabled. This is expected for ordinary user requests; table owners can bypass RLS, so application requests should continue using the signed-in user's role and access token.

## Account deletion

- The account deletion endpoint explicitly deletes rows from `user_game_list`, all avatar files in the user's `avatars/<auth-user-id>/` folder, and then the Supabase Auth user. The table has no foreign key to `auth.users`, so its rows must be deleted explicitly.
- Deletion requires the current password and the exact confirmation text `DELETE`. It uses `SUPABASE_SECRET_KEY` only on the backend for the administrative delete operations; never expose that key to the frontend.
- The cleanup steps are sequential, not transactional. If a cleanup step fails, the endpoint leaves the Auth account active so the user can retry; earlier cleanup steps may already have succeeded.

## Open decisions

- Allowed values for `status` (currently free text).
- Whether to rename `id` to `game_id` to avoid confusion.
- How to generalize the model for movies, TV series, anime and books (for example, a media type column plus an external id per source).
