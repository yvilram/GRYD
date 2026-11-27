const {
    GAME_DETAILS_FIELDS
} = require("../constants/igdb-fields");

const {
    loadGameVersions,
    saveGames
} = require("./game-cache.service");

const SYNC_BATCH_SIZE = 50;

const syncIgdbCacheBatch = async (
    supabase,
    requestIgdb,
    afterId = 0
) => {
    const normalizedAfterId = Number(afterId);

    if (
        !Number.isSafeInteger(normalizedAfterId) ||
        normalizedAfterId < 0
    ) {
        const error = new Error(
            "afterId must be a non-negative integer."
        );

        error.status = 400;
        throw error;
    }

    const {
        count: total,
        error: countError
    } = await supabase
        .from("games")
        .select("igdb_game_id", {
            count: "exact",
            head: true
        });

    if (countError) {
        throw countError;
    }

    const { data: rows, error: rowsError } =
        await supabase
            .from("games")
            .select("igdb_game_id")
            .gt("igdb_game_id", normalizedAfterId)
            .order("igdb_game_id", {
                ascending: true
            })
            .limit(SYNC_BATCH_SIZE);

    if (rowsError) {
        throw rowsError;
    }

    const ids = (rows || [])
        .map(row => Number(row.igdb_game_id))
        .filter(id =>
            Number.isSafeInteger(id) &&
            id > 0
        );

    if (!ids.length) {
        return {
            total: total || 0,
            processed: 0,
            updated: 0,
            unavailable: 0,
            nextAfterId: null,
            complete: true
        };
    }

    const games = await requestIgdb(
        "games",
        `
        fields ${GAME_DETAILS_FIELDS};
        where id = (${ids.join(",")});
        limit ${SYNC_BATCH_SIZE};
        `
    );

    const fullGames = await loadGameVersions(
        requestIgdb,
        games
    );

    await saveGames(
        supabase,
        fullGames
    );

    const returnedIds = new Set(
        fullGames.map(game => Number(game.id))
    );

    const unavailable = ids.filter(
        id => !returnedIds.has(id)
    ).length;

    const nextAfterId = ids.at(-1);

    return {
        total: total || 0,
        processed: ids.length,
        updated: fullGames.length,
        unavailable,
        nextAfterId,
        complete: ids.length < SYNC_BATCH_SIZE
    };
};

const finishIgdbCacheSync = async supabase => {
    const { error } = await supabase
        .from("game_catalog_pages")
        .delete()
        .neq("query_hash", "");

    if (error) {
        throw error;
    }

    return {
        cacheInvalidated: true
    };
};

module.exports = {
    finishIgdbCacheSync,
    syncIgdbCacheBatch
};