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

## `game_playtime_cache`

Stores HowLongToBeat estimates, keyed by IGDB game ID so all users share the same cached result.

| Column | Type | Notes |
|--------|------|-------|
| `igdb_game_id` | `int8` | IGDB game ID and primary key. |
| `game_name` | `text` | Canonical game name returned by IGDB. |
| `main_story_hours` | `numeric` | Main-story estimate in hours, when available. |
| `hltb_data` | `jsonb` | Complete estimate data returned by Fous. |
| `fetched_at` | `timestamptz` | When the estimate was fetched or updated. |

The backend checks this table before querying IGDB and Fous. It uses `SUPABASE_SECRET_KEY` server-side to access the cache; do not expose that key to the frontend.

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
