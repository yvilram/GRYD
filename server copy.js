const express = require("express");
const cookieParser = require("cookie-parser");
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

    if (!response.ok) {
        const error = await response.text();
        console.error("Error IGDB:", error);

        throw new Error(`IGDB error: ${response.status}`);
    }

    return await response.json();
}

app.use(express.static("."));
app.use(express.json());
app.use(cookieParser());

require("./js/api")(app, igdbRequest);

app.listen(3000, () => {
    console.log("Server Start")
});