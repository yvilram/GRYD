const { getSessionContext } = require("../services/session.service");
const createSupabaseClient = require("../services/supabase.client");
const { loadFullGames, toPublicGame } = require("../services/game-cache.service");

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
            if (gameIds.length > 500 ||
                gameIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
                return res.status(400).json({
                    error: "A maximum of 500 valid IDs is allowed."
                });
            }

            const supabase = createSupabaseClient.createSupabaseAdminClient(req.env);
            const gamesById = await loadFullGames(supabase, requestIgdb, gameIds);
            res.json(gameIds
                .map(id => gamesById.get(id))
                .filter(Boolean)
                .map(toPublicGame));
        } catch (error) {
            console.error("Could not load library game details:", error);
            res.status(error.upstream ? 502 : 500).json({ error: error.message });
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
