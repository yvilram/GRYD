const assert = require("node:assert/strict");
const test = require("node:test");
const LZString = require("lz-string");
const {
    getIGNChecklistsCached,
    getIGNChecklistDetailsCached,
    getIGNChecklistGuideCached,
    getIGNContentPageCached,
    getIGNWikiPageCached,
    getIGNGameSlugCandidates
} = require("./ign-checklists-cache.service");

const pageWithApollo = apollo => {
    const serialized = JSON.stringify({
        props: {
            apolloState: LZString.compressToUTF16(JSON.stringify(apollo))
        }
    });
    return `<script id="__NEXT_DATA__" type="application/json">${serialized}</script>`;
};

const indexApollo = gameSlug => ({
    "Checklist:10": {
        __typename: "Checklist",
        id: 10,
        slug: "main-quests",
        name: "Main Quests",
        taskCount: 1,
        category: { __ref: "ChecklistCategory:1" },
        taskJoins: [{ checklistTaskId: 20, checklistGroupId: 30 }]
    },
    "ChecklistCategory:1": {
        __typename: "ChecklistCategory",
        id: 1,
        name: "Quests"
    }
});

const checklistApollo = (
    gameSlug,
    wikiSlug = gameSlug,
    taskName = "Find the guide",
    guideTitle = "Main Quest Guide",
    guideFragment = "find-the-guide"
) => ({
    "Checklist:10": {
        __typename: "Checklist",
        id: 10,
        slug: "main-quests",
        name: "Main Quests",
        taskCount: 1,
        taskJoins: [{ checklistTaskId: 20, checklistGroupId: 30 }]
    },
    "ChecklistTask:20": {
        __typename: "ChecklistTask",
        id: 20,
        name: taskName,
        guidePages: [{
            title: guideTitle,
            wikiUrl: `/wikis/${wikiSlug}/Main_Quest_Guide#${guideFragment}`
        }]
    },
    "ChecklistGroup:30": {
        __typename: "ChecklistGroup",
        id: 30,
        name: "Kaer Morhen"
    }
});

const createSupabaseCache = () => {
    const records = new Map();
    return {
        records,
        from(table) {
            assert.equal(table, "game_missions");
            const filters = {};
            return {
                select() {
                    return this;
                },
                eq(column, value) {
                    filters[column] = value;
                    return this;
                },
                maybeSingle: async () => ({
                    data: records.get(
                        `${filters.igdb_game_id}:${filters.source_name}:${filters.mission_url}`
                    ) || null,
                    error: null
                }),
                upsert: async row => {
                    records.set(
                        `${row.igdb_game_id}:${row.source_name}:${row.mission_url}`,
                        row
                    );
                    return { error: null };
                }
            };
        }
    };
};

test("persists IGN pages and returns the database copy on subsequent requests", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return {
            status: 200,
            text: async () => `
                <h1>Yennefer of Vengerberg</h1>
                <div class="wiki-html">
                    <h2>Biography</h2>
                    <p>Biography content.</p>
                </div>
            `
        };
    };

    try {
        const url = "https://www.ign.com/wikis/the-witcher-3/Yennefer_of_Vengerberg";
        const first = await getIGNWikiPageCached(
            supabase,
            123,
            "the-witcher-3",
            url
        );
        const second = await getIGNWikiPageCached(
            supabase,
            123,
            "the-witcher-3",
            url
        );

        assert.deepEqual(second, first);
        assert.equal(fetchCalls, 1);
        assert.equal(supabase.records.size, 1);
        const [row] = supabase.records.values();
        assert.equal(row.record_type, "cache");
        assert.equal(row.category, "other");
        assert.equal(row.content.ign_cache_version, 5);
        assert.match(row.content.ign_payload.articleContent, /Biography content/);
        assert.equal(row.attribution, "Checklist and guide content provided by IGN.");
    } finally {
        global.fetch = originalFetch;
    }
});

test("refuses to fetch or cache wiki pages outside the game's IGN wiki", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("Untrusted pages must not be fetched.");
    };
    try {
        await assert.rejects(
            getIGNWikiPageCached(
                supabase,
                123,
                "the-witcher-3",
                "https://attacker.example/wikis/the-witcher-3/Yennefer"
            ),
            /not allowed/
        );
        assert.equal(supabase.records.size, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test("caches internal IGN pages outside the wiki path", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return {
            status: 200,
            text: async () => `
                <h1>Quest walkthrough</h1>
                <article><p>Walkthrough content.</p></article>
            `
        };
    };

    try {
        const url = "https://www.ign.com/videos/quest-walkthrough";
        const first = await getIGNContentPageCached(supabase, 123, url);
        const second = await getIGNContentPageCached(supabase, 123, url);

        assert.deepEqual(second, first);
        assert.equal(fetchCalls, 1);
        assert.equal(supabase.records.size, 1);
        assert.match(first.articleContent, /Walkthrough content/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("refuses non-IGN content pages before fetching", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("Untrusted pages must not be fetched.");
    };
    try {
        await assert.rejects(
            getIGNContentPageCached(
                supabase,
                123,
                "https://ign.com/videos/quest-walkthrough"
            ),
            /not allowed/
        );
        assert.equal(supabase.records.size, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test("generates equivalent Roman and Arabic game slug candidates", () => {
    assert.deepEqual(getIGNGameSlugCandidates("grand-theft-auto-v"), [
        "grand-theft-auto-v",
        "grand-theft-auto-5"
    ]);
    assert.deepEqual(getIGNGameSlugCandidates("grand-theft-auto-5"), [
        "grand-theft-auto-5",
        "grand-theft-auto-v"
    ]);
});

test("resolves an IGN checklist slug when its Roman numeral differs", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    const requestedUrls = [];
    global.fetch = async url => {
        requestedUrls.push(url);
        if (url.endsWith("/grand-theft-auto-v/checklists")) {
            return { status: 404 };
        }
        return {
            status: 200,
            text: async () => pageWithApollo({
                "Checklist:10": {
                    __typename: "Checklist",
                    id: 10,
                    slug: "story-missions",
                    name: "Story Missions",
                    taskCount: 1
                }
            })
        };
    };
    try {
        const result = await getIGNChecklistsCached(
            supabase,
            789,
            "grand-theft-auto-v"
        );
        assert.equal(result.game, "grand-theft-auto-5");
        assert.equal(result.checklists[0].name, "Story Missions");
        assert.deepEqual(requestedUrls, [
            "https://www.ign.com/games/grand-theft-auto-v/checklists",
            "https://www.ign.com/games/grand-theft-auto-5/checklists"
        ]);
    } finally {
        global.fetch = originalFetch;
    }
});

test("persists checklist sections, tasks, and guide content in game_missions", async () => {
    const supabase = createSupabaseCache();
    const originalFetch = global.fetch;
    const requested = [];
    global.fetch = async url => {
        requested.push(url);
        if (url.endsWith("/checklists")) {
            return {
                status: 200,
                text: async () => pageWithApollo(indexApollo("cached-game"))
            };
        }
        if (url.endsWith("/checklists/main-quests")) {
            return {
                status: 200,
                text: async () => pageWithApollo(
                    checklistApollo(
                        "the-legend-of-zelda-ocarina-of-time",
                        "ocarina-of-time-remake",
                        "Link Wakes Up Complete",
                        "Kokiri Forest Walkthrough",
                        "link-wakes-up-complete"
                    )
                )
            };
        }
        return {
            status: 200,
            text: async () => `
                <h1>Main Quest Guide</h1>
                <div class="wiki-html">
                    <h2 id="link-wakes-up-complete">Link Wakes Up Complete</h2>
                    <p>Kokiri Forest walkthrough content.</p>
                </div>
            `
        };
    };

    try {
        const index = await getIGNChecklistsCached(supabase, 456, "cached-game");
        const checklist = await getIGNChecklistDetailsCached(
            supabase,
            456,
            "cached-game",
            "main-quests"
        );
        const guide = await getIGNChecklistGuideCached(
            supabase,
            456,
            "cached-game",
            "main-quests",
            20,
            0
        );

        assert.equal(index.checklists[0].name, "Main Quests");
        assert.equal(checklist.tasks[0].group, "Kaer Morhen");
        assert.match(guide.articleContent, /Kokiri Forest walkthrough content/);
        assert.equal(
            guide.url,
            "https://www.ign.com/wikis/ocarina-of-time-remake/Main_Quest_Guide#link-wakes-up-complete"
        );
        assert.equal(guide.title, "Kokiri Forest Walkthrough");
        assert.match(guide.text, /Kokiri Forest walkthrough content/);
        assert.equal(supabase.records.size, 3);
        assert.equal(requested.length, 3);
        assert.ok([...supabase.records.values()].every(row =>
            row.igdb_game_id === 456 &&
            row.record_type === "cache" &&
            row.content.ign_cache_version === 5
        ));
        const cachedChecklist = [...supabase.records.values()].find(
            row => row.mission_url.endsWith("/checklists/main-quests")
        );
        assert.equal(
            cachedChecklist.content.ign_payload.tasks[0].group,
            "Kaer Morhen"
        );
    } finally {
        global.fetch = originalFetch;
    }
});
