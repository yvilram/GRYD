const LIMIT = 40;
let userGames = [];
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


async function loadGameStates() {
    const response = await fetch("/api/game_state_user");
    if (!response.ok) {
        throw new Error("Could not load user game states");
    }
    return await response.json();
}

// Crear una card
function createGameCard(game, savedStatus = "select") {

    const card = document.createElement("div");
    card.classList.add("game-card");
    card.id = game.id;

    const cover = document.createElement("img");
    cover.classList.add("game-cover");
    cover.alt = `Portada de ${game.name}`;

    const title = document.createElement("div");
    title.classList.add("game-title");

    const name = document.createElement("span");
    name.textContent = game.name;

    const rating = document.createElement("span");
    rating.classList.add("game-rating");

    const input = document.createElement("select");
    input.id = `state-${game.id}`;

    const option_none = document.createElement("option");
    option_none.textContent = "Select";
    option_none.value = "select";

    const backlog = document.createElement("option");
    backlog.value = "backlog";  
    backlog.textContent = "Backlog";

    const play = document.createElement("option");  
    play.value = "play";    
    play.textContent = "Playing";

    const pause = document.createElement("option"); 
    pause.value = "pause";  
    pause.textContent = "Pause";

    const completed = document.createElement("option"); 
    completed.value = "completed";  
    completed.textContent = "Completed";

    const drop = document.createElement("option");  
    drop.value = "drop";    
    drop.textContent = "Drop";

    input.append(option_none, backlog, play, pause, completed, drop);
    input.value = savedStatus || "select";


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
    card.appendChild(input);
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

        const container = document.getElementById("games-container");

        userGames = await loadGameStates();
        console.log(userGames);


        games.forEach(game => {
            const savedGame  = userGames.find(
                userGame => Number(userGame.id) === Number(game.id)
            );
            const card = createGameCard(game, savedGame ?.status);
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

document.getElementById("explore").addEventListener("click", () => {
    document.getElementById("games-container").style.display = "grid";
    document.getElementById("home").style.display = "none";
    showGames();
});



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
