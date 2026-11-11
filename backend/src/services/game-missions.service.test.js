const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getGameMissionDetails,
    getGameMissions,
    parseMissionArticle,
    parseMissionPage
} = require("./game-missions.service");

test("parses mission names, table details, and regional grouping", () => {
    const source = {
        category: "side",
        page: "The_Witcher_3_secondary_quests",
        baseUrl: "https://witcher.fandom.com",
        url: "https://witcher.fandom.com/wiki/The_Witcher_3_secondary_quests"
    };
    const html = `
        <div class="mw-parser-output">
            <h2><span class="mw-headline">Velen</span></h2>
            <table class="fandom-table sortable">
                <tr><th>Quest</th><th>Level</th><th>Location</th></tr>
                <tr>
                    <td><input disabled></td>
                    <td><a href="/wiki/A_Towerful_of_Mice_(quest)">A Towerful of Mice</a></td>
                    <td>15</td><td>Fyke Isle</td>
                </tr>
                <tr>
                    <td><input disabled></td>
                    <td><a href="/wiki/For_the_Advancement_of_Learning_(quest)">For the Advancement of Learning</a></td>
                    <td>18</td><td>Fyke Isle</td>
                </tr>
            </table>
        </div>`;

    const missions = parseMissionPage(html, source);
    assert.equal(missions.length, 2);
    assert.equal(missions[0].category, "side");
    assert.equal(missions[0].group_name, "Velen");
    assert.equal(missions[0].title, "A Towerful of Mice");
    assert.equal(
        missions[0].mission_url,
        "https://witcher.fandom.com/wiki/A_Towerful_of_Mice_(quest)"
    );
    assert.equal(missions[0].description, "Level: 15 · Location: Fyke Isle");
});

test("detects quest categories in expansion page sections", () => {
    const source = {
        group: "Hearts of Stone",
        page: "Hearts_of_Stone_quests",
        url: "https://witcher.fandom.com/wiki/Hearts_of_Stone_quests"
    };
    const html = `
        <div class="mw-parser-output">
            <h2><span class="mw-headline">Main quests</span></h2>
            <table class="fandom-table">
                <tr><th>Quest</th><th>Level</th></tr>
                <tr><td><a href="/wiki/Dead_Man%27s_Party">Dead Man's Party</a></td><td>33</td></tr>
            </table>
            <h2><span class="mw-headline">Secondary quests</span></h2>
            <table class="fandom-table">
                <tr><th>Quest</th><th>Level</th></tr>
                <tr><td><a href="/wiki/Of_Leather_and_Darkness">Of Leather and Darkness</a></td><td>32</td></tr>
            </table>
        </div>`;

    const missions = parseMissionPage(html, source);
    assert.equal(missions.length, 2);
    assert.equal(missions[0].category, "main");
    assert.equal(missions[0].group_name, "Hearts of Stone");
    assert.equal(missions[1].category, "side");
    assert.equal(missions[1].group_name, "Hearts of Stone");
});

test("extracts sanitized article HTML and media references", () => {
    const article = parseMissionArticle(`
        <div class="mw-parser-output">
            <div class="toc"><a href="#contents">Contents</a></div>
            <h2>Walkthrough</h2>
            <p>Find the <strong>hidden key</strong> in the old tower.</p>
            <p><a href="/wiki/Old_Tower">Old Tower</a></p>
            <p><a href="javascript:alert(1)" onclick="alert(2)">Unsafe link</a></p>
            <figure>
                <a href="/wiki/File:Quest_map.jpg">
                    <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                         data-src="//static.wikia.nocookie.net/witcher/images/quest-map.jpg"
                         alt="Quest map">
                </a>
                <figcaption>Map of the tower</figcaption>
            </figure>
            <iframe src="https://www.youtube.com/embed/example" title="Quest video"></iframe>
            <h2>Notes</h2><p>Unrelated notes must not be imported.</p>
            <h2>Bugs</h2><p>Unrelated bugs must not be imported.</p>
            <h2>Videos</h2><p>Wiki video gallery must not be imported.</p>
            <script>alert("not content")</script>
        </div>
    `, "https://witcher.fandom.com/wiki/Example_quest");

    assert.match(article.html, /<h2>Walkthrough<\/h2>/);
    assert.match(article.html, /<strong>hidden key<\/strong>/);
    assert.match(article.html, /href="https:\/\/witcher\.fandom\.com\/wiki\/Old_Tower"/);
    assert.match(article.html, /Unsafe link/);
    assert.match(article.html, /<img data-mission-media-index="0" alt="Quest map">/);
    assert.match(article.html, /<span data-mission-media-index="1"><\/span>/);
    assert.doesNotMatch(
        article.html,
        /Contents|alert|onclick|<script|Unrelated notes|Unrelated bugs|Wiki video gallery/
    );
    assert.equal(article.media.length, 2);
    assert.equal(article.media[0].file_title, "File:Quest map.jpg");
    assert.equal(article.media[0].source_url,
        "https://static.wikia.nocookie.net/witcher/images/quest-map.jpg");
    assert.equal(article.media[1].type, "video");
    assert.equal(article.media[1].source_url,
        "https://www.youtube.com/embed/example");
});

test("keeps readable article content when a wiki page has no section headings", () => {
    const article = parseMissionArticle(`
        <div class="mw-parser-output">
            <p>This mission page uses plain paragraphs instead of headings.</p>
            <ul><li>Reach the marked location.</li></ul>
            <div class="navbox">Navigation that should be omitted.</div>
        </div>
    `, "https://example.org/wiki/mission");

    assert.match(article.html, /This mission page uses plain paragraphs/);
    assert.match(article.html, /Reach the marked location/);
    assert.doesNotMatch(article.html, /Navigation that should be omitted/);
});

test("marks small inline mission icons so they stay alongside text", () => {
    const article = parseMissionArticle(`
        <div class="mw-parser-output">
            <h2>Objectives</h2>
            <p>Gain (150 <img
                src="//static.wikia.nocookie.net/witcher/images/xp.png"
                width="18" height="18" alt="experience points">).</p>
        </div>
    `, "https://witcher.fandom.com/wiki/Example_quest");

    assert.equal(article.media.length, 1);
    assert.equal(article.media[0].inline, true);
    assert.match(article.html, /data-mission-media-index="0"/);
});

test("serves a cached mission list without contacting the source", async () => {
    let fetchCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        fetchCalls += 1;
        throw new Error("A cache hit must not fetch the wiki.");
    };

    const cachedMission = {
        title: "Kaer Morhen",
        category: "main",
        mission_url: "https://example.org/wiki/Kaer_Morhen"
    };
    const configuredSource = {
        record_type: "source",
        title: "Main quests",
        mission_url: "https://example.org/wiki/Main_quests",
        source_page_url: "https://example.org",
        source_name: "Example Wiki",
        category: "main",
        source_license: "CC BY-SA 4.0",
        attribution: "Example Wiki contributors",
        content: {
            wiki_base_url: "https://example.org",
            api_url: "/api.php",
            page: "Main_quests"
        }
    };
    const supabase = {
        from() {
            let filters = {};
            return {
                select() {
                    return this;
                },
                eq(column, value) {
                    filters[column] = value;
                    return this;
                },
                maybeSingle: async () => filters.record_type === "cache"
                    ? {
                        data: {
                            source_name: "Example Wiki",
                            source_page_url: "https://example.org/wiki/Main_quests",
                            source_license: "CC BY-SA 4.0",
                            attribution: "Example Wiki contributors",
                            content: { fetched_at: "2026-11-09T00:00:00.000Z" }
                        },
                        error: null
                    }
                    : { data: null, error: null },
                order: async () => {
                    if (filters.record_type === "source") {
                        return { data: [configuredSource], error: null };
                    }
                    return {
                        data: filters.record_type === "mission" ? [cachedMission] : [],
                        error: null
                    };
                }
            };
        }
    };

    try {
        const result = await getGameMissions(supabase, {
            id: 123,
            name: "A Different Game"
        });
        assert.equal(result.supported, true);
        assert.deepEqual(result.missions, [cachedMission]);
        assert.equal(fetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test("imports a new game's missions from a configured MediaWiki source", async () => {
    const originalFetch = global.fetch;
    global.fetch = async url => {
        const request = new URL(url);
        assert.equal(request.pathname, "/w/api.php");
        assert.equal(request.searchParams.get("page"), "Example_jobs");
        return {
            ok: true,
            json: async () => ({
                parse: {
                    text: {
                        "*": `
                            <div class="mw-parser-output">
                                <h2>Jobs</h2>
                                <table class="wikitable">
                                    <tr><th>Job</th><th>Region</th></tr>
                                    <tr><td><a href="/wiki/First_Job">First Job</a></td><td>North</td></tr>
                                </table>
                                <ul><li><a href="/wiki/Second_Job">Second Job</a></li></ul>
                            </div>
                        `
                    }
                }
            })
        };
    };

    const configuredSources = [{
        igdb_game_id: 8675309,
        record_type: "source",
        source_name: "Example Wiki",
        title: "Example_jobs",
        mission_url: "https://example.org/wiki/Example_jobs",
        source_page_url: "https://example.org",
        category: "other",
        source_license: "CC BY-SA 4.0",
        attribution: "Example Wiki contributors",
        sort_order: 0,
        content: {
            wiki_base_url: "https://example.org",
            api_url: "/w/api.php",
            page: "Example_jobs",
            group_name: "Campaign",
            parse_lists: true,
            enabled: true
        }
    }];
    let upsertedMissions = [];
    const existingMission = {
        id: 7001,
        source_name: "Example Wiki",
        mission_url: "https://example.org/wiki/First_Job",
        article_content: "<p>Previously cached article.</p>",
        article_format: "structured-v3",
        media: [],
        content_fetched_at: "2026-11-10T00:00:00.000Z",
        content_revision_id: 123,
        content: {
            article_content: "<p>Previously cached article.</p>",
            article_format: "structured-v3",
            content_fetched_at: "2026-11-10T00:00:00.000Z",
            content_revision_id: 123
        }
    };
    const supabase = {
        from(table) {
            let filters = {};
            const query = {
                select() {
                    return this;
                },
                eq(column, value) {
                    filters[column] = value;
                    return this;
                },
                in() {
                    return this;
                },
                order: async () => {
                    if (filters.record_type === "source") {
                        return { data: configuredSources, error: null };
                    }
                    return {
                        data: upsertedMissions.map((mission, index) => ({
                            ...mission,
                            id: 7000 + index
                        })),
                        error: null
                    };
                },
                maybeSingle: async () => ({ data: null, error: null }),
                upsert(rows) {
                    if (rows[0]?.record_type === "mission") upsertedMissions = rows;
                    return Promise.resolve({ error: null });
                },
                then(resolve, reject) {
                    return Promise.resolve({
                        data: filters.record_type === "mission" ? [existingMission] : [],
                        error: null
                    }).then(resolve, reject);
                }
            };
            return query;
        }
    };

    try {
        const result = await getGameMissions(supabase, {
            id: 8675309,
            name: "A Different Game"
        });
        assert.equal(result.supported, true);
        assert.equal(result.source.source_name, "Example Wiki");
        assert.equal(result.missions.length, 2);
        assert.deepEqual(result.missions.map(mission => mission.category), ["other", "other"]);
        assert.deepEqual(
            result.missions.map(mission => mission.title),
            ["First Job", "Second Job"]
        );
        assert.match(
            upsertedMissions.find(mission => mission.title === "First Job")
                .content.article_content,
            /Previously cached article/
        );
        assert.equal(upsertedMissions[0].content.title, "First Job");
        assert.equal(upsertedMissions[0].content.source.license, "CC BY-SA 4.0");
        assert.ok(result.missions.every(mission =>
            mission.mission_url.startsWith("https://example.org/wiki/")
        ));
    } finally {
        global.fetch = originalFetch;
    }
});

test("does not fetch missions for games without an explicitly configured source", async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unconfigured games must not trigger upstream requests.");
    };
    let sourceQueryCount = 0;
    const supabase = {
        from() {
            return {
                select() {
                    return this;
                },
                eq(column, value) {
                    if (column === "record_type" && value === "source") {
                        sourceQueryCount += 1;
                    }
                    return this;
                },
                order: async () => ({ data: [], error: null })
            };
        }
    };

    try {
        const result = await getGameMissions(supabase, {
            id: 987654,
            name: "Unconfigured Game"
        });
        assert.deepEqual(result, {
            supported: false,
            missions: [],
            source: null
        });
        assert.equal(sourceQueryCount, 1);
        assert.equal(fetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test("stores complete mission text and revision metadata on first open", async () => {
    const originalFetch = global.fetch;
    const originalMission = {
        id: 8,
        category: "side",
        title: "An Example Quest",
        mission_url: "https://example.org/wiki/An_Example_Quest",
        source_page_url: "https://example.org/wiki/Example_quests",
        source_name: "Example Wiki",
        source_license: "CC BY-SA 4.0",
        attribution: "Example Wiki contributors",
        article_content: null,
        article_format: "text",
        media: [],
        content_fetched_at: null,
        content_revision_id: null
    };
    const configuredSource = {
        title: "Example_quests",
        category: "other",
        mission_url: "https://example.org/wiki/Example_quests",
        source_name: "Example Wiki",
        source_page_url: "https://example.org",
        source_license: "CC BY-SA 4.0",
        attribution: "Example Wiki contributors",
        content: {
            wiki_base_url: "https://example.org",
            api_url: "/api.php",
            page: "Example_quests"
        }
    };
    let updateValues;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            parse: {
                title: "An Example Quest",
                revid: 98765,
                text: {
                    "*": "<div class='mw-parser-output'><h2>Walkthrough</h2><p>Find the key.</p></div>"
                }
            }
        })
    });
    const query = {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        order: async () => ({ data: [configuredSource], error: null }),
        maybeSingle: async () => ({ data: originalMission, error: null }),
        update(values) {
            updateValues = values;
            return this;
        },
        single: async () => ({
            data: { ...originalMission, ...updateValues },
            error: null
        })
    };
    const supabase = { from: () => query };

    try {
        const result = await getGameMissionDetails(supabase, 123, 8);
        assert.match(result.article_content, /<h2>Walkthrough<\/h2>/);
        assert.match(result.article_content, /<p>Find the key\.<\/p>/);
        assert.equal(result.content_revision_id, 98765);
        assert.equal(result.article_format, "structured-v3");
        assert.ok(result.content_fetched_at);
        assert.deepEqual(result.media, []);
        assert.equal(updateValues.article_content, result.article_content);
    } finally {
        global.fetch = originalFetch;
    }
});

test("loads a configured game's mission detail from its MediaWiki API", async () => {
    const originalFetch = global.fetch;
    const mission = {
        id: 21,
        category: "other",
        title: "First Job",
        mission_url: "https://example.org/wiki/First_Job",
        source_name: "Example Wiki",
        article_content: null,
        article_format: "text",
        media: [],
        content_fetched_at: null
    };
    const sourceRows = [{
        record_type: "source",
        source_name: "Example Wiki",
        title: "Example_jobs",
        mission_url: "https://example.org/wiki/Example_jobs",
        source_page_url: "https://example.org",
        category: "other",
        source_license: "CC BY-SA 4.0",
        attribution: "Example Wiki contributors",
        content: {
            wiki_base_url: "https://example.org",
            api_url: "/w/api.php",
            page: "Example_jobs"
        }
    }];
    global.fetch = async url => {
        const request = new URL(url);
        assert.equal(request.pathname, "/w/api.php");
        assert.equal(request.searchParams.get("page"), "First Job");
        return {
            ok: true,
            json: async () => ({
                parse: {
                    revid: 31415,
                    text: {
                        "*": "<div class='mw-parser-output'><h2>Walkthrough</h2><p>Complete walkthrough.</p></div>"
                    }
                }
            })
        };
    };

    let updateValues;
    const supabase = {
        from(table) {
            const query = {
                select() {
                    return this;
                },
                eq() {
                    return this;
                },
                order() {
                    return this;
                },
                maybeSingle: async () => ({ data: mission, error: null }),
                update(values) {
                    updateValues = values;
                    return this;
                },
                single: async () => ({
                    data: { ...mission, ...updateValues },
                    error: null
                }),
                order() {
                    return this;
                },
                then(resolve, reject) {
                    return Promise.resolve({
                        data: sourceRows,
                        error: null
                    }).then(resolve, reject);
                }
            };
            assert.equal(table, "game_missions");
            return query;
        }
    };

    try {
        const result = await getGameMissionDetails(supabase, 8675309, 21);
        assert.match(result.article_content, /Complete walkthrough/);
        assert.equal(result.content_revision_id, 31415);
        assert.equal(result.article_format, "structured-v3");
        assert.equal(updateValues.content.article_content, result.article_content);
    } finally {
        global.fetch = originalFetch;
    }
});

test("does not fetch mission details without an explicitly configured source", async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unconfigured missions must not trigger upstream requests.");
    };
    const mission = {
        id: 697,
        category: "main",
        title: "Boys Will Be Boys",
        mission_url: "https://example.org/wiki/Example_Mission",
        source_page_url: "https://example.org/wiki/Example_quests",
        source_name: "Example Wiki",
        source_license: "CC-BY-SA",
        attribution: "Example Wiki contributors",
        article_content: null,
        article_format: "text",
        media: [],
        content_fetched_at: null
    };
    const supabase = {
        from(table) {
            return {
                select() {
                    return this;
                },
                eq() {
                    return this;
                },
                order() {
                    return this;
                },
                maybeSingle: async () => table === "game_missions"
                    ? { data: mission, error: null }
                    : { data: null, error: null },
                then(resolve, reject) {
                    return Promise.resolve({
                        data: [],
                        error: null
                    }).then(resolve, reject);
                }
            };
        }
    };

    try {
        await assert.rejects(
            getGameMissionDetails(supabase, 127, 697),
            /Mission source is not an enabled wiki provider/
        );
        assert.equal(fetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
    }
});
