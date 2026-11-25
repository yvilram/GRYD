const EGDATA_API_URL = "https://api.egdata.app";
const REQUEST_TIMEOUT_MS = 12000;

const normalizeTitle = value =>
    String(value || "")
        .normalize("NFKC")
        .replace(/[™®©]/g, "")
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

const requestJson = async url => {
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
    } catch {
        return null;
    }

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        return null;
    }

    try {
        return await response.json();
    } catch {
        return null;
    }
};

const findEpicOffer = async (
    title,
    locale = "es-ES"
) => {
    const normalizedTitle = normalizeTitle(title);

    if (!normalizedTitle) {
        return null;
    }

    const params = new URLSearchParams({
        query: String(title).trim(),
        limit: "20",
        locale
    });

    const result = await requestJson(
        `${EGDATA_API_URL}/autocomplete?${params.toString()}`
    );

    const offers = Array.isArray(result?.elements)
        ? result.elements
        : [];

    const exactMatches = offers.filter(offer =>
        normalizeTitle(offer?.title) === normalizedTitle
    );

    if (!exactMatches.length) {
        return null;
    }

    const isEdition =
        /\b(ultimate|complete|deluxe|definitive|anniversary|game of the year|goty)\b/i
            .test(normalizedTitle);

    if (isEdition) {
        return exactMatches.find(offer =>
            String(
                offer?.offerType || ""
            ).toUpperCase() === "EDITION"
        ) || exactMatches.find(offer =>
            String(
                offer?.offerType || ""
            ).toUpperCase() === "OTHERS"
        ) || exactMatches[0];
    }

    return exactMatches.find(offer =>
        String(
            offer?.offerType || ""
        ).toUpperCase() === "BASE_GAME"
    ) || exactMatches[0];
};

const getEpicOfferPrice = async (
    offerId,
    country = "ES"
) => {
    const id = String(offerId || "").trim();

    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
        return null;
    }

    const params = new URLSearchParams({
        country
    });

    return requestJson(
        `${EGDATA_API_URL}/offers/${encodeURIComponent(id)}/price?${params.toString()}`
    );
};

const getEpicProductSlug = offer => {
    const mapping = offer?.offerMappings?.find(
        item => item?.pageType === "productHome" &&
            typeof item.pageSlug === "string"
    );

    const slug =
        mapping?.pageSlug ||
        offer?.productSlug ||
        offer?.urlSlug ||
        null;

    if (typeof slug !== "string") {
        return null;
    }

    return slug
        .replace(/^\/?p\//, "")
        .split("/")[0]
        .trim() || null;
};

const getEpicPrice = async (
    title,
    country = "ES",
    locale = "es-ES"
) => {
    const offer = await findEpicOffer(
        title,
        locale
    );

    if (!offer?.id) {
        return null;
    }

    const priceResult = await getEpicOfferPrice(
        offer.id,
        country
    );

    const price = priceResult?.price;

    if (
        price?.discountPrice == null ||
        price?.originalPrice == null
    ) {
        return null;
    }

    const currentPrice = Number(
        price.discountPrice
    );

    const originalPrice = Number(
        price.originalPrice
    );

    if (
        !Number.isFinite(currentPrice) ||
        !Number.isFinite(originalPrice) ||
        currentPrice <= 0 ||
        originalPrice <= 0
    ) {
        return null;
    }

    const currency =
        price.currencyCode || "EUR";

    const cut =
        originalPrice > currentPrice &&
        originalPrice > 0
            ? Math.round(
                (1 - currentPrice / originalPrice) * 100
            )
            : 0;

    const slug = getEpicProductSlug(offer);

    return {
        shop: {
            id: "epic-games",
            name: "Epic Games Store"
        },

        price: {
            amount: currentPrice / 100,
            amountInt: currentPrice,
            currency
        },

        regular: {
            amount: originalPrice / 100,
            amountInt: originalPrice,
            currency
        },

        cut,
        voucher: null,
        storeLow: null,
        drm: [{
            id: "epic-games",
            name: "Epic Games Store"
        }],

        platforms: [{
            id: "windows",
            name: "Windows"
        }],

        url: slug
            ? `https://store.epicgames.com/p/${slug}`
            : null,

        offerId: offer.id,
        namespace: offer.namespace || null,
        source: "egdata"
    };
};

module.exports = {
    getEpicPrice
};