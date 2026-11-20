# Database schema

GRYD uses Supabase PostgreSQL for application data and caching, Supabase Auth
for user identities, and Supabase Storage for avatars and selected media
assets.

User accounts are managed exclusively by **Supabase Auth** (`auth.users`).
The former redundant `public.users` table has been removed.

## `user_game_list`

Stores the games each authenticated user has added to their personal library.

`user_id` contains the Supabase Auth user UUID. The table currently has no
foreign-key constraint from this column to `auth.users`.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | Supabase Auth user UUID. Part of the composite primary key. |
| `id` | `int8` | IGDB game ID. Part of the composite primary key. |
| `game_name` | `text` | Cached game name so basic library operations do not require an IGDB lookup. |
| `status` | `text` | Current library status. |
| `created_at` | `timestamptz` | Time the game was added to the user's library. |

### Library statuses

The application currently uses these status values:

```text
backlog
play
pause
completed
drop
```

They correspond to the following user-facing labels:

| Stored value | Display label |
|---|---|
| `backlog` | Backlog |
| `play` | Playing |
| `pause` | Paused |
| `completed` | Completed |
| `drop` | Dropped |

`status` is currently stored as free text. Validation is therefore performed
by the application rather than through a PostgreSQL enum or CHECK constraint.

### Relationships

The composite primary key is:

```text
user_id + id
```

This guarantees that the same IGDB game cannot appear more than once in a
single user's library.

The same IGDB game can appear in the libraries of multiple users.

## `games`

Central cache for IGDB game information and shared HowLongToBeat data.

The SQL setup is defined in:

```text
supabase/create_games.sql
```

| Column | Type | Notes |
|---|---|---|
| `igdb_game_id` | `int8` | IGDB game ID and primary key. |
| `igdb_data` | `jsonb` | Cached IGDB game response used by cards and detailed game views. |
| `details_loaded_at` | `timestamptz` | Set when a complete IGDB record has been cached. |
| `hltb_data` | `jsonb` | Complete estimate data returned by Fous/HowLongToBeat. |
| `hltb_main_story_hours` | `numeric` | Main-story estimate in hours when available. |
| `hltb_fetched_at` | `timestamptz` | Set after a HowLongToBeat lookup, including successful lookups without a matching result. |
| `updated_at` | `timestamptz` | Time of the most recent cache write. |

### IGDB caching

Explorer and Library cache complete IGDB records when games are encountered.

Game detail pages reuse the same records whenever possible instead of
performing another IGDB request.

Related content such as:

- expansions
- DLC
- bundles
- editions
- ports
- remakes
- remasters

is represented by normal IGDB games with their own IGDB IDs.

Consequently, related content uses the same:

```text
games
```

table and:

```text
/api/games/:id
```

route.

A separate related-content table is not required.

### HowLongToBeat caching

HowLongToBeat information is requested when playtime information is needed for
a game detail page.

The result is stored in the corresponding `games` row so future users can
reuse the cached information.

A completed lookup with no matching HowLongToBeat result is also recorded to
avoid repeatedly requesting the same unavailable data.

### Legacy playtime cache

Existing data from the former:

```text
game_playtime_cache
```

table can be migrated into `games` by the database setup script.

Migrated rows may initially contain partial IGDB records and are completed the
next time the corresponding game is requested.

The old table is not used by the current backend after migration and should
only be retained until the migration has been verified.

## `game_catalog_pages`

Caches Explorer result pages for normalized combinations of filters, sorting,
and pagination.

This allows repeated Explorer queries to reconstruct results from the `games`
cache without querying IGDB again.

| Column | Type | Notes |
|---|---|---|
| `query_hash` | `text` | SHA-256 hash of the normalized Explorer query parameters. Primary key. |
| `game_ids` | `int8[]` | Ordered list of IGDB IDs returned for the cached page. |
| `cached_at` | `timestamptz` | Time at which the Explorer page was cached. |

Explorer page-cache entries currently expire after:

```text
6 hours
```

After expiration, the associated query can be refreshed from IGDB.

## `game_missions`

Stores Game Missions data, source configuration, imported article content,
media metadata, and cache information.

Game Missions is currently a **Beta** feature because coverage varies between
games and sources.

For a new database, apply:

```text
supabase/create_game_missions.sql
```

after:

```text
supabase/create_games.sql
```

For an existing database using the previous mission schema, apply:

```text
supabase/migrate_game_missions_single_table.sql
```

once before deploying the updated backend.

The migration consolidates the previous mission tables into `game_missions`
and removes the legacy:

```text
game_mission_cache
game_mission_sources
```

tables.

### Record types

Every row belongs to a game and uses a `record_type`.

Supported types are:

```text
mission
source
cache
```

#### `mission`

Represents an individual mission and its imported content.

Mission rows retain searchable/indexed scalar values while the complete
mission payload is stored in:

```text
content jsonb
```

The JSON payload can contain:

- mission information
- sanitized article content
- guide-page information
- media metadata
- source revision information
- attribution metadata

#### `source`

Defines an external source from which mission information may be imported.

Mission data is imported only for games with an explicitly configured and
enabled source.

Without an enabled source record, the API considers the game unsupported and
does not attempt an external mission-content request.

Source-specific configuration is stored in `content`.

Relevant configuration can include:

```text
page
wiki_base_url
api_url
parse_lists
enabled
```

URLs must use HTTPS and configured source URLs must be compatible with the
source validation performed by the backend.

Source attribution and licensing information must represent the actual source
terms.

No common license should be assumed across different external sources.

#### `cache`

Stores cache-related information associated with mission imports.

This allows the backend to determine whether previously imported information
can be reused.

Failed or empty upstream results are not permanently cached as valid mission
content.

### Mission categories

Mission categories currently supported by the importer include:

```text
main
side
contract
gig
minor
treasure_hunt
expansion
other
```

### Mission loading

Mission lists are loaded on demand.

The backend first checks Supabase. If the information has already been
imported, the cached data is returned.

Mission article and guide content is also loaded lazily when requested.

This prevents GRYD from importing complete guide content for games and
missions that users never open.

### Supported source format

The importer supports compatible MediaWiki sources, including API parse
responses and rendered `.mw-parser-output` content containing supported
mission tables or lists.

This does not imply automatic compatibility with arbitrary wiki platforms.

External resources should only be configured after verifying:

- source compatibility
- attribution requirements
- licensing requirements
- URL structure
- content format

### Mission media

Mission content can include images and embedded videos.

Images with verified compatible licensing may be copied to the public
Supabase Storage bucket:

```text
game-mission-media
```

Other media remains referenced through its external source.

Source attribution and license information are displayed alongside mission
content where required.

## Storage

Database tables and Supabase Storage serve different purposes within GRYD.

### `avatars`

User profile images are stored under a user-specific path:

```text
avatars/<auth-user-id>/
```

Account deletion removes the user's avatar files before deleting the
Supabase Auth account.

### `game-mission-media`

Contains mission-related media that GRYD is permitted to store directly.

Only media whose usage terms have been verified should be copied into this
bucket.

### `retro-gaming`

Contains public assets used by the Retro Games feature, including EmulatorJS
files, supported ROMs stored in Supabase, and game covers.

A typical structure is:

```text
retro-gaming/
├── emulatorjs/
│   └── data/
├── roms/
└── cover/
```

Large retro games may use the optional external S3-compatible storage
implementation instead.

External S3 storage does not introduce additional PostgreSQL tables and is
therefore configured independently from this database schema.

## Security

### Row Level Security

`user_game_list` has Row Level Security enabled.

The verified policy applies to authenticated users for all commands and
requires `user_id` to match the current Supabase Auth user:

```sql
create policy "User manager their own game list"
on public.user_game_list
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

This prevents one authenticated user from accessing or modifying another
user's personal library through normal application requests.

### Session-scoped requests

Database operations involving `user_game_list` must use the authenticated
user's access token.

The backend creates a session-scoped Supabase client for these requests.

Do not replace the user's authenticated context with the administrative
secret when performing ordinary personal-library operations because doing so
would bypass the intended RLS protection.

### Administrative credentials

The backend uses:

```text
SUPABASE_SECRET_KEY
```

only for server-side operations requiring elevated permissions.

It must never be exposed to:

- frontend JavaScript
- HTML
- public configuration
- Git
- browser network responses

`FORCE ROW LEVEL SECURITY` is not currently enabled.

Table owners and administrative database roles can therefore bypass RLS, which
is why ordinary application requests must continue using the signed-in user's
role and access token.

## Account deletion

Account deletion performs explicit cleanup because `user_game_list.user_id`
does not currently have a foreign-key relationship with `auth.users`.

The deletion process removes:

1. Rows belonging to the user from `user_game_list`.
2. Avatar files under:

   ```text
   avatars/<auth-user-id>/
   ```

3. The Supabase Auth user.

Deletion requires:

- the user's current password
- the exact confirmation text `DELETE`

Administrative deletion operations use `SUPABASE_SECRET_KEY` exclusively on
the backend.

The cleanup sequence is not transactional across PostgreSQL, Storage, and
Supabase Auth.

If a cleanup operation fails, the Auth account remains active so the user can
retry. Operations completed before the failure may already have taken effect.

## Cache overview

GRYD currently uses several persistent caching mechanisms:

| Cache | Purpose | Scope |
|---|---|---|
| `games` | IGDB records and HowLongToBeat estimates | Shared |
| `game_catalog_pages` | Explorer query result IDs | Shared |
| `game_missions` | Mission, guide, source, and mission-cache data | Shared |

These caches are shared between users where the underlying information is not
user-specific.

Personal library data is never part of the shared cache.

## Open decisions

### Library status constraint

`user_game_list.status` is currently free text.

The application currently expects:

```text
backlog
play
pause
completed
drop
```

A future migration may enforce these values with either:

- a PostgreSQL `CHECK` constraint, or
- a PostgreSQL enum.

A `CHECK` constraint would be simpler to evolve if additional statuses are
introduced later.

### `id` naming

`user_game_list.id` represents an IGDB game ID rather than an internal row ID.

Renaming it to:

```text
game_id
```

or:

```text
igdb_game_id
```

would make its meaning clearer and align it with `games.igdb_game_id`.

Such a change requires a database migration and corresponding backend updates.

### User relationship

`user_game_list.user_id` currently stores the Supabase Auth UUID without a
foreign-key constraint to `auth.users`.

The explicit cleanup behavior should be reconsidered if a supported
foreign-key/cascade strategy is adopted later.

### Library Insights

Planned Library Insights should initially be calculated from
`user_game_list` rather than persisted in a separate statistics table.

Examples include:

- backlog count
- playing count
- completed count
- total library size

A dedicated aggregate table is unnecessary unless performance measurements
later justify one.

### Public profiles

Planned public profiles will require deciding which profile information should
exist outside `auth.users`.

If profile metadata becomes publicly queryable, a dedicated public profile
table may be appropriate rather than exposing Auth data.

Privacy rules and RLS policies must be defined before public profiles are
implemented.

### Other media types

GRYD is currently game-focused.

Supporting movies, television, anime, books, or other media would require a
more generic identity model instead of assuming every content ID is an IGDB
game ID.

This remains a future architectural decision rather than part of the current
schema.