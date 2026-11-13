const createSupabaseClient = require("../services/supabase.client");
const { getRetroGames } = require("../services/retro-games.service");

module.exports = function registerRetroRoutes(app) {
    app.get("/api/retro-games", async (req, res) => {
        try {
            const supabase = createSupabaseClient.createSupabaseAdminClient(req.env);
            res.json(await getRetroGames(supabase));
        } catch (error) {
            console.error("Could not load retro games:", error);
            res.status(500).json({ error: "Could not load retro games." });
        }
    });
};
