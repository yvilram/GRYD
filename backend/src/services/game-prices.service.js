const ITAD_API_URL = "https://api.isthereanydeal.com";
const REQUEST_TIMEOUT_MS = 12000;

const {
    findNintendoNsuid,
    getNintendoPrice
} = require("./nintendo-prices.service");

const {
    getEpicPrice
} = require("./epic-prices.service");

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

const getSteamStorePrice = async (
    steamAppId,
    country = "ES"
) => {
    const appId = String(steamAppId || "").trim();

    if (!/^[1-9]\d*$/.test(appId)) {
        return null;
    }

    let response;

    try {
        const params = new URLSearchParams({
            appids: appId,
            cc: country,
            l: "english"
        });

        response = await fetch(
            `https://store.steampowered.com/api/appdetails?${params}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );
    } catch {
        return null;
    }

    if (!response.ok) {
        return null;
    }

    const result = await response.json();
    const app = result?.[appId];

    if (!app?.success) {
        return null;
    }

    const price = app.data?.price_overview;

    if (!price) {
        return null;
    }

    return {
        shop: {
            id: 61,
            name: "Steam"
        },

        price: {
            amount: price.final / 100,
            amountInt: price.final,
            currency: price.currency
        },

        regular: {
            amount: price.initial / 100,
            amountInt: price.initial,
            currency: price.currency
        },

        cut: Number(price.discount_percent) || 0,

        voucher: null,
        storeLow: null,

        drm: [{
            id: 61,
            name: "Steam"
        }],

        platforms: [],

        url:
            `https://store.steampowered.com/app/${appId}`,

        source: "steam"
    };
};

const findPurchasableSteamAppId = async (
    title,
    excludedAppId,
    country = "ES"
) => {
    const normalizedTitle = normalizeTitle(title);

    if (!normalizedTitle) {
        return null;
    }

    const params = new URLSearchParams({
        term: String(title).trim(),
        cc: country,
        l: "english"
    });

    let response;

    try {
        response = await fetch(
            `https://store.steampowered.com/api/storesearch/?${params}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );
    } catch {
        return null;
    }

    if (!response.ok) {
        return null;
    }

    let result;

    try {
        result = await response.json();
    } catch {
        return null;
    }

    const excludedId = String(excludedAppId || "");

    const candidate = (result?.items || []).find(item => {
        if (
            item?.type !== "app" ||
            String(item.id) === excludedId ||
            !item.price
        ) {
            return false;
        }

        const candidateTitle = normalizeTitle(item.name);

        return candidateTitle === normalizedTitle ||
            candidateTitle.startsWith(
                `${normalizedTitle} `
            );
    });

    return candidate?.id
        ? String(candidate.id)
        : null;
};

const stripHtml = value =>
    String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const normalizeSteamPackageTitle = value =>
    normalizeTitle(value)
        .replace(/[:–—-]/g, " ")
        .replace(/\bedition\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

const getSteamAppDetails = async (
    steamAppId,
    country = "ES"
) => {
    const appId = String(steamAppId || "").trim();

    if (!/^[1-9]\d*$/.test(appId)) {
        return null;
    }

    const params = new URLSearchParams({
        appids: appId,
        cc: country,
        l: "english"
    });

    try {
        const response = await fetch(
            `https://store.steampowered.com/api/appdetails?${params}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );

        if (!response.ok) {
            return null;
        }

        const result = await response.json();
        const app = result?.[appId];

        return app?.success
            ? app.data
            : null;
    } catch {
        return null;
    }
};

const getSteamPackagePrice = async (
    packageId,
    country = "ES"
) => {
    const id = String(packageId || "").trim();

    if (!/^[1-9]\d*$/.test(id)) {
        return null;
    }

    const params = new URLSearchParams({
        packageids: id,
        cc: country,
        l: "english"
    });

    try {
        const response = await fetch(
            `https://store.steampowered.com/api/packagedetails?${params}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );

        if (!response.ok) {
            return null;
        }

        const result = await response.json();
        const steamPackage = result?.[id];

        if (!steamPackage?.success) {
            return null;
        }

        const price = steamPackage.data?.price;

        if (!price) {
            return null;
        }

        return {
            shop: {
                id: 61,
                name: "Steam"
            },

            price: {
                amount: price.final / 100,
                amountInt: price.final,
                currency: price.currency
            },

            regular: {
                amount: price.initial / 100,
                amountInt: price.initial,
                currency: price.currency
            },

            cut: Number(price.discount_percent) || 0,
            voucher: null,
            storeLow: null,

            drm: [{
                id: 61,
                name: "Steam"
            }],

            platforms: [],

            url:
                `https://store.steampowered.com/sub/${id}`,

            packageId: id,
            source: "steam-package"
        };
    } catch {
        return null;
    }
};

const findSteamPackagePrice = async (
    title,
    country = "ES"
) => {
    const normalizedTitle =
        normalizeSteamPackageTitle(title);

    if (!normalizedTitle) {
        return null;
    }

    const baseTitle = String(title)
        .replace(
            /\s*[-:–—]\s*(ultimate|complete|deluxe|definitive|game of the year|goty)\s+edition\s*$/i,
            ""
        )
        .trim();

    if (baseTitle === title) {
        return null;
    }

    const searchParams = new URLSearchParams({
        term: baseTitle,
        cc: country,
        l: "english"
    });

    let searchResult;

    try {
        const response = await fetch(
            `https://store.steampowered.com/api/storesearch/?${searchParams}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );

        if (!response.ok) {
            return null;
        }

        searchResult = await response.json();
    } catch {
        return null;
    }

    const baseApp = (searchResult?.items || []).find(
        item =>
            item?.type === "app" &&
            normalizeTitle(item.name) ===
                normalizeTitle(baseTitle)
    );

    if (!baseApp?.id) {
        return null;
    }

    const appDetails = await getSteamAppDetails(
        baseApp.id,
        country
    );

    const packages = (
        appDetails?.package_groups || []
    ).flatMap(group =>
        Array.isArray(group?.subs)
            ? group.subs
            : []
    );

    const matchingPackage = packages.find(
        steamPackage => {
            const packageTitle =
                normalizeSteamPackageTitle(
                    stripHtml(
                        steamPackage.option_text
                    ).replace(
                        /\s+\d+[.,]\d{2}\s*€.*$/i,
                        ""
                    )
                );

            return packageTitle ===
                normalizedTitle;
        }
    );

    if (!matchingPackage?.packageid) {
        return null;
    }

    return getSteamPackagePrice(
        matchingPackage.packageid,
        country
    );
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

    let deals = [];

    if (resolvedGame) {
        const priceData = await getGamePrices(
            env,
            resolvedGame.id,
            country
        );

        deals = Array.isArray(priceData?.deals)
            ? [...priceData.deals]
            : [];
    }

    const responseGame = resolvedGame || {
        id: null,
        title: game.name,
        matchedBy: null,
        steamAppId: game.steamAppId
            ? String(game.steamAppId)
            : null
    };

    const hasEpicDeal = deals.some(deal =>
        normalizeTitle(
            deal?.shop?.name
        ).includes("epic")
    );

    if (!hasEpicDeal) {
        const epicPrice = await getEpicPrice(
            game.name,
            country
        );

        if (epicPrice) {
            deals.push(epicPrice);
        }
    }

    let hasSteamDeal = deals.some(deal =>
        normalizeTitle(
            deal?.shop?.name
        ) === "steam"
    );

    if (!hasSteamDeal && responseGame.steamAppId) {
        let steamAppId = responseGame.steamAppId;

        let steamPrice = await getSteamStorePrice(
            steamAppId,
            country
        );

        if (!steamPrice) {
            const purchasableAppId =
                await findPurchasableSteamAppId(
                    game.name,
                    steamAppId,
                    country
                );

            if (purchasableAppId) {
                steamAppId = purchasableAppId;

                steamPrice = await getSteamStorePrice(
                    steamAppId,
                    country
                );
            }
        }

        if (steamPrice) {
            responseGame.resolvedSteamAppId =
                steamAppId;

            deals.push(steamPrice);
            hasSteamDeal = true;
        }
    }

    if (!hasSteamDeal) {
        const steamPackagePrice =
            await findSteamPackagePrice(
                game.name,
                country
            );

        if (steamPackagePrice) {
            deals.push(steamPackagePrice);
        }
    }

    try {
        const nsuid = await findNintendoNsuid(
            game.name
        );

        if (nsuid) {
            const nintendoPrice =
                await getNintendoPrice(
                    nsuid,
                    country
                );

            if (nintendoPrice) {
                deals.push(nintendoPrice);
            }
        }
    } catch (error) {
        console.error(
            `Could not load Nintendo price for ${game.name}:`,
            error
        );
    }

    return {
        supported: deals.length > 0,
        game: responseGame,
        deals
    };
};

module.exports = {
    getPricesForGame
};