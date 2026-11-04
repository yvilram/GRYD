const { getSessionContext } = require("../services/session.service");
const { GAME_DETAILS_FIELDS } = require("../constants/igdb-fields");

module.exports = function registerLibraryRoutes(app, requestIgdb) {
    app.get("/api/library", async (req, res) => {
        try {
            const ids = req.query.ids;
            if (!ids) return res.json([]);

            const games = await requestIgdb(
                "games",
                `fields ${GAME_DETAILS_FIELDS}; where id = (${ids});`
            );
            res.json(games);
        } catch (error) {
            console.error("Could not load library game details:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/game_state", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const { gameId, gameName, status } = req.body;
            const { error } = await session.supabase
                .from("user_game_list")
                .upsert({
                    id: Number(gameId),
                    user_id: session.user.id,
                    game_name: gameName,
                    status
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
