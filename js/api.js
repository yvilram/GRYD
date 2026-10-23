module.exports = function(app, igdbRequest) {

    app.get("/api/games", async (req, res) => {

        const limit = 10;
        const offset = Number(req.query.offset) || 0;

        const games = await igdbRequest(
            "games",

            `
            fields name, cover.image_id, platforms;
            sort total_rating_count desc;
            limit ${limit};
            offset ${offset};
            `
        );

        res.json(games);
    });

}
