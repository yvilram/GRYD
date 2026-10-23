const express = require("express");

const app = express();

app.set("json spaces", 2);

const CLIENT_ID = "51nao0y8eswrbmauu3z3hudjwc3rhq";
const ACCESS_TOKEN = "uj9kdekck5duf31sbi43b6xqx9629x";

async function igdbRequest(endpoint, body){
    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers:{
            "Client-ID": `${CLIENT_ID}`,
            "Authorization": `Bearer ${ACCESS_TOKEN}`
        },

        body: body
    });

    return await response.json();
}

async function RequestItem(endpoint, body, item){
    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers:{
            "Client-ID": `${CLIENT_ID}`,
            "Authorization": `Bearer ${ACCESS_TOKEN}`
        },

        body: body
    });

    return await response.json();
}

app.use(express.static("."));

app.get("/api/games", async (req, res) => {

    const games = await igdbRequest(
        "games",
        "fields name, cover.url, cover.image_id; limit 5;"
    );

    res.json(games);
});

app.listen(3000, () => {
    console.log("Server Start")
});