const { GAME_DETAILS_FIELDS } = require("../constants/igdb-fields");

const GAME_COLUMNS =
    "igdb_game_id, igdb_data, details_loaded_at, hltb_data, hltb_main_story_hours, hltb_fetched_at";
const IGDB_BATCH_SIZE = 50;

const getRowsByIds = async (supabase, ids) => {
    if (!ids.length) return new Map();

    const { data, error } = await supabase
        .from("games")
        .select(GAME_COLUMNS)
        .in("igdb_game_id", ids);
    if (error) throw error;

    return new Map(data.map(row => [Number(row.igdb_game_id), row]));
};

const loadGameVersions = async (requestIgdb, games) => {
    if (!games.length) return games;

    const ids = games.map(game => Number(game.id));
    const versions = await requestIgdb(
        "game_versions",
        `
        fields game, games.id, games.name, games.cover.image_id;
        where game = (${ids.join(",")});
        limit 500;
        `
    );
    const editionsByGameId = new Map(ids.map(id => [id, []]));
    versions.forEach(version => {
        (version.games || []).forEach(game => {
            const editions = editionsByGameId.get(Number(version.game));
            if (editions) editions.push(game);
        });
    });

    return games.map(game => ({
        ...game,
        editions: editionsByGameId.get(Number(game.id)) || []
    }));
};

const saveGames = async (supabase, games) => {
    if (!games.length) return;

    const ids = games.map(game => Number(game.id));
    const existingRows = await getRowsByIds(supabase, ids);
    const now = new Date().toISOString();
    const rows = games.map(game => {
        const existing = existingRows.get(Number(game.id));
        return {
            igdb_game_id: Number(game.id),
            igdb_data: game,
            details_loaded_at: now,
            hltb_data: existing?.hltb_data ?? null,
            hltb_main_story_hours: existing?.hltb_main_story_hours ?? null,
            hltb_fetched_at: existing?.hltb_fetched_at ?? null,
            updated_at: now
        };
    });

    const { error } = await supabase
        .from("games")
        .upsert(rows, { onConflict: "igdb_game_id" });
    if (error) throw error;
};

const loadFullGames = async (supabase, requestIgdb, ids) => {
    const uniqueIds = [...new Set(ids.map(Number))];
    let rowsById = await getRowsByIds(supabase, uniqueIds);
    const missingIds = uniqueIds.filter(id =>
        !rowsById.get(id)?.details_loaded_at
    );

    for (let index = 0; index < missingIds.length; index += IGDB_BATCH_SIZE) {
        const batchIds = missingIds.slice(index, index + IGDB_BATCH_SIZE);
        const games = await requestIgdb(
            "games",
            `
            fields ${GAME_DETAILS_FIELDS};
            where id = (${batchIds.join(",")});
            limit 500;
            `
        );
        const fullGames = await loadGameVersions(requestIgdb, games);
        await saveGames(supabase, fullGames);
    }

    return getRowsByIds(supabase, uniqueIds);
};

const toPublicGame = row => ({
    ...row.igdb_data,
    howlongtobeat: row.hltb_data
});

module.exports = {
    getRowsByIds,
    loadGameVersions,
    loadFullGames,
    saveGames,
    toPublicGame
};
