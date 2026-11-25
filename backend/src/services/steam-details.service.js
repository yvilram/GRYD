const STEAM_STORE_API =
    "https://store.steampowered.com/api";

const STEAM_WEB_API =
    "https://api.steampowered.com";

const REQUEST_TIMEOUT_MS = 12000;

const getSteamApiKey = env =>
    env?.STEAM_WEB_API_KEY ||
    (
        typeof process !== "undefined"
            ? process.env?.STEAM_WEB_API_KEY
            : null
    );

const normalizeSteamAppId = value => {
    const appId = String(value || "").trim();

    return /^[1-9]\d*$/.test(appId)
        ? appId
        : null;
};

const normalizeSteamLanguages = value => {
    if (typeof value !== "string") {
        return [];
    }

    const [languagesHtml] = value.split(/<br\s*\/?>/i);

    return languagesHtml
        .split(",")
        .map(item => {
            const fullAudio =
                /<strong>\s*\*\s*<\/strong>/i.test(item);

            const name = item
                .replace(
                    /<strong>\s*\*\s*<\/strong>/gi,
                    ""
                )
                .replace(/<[^>]+>/g, "")
                .trim();

            return {
                name,
                fullAudio
            };
        })
        .filter(language => language.name);
};

const requestSteamJson = async (
    url,
    errorMessage
) => {
    let response;

    try {
        response = await fetch(url, {
            headers: {
                Accept: "application/json"
            },
            signal: AbortSignal.timeout(
                REQUEST_TIMEOUT_MS
            )
        });
    } catch (cause) {
        const error = new Error(
            errorMessage,
            { cause }
        );

        error.upstream = true;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(
            `${errorMessage} (${response.status}).`
        );

        error.upstream = true;
        error.statusCode = response.status;

        throw error;
    }

    try {
        return await response.json();
    } catch (cause) {
        const error = new Error(
            "Steam returned invalid JSON.",
            { cause }
        );

        error.upstream = true;
        throw error;
    }
};

const getSteamAppDetails = async (
    steamAppId,
    country = "ES",
    language = "english"
) => {
    const appId = normalizeSteamAppId(
        steamAppId
    );

    if (!appId) {
        return null;
    }

    const params = new URLSearchParams({
        appids: appId,
        cc: country,
        l: language
    });

    const result = await requestSteamJson(
        `${STEAM_STORE_API}/appdetails?${params}`,
        "Could not load Steam app details"
    );

    const app = result?.[appId];

    if (!app?.success || !app.data) {
        return null;
    }

    return app.data;
};

const getSteamMetadata = async (
    steamAppId,
    country = "ES",
    language = "english"
) => {
    const appId = normalizeSteamAppId(
        steamAppId
    );

    if (!appId) {
        return null;
    }

    const app = await getSteamAppDetails(
        appId,
        country,
        language
    );

    if (!app) {
        return null;
    }

    const metacriticScore = Number(
        app.metacritic?.score
    );

    const achievementsTotal = Number(
        app.achievements?.total
    );

    const controllerCategory = Array.isArray(app.categories)
        ? app.categories.find(category =>
            category?.description === "Full controller support" ||
            category?.description === "Partial Controller Support"
        )
        : null;

    const controllerSupport =
        typeof app.controller_support === "string"
            ? app.controller_support
            : controllerCategory?.description === "Full controller support"
                ? "full"
                : controllerCategory?.description === "Partial Controller Support"
                    ? "partial"
                    : null;

    return {
        steamAppId: appId,

        controllerSupport,

        supportedLanguages: normalizeSteamLanguages(
            app.supported_languages
        ),


        metacritic:
            Number.isFinite(metacriticScore)
                ? {
                    score: metacriticScore,
                    url:
                        typeof app.metacritic?.url === "string"
                            ? app.metacritic.url
                            : null
                }
                : null,

        achievements: {
            total:
                Number.isSafeInteger(achievementsTotal) &&
                    achievementsTotal > 0
                    ? achievementsTotal
                    : 0,

            highlighted: Array.isArray(
                app.achievements?.highlighted
            )
                ? app.achievements.highlighted.map(
                    achievement => ({
                        name:
                            achievement.localized_name ||
                            achievement.name ||
                            null,

                        icon:
                            achievement.path ||
                            null,

                        hidden:
                            Number(
                                achievement.hidden
                            ) === 1
                    })
                )
                : []
        }
    };
};

const getSteamAchievements = async (
    env,
    steamAppId,
    language = "english"
) => {
    const appId = normalizeSteamAppId(
        steamAppId
    );

    if (!appId) {
        return {
            available: false,
            steamAppId: null,
            gameName: null,
            achievements: []
        };
    }

    const apiKey = getSteamApiKey(env);

    if (!apiKey) {
        throw new Error(
            "STEAM_WEB_API_KEY is not configured."
        );
    }

    const params = new URLSearchParams({
        key: apiKey,
        appid: appId,
        l: language
    });

    const result = await requestSteamJson(
        `${STEAM_WEB_API}` +
        `/ISteamUserStats/GetSchemaForGame/v2/?${params}`,
        "Could not load Steam achievements"
    );

    const game = result?.game;

    const achievements = Array.isArray(
        game?.availableGameStats?.achievements
    )
        ? game.availableGameStats.achievements
            .map(achievement => ({
                id:
                    typeof achievement.name === "string"
                        ? achievement.name
                        : null,

                name:
                    typeof achievement.displayName === "string"
                        ? achievement.displayName
                        : achievement.name || null,

                description:
                    typeof achievement.description === "string"
                        ? achievement.description
                        : null,

                hidden:
                    Number(achievement.hidden) === 1,

                icon:
                    typeof achievement.icon === "string"
                        ? achievement.icon
                        : null,

                lockedIcon:
                    typeof achievement.icongray === "string"
                        ? achievement.icongray
                        : null
            }))
            .filter(achievement =>
                achievement.id &&
                achievement.name
            )
        : [];

    return {
        available: achievements.length > 0,
        steamAppId: appId,
        gameName:
            typeof game?.gameName === "string"
                ? game.gameName
                : null,
        total: achievements.length,
        achievements
    };
};

module.exports = {
    getSteamAppDetails,
    getSteamMetadata,
    getSteamAchievements
};