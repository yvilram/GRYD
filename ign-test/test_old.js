const cheerio = require("cheerio");

async function getCategories(url) {

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

    return [...categories];
}

getCategories(
    "https://www.ign.com/wikis/cyberpunk-2077/Walkthrough_-_Main_Jobs"
).then(categories => {
    console.log(categories);
});