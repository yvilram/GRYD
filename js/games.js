const LIMIT = 24;

let offset = 0;
let isLoading = false;
let hasMoreGames = true;


// Obtener juegos del backend
async function getGames() {

    const response = await fetch(`/api/games?offset=${offset}`);

    if (!response.ok) {
        throw new Error("No se pudieron obtener los juegos");
    }

    return await response.json();
}


// Crear una card
function createGameCard(game) {
    console.log(game);
    const card = document.createElement("div");
    const cover = document.createElement("img");
    const platforms_cover = document.createElement("div");
    const name = document.createElement("p");

    card.classList.add("game-card");
    cover.classList.add("game-cover");
    platforms_cover.classList.add("game-platforms");

    name.textContent = game.name;
    cover.alt = `Portada de ${game.name}`;

    game.platforms.forEach(element => {
        console.log(element);
    });

    if (game.cover?.image_id) {
        cover.src =`https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.png`;
    }else {
        image.src = "/assets/no-cover.png";
    }

    card.appendChild(cover);
    card.appendChild(platforms_cover);
    card.appendChild(name);

    return card;
}


// Mostrar juegos
async function showGames() {

    if (isLoading || !hasMoreGames) {
        return;
    }

    isLoading = true;

    try {

        const games = await getGames();

        const container =
            document.getElementById("games-container");

        games.forEach(game => {

            const card = createGameCard(game);

            container.appendChild(card);

        });

        offset += games.length;

        if (games.length < LIMIT) {
            hasMoreGames = false;
        }

    } catch (error) {

        console.error("Error:", error);

    } finally {

        isLoading = false;

    }
}


// Scroll infinito
const sentinel =
    document.getElementById("scroll-sentinel");

const observer =
    new IntersectionObserver(entries => {

        if (entries[0].isIntersecting) {
            showGames();
        }

    });

observer.observe(sentinel);