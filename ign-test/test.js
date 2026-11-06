const cheerio = require("cheerio");

async function getMissions(url) {

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
    const categories = new Set();

    tasks.forEach(task => {
        task.checklists.forEach(checklist => {
            categories.add(checklist.name);
        });
    });

    console.log("Categorías disponibles:", [...categories]);


    // FALLBACK HTML
    if (tasks.length === 0) {

        console.log("No hay checklistTasks. Usando fallback HTML...");

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

    console.log(
        "Categoría detectada:",
        mainCategory?.name
    );

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


getMissions(
    "https://www.ign.com/wikis/dishonored/Walkthrough"
).then(missions => {

    console.log("Total:", missions.length);
    console.log(missions);

});