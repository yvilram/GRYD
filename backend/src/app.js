const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const requestIgdb = require("./services/igdb.client");

const app = express();
const allowedOrigins = [
    "https://gryd.pages.dev",
    "https://crispy-dollop-pjrxw6g59jvp3r4r5-3000.app.github.dev"
];

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        try {
            const { hostname, protocol } = new URL(origin);
            if (
                protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(hostname)
            ) {
                return callback(null, true);
            }
        } catch {
            return callback(null, false);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

app.set("json spaces", 2);

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    req.env = process.env;
    next();
});

require("./routes/auth.routes")(app);
require("./routes/catalog.routes")(app, requestIgdb);
require("./routes/library.routes")(app, requestIgdb);

module.exports = app;
