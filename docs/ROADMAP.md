# Roadmap

GRYD is actively evolving as a platform to discover, explore, organize, and
play games.

This roadmap tracks the current state of the project and the main features
planned for future versions.

## Available

### Core application

- [x] Base project structure using HTML, SCSS/CSS, and vanilla JavaScript
- [x] Client-side navigation with shareable routes and browser history support
- [x] Responsive interface with dark and light themes
- [x] Product-focused home page presenting GRYD's main features
- [x] Dedicated Roadmap section inside the application
- [x] Clear success and error feedback across the interface

### Game Explorer

- [x] IGDB game catalog
- [x] Game title search
- [x] Filters by genre, theme, platform, and release year
- [x] Sorting by rating, popularity, and release date
- [x] Active filter indicators and clear actions
- [x] Option to hide games already stored in the user's library
- [x] Shareable game URLs using `#game/<id>/<slug>`
- [x] Full game detail pages
- [x] Covers, screenshots, videos, and related games
- [x] Release and platform information
- [x] Company information
- [x] IGDB aggregate ratings and vote information
- [x] HowLongToBeat estimates
- [x] Cached IGDB and HowLongToBeat data in Supabase

### Personal Library

- [x] Personal game library for authenticated users
- [x] Backlog status
- [x] Playing status
- [x] Paused status
- [x] Completed status
- [x] Dropped status
- [x] Library search
- [x] Filtering by game status
- [x] Sorting by title, date added, and status
- [x] Change library status directly from a game detail page
- [x] Remove games from the library
- [x] Synchronize library state between Explorer, Library, and game details

### Accounts and profiles

- [x] Supabase Auth registration
- [x] Login and logout
- [x] Session handling
- [x] Email updates
- [x] Password updates
- [x] Profile avatar uploads through Supabase Storage
- [x] Circular avatar crop preview
- [x] Account deletion
- [x] Cleanup of saved games and avatars when deleting an account
- [x] Account-only access to profile and library functionality
- [x] Supabase Auth as the user source of truth
- [x] RLS protection for personal library data

### Retro Gaming

- [x] EmulatorJS integration
- [x] Retro game catalog
- [x] Search retro games
- [x] Dynamic platform filters
- [x] Open compatible local ROM files
- [x] Nintendo 64 support
- [x] Super Nintendo support
- [x] Game Boy Advance support
- [x] Sega Genesis support
- [x] Automatic association between ROMs and covers
- [x] Supabase Storage integration for retro assets
- [x] Generic optional S3-compatible storage implementation for larger games
- [x] Ability to enable or disable external retro storage independently

## Beta

### Game Missions

- [x] Missions tab on supported game pages
- [x] Mission lists for supported games
- [x] Individual mission pages
- [x] Mission descriptions and objectives
- [x] Guide pages associated with missions
- [x] Sidebar navigation between mission guides
- [x] Images and videos inside guide content
- [x] Links to related guide content
- [x] Load mission and guide data on demand
- [x] Cache retrieved mission information in Supabase
- [x] Attribution for externally sourced guide content
- [x] Resolve common game-title and slug variations
- [ ] Expand mission coverage across more games
- [ ] Improve matching when external game titles differ from IGDB titles
- [ ] Improve handling of incomplete or unavailable mission data

Game Missions remains in Beta because availability currently varies between
games and coverage is still being expanded.

## In progress

### PlayStation support

- [x] Detect PlayStation CHD files through the retro catalog backend
- [x] Configure the PSX EmulatorJS core
- [x] Generate PS1 catalog entries dynamically
- [x] Associate externally stored games with Supabase covers
- [x] Prototype private S3-compatible