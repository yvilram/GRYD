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

}
