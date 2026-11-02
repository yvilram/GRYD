# Database schema (Supabase, `public` schema)

Users are managed by **Supabase Auth** (`auth.users`). The `public.users` table is our own copy, used to store the email and a reference for the logged-in user.

## `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | Primary key. Same id as the user in `auth.users`. |
| `email` | `varchar` | User's email address. |

## `user_game_list`

Games each user has added to their list, with a status.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | Reference to the user (foreign key). Part of the primary key. |
| `id` | `int8` | **IGDB game id** (not an auto-increment row id). Part of the primary key. |
| `game_name` | `text` | Game name, stored as a copy to avoid querying IGDB when listing. |
| `status` | `text` | Game status. Values seen so far: `completed`, `backlog`. |
| `created_at` | `timestamptz` | When the game was added to the list. |

### Relationships

- `user_game_list.user_id` → `users.id` (one user has many games in their list).
- A game cannot appear twice for the same user (composite primary key: `user_id` + `id`).

## Security (RLS)

- `user_game_list`: **RLS disabled** (shown as *UNRESTRICTED* in Supabase). Must be fixed: with RLS enabled, each user should only read and write rows where `user_id` equals their own id.
- `users`: RLS appears to be enabled; needs confirming.

## Open decisions

- Allowed values for `status` (currently free text).
- Whether to rename `id` to `game_id` to avoid confusion.
- How to generalize the model for movies, TV series, anime and books (for example, a media type column plus an external id per source).
