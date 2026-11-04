const { getSessionContext } = require("../services/session.service");
const { GAME_DETAILS_FIELDS } = require("../constants/igdb-fields");

module.exports = function registerLibraryRoutes(app, requestIgdb) {
    app.get("/api/library", async (req, res) => {
        try {
            const ids = req.query.ids;
            if (!ids) return res.json([]);
            if (typeof ids !== "string" || !/^\d+(,\d+)*$/.test(ids)) {
                return res.status(400).json({
                    error: "IDs must be comma-separated positive integers."
                });
            }

            const gameIds = [...new Set(ids.split(",").map(Number))];
            if (gameIds.length > 100 ||
                gameIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
                return res.status(400).json({
                    error: "A maximum of 100 valid IDs is allowed."
                });
            }

            const gamesById = new Map();
            let primaryQueryError;
            try {
                const games = await requestIgdb(
                    "games",
                    `fields ${GAME_DETAILS_FIELDS}; where id = (${gameIds.join(",")});`
                );
                games.forEach(game => gamesById.set(Number(game.id), game));
            } catch (error) {
                primaryQueryError = error;
                console.error("Could not load full library game details:", error);
            }

            const missingDetailsIds = gameIds.filter(id => {
                const game = gamesById.get(id);
                return !game?.cover?.image_id ||
                    game?.total_rating === null ||
                    game?.total_rating === undefined ||
                    game?.total_rating_count === null ||
                    game?.total_rating_count === undefined ||
                    !Array.isArray(game?.platforms) ||
                    game.platforms.length === 0;
            });

            if (missingDetailsIds.length) {
                try {
                    const fallbackGames = await requestIgdb(
                        "games",
                        "fields id, name, cover.image_id, total_rating, total_rating_count, " +
                            "platforms.name, platforms.platform_logo.image_id; " +
                            `where id = (${missingDetailsIds.join(",")});`
                    );
                    fallbackGames.forEach(fallback => {
                        const id = Number(fallback.id);
                        const existing = gamesById.get(id) || { id };
                        if (!existing.name && fallback.name) existing.name = fallback.name;
                        if (!existing.cover?.image_id && fallback.cover?.image_id) {
                            existing.cover = fallback.cover;
                        }
                        if ((existing.total_rating === null ||
                            existing.total_rating === undefined) &&
                            fallback.total_rating !== null &&
                            fallback.total_rating !== undefined) {
                            existing.total_rating = fallback.total_rating;
                        }
                        if ((existing.total_rating_count === null ||
                            existing.total_rating_count === undefined) &&
                            fallback.total_rating_count !== null &&
                            fallback.total_rating_count !== undefined) {
                            existing.total_rating_count = fallback.total_rating_count;
                        }
                        if ((!Array.isArray(existing.platforms) ||
                            existing.platforms.length === 0) &&
                            Array.isArray(fallback.platforms)) {
                            existing.platforms = fallback.platforms;
                        }
                        gamesById.set(id, existing);
                    });
                } catch (error) {
                    console.error("Could not load missing library game details:", error);
                    if (primaryQueryError && gamesById.size === 0) throw primaryQueryError;
                }
            }

            res.json([...gamesById.values()]);
        } catch (error) {
            console.error("Could not load library game details:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/game_state", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const gameId = Number(req.body?.gameId);
            const gameName = typeof req.body?.gameName === "string"
                ? req.body.gameName.trim()
                : "";
            const { status } = req.body || {};
            const validStatuses = ["backlog", "play", "pause", "completed", "drop"];
            if (!Number.isSafeInteger(gameId) || gameId < 1) {
                return res.status(400).json({ error: "A valid game ID is required." });
            }
            if (!gameName) {
                return res.status(400).json({ error: "A game name is required." });
            }
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: "Select a valid library status." });
            }

            const { error } = await session.supabase
                .from("user_game_list")
                .upsert({
                    id: gameId,
                    user_id: session.user.id,
                    game_name: gameName,
                    status
                }, {
                    onConflict: "user_id,id"
                });

            if (error) return res.status(400).json({ error: error.message });

            res.json({ message: "Game saved" });
        } catch (error) {
            console.error("Could not save game status:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/game_state_user", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const { data, error } = await session.supabase
                .from("user_game_list")
                .select("id, game_name, status, created_at")
                .eq("user_id", session.user.id);

            if (error) return res.status(500).json({ error: error.message });
            res.json(data);
        } catch (error) {
            console.error("Could not load saved game statuses:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/remove-item", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const gameId = Number(req.query.id);
            if (!Number.isFinite(gameId)) {
                return res.status(400).json({ error: "Invalid id" });
            }

            const { error } = await session.supabase
                .from("user_game_list")
                .delete()
                .eq("id", gameId)
                .eq("user_id", session.user.id);

            if (error) return res.status(500).json({ error: error.message });

            res.json({ success: true });
        } catch (error) {
            console.error("Could not remove saved game:", error);
            res.status(500).json({ error: error.message });
        }
    });
};
