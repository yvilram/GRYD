const GAME_DETAILS_FIELDS = [
    "id", "name", "slug", "summary", "storyline", "first_release_date",
    "cover.image_id", "screenshots.image_id", "artworks.image_id",
    "videos.name", "videos.video_id",
    "total_rating", "total_rating_count",
    "genres", "genres.name", "game_modes.name", "themes", "themes.name",
    "player_perspectives.name", "franchises.name", "collections.name",
    "game_engines.name", "parent_game.name",
    "expansions.id", "expansions.name", "expansions.cover.image_id",
    "dlcs.id", "dlcs.name", "dlcs.cover.image_id",
    "bundles.id", "bundles.name", "bundles.cover.image_id",
    "standalone_expansions.id", "standalone_expansions.name",
    "standalone_expansions.cover.image_id",
    "ports.id", "ports.name", "ports.cover.image_id",
    "remakes.id", "remakes.name", "remakes.cover.image_id",
    "remasters.id", "remasters.name", "remasters.cover.image_id",
    "platforms", "platforms.name", "platforms.platform_logo.image_id",
    "release_dates.date", "release_dates.human",
    "release_dates.region", "release_dates.status.name",
    "release_dates.platform.name",
    "involved_companies.company.name", "involved_companies.developer",
    "involved_companies.publisher", "involved_companies.supporting"
].join(", ");

module.exports = { GAME_DETAILS_FIELDS };
