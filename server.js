const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
const cors = require("cors");

app.use(cors({
    origin: "https://gryd.pages.dev",
    credentials: true
}));

app.set("json spaces", 2);

app.use(express.json());
app.use(cookieParser());

// Variables de entorno
const CLIENT_ID = process.env.IGDB_CLIENT_ID;
const ACCESS_TOKEN = process.env.IGDB_ACCESS_TOKEN;

// Pasar variables de entorno a las rutas
app.use((req, res, next) => {
    req.env = process.env;
    next();
});

// Peticiones a IGDB
async function igdbRequest(endpoint, body) {
    const response = await fetch(
        `https://api.igdb.com/v4/${endpoint}`,
        {
            method: "POST",
            headers: {
                "Client-ID": CLIENT_ID,
                "Authorization": `Bearer ${ACCESS_TOKEN}`
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