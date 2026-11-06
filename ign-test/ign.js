const cheerio = require("cheerio");


function normalizeGameName(name) {
    return name
        .toLowerCase()
        .replace("grand theft auto", "gta")
        .replace(/\bv\b/g, "5")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
}


async function findIgnWiki(gameName) {

    const searchUrl =
        `https://www.ign.com/search?q=${encodeURIComponent(gameName)}`;

    const response = await fetch(searchUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const normalizedGameName = normalizeGameName(gameName);

    let exactMatch = null;
    let fallbackMatch = null;

    $("a").each((i, element) => {

        const name = $(element).text().trim();
        const href = $(element).attr("href");

        if (!href?.includes("/wikis/")) {
            return;
        }

        const parts = href.split("/");

        if (parts.length < 3) {
            return;
        }

        const wikiRoot = `/${parts[1]}/${parts[2]}`;
        const normalizedResult = normalizeGameName(name);

        if (name.toLowerCase() === gameName.toLowerCase()) {
            exactMatch = wikiRoot;
        }

        if (
            normalizedResult.includes(normalizedGameName) ||
            normalizedGameName.includes(normalizedResult)
        ) {
            fallbackMatch = wikiRoot;
        }
    });

    return exactMatch || fallbackMatch;
}


async function findWalkthrough(wikiRoot) {

    const url = `https://www.ign.com${wikiRoot}`;

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    let walkthroughUrl = null;

    $("a").each((i, element) => {

        if (walkthroughUrl) return;

        const name = $(element).text().trim();
        const href = $(element).attr("href");

        if (
            href?.includes(wikiRoot) &&
            name.toLowerCase().includes("walkthrough")
        ) {
            walkthroughUrl = href;
        }
    });

    return walkthroughUrl;
}


async function getMissions(walkthroughUrl) {

    const url = `https://www.ign.com${walkthroughUrl}`;

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const content = $("#__NEXT_DATA__").html();
    const data = JSON.parse(content);

    const tasks = data.props.pageProps.page.page.checklistTasks;


    // FALLBACK HTML
    if (tasks.length === 0) {

        const missions = [];

        $("table a").each((i, element) => {

            const name = $(element).text().trim();
            const href = $(element).attr("href");

            if (
                href?.includes("/wikis/") &&
                !href.includes("#")
            ) {
                missions.push({
                    name: name,
                    url: href
                });
            }
        });

        return missions;
    }


    // MÉTODO JSON
    const mainCategory = tasks
        .flatMap(task => task.checklists)
        .find(checklist => {

            const name = checklist.name.toLowerCase();

            return (
                (
                    name.includes("main") ||
                    name.includes("story")
                ) &&
                (
                    name.includes("quest") ||
                    name.includes("mission")
                )
            );
        });

    if (!mainCategory) {
        return [];
    }


    const mainQuests = tasks.filter(task =>
        task.checklists.some(checklist =>
            checklist.name === mainCategory.name
        )
    );


    const missions = mainQuests.map(task => {

        const name = task.name.replace(/ Complete$/, "");

        let page = task.guidePages.find(page =>
            page.title.toLowerCase() === name.toLowerCase() ||
            page.title.toLowerCase() === `${name.toLowerCase()} walkthrough`
        );

        if (!page) {
            page = task.guidePages.find(page =>
                !page.title.toLowerCase().includes("walkthrough")
            );
        }

        return {
            name: name,
            url: page?.wikiUrl
        };
    });

    return missions;
}


async function getGameMissions(gameName) {

    const wikiRoot = await findIgnWiki(gameName);

    if (!wikiRoot) {
        return [];
    }

    const walkthroughUrl = await findWalkthrough(wikiRoot);

    if (!walkthroughUrl) {
        return [];
    }

    return await getMissions(walkthroughUrl);
}


module.exports = {
    getGameMissions
};