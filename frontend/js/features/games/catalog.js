const PAGE_SIZE = 24;
const DEFAULT_GAME_STATUS = "select";
const GAME_STATUSES = [
    ["select", "Select"],
    ["backlog", "Backlog"],
    ["play", "Playing"],
    ["pause", "Paused"],
    ["completed", "Completed"],
    ["drop", "Dropped"]
];
const LIBRARY_CONTENT_TYPES = [
    { id: "games", label: "Games", icon: "bi-controller" }
];
const LIBRARY_STATUS_FILTERS = [
    ["all", "All"],
    ...GAME_STATUSES.filter(([status]) => status !== DEFAULT_GAME_STATUS)
];
const PLATFORM_FAMILIES = [
    { id: "windows", label: "Windows", icon: "bi-windows", matches: /windows/i },
    { id: "linux", label: "Linux", icon: "bi-ubuntu", matches: /linux|steamos/i },
    { id: "macos", label: "macOS", icon: "bi-apple", matches: /\bmac(?: ?os)?\b|macintosh|os x/i },
    { id: "playstation", label: "PlayStation", icon: "bi-playstation", matches: /playstation|^ps[1-5]\b/i },
    { id: "xbox", label: "Xbox", icon: "bi-xbox", matches: /xbox/i },
    { id: "switch", label: "Nintendo Switch", icon: "bi-nintendo-switch", matches: /nintendo switch|switch/i }
];

let savedGames = [];
let catalogOffset = 0;
let isCatalogLoading = false;
let hasMoreCatalogGames = true;
let isCatalogLoaded = false;
let catalogGeneration = 0;
let catalogRequestController = null;
let isAuthenticated = false;
let isAuthenticationResolved = false;
let activeLibraryContent = LIBRARY_CONTENT_TYPES[0].id;
let activeLibraryStatus = "all";
let activeLibrarySearch = "";
let activeLibrarySort = "added";
let catalogFilterTimer = null;
let catalogSearchTimer = null;
let explorerFilters = {
    genres: [],
    themes: [],
    platforms: [],
    yearFrom: "",
    yearTo: "",
    search: "",
    sort: "rating",
    hideOwned: false
};

// Fetch JSON from the API and keep the response status on errors.
const requestJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
            const result = await response.json();
            if (typeof result.error === "string" && result.error) {
                message = result.error;
            }
        } catch {
            // Keep the HTTP status message when the server does not return JSON.
        }
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return response.json();
};

// Keep account-only navigation in sync with the current session.
const updateAuthenticationControls = () => {
    document.getElementById("navigation-library").hidden = !isAuthenticated;
    document.getElementById("home-register").hidden = isAuthenticated;
    document.getElementById("catalog-hide-owned-control").hidden = !isAuthenticated;
    if (!isAuthenticated) {
        document.getElementById("catalog-hide-owned").checked = false;
        explorerFilters.hideOwned = false;
    }
    renderActiveCatalogFilters();
};

// Build a content selector from the shared media-type configuration.
const renderContentMenu = (containerId, activeContentId, dataAttribute) => {
    const contentMenu = document.getElementById(containerId);
    LIBRARY_CONTENT_TYPES.forEach(({ id, label, icon }) => {
        const button = document.createElement("button");
        button.classList.add("library-content-menu__button");
        button.type = "button";
        button.dataset[dataAttribute] = id;
        button.setAttribute("aria-pressed", String(id === activeContentId));

        const iconElement = document.createElement("i");
        iconElement.classList.add("bi", icon);
        iconElement.setAttribute("aria-hidden", "true");

        const labelElement = document.createElement("span");
        labelElement.textContent = label;
        button.append(iconElement, labelElement);
        contentMenu.appendChild(button);
    });
};

// Build the library status filters from their configuration.
const renderLibraryMenus = () => {
    renderContentMenu("library-content-menu", activeLibraryContent, "libraryContent");
    const statusFilters = document.getElementById("library-status-filters");
    LIBRARY_STATUS_FILTERS.forEach(([status, label]) => {
        const button = document.createElement("button");
        button.classList.add("library-status-filters__button");
        button.type = "button";
        button.dataset.libraryStatus = status;
        button.setAttribute("aria-pressed", String(status === activeLibraryStatus));

        const labelElement = document.createElement("span");
        labelElement.textContent = label;

        const countElement = document.createElement("span");
        countElement.classList.add("library-status-filters__count");
        countElement.dataset.statusCount = status;

        button.append(labelElement, countElement);
        statusFilters.appendChild(button);
    });
};

// Render checkbox choices returned by a catalog metadata endpoint.
const renderCatalogOptions = (containerId, items, inputName) => {
    const container = document.getElementById(containerId);
    const checkedValues = new Set([...container.querySelectorAll("input:checked")]
        .map(input => input.value));
    container.replaceChildren();
    items.forEach(({ id, name }) => {
        const label = document.createElement("label");
        label.classList.add("catalog-filter-option");
        label.dataset.searchText = name.toLocaleLowerCase();

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = inputName;
        checkbox.value = String(id);
        checkbox.checked = checkedValues.has(String(id));

        const nameElement = document.createElement("span");
        nameElement.textContent = name;
        label.append(checkbox, nameElement);
        container.appendChild(label);
    });
};

// Keep checked filter options together at the top of their lists.
const sortSelectedCatalogOptions = input => {
    const options = input.closest(".catalog-filter-options");
    if (!options) return;

    const labels = [...options.querySelectorAll(".catalog-filter-option")];
    labels.sort((first, second) => {
        const firstChecked = first.querySelector("input").checked;
        const secondChecked = second.querySelector("input").checked;
        if (firstChecked !== secondChecked) return Number(secondChecked) - Number(firstChecked);
        return first.dataset.searchText.localeCompare(second.dataset.searchText);
    });

    labels.forEach(label => options.appendChild(label));
    options.scrollTop = 0;
};

const getCatalogFilterOptions = (containerId, selectedIds) => {
    const selected = new Set(selectedIds);
    return [...document.querySelectorAll(`#${containerId} .catalog-filter-option`)]
        .filter(option => selected.has(option.querySelector("input").value))
        .map(option => ({
            id: option.querySelector("input").value,
            name: option.querySelector("span").textContent
        }));
};

const getActiveCatalogFilters = () => {
    const filters = [];
    if (explorerFilters.search) {
        filters.push({ key: "search", label: `Search: ${explorerFilters.search}` });
    }
    getCatalogFilterOptions("catalog-genre-options", explorerFilters.genres)
        .forEach(({ id, name }) => {
            filters.push({
                key: `genre:${id}`,
                label: `Genre: ${name}`
            });
        });
    getCatalogFilterOptions("catalog-theme-options", explorerFilters.themes)
        .forEach(({ id, name }) => {
            filters.push({
                key: `theme:${id}`,
                label: `Theme: ${name}`
            });
        });
    getCatalogFilterOptions("catalog-platform-options", explorerFilters.platforms)
        .forEach(({ id, name }) => {
            filters.push({
                key: `platform:${id}`,
                label: `Platform: ${name}`
            });
        });
    if (explorerFilters.yearFrom || explorerFilters.yearTo) {
        filters.push({
            key: "year",
            label: `Release: ${explorerFilters.yearFrom || "Any"}–${explorerFilters.yearTo || "Any"}`
        });
    }
    if (explorerFilters.hideOwned) {
        filters.push({ key: "hide-owned", label: "Hide games in my library" });
    }
    if (explorerFilters.sort !== "rating") {
        const sortLabel = document.querySelector("#catalog-sort option:checked")?.textContent;
        filters.push({ key: "sort", label: `Sort: ${sortLabel || explorerFilters.sort}` });
    }
    return filters;
};

const renderActiveCatalogFilters = () => {
    const container = document.getElementById("catalog-active-filters");
    const count = document.getElementById("catalog-filter-count");
    const filters = getActiveCatalogFilters();
    container.replaceChildren();
    container.hidden = filters.length === 0;
    count.hidden = filters.length === 0;
    count.textContent = String(filters.length);
    document.getElementById("catalog-filters-toggle").setAttribute(
        "aria-label",
        filters.length
            ? `Open filters (${filters.length} active)`
            : "Open filters"
    );

    filters.forEach(({ key, label }) => {
        const button = document.createElement("button");
        button.className = "catalog-active-filters__chip";
        button.type = "button";
        button.dataset.filterKey = key;
        button.setAttribute("aria-label", `Remove ${label} filter`);
        button.textContent = `${label} ×`;
        container.appendChild(button);
    });

    if (filters.length > 1) {
        const clearButton = document.createElement("button");
        clearButton.className = "catalog-active-filters__clear";
        clearButton.type = "button";
        clearButton.dataset.filterKey = "all";
        clearButton.textContent = "Clear all";
        container.appendChild(clearButton);
    }
};

const removeCatalogFilter = key => {
    if (key === "all") {
        document.getElementById("catalog-filters").reset();
        return;
    }
    if (key === "search") {
        document.getElementById("catalog-search").value = "";
    } else if (key === "year") {
        document.getElementById("catalog-year-from").value = "";
        document.getElementById("catalog-year-to").value = "";
    } else if (key === "hide-owned") {
        document.getElementById("catalog-hide-owned").checked = false;
    } else if (key === "sort") {
        document.getElementById("catalog-sort").value = "rating";
    } else {
        const [type, id] = key.split(":");
        const containerId = {
            genre: "catalog-genre-options",
            theme: "catalog-theme-options",
            platform: "catalog-platform-options"
        }[type];
        const input = containerId && [...document.querySelectorAll(
            `#${containerId} input`
        )].find(option => option.value === id);
        if (input) input.checked = false;
    }
    applyCatalogFilters();
};

// Load available genres, themes, and platforms for the Explorer filters.
const loadCatalogFilterOptions = async () => {
    const genreOptions = document.getElementById("catalog-genre-options");
    const themeOptions = document.getElementById("catalog-theme-options");
    const platformOptions = document.getElementById("catalog-platform-options");
    const requests = await Promise.allSettled([
        requestJson(`${API_URL}/api/genres`),
        requestJson(`${API_URL}/api/themes`),
        requestJson(`${API_URL}/api/platforms`)
    ]);
    const [genres, themes, platforms] = requests;
    if (genres.status === "fulfilled") {
        renderCatalogOptions("catalog-genre-options", genres.value, "genres");
    } else {
        genreOptions.textContent = "Could not load genres.";
    }
    if (themes.status === "fulfilled") {
        renderCatalogOptions("catalog-theme-options", themes.value, "themes");
    } else {
        themeOptions.textContent = "Could not load themes.";
    }
    if (platforms.status === "fulfilled") {
        renderCatalogOptions("catalog-platform-options", platforms.value, "platforms");
    } else {
        platformOptions.textContent = "Could not load platforms.";
    }

    const failedRequests = requests.filter(result => result.status === "rejected");
    const error = document.getElementById("catalog-filter-options-error");
    const retry = document.getElementById("catalog-filter-retry");
    error.hidden = failedRequests.length === 0;
    retry.hidden = failedRequests.length === 0;
    if (failedRequests.length) {
        console.error("Could not load some catalog filter options:",
            failedRequests.map(result => result.reason));
        error.textContent = "Some filter options could not be loaded. You can retry without losing your current selections.";
    }
    renderActiveCatalogFilters();
};

// Read and validate all Explorer filter controls before applying them.
const readExplorerFilters = () => {
    const yearFrom = document.getElementById("catalog-year-from").value.trim();
    const yearTo = document.getElementById("catalog-year-to").value.trim();
    const yearFromValue = yearFrom ? Number(yearFrom) : null;
    const yearToValue = yearTo ? Number(yearTo) : null;
    const errorElement = document.getElementById("catalog-filter-error");

    if ([yearFromValue, yearToValue].some(year =>
        year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)
    )) {
        errorElement.textContent = "Enter a release year between 1950 and 2100.";
        errorElement.hidden = false;
        return null;
    }
    if (yearFromValue && yearToValue && yearFromValue > yearToValue) {
        errorElement.textContent = "The start year must not be later than the end year.";
        errorElement.hidden = false;
        return null;
    }

    errorElement.hidden = true;
    return {
        genres: [...document.querySelectorAll(
            "#catalog-genre-options input:checked"
        )].map(input => input.value),
        themes: [...document.querySelectorAll(
            "#catalog-theme-options input:checked"
        )].map(input => input.value),
        platforms: [...document.querySelectorAll(
            "#catalog-platform-options input:checked"
        )].map(input => input.value),
        yearFrom,
        yearTo,
        search: document.getElementById("catalog-search").value.trim(),
        sort: document.getElementById("catalog-sort").value,
        hideOwned: document.getElementById("catalog-hide-owned").checked
    };
};

// Apply saved-item visibility without changing the catalog's server filters.
const refreshCatalogVisibility = () => {
    const savedGameIds = new Set(savedGames.map(game => Number(game.id)));
    document.querySelectorAll("#game-catalog .game-card").forEach(card => {
        const status = card.querySelector(".game-card__status").value;
        card.hidden = explorerFilters.hideOwned &&
            (savedGameIds.has(Number(card.dataset.gameId)) || status !== DEFAULT_GAME_STATUS);
    });
    updateCatalogEmptyState();
};

// Show a no-results message only when no more catalog pages remain.
const updateCatalogEmptyState = (message) => {
    const emptyState = document.getElementById("catalog-empty-state");
    const hasVisibleCards = [...document.querySelectorAll("#game-catalog .game-card")]
        .some(card => !card.hidden);
    document.getElementById("catalog-empty-message").textContent = message || (
        hasMoreCatalogGames
            ? "No games on this page are visible. Load more to continue."
            : explorerFilters.search
                ? "No games match your search and filters."
                : "No games match these filters."
    );
    emptyState.hidden = hasVisibleCards;
    const activeFilters = getActiveCatalogFilters();
    const clearButton = document.getElementById("catalog-clear-filters");
    clearButton.hidden = hasVisibleCards || activeFilters.length === 0;
    const loadMoreButton = document.getElementById("catalog-load-more");
    loadMoreButton.hidden = !hasMoreCatalogGames;
    loadMoreButton.textContent = message ? "Try again" : "Load more games";
};

// Reset Explorer pagination and cancel an outdated filter request.
const resetCatalogResults = () => {
    catalogGeneration += 1;
    catalogRequestController?.abort();
    catalogRequestController = null;
    isCatalogLoading = false;
    catalogOffset = 0;
    hasMoreCatalogGames = true;
    document.getElementById("game-catalog").replaceChildren();
    document.getElementById("catalog-empty-state").hidden = true;
    const loadMoreButton = document.getElementById("catalog-load-more");
    loadMoreButton.hidden = true;
    loadMoreButton.disabled = false;
};

// Keep status totals, visible cards, and the empty message in sync.
const refreshLibraryView = () => {
    const library = document.getElementById("game-library");
    const cards = [...library.querySelectorAll(".game-card")];
    const counts = new Map(LIBRARY_STATUS_FILTERS.map(([status]) => [status, 0]));

    cards.sort((first, second) => {
        if (activeLibrarySort === "title-asc") {
            return first.dataset.gameName.localeCompare(second.dataset.gameName);
        }
        if (activeLibrarySort === "title-desc") {
            return second.dataset.gameName.localeCompare(first.dataset.gameName);
        }
        if (activeLibrarySort === "status") {
            const firstStatus = GAME_STATUSES.findIndex(([status]) =>
                status === first.querySelector(".game-card__status").value
            );
            const secondStatus = GAME_STATUSES.findIndex(([status]) =>
                status === second.querySelector(".game-card__status").value
            );
            return firstStatus - secondStatus ||
                first.dataset.gameName.localeCompare(second.dataset.gameName);
        }
        return Number(second.dataset.addedAt) - Number(first.dataset.addedAt);
    });
    cards.forEach(card => library.appendChild(card));

    cards.forEach(card => {
        const status = card.querySelector(".game-card__status").value;
        counts.set(status, (counts.get(status) || 0) + 1);
        const matchesStatus = activeLibraryStatus === "all" || status === activeLibraryStatus;
        const matchesSearch = card.dataset.gameName.includes(activeLibrarySearch);
        card.hidden = !matchesStatus || !matchesSearch;
    });
    counts.set("all", cards.length);

    document.querySelectorAll("#library-status-filters [data-status-count]")
        .forEach(count => {
            count.textContent = String(counts.get(
                count.closest("[data-library-status]").dataset.libraryStatus
            ) || 0);
        });

    document.querySelectorAll("#library-status-filters [data-library-status]")
        .forEach(button => {
            button.setAttribute(
                "aria-pressed",
                String(button.dataset.libraryStatus === activeLibraryStatus)
            );
        });

    const emptyState = document.getElementById("library-empty-state");
    emptyState.hidden = cards.some(card => !card.hidden);
    if (!emptyState.hidden) {
        const filterLabel = LIBRARY_STATUS_FILTERS.find(
            ([status]) => status === activeLibraryStatus
        )?.[1];
        const message = document.getElementById("library-empty-message");
        if (!cards.length) {
            message.textContent = "Your library is empty. Explore games to start your collection.";
        } else if (activeLibrarySearch) {
            message.textContent = `No games match "${activeLibrarySearch}"` +
                `${activeLibraryStatus === "all" ? "." : ` in ${filterLabel}.`}`;
        } else {
            message.textContent = `No games in ${filterLabel} yet.`;
        }
    }
};

// Load the current user's saved games, or return an empty list for guests.
const fetchSavedGames = async () => {
    if (!isAuthenticated) return [];

    try {
        const games = await requestJson(`${API_URL}/api/game_state_user`, {
            credentials: "include"
        });
        if (!Array.isArray(games)) {
            throw new Error("The server returned an invalid library response.");
        }
        return games;
    } catch (error) {
        console.error("Could not load saved games:", error);
        if (error.status === 401) {
            isAuthenticated = false;
            updateAuthenticationControls();
            window.dispatchEvent(new CustomEvent("auth:session-expired"));
            window.showAppNotice(
                "Your session has expired. Log in again to manage your library.",
                "error"
            );
            return [];
        }
        error.resource = "library";
        throw error;
    }
};

const getPlatformFamilies = platforms => {
    const names = platforms.map(platform => platform.name || "").filter(Boolean);
    return PLATFORM_FAMILIES.filter(({ matches }) =>
        names.some(name => matches.test(name))
    );
};

const createGameRoute = game => {
    const slug = game.name.normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "game";
    return `#game/${game.id}/${slug}`;
};

// Create a game card and wire its status and remove controls.
const createGameCard = (game, savedStatus = DEFAULT_GAME_STATUS, addedAt = "") => {
    const card = document.createElement("article");
    card.classList.add("game-card");
    card.dataset.gameId = String(game.id);
    card.dataset.gameName = game.name.toLocaleLowerCase();
    card.dataset.addedAt = String(Date.parse(addedAt) || 0);

    const cover = document.createElement("img");
    cover.classList.add("game-card__cover");
    cover.alt = `${game.name} cover`;
    cover.src = game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.png`
        : "/assets/no-cover.png";

    const rating = document.createElement("span");
    rating.classList.add("game-card__rating");
    const totalRating = Number(game.total_rating);
    const hasRating = game.total_rating !== null &&
        game.total_rating !== undefined &&
        Number.isFinite(totalRating);
    rating.textContent = hasRating ? String(Math.round(totalRating)) : "—";
    rating.dataset.ratingLevel = !hasRating
        ? "none"
        : totalRating >= 100
            ? "perfect"
            : totalRating >= 80
                ? "great"
                : totalRating >= 60
                    ? "good"
                    : totalRating >= 40
                        ? "fair"
                        : "low";
    rating.setAttribute(
        "aria-label",
        !hasRating
            ? "No IGDB rating available"
            : `IGDB community rating ${rating.textContent} out of 100`
    );
    const totalRatingCount = Number(game.total_rating_count);
    const hasRatingCount = Number.isFinite(totalRatingCount) && totalRatingCount > 0;
    rating.title = hasRating
        ? `IGDB community rating: ${rating.textContent}/100` +
            `${hasRatingCount ? ` from ${new Intl.NumberFormat("en").format(totalRatingCount)} votes` : ""}`
        : "No IGDB community rating available";

    const ratingMeta = document.createElement("p");
    ratingMeta.classList.add("game-card__rating-meta");
    ratingMeta.textContent = hasRatingCount
        ? `IGDB · ${new Intl.NumberFormat("en").format(totalRatingCount)} votes`
        : "IGDB · No votes yet";

    const media = document.createElement("div");
    media.classList.add("game-card__media");
    const coverLink = document.createElement("a");
    coverLink.classList.add("game-card__cover-link");
    coverLink.href = createGameRoute(game);
    coverLink.setAttribute("aria-label", `View details for ${game.name}`);
    coverLink.appendChild(cover);
    media.append(coverLink, rating);

    const controls = document.createElement("div");
    controls.classList.add("game-card__controls");
    controls.hidden = !isAuthenticated;

    const statusSelect = document.createElement("select");
    statusSelect.classList.add("game-card__status");
    statusSelect.setAttribute("aria-label", `Status for ${game.name}`);
    GAME_STATUSES.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.disabled = value === DEFAULT_GAME_STATUS;
        statusSelect.appendChild(option);
    });
    statusSelect.value = savedStatus || DEFAULT_GAME_STATUS;
    statusSelect.dataset.savedStatus = statusSelect.value;

    const removeButton = document.createElement("button");
    removeButton.classList.add("game-card__remove");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${game.name} from your library`);
    removeButton.hidden = statusSelect.value === DEFAULT_GAME_STATUS;

    const trashIcon = document.createElement("i");
    trashIcon.classList.add("bi", "bi-trash");
    trashIcon.setAttribute("aria-hidden", "true");
    removeButton.appendChild(trashIcon);

    statusSelect.addEventListener("change", () => {
        removeButton.hidden = statusSelect.value === DEFAULT_GAME_STATUS;
    });

    removeButton.addEventListener("click", async () => {
        removeButton.disabled = true;
        try {
            await requestJson(`${API_URL}/api/remove-item?id=${game.id}`, {
                credentials: "include"
            });

            savedGames = savedGames.filter(
                savedGame => Number(savedGame.id) !== Number(game.id)
            );

            if (card.parentElement?.id === "game-library") {
                card.remove();
                refreshLibraryView();
                window.showAppNotice(`${game.name} was removed from your library.`);
                return;
            }

            statusSelect.value = DEFAULT_GAME_STATUS;
            statusSelect.dataset.savedStatus = DEFAULT_GAME_STATUS;
            removeButton.hidden = true;
            refreshCatalogVisibility();
            window.showAppNotice(`${game.name} was removed from your library.`);
        } catch (error) {
            console.error(`Could not remove ${game.name} from the library:`, error);
            window.showAppNotice(
                error.status === 401
                    ? "Your session has expired. Log in again to manage your library."
                    : `Could not remove ${game.name}. Check your connection and try again.`,
                "error"
            );
        } finally {
            removeButton.disabled = false;
        }
    });

    controls.append(statusSelect, removeButton);

    const title = document.createElement("h2");
    title.classList.add("game-card__title");

    const name = document.createElement("span");
    name.classList.add("game-card__name");
    name.textContent = game.name;
    const gameLink = document.createElement("a");
    gameLink.classList.add("game-card__link");
    gameLink.href = createGameRoute(game);
    gameLink.setAttribute("aria-label", `View details for ${game.name}`);
    gameLink.appendChild(name);
    title.appendChild(gameLink);

    const releaseYear = document.createElement("p");
    releaseYear.classList.add("game-card__year");
    const releaseTimestamp = Number(game.first_release_date);
    releaseYear.textContent = Number.isFinite(releaseTimestamp) && releaseTimestamp > 0
        ? String(new Date(releaseTimestamp * 1000).getUTCFullYear())
        : "Release date TBA";

    const platforms = document.createElement("div");
    platforms.classList.add("game-card__platforms");
    platforms.setAttribute("aria-label", "Available platforms");
    const platformFamilies = getPlatformFamilies(
        Array.isArray(game.platforms) ? game.platforms : []
    );
    platforms.hidden = platformFamilies.length === 0;
    platformFamilies.forEach(({ id, label, icon }) => {
            const platform = document.createElement("span");
            platform.classList.add("game-card__platform");
            platform.dataset.platform = id;
            platform.title = label;
            platform.setAttribute("aria-label", label);

            const platformIcon = document.createElement("i");
            platformIcon.classList.add("bi", icon);
            platformIcon.setAttribute("aria-hidden", "true");

            const platformName = document.createElement("span");
            platformName.textContent = label;
            platform.append(platformIcon, platformName);
            platforms.appendChild(platform);
        });

    const details = document.createElement("div");
    details.classList.add("game-card__details");
    details.append(releaseYear, controls, platforms);

    const body = document.createElement("div");
    body.classList.add("game-card__body");
    body.append(title, ratingMeta, details);
    card.append(media, body);
    return card;
};

// Render the next page of games and their saved statuses.
const loadCatalogPage = async () => {
    if (isCatalogLoading || !hasMoreCatalogGames) return;

    isCatalogLoading = true;
    const generation = catalogGeneration;
    const controller = new AbortController();
    catalogRequestController = controller;
    const loadMoreButton = document.getElementById("catalog-load-more");
    loadMoreButton.disabled = true;
    try {
        const params = new URLSearchParams({
            offset: String(catalogOffset),
            limit: String(PAGE_SIZE),
            sort: explorerFilters.sort
        });
        if (explorerFilters.search) params.set("search", explorerFilters.search);
        if (explorerFilters.genres.length) {
            params.set("genres", explorerFilters.genres.join(","));
        }
        if (explorerFilters.themes.length) {
            params.set("themes", explorerFilters.themes.join(","));
        }
        if (explorerFilters.platforms.length) {
            params.set("platforms", explorerFilters.platforms.join(","));
        }
        if (explorerFilters.yearFrom) params.set("yearFrom", explorerFilters.yearFrom);
        if (explorerFilters.yearTo) params.set("yearTo", explorerFilters.yearTo);

        const games = await requestJson(`${API_URL}/api/games?${params}`, {
            signal: controller.signal
        });
        if (generation !== catalogGeneration) return;

        savedGames = await fetchSavedGames();
        if (generation !== catalogGeneration) return;

        const savedGamesById = new Map(
            savedGames.map(game => [Number(game.id), game])
        );
        const catalog = document.getElementById("game-catalog");
        games.forEach(game => {
            const card = createGameCard(
                game,
                savedGamesById.get(Number(game.id))?.status
            );
            card.hidden = explorerFilters.hideOwned && savedGamesById.has(Number(game.id));
            catalog.appendChild(card);
        });

        catalogOffset += games.length;
        hasMoreCatalogGames = games.length === PAGE_SIZE;
        updateCatalogEmptyState();
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Could not load the game catalog:", error);
            const message = error.resource === "library"
                ? "Could not load your library status. Please try again."
                : "Could not load games. Please try again.";
            updateCatalogEmptyState(message);
            window.showAppNotice(
                error.resource === "library"
                    ? "Could not load your library status. Check your connection and try again."
                    : "Could not load games. Check your connection and try again.",
                "error"
            );
        }
    } finally {
        if (generation === catalogGeneration) {
            isCatalogLoading = false;
            loadMoreButton.disabled = false;
            if (catalogRequestController === controller) {
                catalogRequestController = null;
            }
        }
    }
};

// Refresh Explorer cards after changes made in the library.
const syncCatalogWithSavedGames = async () => {
    savedGames = await fetchSavedGames();
    const savedGamesById = new Map(
        savedGames.map(game => [Number(game.id), game])
    );

    document.querySelectorAll("#game-catalog .game-card").forEach(card => {
        const savedGame = savedGamesById.get(Number(card.dataset.gameId));
        const statusSelect = card.querySelector(".game-card__status");

        card.querySelector(".game-card__controls").hidden = !isAuthenticated;
        statusSelect.value = savedGame?.status || DEFAULT_GAME_STATUS;
        statusSelect.dataset.savedStatus = statusSelect.value;
        card.querySelector(".game-card__remove").hidden = !savedGame;
        card.hidden = explorerFilters.hideOwned && Boolean(savedGame);
    });
    updateCatalogEmptyState();
};

// Show Explorer and load or refresh its game cards.
const openExplorer = async () => {
    try {
        if (!isCatalogLoaded) {
            isCatalogLoaded = true;
            await loadCatalogPage();
            return;
        }

        await syncCatalogWithSavedGames();
    } catch (error) {
        console.error("Could not refresh the game catalog:", error);
        window.showAppNotice(
            "Could not refresh your library status. Please try again.",
            "error"
        );
    }
};

// Apply validated filter selections and restart catalog pagination.
const applyCatalogFilters = async () => {
    const filters = readExplorerFilters();
    if (!filters) return;

    explorerFilters = filters;
    isCatalogLoaded = true;
    renderActiveCatalogFilters();
    resetCatalogResults();
    await loadCatalogPage();
};

// Debounce text-based filters while applying checkbox and select changes at once.
const scheduleCatalogFilterApplication = (delay = 0) => {
    window.clearTimeout(catalogFilterTimer);
    catalogFilterTimer = window.setTimeout(() => {
        applyCatalogFilters();
    }, delay);
};

// Load a user's saved games and render the matching catalog entries.
const openLibrary = async () => {
    try {
        savedGames = await fetchSavedGames();
        const library = document.getElementById("game-library");
        library.replaceChildren();

        if (!savedGames.length) {
            refreshLibraryView();
            return;
        }

        const games = await requestJson(
            `${API_URL}/api/library?ids=${savedGames.map(game => game.id).join(",")}`
        );
        const savedGamesById = new Map(
            savedGames.map(game => [Number(game.id), game])
        );

        games.forEach(game => {
            const savedGame = savedGamesById.get(Number(game.id));
            library.appendChild(
                createGameCard(game, savedGame?.status, savedGame?.created_at)
            );
        });
        refreshLibraryView();
    } catch (error) {
        console.error("Could not load the game library:", error);
        window.showAppNotice(
            "Could not load your library. Check your connection and try again.",
            "error"
        );
    }
};

// Check the session and set up navigation and infinite scrolling.
const initializeCatalog = async () => {
    renderLibraryMenus();
    renderContentMenu(
        "explorer-content-menu",
        LIBRARY_CONTENT_TYPES[0].id,
        "explorerContent"
    );
    loadCatalogFilterOptions();

    const catalogFilterToggle = document.getElementById("catalog-filters-toggle");
    const catalogFilterPanel = document.getElementById("catalog-filter-panel");
    const setCatalogFiltersOpen = isOpen => {
        catalogFilterPanel.dataset.open = String(isOpen);
        catalogFilterToggle.setAttribute("aria-expanded", String(isOpen));
    };
    catalogFilterToggle.addEventListener("click", () => {
        setCatalogFiltersOpen(catalogFilterToggle.getAttribute("aria-expanded") !== "true");
    });
    document.getElementById("catalog-filter-apply").addEventListener("click", () => {
        scheduleCatalogFilterApplication();
        setCatalogFiltersOpen(false);
    });
    document.getElementById("catalog-filter-retry").addEventListener("click", () => {
        loadCatalogFilterOptions();
    });
    document.getElementById("catalog-active-filters").addEventListener("click", event => {
        const button = event.target.closest("[data-filter-key]");
        if (button) removeCatalogFilter(button.dataset.filterKey);
    });
    document.getElementById("catalog-clear-filters").addEventListener("click", () => {
        document.getElementById("catalog-filters").reset();
    });

    document.getElementById("explorer-content-menu").addEventListener("click", event => {
        const button = event.target.closest("[data-explorer-content]");
        if (!button) return;

        document.querySelectorAll("#explorer-content-menu [data-explorer-content]")
            .forEach(contentButton => {
                contentButton.setAttribute(
                    "aria-pressed",
                    String(contentButton === button)
                );
            });
    });
    const catalogFilterForm = document.getElementById("catalog-filters");
    catalogFilterForm.addEventListener("submit", event => {
        event.preventDefault();
        scheduleCatalogFilterApplication();
    });
    catalogFilterForm.addEventListener("change", event => {
        if (!["catalog-platform-search", "catalog-year-from", "catalog-year-to"]
            .includes(event.target.id)) {
            if (event.target.matches(".catalog-filter-option input")) {
                sortSelectedCatalogOptions(event.target);
            }
            scheduleCatalogFilterApplication();
        }
    });
    catalogFilterForm.addEventListener("reset", () => {
        setCatalogFiltersOpen(false);
        window.clearTimeout(catalogFilterTimer);
        window.clearTimeout(catalogSearchTimer);
        window.setTimeout(() => {
            document.getElementById("catalog-search").value = "";
            document.getElementById("catalog-sort").value = "rating";
            document.querySelectorAll("#catalog-platform-options .catalog-filter-option")
                .forEach(option => {
                    option.hidden = false;
                });
            scheduleCatalogFilterApplication();
        });
    });
    catalogFilterForm.addEventListener("input", event => {
        if (event.target.id === "catalog-year-from" ||
            event.target.id === "catalog-year-to") {
            scheduleCatalogFilterApplication(350);
        }
    });
    document.getElementById("catalog-platform-search").addEventListener("input", event => {
        const searchTerm = event.target.value.trim().toLocaleLowerCase();
        document.querySelectorAll("#catalog-platform-options .catalog-filter-option")
            .forEach(option => {
                option.hidden = !option.dataset.searchText.includes(searchTerm);
            });
    });
    document.getElementById("catalog-search").addEventListener("input", () => {
        window.clearTimeout(catalogSearchTimer);
        catalogSearchTimer = window.setTimeout(() => {
            scheduleCatalogFilterApplication();
        }, 350);
    });
    document.getElementById("catalog-sort").addEventListener("change", () => {
        scheduleCatalogFilterApplication();
    });
    document.getElementById("game-catalog").addEventListener("change", event => {
        if (event.target.matches(".game-card__status")) refreshCatalogVisibility();
    });
    document.getElementById("catalog-load-more").addEventListener("click", () => {
        loadCatalogPage();
    });

    document.getElementById("library-content-menu").addEventListener("click", event => {
        const button = event.target.closest("[data-library-content]");
        if (!button) return;

        activeLibraryContent = button.dataset.libraryContent;
        document.querySelectorAll("#library-content-menu [data-library-content]")
            .forEach(contentButton => {
                contentButton.setAttribute(
                    "aria-pressed",
                    String(contentButton.dataset.libraryContent === activeLibraryContent)
                );
            });
    });
    const libraryFilterToggle = document.getElementById("library-filters-toggle");
    const libraryStatusFilters = document.getElementById("library-status-filters");
    const setLibraryFiltersOpen = isOpen => {
        libraryStatusFilters.dataset.open = String(isOpen);
        libraryFilterToggle.setAttribute("aria-expanded", String(isOpen));
    };
    libraryFilterToggle.addEventListener("click", () => {
        setLibraryFiltersOpen(libraryFilterToggle.getAttribute("aria-expanded") !== "true");
    });
    libraryStatusFilters.addEventListener("click", event => {
        const button = event.target.closest("[data-library-status]");
        if (!button) return;

        activeLibraryStatus = button.dataset.libraryStatus;
        refreshLibraryView();
        setLibraryFiltersOpen(false);
    });
    document.getElementById("library-search").addEventListener("input", event => {
        activeLibrarySearch = event.target.value.trim().toLocaleLowerCase();
        refreshLibraryView();
    });
    document.getElementById("library-sort").addEventListener("change", event => {
        activeLibrarySort = event.target.value;
        refreshLibraryView();
    });
    document.getElementById("game-library").addEventListener("change", event => {
        if (event.target.matches(".game-card__status")) refreshLibraryView();
    });

    document.addEventListener("app:library-state-changed", ({ detail }) => {
        const gameId = Number(detail.gameId);
        const savedGame = savedGames.find(game => Number(game.id) === gameId);
        if (detail.status === DEFAULT_GAME_STATUS) {
            savedGames = savedGames.filter(game => Number(game.id) !== gameId);
        } else if (savedGame) {
            savedGame.status = detail.status;
        } else {
            savedGames.push({
                id: gameId,
                game_name: detail.gameName,
                status: detail.status,
                created_at: detail.savedAt || new Date().toISOString()
            });
        }
        refreshCatalogVisibility();
        refreshLibraryView();
    });

    document.addEventListener("app:navigate", async ({ detail: { route } }) => {
        setCatalogFiltersOpen(false);
        setLibraryFiltersOpen(false);
        if (!isAuthenticationResolved) return;

        if (route === "explore") {
            await openExplorer();
        } else if (route === "library") {
            if (!isAuthenticated) {
                navigateToRoute("login", { replace: true });
                return;
            }
            await openLibrary();
        } else if (route === "profile" && !isAuthenticated) {
            navigateToRoute("login", { replace: true });
        }
    });

    window.addEventListener("auth:changed", event => {
        isAuthenticated = event.detail.authenticated;
        isAuthenticationResolved = true;
        updateAuthenticationControls();
    });

    isAuthenticated = await window.authStateReady;
    isAuthenticationResolved = true;
    updateAuthenticationControls();

    const sentinel = document.getElementById("catalog-scroll-sentinel");
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) loadCatalogPage();
        }).observe(sentinel);
    }

    restoreRouteFromUrl();
};

initializeCatalog();
