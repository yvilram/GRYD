const LIMIT = 20;

let offset = 0;
let isLoading = false;
let hasMoreGames = true;


// Obtener juegos del backend
async function getGames() {

    const response = await fetch(`/api/games?offset=${offset}&limit=${LIMIT}`);

    if (!response.ok) {
        throw new Error("No se pudieron obtener los juegos");
    }

    return await response.json();
}

// Obtener plataformas del backend
async function getPlatforms() {

    const response = await fetch(`/api/platforms?platform=${platform}`);

    if (!response.ok) {
        throw new Error("No se pudieron obtener los juegos");
    }

    return await response.json();
}


// Crear una card
function createGameCard(game) {
    const card = document.createElement("div");
    const cover = document.createElement("img");

    const title = document.createElement("div");
    const name = document.createElement("span");
    const rating = document.createElement("span");

    card.classList.add("game-card");
    cover.classList.add("game-cover");
    title.classList.add("game-title");
    rating.classList.add("game-rating");
    

    name.textContent = game.name;
    cover.alt = `Portada de ${game.name}`;
    rating.textContent = Math.round(`${game.total_rating}`);
    
    if(Math.round(`${game.total_rating}`) >= 80){
        rating.style.color = "green";
        rating.style.border = "1px solid green";
    }else if (Math.round(`${game.total_rating}`) < 80){
        rating.style.color = "yellow";
        rating.style.border = "1px solid yellow";
    }else if(Math.round(`${game.total_rating}`) < 60){
        rating.style.color = "orange";
        rating.style.border = "1px solid orange";
    }else{
        rating.style.color = "red";
        rating.style.border = "1px solid red";
    }

    if (game.cover?.image_id) {
        cover.src =`https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.png`;
    }else {
        cover.src = "/assets/no-cover.png";
    }

    title.appendChild(name);
    title.appendChild(rating);

    card.appendChild(cover);
    card.appendChild(title);

    
    

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
