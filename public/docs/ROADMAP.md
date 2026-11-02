# Roadmap

> Items marked with [?] are guesses based on the project structure. Confirm or edit them.

## Done

- [x] Base project structure (HTML, SCSS/CSS, vanilla JS)
- [x] Supabase project and authentication
- [x] `users` table linked to Supabase Auth
- [x] `user_game_list` table with per-user game statuses (`completed`, `backlog`)
- [x] [?] Game listing in the UI

## In progress

- [ ] [Write here what you are working on right now]

## Next up

- [ ] **Enable RLS on `user_game_list`** and add per-user policies (security priority)
- [ ] Restrict `status` to a fixed set of values
- [ ] Search and catalog with IGDB (keep the IGDB secret on the server, never in the frontend)
- [ ] More statuses (e.g. playing, dropped, wishlist)
- [ ] Ratings and reviews
- [ ] Remove duplicated or leftover files (`indexcopy.html`, `server copy.js`)
- [ ] Optimize large images in `assets/`
- [ ] Check that `.env` is not committed to the repository and rotate keys if it was

## Ideas

- Integrate quests and guides from other websites
- Custom lists and collections shared between users
- Generic data model ("media" instead of "game") before adding new content types
- Expansion to movies, TV series, anime and books
- Import lists from other services
- Recommendations based on the user's library
