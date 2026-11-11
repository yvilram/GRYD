const cheerio = require("cheerio");

const gameSlugs = [
    "the-legend-of-zelda-breath-of-the-wild",
    "the-legend-of-zelda-tears-of-the-kingdom",
    "elden-ring",
    "red-dead-redemption-2",
    "grand-theft-auto-5",
    "the-witcher-3-wild-hunt",
    "cyberpunk-2077",
    "god-of-war-2018",
    "god-of-war-ragnarok",
    "horizon-zero-dawn",
    "horizon-forbidden-west",
    "assassins-creed-valhalla",
    "assassins-creed-odyssey",
    "final-fantasy-vii-remake",
    "final-fantasy-xvi",
    "resident-evil-4-2023",
    "marvels-spider-man-2",
    "super-mario-odyssey",
    "pokemon-legends-arceus",
    "dark-souls-3"
];

async function hasIGNChecklists(slug) {
    const url = `https://www.ign.com/games/${slug}/checklists`;
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

    return $(`a[href*="/games/${slug}/checklists/"]`).length > 0;
}

async function checkGames() {
    for (const slug of gameSlugs) {
        try {
            const found = await hasIGNChecklists(slug);
            console.log(found ? `[OK] ${slug}` : `[NO] ${slug}`);
        } catch (error) {
            console.error(`[ERROR] ${slug}: ${error.message}`);
        }
    }
}

checkGames();
