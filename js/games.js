const url = "https://crispy-dollop-pjrxw6g59jvp3r4r5-3000.app.github.dev";

async function getGames(){
    const response = await fetch(`${url}/api/games`);

    const games = await response.json();

    return games;
}

async function showGames(){

    const games = await getGames();

    const container = document.getElementById("games-container");

    games.forEach(element => {
        const div = document.createElement("div");
        const cover = document.createElement("img");
        const name = document.createElement("p");
        cover.src = `https://images.igdb.com/igdb/image/upload/t_cover_big/${element.cover.image_id}.jpg`;
        cover.id = "game-cover";
        name.textContent = element.name;
        div.appendChild(cover);
        div.appendChild(name);
        container.appendChild(div);
    });

}

showGames();