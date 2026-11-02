const getSupabase = require('./supabase');

module.exports = function(app, igdbRequest) {

    app.get("/api/games", async (req, res) => {
        try {
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
                ? Math.min(requestedLimit, 50)
                : 10;
            const offset = Number(req.query.offset) || 0;

            const games = await igdbRequest(
                "games",
                `
                fields name, cover.image_id, total_rating, platforms, platforms.name, platforms.platform_logo.image_id;
                sort total_rating_count desc;
                limit ${limit};
                offset ${offset};
                `
            );

            res.json(games);
        } catch (error) {
            console.error("Error en /api/games:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/platforms", async (req, res) => {
        try {
            const platform = req.query.platform;
            const platforms = await igdbRequest(
                "platforms",
                `
                fields name;
                where id = ${platform};
                `
            );

            res.json(platforms);
        } catch (error) {
            console.error("Error en /api/platforms:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/register", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const { email, password1, password2 } = req.body;

            if (password1 !== password2)
                return res.status(400).json({ error: "Las contraseñas no coinciden" });

            const { data, error } = await supabase.auth.signUp({
                email,
                password: password1
            });

            if (error) return res.status(400).json({ error: error.message });

            const { error: dbError } = await supabase
                .from("users")
                .insert({ id: data.user.id, email });

            if (dbError) return res.status(400).json({ error: dbError.message });

            if (!data.session) {
                return res.status(400).json({
                    error: "Account created, but automatic login failed."
                });
            }

            res.cookie("session", data.session.access_token, {
                httpOnly: true,
                sameSite: "none",
                secure: true,
                maxAge: 60 * 60 * 1000
            });

            res.json({
                message: "Account created and logged in successfully."
            });
        } catch (error) {
            console.error("Error en /api/register:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/login", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const { email, password } = req.body;

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                return res.status(401).json({ error: "Invalid email or password" });
            }

            res.cookie("session", data.session.access_token, {
                httpOnly: true,
                sameSite: "none",
                secure: true,
                maxAge: 60 * 60 * 1000
            });

            res.json({ message: "Login successful" });
        } catch (error) {
            console.error("Error en /api/login:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/session", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const token = req.cookies?.session;

            if (!token) {
                return res.json({ loggedIn: false });
            }

            const { data, error } = await supabase.auth.getUser(token);

            if (error || !data.user) {
                return res.json({ loggedIn: false });
            }

            res.json({
                loggedIn: true,
                email: data.user.email
            });
        } catch (error) {
            console.error("Error en /api/session:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/logout", (req, res) => {
        try {
            res.clearCookie("session", {
                httpOnly: true,
                secure: true,
                sameSite: "none"
            });

            res.json({ message: "Logged out successfully" });
        } catch (error) {
            console.error("Error en /api/logout:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/game_state", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const { gameId, gameName, status } = req.body;
            const token = req.cookies?.session;

            if (!token) {
                return res.status(401).json({ error: "Not logged in" });
            }

            const { data: { user }, error: authError } =
                await supabase.auth.getUser(token);

            if (authError || !user) {
                return res.status(401).json({ error: "Invalid session" });
            }

            const { error } = await supabase
                .from("user_game_list")
                .upsert({
                    id: Number(gameId),
                    user_id: user.id,
                    game_name: gameName,
                    status
                });

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            res.json({ message: "Game saved" });
        } catch (error) {
            console.error("Error en /api/game_state:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/game_state_user", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const token = req.cookies?.session;

            if (!token) return res.status(401).json({ error: "Not logged in" });

            const { data: { user }, error: authError } =
                await supabase.auth.getUser(token);

            if (authError || !user) {
                return res.status(401).json({ error: "Invalid session" });
            }

            const { data, error } = await supabase
                .from("user_game_list")
                .select("id, game_name, status")
                .eq("user_id", user.id);

            if (error) return res.status(500).json({ error: error.message });
            res.json(data);
        } catch (error) {
            console.error("Error en /api/game_state_user:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/library", async (req, res) => {
        try {
            const ids = req.query.ids;

            if (!ids) return res.json([]);

            const games = await igdbRequest(
                "games",
                `
                fields name, cover.image_id, total_rating, platforms, platforms.name, platforms.platform_logo.image_id;
                where id = (${ids});
                `
            );

            res.json(games);
        } catch (error) {
            console.error("Error obteniendo juegos (library):", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/check-auth", async (req, res) => {
        try {
            const supabase = getSupabase(req.env);
            const token = req.cookies?.session;

            if (!token) {
                return res.json({ authenticated: false });
            }

            const { data: { user }, error } =
                await supabase.auth.getUser(token);

            if (error || !user) {
                return res.json({ authenticated: false });
            }

            return res.json({
                authenticated: true,
                user: {
                    id: user.id,
                    email: user.email
                }
            });

        } catch (error) {
            console.error("Error comprobando sesión:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/remove-item", async (req, res) => {
        try {
            const token = req.cookies?.session;
            if (!token) return res.status(401).json({ error: "Not logged in" });

            const supabase = getSupabase(req.env);

            const { data: { user }, error: authError } = await supabase.auth.getUser(token);
            if (authError || !user) return res.status(401).json({ error: "Invalid session" });

            const gameId = Number(req.query.id);
            if (!Number.isFinite(gameId)) return res.status(400).json({ error: "Invalid id" });

            const { error } = await supabase
                .from("user_game_list")
                .delete()
                .eq("id", gameId)
                .eq("user_id", user.id);

            if (error) return res.status(500).json({ error: error.message });

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
};