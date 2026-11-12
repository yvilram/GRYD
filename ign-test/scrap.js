
const cheerio = require("cheerio");
const fs = require("fs");

const gameSlug = "the-legend-of-zelda-breath-of-the-wild";

async function getIGNChecklists(slug) {
    const url = `https://www.ign.com/games/${slug}/checklists`;

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const checklists = [];

        $('a[href*="/games/' + slug + '/checklists/"]').each((i, element) => {
            const name = $(element).text().trim();
            const href = $(element).attr("href");

            if (name && href) {
                const fullUrl = new URL(href, "https://www.ign.com").href;

                if (!checklists.some(item => item.url === fullUrl)) {
                    checklists.push({
                        name,
                        url: fullUrl
                    });
                }
            }
        });

        const result = {
            game: slug,
            total: checklists.length,
            checklists: checklists
        };

        // Crear archivo JSON
        fs.writeFileSync(
            `${slug}-checklists.json`,
            JSON.stringify(result, null, 2),
            "utf8"
        );

        console.log(`JSON generado: ${slug}-checklists.json`);
        console.log(`Checklists encontradas: ${checklists.length}`);

        return result;

    } catch (error) {
        console.error("Error:", error.message);
        return null;
    }
}

getIGNChecklists(gameSlug);
