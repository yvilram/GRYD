const { GAME_DETAILS_FIELDS } = require("../constants/igdb-fields");

const invalidInput = message => Object.assign(new Error(message), { status: 400 });

const parseIdList = value => {
    if (value === undefined) return [];
    if (typeof value !== "string" || !/^\d+(,\d+)*$/.test(value)) {
        throw invalidInput("IDs must be comma-separated positive integers.");
    }

    const ids = [...new Set(value.split(",").map(Number))];
    if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) {
        throw invalidInput("A maximum of 100 valid IDs is allowed.");
    }

    return ids;
};

const parseYear = (value, label) => {
    if (value === undefined || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
        throw invalidInput(`${label} must be a four-digit year.`);
    }

    const year = Number(value);
    if (year < 1950 || year > 2100) {
        throw invalidInput(`${label} is outside the supported range.`);
    }

    return year;
};

module.exports = function registerCatalogRoutes(app, requestIgdb) {
    app.get("/api/games", async (req, res) => {
        try {
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
                ? Math.min(requestedLimit, 50)
                : 10;
            const requestedOffset = Number(req.query.offset);
            const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0
                ? Math.min(requestedOffset, 10000)
                : 0;
            const genreIds = parseIdList(req.query.genres);
            const themeIds = parseIdList(req.query.themes);
            const platformIds = parseIdList(req.query.platforms);
            const yearFrom = parseYear(req.query.yearFrom, "yearFrom");
            const yearTo = parseYear(req.query.yearTo, "yearTo");
            const searchValue = req.query.search;
            if (searchValue !== undefined &&
                (typeof searchValue !== "string" || searchValue.length > 100)) {
                throw invalidInput("search must be a string of at most 100 characters.");
            }
            const search = searchValue?.trim() || "";
            if (yearFrom && yearTo && yearFrom > yearTo) {
                throw invalidInput("yearFrom cannot be later than yearTo.");
            }
            const sortOptions = {
                rating: "sort total_rating desc; sort total_rating_count desc;",
                popular: "sort total_rating_count desc; sort total_rating desc;",
                newest: "sort first_release_date desc;"
            };
            const sort = req.query.sort === undefined ? "rating" : req.query.sort;
            if (typeof sort !== "string" || !Object.hasOwn(sortOptions, sort)) {
                throw invalidInput("sort must be rating, popular, or newest.");
            }

            const filters = [];
            if (search) filters.push(`name ~ *${JSON.stringify(search)}*`);
            if (genreIds.length) filters.push(`genres = (${genreIds.join(",")})`);
            if (themeIds.length) filters.push(`themes = (${themeIds.join(",")})`);
            if (platformIds.length) filters.push(`platforms = (${platformIds.join(",")})`);
            if (yearFrom) filters.push(`first_release_date >= ${Date.UTC(yearFrom, 0, 1) / 1000}`);
            if (yearTo) filters.push(`first_release_date < ${Date.UTC(yearTo + 1, 0, 1) / 1000}`);
            const whereClause = filters.length ? `where ${filters.join(" & ")};` : "";

            const games = await requestIgdb(
                "games",
                `
                fields ${GAME_DETAILS_FIELDS};
                ${whereClause}
                ${sortOptions[sort]}
                limit ${limit};
                offset ${offset};
                `
            );

            res.json(games);
        } catch (error) {
            if (error.status === 400) {
                return res.status(400).json({ error: error.message });
            }
            console.error("Could not load catalog games:", error);
            if (error.upstream) {
                return res.status(502).json({ error: error.message });
            }
            res.status(500).json({ error: "Could not load catalog games." });
        }
    });

    app.get("/api/platforms", async (req, res) => {
        try {
            if (req.query.platform === undefined) {
                const platforms = await requestIgdb(
                    "platforms",
                    "fields id,name; sort name asc; limit 500;"
                );
                return res.json(platforms);
            }

            if (!/^\d+$/.test(String(req.query.platform))) {
                return res.status(400).json({ error: "Platform must be a valid ID." });
            }

            const platforms = await requestIgdb(
                "platforms",
                `fields name; where id = ${req.query.platform};`
            );
            res.json(platforms);
        } catch (error) {
            console.error("Could not load platform details:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/genres", async (_req, res) => {
        try {
            const genres = await requestIgdb(
                "genres",
                "fields id,name; sort name asc; limit 100;"
            );
            res.json(genres);
        } catch (error) {
            console.error("Could not load game genres:", error);
            res.status(500).json({ error: "Could not load game genres." });
        }
    });

    app.get("/api/themes", async (_req, res) => {
        try {
            const themes = await requestIgdb(
                "themes",
                "fields id,name; sort name asc; limit 100;"
            );
            res.json(themes);
        } catch (error) {
            console.error("Could not load game themes:", error);
            res.status(500).json({ error: "Could not load game themes." });
        }
    });

};
