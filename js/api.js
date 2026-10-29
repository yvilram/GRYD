const supabase = require('./supabase');
module.exports = function(app, igdbRequest) {

    app.get("/api/games", async (req, res) => {
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
    });

    app.get("/api/platforms", async (req, res) => {
        const requestedLimit = Number(req.query.limit);
        const platform = req.query.platform;
        const platforms = await igdbRequest(
            "platforms",

            `
            fields name;
            where id = ${platform};
            `
        );

        res.json(platforms);
    });

    app.post("/api/register", async (req, res) => {
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
            secure: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 1000
        });

        res.json({
            message: "Account created and logged in successfully."
        });
    });

    app.post("/api/login", async (req, res) => {
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
            secure: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 1000
        });

        res.json({ message: "Login successful" });
    });

    app.get("/api/session", async (req, res) => {
        const token = req.cookies.session;

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
    });

    app.post("/api/logout", (req, res) => {
        res.clearCookie("session");
        res.json({ message: "Logged out successfully" });
    });

    app.post("/api/game_state", async (req, res) => {
        const { gameId, gameName, status } = req.body;
        const token = req.cookies.session;

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
    });

    app.get("/api/game_state_user", async (req, res) => {
    const token = req.cookies.session;

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
});

}
