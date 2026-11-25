const ITAD_API_URL = "https://api.isthereanydeal.com";
const REQUEST_TIMEOUT_MS = 12000;

const getApiKey = env =>
    env?.ISTHEREANYDEAL_API_KEY ||
    process.env.ISTHEREANYDEAL_API_KEY;

const requestItad = async (env, path, options = {}) => {
    const apiKey = getApiKey(env);

    if (!apiKey) {
        throw new Error(
            "ISTHEREANYDEAL_API_KEY is not configured."
        );
    }

    let response;

    try {
        response = await fetch(
            `${ITAD_API_URL}${path}`,
            {
                ...options,
                headers: {
                    Accept: "application/json",
                    "ITAD-API-Key": apiKey,
                    ...(options.headers || {})
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );
    } catch (cause) {
        const error = new Error(
            "Could not contact IsThereAnyDeal.",
            { cause }
        );

        error.upstream = true;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(
            `IsThereAnyDeal request failed (${response.status}).`
        );

        error.upstream = true;
        error.statusCode = response.status;

        throw error;
    }

    try {
        return await response.json();
    } catch (cause) {
        const error = new Error(
            "IsThereAnyDeal returned invalid JSON.",
            { cause }
        );

        error.upstream = true;
        throw error;
    }
};

const normalizeTitle = value =>
    String(value || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();

const lookupGameBySteamAppId = async (
    env,
    steamAppId
) => {
    const appId = String(steamAppId || "").trim();

    if (!/^[1-9]\d*$/.test(appId)) {
        return null;
    }

    const result = await requestItad(
        env,
        "/lookup/id/shop/61/v1",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                `app/${appId}`
            ])
        }
    );

    if (!result || typeof result !== "object") {
        return null;
    }

    return result[`app/${appId}`] || null;
};

const lookupGameByExactTitle = async (
    env,
    title
) => {
    const normalizedTitle = normalizeTitle(title);

    if (!normalizedTitle) {
        return null;
    }

    const params = new URLSearchParams({
        title: String(title).trim(),
        results: "10"
    });

    const result = await requestItad(
        env,
        `/games/search/v1?${params.toString()}`
    );

    if (!Array.isArray(result)) {
        return null;
    }

    return result.find(game =>
        normalizeTitle(game?.title) ===
        normalizedTitle
    ) || null;
};

const resolveItadGame = async (
    env,
    game
) => {
    if (game?.steamAppId) {
        const itadGameId =
            await lookupGameBySteamAppId(
                env,
                game.steamAppId
            );

        if (itadGameId) {
            return {
                id: itadGameId,
                matchedBy: "steam",
                steamAppId:
                    String(game.steamAppId)
            };
        }
    }

    const titleMatch =
        await lookupGameByExactTitle(
            env,
            game?.name
        );

    if (!titleMatch) {
        return null;
    }

    return {
        id: titleMatch.id,
        slug: titleMatch.slug,
        title: titleMatch.title,
        matchedBy: "title",
        steamAppId: game?.steamAppId
            ? String(game.steamAppId)
            : null
    };
};

const getGamePrices = async (
    env,
    itadGameId,
    country = "ES"
) => {
    if (
        typeof itadGameId !== "string" ||
        !itadGameId.trim()
    ) {
        return null;
    }

    const params = new URLSearchParams({
        country
    });

    const result = await requestItad(
        env,
        `/games/prices/v3?${params.toString()}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                itadGameId
            ])
        }
    );

    if (!Array.isArray(result)) {
        return null;
    }

    return result.find(
        item => item.id === itadGameId
    ) || null;
};

const getPricesForGame = async (
    env,
    game,
    country = "ES"
) => {
    if (!game?.name) {
        return {
            supported: false,
            game: null,
            deals: []
        };
    }

    const resolvedGame = await resolveItadGame(
        env,
        game
    );

    if (!resolvedGame) {
        return {
            supported: false,
            game: null,
            deals: []
        };
    }

    const priceData = await getGamePrices(
        env,
        resolvedGame.id,
        country
    );

    return {
        supported: true,

        game: resolvedGame,

        deals: Array.isArray(priceData?.deals)
            ? priceData.deals
            : []
    };
};

module.exports = {
    getPricesForGame
};