const GOG_PRICE_API =
    "https://api.gog.com/products/prices";

const REQUEST_TIMEOUT_MS = 12000;

const parseGogPrice = value => {
    const amountInt = Number.parseInt(
        String(value || "").split(" ")[0],
        10
    );

    return Number.isSafeInteger(amountInt) &&
        amountInt >= 0
        ? amountInt
        : null;
};

const getGogPrice = async (
    productIds,
    country = "ES",
    currency = "EUR"
) => {
    const ids = [...new Set(
        (Array.isArray(productIds) ? productIds : [])
            .map(id => String(id || "").trim())
            .filter(id => /^[1-9]\d*$/.test(id))
    )];

    if (ids.length === 0) {
        return null;
    }

    const params = new URLSearchParams({
        ids: ids.join(","),
        countryCode: country,
        currency
    });

    let response;

    try {
        response = await fetch(
            `${GOG_PRICE_API}?${params.toString()}`,
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

    const items = result?._embedded?.items;

    if (!Array.isArray(items)) {
        return null;
    }

    for (const item of items) {
        const productId = String(
            item?._embedded?.product?.id || ""
        );

        const price = item?._embedded?.prices?.find(
            entry =>
                entry?.currency?.code === currency
        );

        if (!productId || !price) {
            continue;
        }

        const finalPrice = parseGogPrice(
            price.finalPrice
        );

        const basePrice = parseGogPrice(
            price.basePrice
        );

        if (
            finalPrice === null ||
            basePrice === null
        ) {
            continue;
        }

        const cut =
            basePrice > finalPrice &&
            basePrice > 0
                ? Math.round(
                    (1 - finalPrice / basePrice) * 100
                )
                : 0;

        return {
            shop: {
                id: 5,
                name: "GOG"
            },

            price: {
                amount: finalPrice / 100,
                amountInt: finalPrice,
                currency
            },

            regular: {
                amount: basePrice / 100,
                amountInt: basePrice,
                currency
            },

            cut,

            voucher: null,
            storeLow: null,

            drm: [{
                id: 5,
                name: "GOG"
            }],

            platforms: [],

            url:
                `https://www.gog.com/game/${productId}`,

            gogProductId: productId,
            source: "gog"
        };
    }

    return null;
};

module.exports = {
    getGogPrice
};