const NINTENDO_PRICE_API =
    "https://api.ec.nintendo.com/v1/price";

const REQUEST_TIMEOUT_MS = 12000;

const normalizeTitle = value =>
    String(value || "")
        .normalize("NFKC")
        .replace(/[™®©]/g, "")
        .replace(/\s*-\s*nintendo switch(?: 2)? edition$/i, "")
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

const findNintendoNsuid = async (
    title
) => {
    const normalizedTitle = normalizeTitle(title);

    if (!normalizedTitle) {
        return null;
    }

    /*
     * Nintendo's EU catalog resolver is kept isolated here.
     * Only an exact normalized title is accepted.
     *
     * We deliberately do not guess an NSUID from IGDB because
     * IGDB may not contain Nintendo external IDs.
     */
    const params = new URLSearchParams({
        q: String(title).trim(),
        rows: "20",
        wt: "json"
    });

    let response;

    try {
        response = await fetch(
            `https://search.nintendo-europe.com/es/select?${params.toString()}`,
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

    const games = Array.isArray(result?.response?.docs)
        ? result.response.docs
        : [];

    const match = games.find(game => {
        const gameTitle =
            game?.title ||
            game?.title_extras ||
            "";

        const nsuid =
            game?.nsuid_txt?.[0] ||
            game?.nsuid ||
            null;

        return normalizeTitle(gameTitle) === normalizedTitle &&
            /^700\d{11}$/.test(String(nsuid || ""));
    });

    const nsuid =
        match?.nsuid_txt?.[0] ||
        match?.nsuid ||
        null;

    return /^700\d{11}$/.test(
        String(nsuid || "")
    )
        ? String(nsuid)
        : null;
};

const getNintendoPrice = async (
    nsuid,
    country = "ES",
    language = "es"
) => {
    const titleId = String(nsuid || "").trim();

    if (!/^700\d{11}$/.test(titleId)) {
        return null;
    }

    const params = new URLSearchParams({
        country,
        lang: language,
        ids: titleId
    });

    let response;

    try {
        response = await fetch(
            `${NINTENDO_PRICE_API}?${params.toString()}`,
            {
                headers: {
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            }
        );
    } catch (cause) {
        const error = new Error(
            "Could not contact Nintendo eShop.",
            { cause }
        );

        error.upstream = true;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(
            `Nintendo eShop request failed (${response.status}).`
        );

        error.upstream = true;
        error.statusCode = response.status;

        throw error;
    }

    let result;

    try {
        result = await response.json();
    } catch (cause) {
        const error = new Error(
            "Nintendo eShop returned invalid JSON.",
            { cause }
        );

        error.upstream = true;
        throw error;
    }

    const price = result?.prices?.find(
        item => String(item.title_id) === titleId
    );

    if (!price) {
        return null;
    }

    const regularAmount = Number(
        price.regular_price?.raw_value
    );

    const discountAmount = Number(
        price.discount_price?.raw_value
    );

    const currentAmount = Number.isFinite(discountAmount)
        ? discountAmount
        : regularAmount;

    if (!Number.isFinite(currentAmount)) {
        return null;
    }

    const currency =
        price.discount_price?.currency ||
        price.regular_price?.currency ||
        "EUR";

    const discountPercent =
        Number.isFinite(regularAmount) &&
        regularAmount > currentAmount
            ? Math.round(
                (1 - currentAmount / regularAmount) * 100
            )
            : 0;

    return {
        shop: {
            id: "nintendo",
            name: "Nintendo eShop"
        },

        price: {
            amount: currentAmount,
            amountInt: Math.round(currentAmount * 100),
            currency
        },

        regular: Number.isFinite(regularAmount)
            ? {
                amount: regularAmount,
                amountInt: Math.round(regularAmount * 100),
                currency
            }
            : null,

        cut: discountPercent,
        voucher: null,
        storeLow: null,
        drm: [],

        platforms: [{
            id: "nintendo-switch",
            name: "Nintendo Switch"
        }],

        salesStatus: price.sales_status || null,
        nsuid: titleId,
        source: "nintendo"
    };
};

module.exports = {
    findNintendoNsuid,
    getNintendoPrice
};


