const {
    getIGNChecklists,
    getIGNChecklistDetails,
    getIGNWikiPage,
    getIGNContentPage
} = require("./ign-checklists.service");

const IGN_SOURCE_NAME = "IGN";
const IGN_SOURCE_LICENSE = "Used with attribution and permission granted by the project owner.";
const IGN_ATTRIBUTION = "Checklist and guide content provided by IGN.";
const CACHE_VERSION = 5;
const EMPTY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const ROMAN_NUMERALS = {
    1: "i",
    2: "ii",
    3: "iii",
    4: "iv",
    5: "v",
    6: "vi",
    7: "vii",
    8: "viii",
    9: "ix",
    10: "x",
    11: "xi",
    12: "xii"
};
const ARABIC_NUMERALS = Object.fromEntries(
    Object.entries(ROMAN_NUMERALS).map(([number, roman]) => [roman, number])
);

const getIGNGameSlugCandidates = (...slugs) => {
    const candidates = new Set();
    slugs.forEach(value => {
        if (typeof value !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return;
        candidates.add(value);
        const parts = value.split("-");
        parts.forEach((part, index) => {
            if (ARABIC_NUMERALS[part]) {
                const replaced = [...parts];
                replaced[index] = ARABIC_NUMERALS[part];
                candidates.add(replaced.join("-"));
            } else if (ROMAN_NUMERALS[part]) {
                const replaced = [...parts];
                replaced[index] = ROMAN_NUMERALS[part];
                candidates.add(replaced.join("-"));
            }
        });
    });
    return [...candidates];
};

const getIGNResource = async (supabase, gameId, url, load) => {
    const { data: cachedRow, error: readError } = await supabase
        .from("game_missions")
        .select("content")
        .eq("igdb_game_id", gameId)
        .eq("record_type", "cache")
        .eq("source_name", IGN_SOURCE_NAME)
        .eq("mission_url", url)
        .maybeSingle();
    if (readError) throw readError;

    const cached = cachedRow?.content;
    if (cached?.ign_cache_version === CACHE_VERSION &&
        Object.hasOwn(cached, "ign_payload") &&
        (!cached.expires_at || Date.parse(cached.expires_at) > Date.now())) {
        return cached.ign_payload;
    }

    const payload = await load();
    if (payload === null) return null;

    const fetchedAt = new Date().toISOString();
    const content = {
        ign_cache_version: CACHE_VERSION,
        ign_payload: payload,
        fetched_at: fetchedAt
    };
    if (payload.total === 0 && Array.isArray(payload.checklists)) {
        content.expires_at = new Date(Date.now() + EMPTY_CACHE_TTL_MS).toISOString();
    }
    const { error: saveError } = await supabase
        .from("game_missions")
        .upsert({
            igdb_game_id: gameId,
            record_type: "cache",
            category: "other",
            title: typeof payload.title === "string" && payload.title
                ? payload.title
                : url,
            mission_url: url,
            source_name: IGN_SOURCE_NAME,
            source_page_url: url,
            source_license: IGN_SOURCE_LICENSE,
            attribution: IGN_ATTRIBUTION,
            content
        }, {
            onConflict: "igdb_game_id,record_type,source_name,mission_url"
        });
    if (saveError) throw saveError;
    return payload;
};

const getIGNChecklistsCached = async (
    supabase,
    gameId,
    gameSlug,
    nameSlug = null
) => {
    let firstEmptyResult = null;
    let lastError = null;
    for (const candidate of getIGNGameSlugCandidates(gameSlug, nameSlug)) {
        const url = `https://www.ign.com/games/${candidate}/checklists`;
        try {
            const result = await getIGNResource(supabase, gameId, url, () =>
                getIGNChecklists(candidate)
            );
            if (result?.checklists?.length) return result;
            firstEmptyResult ||= result;
        } catch (error) {
            lastError = error;
        }
    }
    if (firstEmptyResult) return firstEmptyResult;
    if (lastError) throw lastError;
    return { game: gameSlug, total: 0, checklists: [] };
};

const getIGNChecklistDetailsCached = async (
    supabase,
    gameId,
    gameSlug,
    checklistSlug,
    nameSlug = null
) => {
    const checklists = await getIGNChecklistsCached(
        supabase,
        gameId,
        gameSlug,
        nameSlug
    );
    const resolvedSlug = checklists?.game || gameSlug;
    const checklist = checklists?.checklists.find(
        item => item.slug === checklistSlug
    );
    if (!checklist) return null;
    return getIGNResource(supabase, gameId, checklist.url, () =>
        getIGNChecklistDetails(resolvedSlug, checklistSlug)
    );
};

const getIGNWikiPageCached = async (supabase, gameId, gameSlug, url) => {
    const pageUrl = new URL(url);
    if (pageUrl.protocol !== "https:" ||
        pageUrl.origin !== "https://www.ign.com" ||
        !pageUrl.pathname.startsWith(`/wikis/${gameSlug}/`)) {
        throw new Error("IGN wiki page URL is not allowed.");
    }

    return getIGNResource(supabase, gameId, pageUrl.href, () =>
        getIGNWikiPage(gameSlug, pageUrl.href)
    );
};

const getIGNContentPageCached = async (supabase, gameId, url) => {
    let pageUrl;
    try {
        pageUrl = new URL(url);
    } catch {
        throw new Error("IGN page URL is invalid.");
    }
    if (pageUrl.protocol !== "https:" || pageUrl.origin !== "https://www.ign.com") {
        throw new Error("IGN page URL is not allowed.");
    }
    return getIGNResource(supabase, gameId, pageUrl.href, () =>
        getIGNContentPage(pageUrl.href)
    );
};

const getIGNChecklistGuideCached = async (
    supabase,
    gameId,
    gameSlug,
    checklistSlug,
    taskId,
    guideIndex,
    nameSlug = null
) => {
    const details = await getIGNChecklistDetailsCached(
        supabase,
        gameId,
        gameSlug,
        checklistSlug,
        nameSlug
    );
    const task = details?.tasks.find(item => String(item.id) === String(taskId));
    const guide = task?.guidePages[guideIndex];
    if (!guide) return null;
    const resolvedSlug = new URL(guide.url).pathname.split("/")[2];
    const page = await getIGNWikiPageCached(
        supabase,
        gameId,
        resolvedSlug,
        guide.url
    );
    if (!page) return null;
    return {
        ...page,
        title: guide.title || page.title,
        task: task.name,
        url: guide.url,
        attribution: "Guide content provided by IGN.",
        sourceName: IGN_SOURCE_NAME
    };
};

module.exports = {
    getIGNChecklistsCached,
    getIGNChecklistDetailsCached,
    getIGNChecklistGuideCached,
    getIGNContentPageCached,
    getIGNWikiPageCached,
    getIGNGameSlugCandidates
};
