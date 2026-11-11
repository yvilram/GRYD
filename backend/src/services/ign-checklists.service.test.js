const assert = require("node:assert/strict");
const test = require("node:test");
const LZString = require("lz-string");
const {
    getIGNChecklists,
    getIGNChecklistDetails,
    getIGNChecklistGuide,
    getIGNContentPage,
    extractIGNGuideContent
} = require("./ign-checklists.service");

const pageWithApollo = apollo => {
    const serialized = JSON.stringify({
        props: {
            apolloState: LZString.compressToUTF16(JSON.stringify(apollo))
        }
    });
    return `<script id="__NEXT_DATA__" type="application/json">${serialized}</script>`;
};

const indexApollo = (gameSlug, overrides = {}) => ({
    "Checklist:10": {
        __typename: "Checklist",
        id: 10,
        slug: "main-quests",
        name: "Main Quests",
        imageUrl: null,
        taskCount: 1,
        category: { __ref: "ChecklistCategory:1" },
        taskJoins: [{ checklistTaskId: 20, checklistGroupId: 30 }]
    },
    "ChecklistCategory:1": {
        __typename: "ChecklistCategory",
        id: 1,
        name: "Quests"
    },
    ...overrides
});

const checklistApollo = (gameSlug, overrides = {}) => ({
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
        name: "Find the guide",
        guidePages: [{
            title: "Main Quest Guide",
            wikiUrl: `/wikis/${gameSlug}/Main_Quest_Guide#find-the-guide`
        }],
        map: { mapName: "The Lands Between" },
        mapUrl: `/maps/${gameSlug}/the-lands-between`,
        videos: [{
            start: 5,
            end: 15,
            video: {
                content: {
                    title: "Quest walkthrough",
                    url: "https://www.ign.com/videos/quest-walkthrough"
                }
            }
        }]
    },
    "ChecklistGroup:30": {
        __typename: "ChecklistGroup",
        id: 30,
        name: "Limgrave"
    },
    ...overrides
});

test("extracts checklist metadata from IGN Apollo data", async () => {
    const gameSlug = "test-game";
    let requestedUrl;
    const result = await getIGNChecklists(gameSlug, async url => {
        requestedUrl = url;
        return {
            status: 200,
            text: async () => pageWithApollo(indexApollo(gameSlug))
        };
    });

    assert.equal(requestedUrl, `https://www.ign.com/games/${gameSlug}/checklists`);
    assert.equal(result.total, 1);
    assert.deepEqual(result.checklists[0], {
        id: 10,
        name: "Main Quests",
        slug: "main-quests",
        url: `https://www.ign.com/games/${gameSlug}/checklists/main-quests`,
        imageUrl: null,
        taskCount: 1,
        category: "Quests"
    });
});

test("returns no checklists when IGN does not return HTTP 200", async () => {
    const result = await getIGNChecklists("nonexistent-game", async () => ({
        status: 404
    }));

    assert.deepEqual(result, {
        game: "nonexistent-game",
        total: 0,
        checklists: []
    });
});

test("loads checklist tasks, groups, guide pages, maps, and videos", async () => {
    const gameSlug = "tasks-game";
    const requestedUrls = [];
    const result = await getIGNChecklistDetails(
        gameSlug,
        "main-quests",
        async url => {
            requestedUrls.push(url);
            return {
                status: 200,
                text: async () => pageWithApollo(
                    url.endsWith("/checklists")
                        ? indexApollo(gameSlug)
                        : checklistApollo(gameSlug)
                )
            };
        }
    );

    assert.deepEqual(requestedUrls, [
        `https://www.ign.com/games/${gameSlug}/checklists`,
        `https://www.ign.com/games/${gameSlug}/checklists/main-quests`
    ]);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].name, "Find the guide");
    assert.equal(result.tasks[0].group, "Limgrave");
    assert.deepEqual(result.tasks[0].guidePages, [{
        title: "Main Quest Guide",
        url: `https://www.ign.com/wikis/${gameSlug}/Main_Quest_Guide#find-the-guide`
    }]);
    assert.deepEqual(result.tasks[0].map, {
        name: "The Lands Between",
        url: `https://www.ign.com/maps/${gameSlug}/the-lands-between`
    });
    assert.deepEqual(result.tasks[0].videos, [{
        title: "Quest walkthrough",
        url: "https://www.ign.com/videos/quest-walkthrough",
        start: 5,
        end: 15
    }]);
    assert.equal(result.source.name, "IGN");
    assert.equal(result.complete, true);
});

test("loads and sanitizes a task's IGN wiki guide", async () => {
    const gameSlug = "guide-game";
    const wikiSlug = "guide-game-remake";
    const requestedUrls = [];
    const result = await getIGNChecklistGuide(
        gameSlug,
        "main-quests",
        20,
        0,
        async url => {
            requestedUrls.push(url);
            if (url.endsWith("/checklists")) {
                return {
                    status: 200,
                    text: async () => pageWithApollo(indexApollo(gameSlug))
                };
            }
            if (url.endsWith("/checklists/main-quests")) {
                return {
                    status: 200,
                    text: async () => pageWithApollo(checklistApollo(gameSlug, {
                        "ChecklistTask:20": {
                            ...checklistApollo(gameSlug)["ChecklistTask:20"],
                            guidePages: [{
                                title: "Main Quest Guide",
                                wikiUrl: `/wikis/${wikiSlug}/Main_Quest_Guide#find-the-guide`
                            }]
                        }
                    }))
                };
            }
            return {
                status: 200,
                text: async () => `
                    <div class="wiki-html">
                        <h2 id="find-the-guide">Find the guide</h2>
                        <p>Guide content <a href="/wikis/${wikiSlug}/Related">Related</a></p>
                        <script>alert("unsafe")</script>
                        <a href="javascript:alert(1)">Unsafe link</a>
                    </div>
                `
            };
        }
    );

    assert.deepEqual(requestedUrls, [
        `https://www.ign.com/games/${gameSlug}/checklists`,
        `https://www.ign.com/games/${gameSlug}/checklists/main-quests`,
        `https://www.ign.com/wikis/${wikiSlug}/Main_Quest_Guide#find-the-guide`
    ]);
    assert.equal(result.title, "Main Quest Guide");
    assert.equal(result.task, "Find the guide");
    assert.equal(result.fragmentFound, true);
    assert.equal(result.extractionMethod, "fragment");
    assert.match(result.text, /Guide content/);
    assert.ok(result.sections.some(section => section.title === "Find the guide"));
    assert.match(result.articleContent, /Guide content/);
    assert.match(
        result.articleContent,
        /https:\/\/www\.ign\.com\/wikis\/guide-game-remake\/Related/
    );
    assert.doesNotMatch(result.articleContent, /<script|javascript:/i);
    assert.equal(result.sourceName, "IGN");
});

test("extracts only the IGN section targeted by a guide URL fragment", () => {
    const result = extractIGNGuideContent(`
        <h1>Quest Walkthrough</h1>
        <div class="wiki-html">
            <h2>Previous section</h2>
            <p>Do not include this content.</p>
            <h2 id="find-the-guide">Find the guide</h2>
            <p>First step. <a href="/wikis/guide-game/Related">Related</a></p>
            <img src="https://assets.ignimgs.com/guide-step.jpg" alt="Map">
            <h3>Step two</h3>
            <p>Second step.</p>
            <script>unsafe()</script>
            <h2 id="next-section">Next section</h2>
            <p>Do not include this either.</p>
        </div>
    `, "https://www.ign.com/wikis/guide-game/Quest_Walkthrough#find-the-guide");

    assert.equal(result.pageTitle, "Quest Walkthrough");
    assert.equal(result.fragment, "find-the-guide");
    assert.equal(result.fragmentFound, true);
    assert.equal(result.extractionMethod, "fragment");
    assert.match(result.text, /First step\./);
    assert.match(result.text, /Second step\./);
    assert.doesNotMatch(result.text, /Previous section|Next section|Do not include/);
    assert.deepEqual(result.sections.map(section => section.title), [
        "Find the guide",
        "Step two"
    ]);
    assert.deepEqual(result.links, [{
        text: "Related",
        url: "https://www.ign.com/wikis/guide-game/Related"
    }]);
    assert.deepEqual(result.images, [{
        url: "https://assets.ignimgs.com/guide-step.jpg",
        alt: "Map",
        title: null
    }]);
    assert.match(result.articleContent, /First step/);
    assert.doesNotMatch(result.articleContent, /Previous section|Next section|script|unsafe\(\)/i);
});

test("falls back to the guide article when its URL fragment is missing", () => {
    const result = extractIGNGuideContent(`
        <div class="wiki-html">
            <h2>Walkthrough</h2>
            <p>Available guide content.</p>
        </div>
    `, "https://www.ign.com/wikis/guide-game/Quest_Walkthrough#missing");

    assert.equal(result.fragmentFound, false);
    assert.equal(result.extractionMethod, "article-fallback");
    assert.match(result.text, /Available guide content/);
});

test("extracts guides from IGN article markup when wiki-html is absent", () => {
    const result = extractIGNGuideContent(`
        <main>
            <header><h1>Grand Theft Auto V</h1></header>
            <article class="article-content">
                <h2>Mission walkthrough</h2>
                <p>Reach the safehouse.</p>
                <script>remove this</script>
            </article>
        </main>
    `, "https://www.ign.com/wikis/grand-theft-auto-5/Prologue");

    assert.equal(result.pageTitle, "Grand Theft Auto V");
    assert.match(result.text, /Reach the safehouse/);
    assert.doesNotMatch(result.articleContent, /remove this/);
});

test("extracts and renders IGN lazy-loaded guide images", () => {
    const result = extractIGNGuideContent(`
        <div class="wiki-html">
            <h2 id="franklin-and-lamar">Franklin and Lamar</h2>
            <p>Franklin's first mission.</p>
            <img
                src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                data-original="//oyster.ignimgs.com/mediawiki/apis.ign.com/gta-5/franklin-and-lamar.jpg"
                alt="Franklin and Lamar gameplay"
            >
            <table><tbody><tr><td>Mission objectives</td></tr></tbody></table>
            <h2 id="next-mission">Next mission</h2>
            <p>Not part of this mission.</p>
        </div>
    `, "https://www.ign.com/wikis/gta-5/Franklin_and_Lamar#franklin-and-lamar");

    assert.deepEqual(result.images, [{
        url: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/gta-5/franklin-and-lamar.jpg",
        alt: "Franklin and Lamar gameplay",
        title: null
    }]);
    assert.match(
        result.articleContent,
        /<img src="https:\/\/oyster\.ignimgs\.com\/mediawiki\/apis\.ign\.com\/gta-5\/franklin-and-lamar\.jpg"/
    );
    assert.match(result.articleContent, /<table>/);
    assert.doesNotMatch(result.articleContent, /data-original|data:image/);
    assert.doesNotMatch(result.articleContent, /Not part of this mission/);
});

test("renders structured Apollo image entities in article order", () => {
    const result = extractIGNGuideContent(pageWithApollo({
        "WikiPage:test-game:Guide": {
            __typename: "WikiPage",
            id: "test-game:Guide",
            title: "Guide",
            htmlEntities: [
                {
                    __typename: "WikiPageElement",
                    name: "html",
                    values: { html: "<p>Before the images.</p>" }
                },
                {
                    __typename: "WikiPageElement",
                    name: "image",
                    values: [
                        {
                            original: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/1/1a/first.jpg",
                            src: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/1/1a/first.jpg?width=325"
                        },
                        {
                            original: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/2/2b/second.jpg",
                            src: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/2/2b/second.jpg?width=325"
                        },
                        {
                            original: "https://example.com/not-an-ign-image.jpg",
                            src: "https://example.com/not-an-ign-image.jpg"
                        }
                    ]
                },
                {
                    __typename: "WikiPageElement",
                    name: "html",
                    values: { html: "<p>After the images.</p>" }
                }
            ]
        }
    }), "https://www.ign.com/wikis/test-game/Guide");

    assert.deepEqual(result.images.map(image => image.url), [
        "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/1/1a/first.jpg",
        "https://oyster.ignimgs.com/mediawiki/apis.ign.com/test-game/2/2b/second.jpg"
    ]);
    assert.ok(
        result.articleContent.indexOf("Before the images.") <
        result.articleContent.indexOf("first.jpg")
    );
    assert.ok(
        result.articleContent.indexOf("first.jpg") <
        result.articleContent.indexOf("After the images.")
    );
    assert.doesNotMatch(result.articleContent, /example\.com/);
});

test("uses IGN Apollo article media and resolves embedded video assets", async () => {
    const originalFetch = global.fetch;
    const requestedUrls = [];
    global.fetch = async url => {
        requestedUrls.push(url);
        const apollo = url.includes("/videos/")
            ? {
                "ModernVideo:video-1": {
                    __typename: "ModernVideo",
                    content: { __ref: "ModernContent:video-1" },
                    assets: [{
                        __typename: "VideoAsset",
                        url: "https://assets14.ign.com/videos/guide.mp4",
                        width: 1280
                    }]
                },
                "ModernContent:video-1": {
                    __typename: "ModernContent",
                    title: "Franklin and Lamar walkthrough"
                }
            }
            : {
                "WikiPage:grand-theft-auto-5:Franklin_and_Lamar": {
                    __typename: "WikiPage",
                    id: "grand-theft-auto-5:Franklin_and_Lamar",
                    title: "Franklin and Lamar",
                    htmlEntities: [
                        {
                            __typename: "WikiPageElement",
                            name: "html",
                            values: {
                                html: "<p>Mission intro.</p>"
                            }
                        },
                        {
                            __typename: "WikiPageElement",
                            name: "video",
                            values: {
                                slug: "gta-5-walkthrough-story-mission-franklin-and-lamar"
                            }
                        },
                        {
                            __typename: "WikiPageElement",
                            name: "html",
                            values: {
                                html: `
                                    <p>
                                        <img
                                            src="https://oyster.ignimgs.com/mediawiki/apis.ign.com/gta-5/mission.jpg?width=640"
                                            alt="Franklin and Lamar"
                                        >
                                    </p>
                                    <table><tbody><tr><td>Mission objective</td></tr></tbody></table>
                                `
                            }
                        }
                    ]
                }
            };
        return {
            status: 200,
            text: async () => pageWithApollo(apollo)
        };
    };

    try {
        const result = await getIGNContentPage(
            "https://www.ign.com/wikis/gta-5/Franklin_and_Lamar#franklin-and-lamar"
        );
        assert.deepEqual(requestedUrls, [
            "https://www.ign.com/wikis/gta-5/Franklin_and_Lamar#franklin-and-lamar",
            "https://www.ign.com/videos/gta-5-walkthrough-story-mission-franklin-and-lamar"
        ]);
        assert.deepEqual(result.images, [{
            url: "https://oyster.ignimgs.com/mediawiki/apis.ign.com/gta-5/mission.jpg?width=640",
            alt: "Franklin and Lamar",
            title: null
        }]);
        assert.match(result.articleContent, /<img src="https:\/\/oyster\.ignimgs\.com/);
        assert.match(result.articleContent, /data-mission-media-index="0"/);
        assert.deepEqual(result.videos, [{
            type: "video",
            title: "Franklin and Lamar walkthrough",
            source_url: "https://assets14.ign.com/videos/guide.mp4",
            format: "mp4"
        }]);
        assert.match(result.articleContent, /<table>/);
    } finally {
        global.fetch = originalFetch;
    }
});
