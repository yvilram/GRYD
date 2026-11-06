# Roadmap

## Completed

- [x] Base project structure using HTML, SCSS/CSS, and vanilla JavaScript
- [x] Supabase Auth registration, login, logout, and session handling
- [x] Profile settings for changing email and password
- [x] Profile avatar uploads, updates, and circular crop preview through Supabase Storage
- [x] Account deletion with saved-game and avatar cleanup
- [x] IGDB game catalog with search filters for genre, theme, platform, year, and sort order
- [x] User library with game statuses and status filters
- [x] Account-only access to the profile and library
- [x] Explorer option to hide games already in the user's library
- [x] Decommissioned the redundant `public.users` table; Supabase Auth is the source of truth
- [x] Verified RLS is enabled on `user_game_list`, with an `ALL` policy restricting rows to `auth.uid() = user_id`
- [x] Added personal library search and sorting by title, date added, or status
- [x] Added Explorer title search and catalog-focused sorting by rating, popularity, and release date
- [x] Keep the interface and all user-facing messages in English.
- [x] Show clear success and error feedback for library actions and catalog loading.
- [x] Explain IGDB rating scores, vote counts, and missing ratings in the catalog.
- [x] Improve Explorer search and filters with active-filter chips, clear actions, and retry states.
- [x] Establish shareable game URLs in the form `#game/<id>/<slug>` and support direct navigation.
- [x] Add full game detail pages with media, release information, related games, platforms, and companies.
- [x] Add HowLongToBeat estimates to game detail pages.
- [x] Cache complete IGDB game records and HowLongToBeat estimates in Supabase for reuse across Explorer, Library, and game details.
- [x] Show IGDB aggregate ratings on cards and game detail pages using a 0–10 display scale.
- [x] Serve local image assets and preload the Geist Pixel font.

## Next up

- [ ] Improve the home page as a product landing page using real catalog content.
- [ ] Complete end-to-end testing of email confirmation with production SMTP.

## Later ideas

- [ ] Add personal library statistics, such as games by status and completed games.
- [ ] Add optional play progress and private notes to saved games.
- [ ] Custom lists and collections, such as favorites or co-op games
- [ ] Personalized game recommendations based on the user's library
- [ ] Upcoming releases with platform and date filters
- [ ] Optional read-only sharing of a library, with privacy controls
- [ ] Import a game list from another service
- [ ] Consider a generic media model before expanding beyond games
- [ ] Expand to movies, TV, anime, or books
- [ ] Integrate links to quests and guides from other websites
