# GRYD

A **Letterboxd / Trakt-style app for video games**: a single place to catalog, organize and get oriented in games without having to check several websites.

> Status: in development.

## Idea

- Unify external APIs, starting with **IGDB**, to catalog games.
- Let each user organize their games (lists, statuses, ratings).
- Integrate content from other websites, such as quests and guides.
- Expand in the future to **movies, TV series, anime and books**, so the data model should be generic ("media" rather than "game").

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS (SCSS source) and vanilla JavaScript |
| Backend | Node.js (`server.js`) |
| Deployment | Cloudflare (`worker.mjs`, `wrangler.jsonc`) |
| Auth and database | Supabase |
| Game data | IGDB |

## Project structure

```
GRYD/
├── index.html          # Main page
├── server.js           # Node server
├── worker.mjs          # Cloudflare Worker
├── wrangler.jsonc      # Cloudflare configuration
├── package.json
├── assets/             # Images (background, default cover)
├── css/
│   ├── auth.scss
│   ├── games_container.scss
│   └── styles.scss     # .css and .css.map files are generated on compile
└── js/
    ├── api.js          # API calls
    ├── auth.js         # Sign up and login
    ├── config.js       # Client configuration
    ├── games.js        # Game listing and logic
    ├── game_state.js   # User game state
    └── supabase.js     # Supabase client
```

## Getting started

### Requirements

- Node.js [version]
- A Supabase account and project
- IGDB API credentials (Twitch Developers)

### Installation

```bash
git clone [repository URL]
cd GRYD
npm install
```

### Environment variables

Create a `.env` file in the project root. **Never commit it to the repository.**

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
```

> Adjust the names to match what your code actually uses. Secret keys (such as Supabase's `service_role` or the IGDB secret) must only be used on the server, never in the frontend.

### Running

```bash
npm start
```

> Check the actual command in the `scripts` section of `package.json`.

## Roadmap

- [x] Base project structure
- [x] Authentication with Supabase
- [ ] Search and catalog with IGDB
- [ ] Per-user lists and game statuses (playing, backlog, completed)
- [ ] Ratings and reviews
- [ ] Integration of quests and guides from other websites
- [ ] Expansion to movies, TV series, anime and books

> Tick what you have already done and adjust the order to your plan.

## License

[To be decided]
