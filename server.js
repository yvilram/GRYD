const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: "https://gryd.pages.dev",
    credentials: true
}));

app.set("json spaces", 2);

app.use(express.json());
app.use(cookieParser());

// Peticiones a IGDB (leyendo las variables en tiempo de ejecución)
async function igdbRequest(endpoint, body) {
    const clientId = process.env.IGDB_CLIENT_ID;
    const accessToken = process.env.IGDB_ACCESS_TOKEN;

    const response = await fetch(
        `https://api.igdb.com/v4/${endpoint}`,
        {
            method: "POST",
            headers: {
                "Client-ID": clientId,
                "Authorization": `Bearer ${accessToken}`
            },
            body
        }
    );

    if (!response.ok) {
        throw new Error(`IGDB error: ${response.status}`);
    }

    return response.json();
}

// Registrar rutas
require("./js/api")(app, igdbRequest);

module.exports = app;