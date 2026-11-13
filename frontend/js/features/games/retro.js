const retroCatalog = document.getElementById("retro-catalog");
const retroStatus = document.getElementById("retro-status");
const retroPlatformNav = document.getElementById("retro-platform-nav");
const retroSearch = document.getElementById("retro-search");
const retroPlayer = document.getElementById("retro-player");
const retroPlayerTitle = document.getElementById("retro-player-title");
const retroPlayerStatus = document.getElementById("retro-player-status");
const retroPlayerStatusMessage = document.getElementById("retro-player-status-message");
const retroPlayerFrame = document.getElementById("retro-player-frame");
const retroPlayerBack = document.getElementById("retro-player-back");

let retroGames = [];
let retroPlatforms = [];
let activeRetroPlatform = null;
let retroEmulator = null;
let retroGamesLoaded = false;
let retroGamesLoading = false;
let retroPlayerStartTimeout = 0;

const getPlatformLabel = platform => {
    const normalizedId = platform.id.toLocaleLowerCase();
    if (normalizedId === "n64") return "N64";
    if (normalizedId === "snes") return "SNES";

    return platform.name
        .replace(/[-_]+/g, " ")
        .replace(/\b[a-z]/g, character => character.toLocaleUpperCase());
};

const renderRetroPlatformNav = () => {
    retroPlatformNav.replaceChildren();
    retroPlatformNav.hidden = retroPlatforms.length === 0;

    const platforms = [
        { id: null, name: "All systems" },
        ...retroPlatforms
    ];

    for (const platform of platforms) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "retro-platform-nav__button";
        button.setAttribute("aria-pressed", String(platform.id === activeRetroPlatform));
        if (platform.id === null) {
            button.dataset.allPlatforms = "";
        } else {
            button.dataset.platformId = platform.id;
        }

        const icon = document.createElement("i");
        icon.className = "bi bi-controller";
        icon.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.textContent = platform.id === null ? platform.name : getPlatformLabel(platform);

        button.append(icon, label);
        retroPlatformNav.append(button);
    }
};

const renderRetroGames = () => {
    const query = retroSearch.value.trim().toLocaleLowerCase();
    const filteredGames = retroGames
        .map((game, index) => ({ game, index }))
        .filter(({ game }) => (
            (activeRetroPlatform === null || game.platformId === activeRetroPlatform) &&
            game.title.toLocaleLowerCase().includes(query)
        ));

    retroCatalog.replaceChildren();
    for (const { game, index } of filteredGames) {
        const card = document.createElement("article");
        card.className = "retro-card";

        const artwork = document.createElement("div");
        artwork.className = "retro-card__artwork";
        artwork.setAttribute("aria-hidden", "true");

        const fallback = document.createElement("div");
        fallback.className = "retro-card__fallback";
        fallback.innerHTML = '<i class="bi bi-controller"></i><span>N64</span>';
        fallback.querySelector("span").textContent = game.systemShort;
        artwork.append(fallback);

        if (game.coverUrl) {
            const cover = document.createElement("img");
            cover.className = "retro-card__cover";
            cover.src = game.coverUrl;
            cover.alt = "";
            cover.loading = "lazy";
            cover.addEventListener("error", () => {
                artwork.dataset.coverMissing = "true";
                cover.remove();
            }, { once: true });
            artwork.append(cover);
        } else {
            artwork.dataset.coverMissing = "true";
        }

        const body = document.createElement("div");
        body.className = "retro-card__body";

        const title = document.createElement("h2");
        title.className = "retro-card__title";
        title.textContent = game.title;

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "button button--primary";
        playButton.dataset.retroGameIndex = String(index);
        playButton.innerHTML = 'Play <i class="bi bi-play-fill" aria-hidden="true"></i>';

        body.append(title, playButton);
        card.append(artwork, body);
        retroCatalog.append(card);
    }

    if (retroGamesLoaded) {
        retroStatus.textContent = filteredGames.length
            ? `${filteredGames.length} ${filteredGames.length === 1 ? "game" : "games"}`
            : query
                ? "No games match your search."
                : "No retro games are available yet.";
    }
};

const escapeInlineJson = value => JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const createPlayerDocument = (game, emulator) => `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        html, body, #game { width: 100%; height: 100%; margin: 0; }
        body { background: #000; }
    </style>
</head>
<body>
    <div id="game"></div>
    <script>
        window.EJS_player = "#game";
        window.EJS_core = ${escapeInlineJson(game.core)};
        window.EJS_gameUrl = ${escapeInlineJson(game.url)};
        window.EJS_pathtodata = ${escapeInlineJson(emulator.dataPath)};
        window.EJS_startOnLoaded = true;
        window.EJS_onGameStart = () => {
            window.parent.postMessage({ type: "gryd-retro-started" }, "*");
        };
        const emulatorLoader = document.createElement("script");
        emulatorLoader.src = ${escapeInlineJson(emulator.loaderUrl)};
        emulatorLoader.addEventListener("error", () => {
            window.parent.postMessage({ type: "gryd-retro-loader-error" }, "*");
        });
        document.body.append(emulatorLoader);
    </script>
</body>
</html>`;

const stopRetroGame = () => {
    window.clearTimeout(retroPlayerStartTimeout);
    retroPlayerFrame.srcdoc = "";
    retroPlayer.hidden = true;
    retroCatalog.hidden = false;
    retroStatus.hidden = false;
    retroPlayerStatus.hidden = true;
    delete retroPlayerStatus.dataset.state;
};

const startRetroGame = game => {
    if (!retroEmulator) return;

    retroPlayerTitle.textContent = game.title;
    retroPlayerFrame.title = `${game.title} ${game.system} game player`;
    retroPlayerStatusMessage.textContent = "Starting EmulatorJS…";
    retroPlayerStatus.dataset.state = "loading";
    retroPlayerStatus.hidden = false;
    retroCatalog.hidden = true;
    retroStatus.hidden = true;
    retroPlayer.hidden = false;
    retroPlayerFrame.srcdoc = createPlayerDocument(game, retroEmulator);
    retroPlayerStartTimeout = window.setTimeout(() => {
        retroPlayerStatus.dataset.state = "error";
        retroPlayerStatusMessage.textContent =
            "The emulator did not start. Check that the complete EmulatorJS data package " +
            "is public under emulatorjs/data and that the ROM URL is accessible.";
    }, 30000);
};

const loadRetroGames = async () => {
    if (retroGamesLoaded || retroGamesLoading) return;
    retroGamesLoading = true;
    retroStatus.hidden = false;
    retroStatus.textContent = "Loading games…";

    try {
        const response = await fetch(`${API_URL}/api/retro-games`, {
            credentials: "include"
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Could not load retro games.");
        }
        if (!Array.isArray(result.games) ||
            !Array.isArray(result.platforms) ||
            !result.emulator ||
            typeof result.emulator.loaderUrl !== "string" ||
            typeof result.emulator.dataPath !== "string") {
            throw new Error("The retro games response was invalid.");
        }

        retroGames = result.games;
        retroPlatforms = result.platforms;
        retroEmulator = result.emulator;
        retroGamesLoaded = true;
        renderRetroPlatformNav();
        renderRetroGames();
    } catch (error) {
        console.error("Could not load retro games:", error);
        retroStatus.textContent = "Could not load the retro games catalog. Please try again.";
        window.showAppNotice("Could not load the retro games catalog.", "error");
    } finally {
        retroGamesLoading = false;
    }
};

retroSearch.addEventListener("input", renderRetroGames);
retroPlatformNav.addEventListener("click", event => {
    const button = event.target instanceof Element
        ? event.target.closest("button")
        : null;
    if (!button) return;

    activeRetroPlatform = button.hasAttribute("data-all-platforms")
        ? null
        : button.dataset.platformId;
    renderRetroPlatformNav();
    renderRetroGames();
});
retroPlayerBack.addEventListener("click", stopRetroGame);
retroCatalog.addEventListener("click", event => {
    const button = event.target instanceof Element
        ? event.target.closest("[data-retro-game-index]")
        : null;
    if (!button) return;

    const game = retroGames[Number(button.dataset.retroGameIndex)];
    if (game) startRetroGame(game);
});

window.addEventListener("message", event => {
    if (event.source !== retroPlayerFrame.contentWindow) return;

    if (event.data?.type === "gryd-retro-started") {
        window.clearTimeout(retroPlayerStartTimeout);
        retroPlayerStatus.hidden = true;
    } else if (event.data?.type === "gryd-retro-loader-error") {
        window.clearTimeout(retroPlayerStartTimeout);
        retroPlayerStatus.dataset.state = "error";
        retroPlayerStatusMessage.textContent =
            "Could not load EmulatorJS. Check that emulatorjs/data/loader.js is public.";
    }
});

document.addEventListener("app:navigate", ({ detail }) => {
    if (detail.route !== "retro") {
        stopRetroGame();
        return;
    }
    loadRetroGames();
});
