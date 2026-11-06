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
const normalizeGameStatus = status => {
    const value = String(status || "").trim().toLocaleLowerCase();
    const normalized = {
        playing: "play",
        paused: "pause",
        dropped: "drop"
    }[value] || value;
    return GAME_STATUSES.some(([knownStatus]) => knownStatus === normalized)
        ? normalized
        : DEFAULT_GAME_STATUS;
};
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

const createGameRoute = (game, returnRoute = "explore") => {
    const slug = game.name.normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "game";
    return `#game/${game.id}/${slug}?from=${returnRoute}`;
};

const GAME_DETAIL_TABS = [
    { id: "overview", label: "Overview" },
    { id: "missions", label: "Missions" },
    { id: "media", label: "Gallery" },
    { id: "related", label: "Related content" },
    { id: "platforms", label: "Platforms" },
    { id: "more", label: "More" }
];
let gameDetailController = null;
let currentGameDetail = null;
let activeGameDetailTab = "overview";

const gameItemName = item => {
    if (typeof item === "string") return item;
    return typeof item?.name === "string" ? item.name : "";
};

const gameItemId = item => {
    const id = Number(item?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const createDetailHeading = text => {
    const heading = document.createElement("h2");
    heading.classList.add("game-detail-section__heading");
    heading.textContent = text;
    return heading;
};

const createDetailSection = (title, content) => {
    const section = document.createElement("section");
    section.classList.add("game-detail-section");
    section.append(createDetailHeading(title), content);
    return section;
};

const createNameList = items => {
    const list = document.createElement("ul");
    list.classList.add("game-detail-name-list");
    const names = (Array.isArray(items) ? items : [])
        .map(gameItemName)
        .filter(Boolean);

    if (!names.length) {
        const empty = document.createElement("li");
        empty.classList.add("game-detail-muted");
        empty.textContent = "Not available";
        list.appendChild(empty);
        return list;
    }

    names.forEach(name => {
        const item = document.createElement("li");
        item.textContent = name;
        list.appendChild(item);
    });
    return list;
};

const formatGameDate = timestamp => {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "";
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC"
    }).format(new Date(value * 1000));
};

const getReleaseRegionName = region => {
    const regionNames = {
        1: "Europe",
        2: "North America",
        3: "Australia",
        4: "New Zealand",
        5: "Japan",
        6: "China",
        7: "Asia",
        8: "Worldwide [WW]",
        9: "Korea",
        10: "Brazil"
    };
    const id = Number(region);
    return regionNames[id] || gameItemName(region) || "Region not specified";
};

const getGameMedia = game => {
    const media = [];
    (Array.isArray(game.videos) ? game.videos : []).forEach(video => {
        if (typeof video.video_id !== "string" || !video.video_id) return;
        media.push({
            type: "video",
            label: video.name || "Game trailer",
            videoId: video.video_id,
            thumbnail: `https://img.youtube.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`
        });
    });

    const seenImages = new Set();
    const appendImages = (items, type, label) => {
        (Array.isArray(items) ? items : []).forEach(image => {
            if (typeof image.image_id !== "string" || !image.image_id ||
                seenImages.has(image.image_id)) return;
            seenImages.add(image.image_id);
            media.push({
                type,
                label,
                imageUrl: `https://images.igdb.com/igdb/image/upload/t_1080p/${image.image_id}.jpg`
            });
        });
    };

    appendImages(game.screenshots, "screenshot", "Screenshot");
    appendImages(game.artworks, "artwork", "Artwork");
    return media;
};

let currentGameMediaIndex = 0;

const setFeaturedGameMedia = (media, index = 0, total = 0, scrollThumbnail = true) => {
    const featured = document.getElementById("game-detail-featured");
    featured.replaceChildren();
    if (!media) {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "No images or videos are available yet.";
        featured.appendChild(empty);
        return;
    }

    if (media.type === "video") {
        const frame = document.createElement("iframe");
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.videoId)}`;
        frame.title = media.label;
        frame.loading = "lazy";
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.allow =
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        frame.allowFullscreen = true;
        featured.appendChild(frame);
    } else {
        const image = document.createElement("img");
        image.src = media.imageUrl;
        image.alt = media.label;
        image.loading = "lazy";
        featured.appendChild(image);
    }

    if (total > 1) {
        const previous = document.createElement("button");
        previous.classList.add("game-detail-gallery__arrow", "game-detail-gallery__arrow--previous");
        previous.type = "button";
        previous.dataset.galleryDirection = "-1";
        previous.setAttribute("aria-label", "Previous gallery item");
        const previousIcon = document.createElement("i");
        previousIcon.classList.add("bi", "bi-chevron-left");
        previousIcon.setAttribute("aria-hidden", "true");
        previous.appendChild(previousIcon);

        const next = document.createElement("button");
        next.classList.add("game-detail-gallery__arrow", "game-detail-gallery__arrow--next");
        next.type = "button";
        next.dataset.galleryDirection = "1";
        next.setAttribute("aria-label", "Next gallery item");
        const nextIcon = document.createElement("i");
        nextIcon.classList.add("bi", "bi-chevron-right");
        nextIcon.setAttribute("aria-hidden", "true");
        next.appendChild(nextIcon);

        const counter = document.createElement("span");
        counter.classList.add("game-detail-gallery__counter");
        counter.setAttribute("aria-live", "polite");
        counter.textContent = `${index + 1} / ${total}`;
        featured.append(previous, next, counter);
    }

    document.querySelectorAll("#game-detail-thumbnails [data-media-index]")
        .forEach(thumbnail => {
            const selected = Number(thumbnail.dataset.mediaIndex) === index;
            thumbnail.setAttribute("aria-pressed", String(selected));
            if (selected && scrollThumbnail) {
                thumbnail.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center"
                });
            }
        });
};

const renderGameMedia = game => {
    const media = getGameMedia(game);
    const featured = document.getElementById("game-detail-featured");
    const thumbnails = document.getElementById("game-detail-thumbnails");
    currentGameMediaIndex = 0;
    thumbnails.replaceChildren();
    media.forEach((item, index) => {
        item.index = index;
        const button = document.createElement("button");
        button.classList.add("game-detail-thumbnail");
        button.type = "button";
        button.dataset.mediaIndex = String(index);
        button.setAttribute("aria-label", `Show ${item.label}`);
        button.setAttribute("aria-pressed", String(index === 0));

        const image = document.createElement("img");
        image.src = item.type === "video" ? item.thumbnail : item.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        button.appendChild(image);

        if (item.type === "video") {
            const play = document.createElement("span");
            play.classList.add("game-detail-thumbnail__play");
            play.setAttribute("aria-hidden", "true");
            play.textContent = "▶";
            button.appendChild(play);
        }

        const label = document.createElement("span");
        label.classList.add("visually-hidden");
        label.textContent = item.label;
        button.appendChild(label);
        thumbnails.appendChild(button);
    });
    featured.replaceChildren();
    setFeaturedGameMedia(media[0], 0, media.length, false);

    return media;
};

const renderGameStory = game => {
    const story = document.createElement("div");
    story.classList.add("game-detail-story");
    const synopsis = game.storyline || game.summary || "";
    if (synopsis) {
        const paragraph = document.createElement("p");
        paragraph.textContent = synopsis;
        story.appendChild(paragraph);
    } else {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "No synopsis is available for this game yet.";
        story.appendChild(empty);
    }
    if (game.storyline && game.summary && game.storyline !== game.summary) {
        story.appendChild(createDetailSection("At a glance", createNameList([game.summary])));
    }
    return story;
};

const formatPlaytimeHours = hours => {
    const value = Number(hours);
    if (!Number.isFinite(value) || value < 0) return null;
    return `${Number.isInteger(value) ? value : value.toFixed(1)} hours`;
};

const formatRatingOutOfTen = rating =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(rating);

const renderPlaytimePlaceholder = (howlongtobeat, loading, failed) => {
    const section = document.createElement("section");
    section.classList.add("game-detail-section", "game-detail-playtime");
    section.appendChild(createDetailHeading("Playtime estimates"));

    const estimates = document.createElement("div");
    estimates.classList.add("game-detail-playtime__estimates");
    [
        ["Main Story", "main_story_hours"],
        ["Main + Extras", "main_story_plus_extras_hours"],
        ["Completionist", "completionist_hours"]
    ].forEach(([label, key]) => {
        const card = document.createElement("article");
        card.classList.add("game-detail-playtime__card");
        const title = document.createElement("h3");
        title.textContent = label;
        const value = document.createElement("p");
        value.classList.add("game-detail-playtime__value");
        const hours = formatPlaytimeHours(howlongtobeat?.[key]);
        value.textContent = hours || "—";
        const status = document.createElement("span");
        status.classList.add("game-detail-playtime__status");
        status.textContent = loading
            ? "Loading estimate…"
            : failed
                ? "Could not load estimate"
                : hours
                    ? "HowLongToBeat estimate"
                    : "Not available";
        card.append(title, value, status);
        estimates.appendChild(card);
    });

    section.appendChild(estimates);
    return section;
};

const getGameCompaniesByRole = (game, role) => {
    const companies = Array.isArray(game.involved_companies)
        ? game.involved_companies
        : [];
    return companies
        .filter(item => item[role])
        .map(item => gameItemName(item.company))
        .filter(Boolean);
};

const renderOverviewTab = game => {
    const details = document.createElement("div");
    details.classList.add("game-detail-overview");
    details.appendChild(renderPlaytimePlaceholder(
        currentGameDetail.playtime,
        currentGameDetail.playtimeLoading,
        currentGameDetail.playtimeFailed
    ));
    details.appendChild(createDetailSection("Story", renderGameStory(game)));

    const platformFamilies = getPlatformFamilies(
        Array.isArray(game.platforms) ? game.platforms : []
    );
    const platforms = document.createElement("div");
    platforms.classList.add("game-detail-overview__platforms");
    if (platformFamilies.length) {
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
    } else {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "Platform information is not available yet.";
        platforms.appendChild(empty);
    }
    details.appendChild(createDetailSection("Platforms", platforms));

    const fields = [
        ["Genres", game.genres],
        ["Developed by", getGameCompaniesByRole(game, "developer")],
        ["Published by", getGameCompaniesByRole(game, "publisher")]
    ];
    fields.forEach(([label, items]) => {
        const values = (Array.isArray(items) ? items : [])
            .map(gameItemName)
            .filter(Boolean);
        if (!values.length) return;
        const row = document.createElement("div");
        row.classList.add("game-detail-overview__row");
        const term = document.createElement("h3");
        term.textContent = label;
        row.append(term, createNameList(items));
        details.appendChild(row);
    });
    return details;
};

const renderMoreTab = game => {
    const content = document.createElement("div");
    content.classList.add("game-detail-overview");
    const companies = getGameCompaniesByRole(game, "supporting");
    const fields = [
        ["Supporting studios", companies],
        ["Game modes", game.game_modes],
        ["Themes", game.themes],
        ["Player perspective", game.player_perspectives],
        ["Series", game.collections],
        ["Franchise", game.franchises],
        ["Game engine", game.game_engines]
    ];
    let visibleRows = 0;
    fields.forEach(([label, items]) => {
        const values = (Array.isArray(items) ? items : [])
            .map(gameItemName)
            .filter(Boolean);
        if (!values.length) return;
        visibleRows += 1;
        const row = document.createElement("div");
        row.classList.add("game-detail-overview__row");
        const term = document.createElement("h3");
        term.textContent = label;
        row.append(term, createNameList(items));
        content.appendChild(row);
    });
    if (game.parent_game) {
        content.appendChild(createDetailSection(
            "Related game",
            createNameList([game.parent_game])
        ));
        visibleRows += 1;
    }
    if (!visibleRows) {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "No additional details are available for this game yet.";
        content.appendChild(empty);
    }
    return content;
};

const appendMediaGrid = (container, media) => {
    if (!media.length) {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "No media is available in this category yet.";
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement("div");
    grid.classList.add("game-detail-media-grid");
    media.forEach(item => {
        const button = document.createElement("button");
        button.classList.add("game-detail-media-card");
        button.type = "button";
        button.dataset.mediaIndex = String(item.index);
        button.setAttribute("aria-label", `Show ${item.label} in featured media`);
        const image = document.createElement("img");
        image.src = item.type === "video" ? item.thumbnail : item.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        button.appendChild(image);
        if (item.type === "video") {
            const play = document.createElement("span");
            play.classList.add("game-detail-thumbnail__play");
            play.setAttribute("aria-hidden", "true");
            play.textContent = "▶";
            button.appendChild(play);
        }
        const caption = document.createElement("span");
        caption.textContent = item.label;
        button.appendChild(caption);
        grid.appendChild(button);
    });
    container.appendChild(grid);
};

const renderMediaTab = (game, media) => {
    const content = document.createElement("div");
    content.classList.add("game-detail-media");
    const coverMedia = game.cover?.image_id
        ? [{
            type: "cover",
            label: "Cover",
            imageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        }]
        : [];
    [
        ["Videos", media.filter(item => item.type === "video")],
        ["Screenshots", media.filter(item => item.type === "screenshot")],
        ["Artwork", media.filter(item => item.type === "artwork")],
        ["Cover", coverMedia]
    ].forEach(([title, items]) => {
        if (items.length) {
            const section = document.createElement("section");
            section.classList.add("game-detail-section");
            section.appendChild(createDetailHeading(title));
            appendMediaGrid(section, items);
            content.appendChild(section);
        }
    });
    if (!content.childElementCount) {
        appendMediaGrid(content, media);
    }
    return content;
};

const renderRelatedTab = game => {
    const groups = [
        ["Expansions", game.expansions],
        ["Additional content", game.dlcs],
        ["Bundles and editions", [
            ...(Array.isArray(game.bundles) ? game.bundles : []),
            ...(Array.isArray(game.editions) ? game.editions : [])
        ]],
        ["Ports and remasters", [
            ...(Array.isArray(game.ports) ? game.ports : []),
            ...(Array.isArray(game.remasters) ? game.remasters : [])
        ]],
        ["Remakes and standalone expansions", [
            ...(Array.isArray(game.remakes) ? game.remakes : []),
            ...(Array.isArray(game.standalone_expansions)
                ? game.standalone_expansions
                : [])
        ]]
    ];
    const content = document.createElement("div");
    content.classList.add("game-detail-related");
    let hasRelatedContent = false;
    groups.forEach(([title, items]) => {
        if (!Array.isArray(items) || !items.length) return;
        hasRelatedContent = true;
        const section = document.createElement("section");
        section.classList.add("game-detail-related__group");
        section.appendChild(createDetailHeading(title));
        const cards = document.createElement("div");
        cards.classList.add("game-detail-related__cards");
        items.forEach(item => {
            const name = gameItemName(item);
            if (!name) return;
            const card = document.createElement("article");
            card.classList.add("game-detail-related-card");
            const cover = document.createElement("img");
            cover.alt = "";
            cover.loading = "lazy";
            cover.src = item.cover?.image_id
                ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${item.cover.image_id}.jpg`
                : "/assets/no-cover.png";
            const titleElement = document.createElement("h3");
            titleElement.textContent = name;
            card.append(cover, titleElement);
            cards.appendChild(card);
        });
        section.appendChild(cards);
        content.appendChild(section);
    });
    if (!hasRelatedContent) {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "No related content is listed for this game yet.";
        content.appendChild(empty);
    }
    return content;
};

const renderPlatformsTab = game => {
    const platforms = Array.isArray(game.platforms) ? game.platforms : [];
    const releases = Array.isArray(game.release_dates) ? game.release_dates : [];
    const companies = Array.isArray(game.involved_companies)
        ? game.involved_companies
        : [];
    const content = document.createElement("div");
    content.classList.add("game-detail-platforms");
    if (!platforms.length) {
        const empty = document.createElement("p");
        empty.classList.add("game-detail-muted");
        empty.textContent = "Platform information is not available yet.";
        content.appendChild(empty);
        return content;
    }

    platforms.forEach(platform => {
        const platformName = gameItemName(platform);
        if (!platformName) return;
        const platformId = gameItemId(platform);
        const platformReleases = releases.filter(release =>
            platformId && gameItemId(release.platform) === platformId ||
            gameItemName(release.platform) === platformName
        );
        const card = document.createElement("article");
        card.classList.add("game-detail-platform-card");
        const heading = document.createElement("h3");
        heading.textContent = platformName;
        card.appendChild(heading);

        const releaseList = document.createElement("ul");
        releaseList.classList.add("game-detail-platform-card__releases");
        platformReleases.forEach(release => {
            const item = document.createElement("li");
            const region = getReleaseRegionName(release.region);
            const date = release.human || formatGameDate(release.date) || "Release date TBA";
            const status = gameItemName(release.status);
            const description = [date, status].filter(Boolean).join(" · ");
            item.textContent = `${region} — ${description}`;
            releaseList.appendChild(item);
        });
        if (!releaseList.childElementCount) {
            const item = document.createElement("li");
            item.textContent = "Platform release date not listed";
            releaseList.appendChild(item);
        }
        card.appendChild(releaseList);

        [
            ["Main developer(s)", "developer"],
            ["Publisher(s)", "publisher"],
            ["Supporting developer(s)", "supporting"]
        ].forEach(([label, role]) => {
            const names = companies
                .filter(company => company[role])
                .map(company => company.company)
                .filter(Boolean);
            if (!names.length) return;
            const group = document.createElement("div");
            group.classList.add("game-detail-platform-card__companies");
            const groupTitle = document.createElement("h4");
            groupTitle.textContent = label;
            group.append(groupTitle, createNameList(names));
            card.appendChild(group);
        });
        content.appendChild(card);
    });
    return content;
};

const renderGameDetailTab = tabId => {
    if (!currentGameDetail) return;
    const game = currentGameDetail.game;
    const media = currentGameDetail.media;
    const panel = document.getElementById("game-detail-panel");
    panel.setAttribute("aria-labelledby", `game-tab-${tabId}`);
    panel.replaceChildren();

    if (tabId === "overview") {
        panel.appendChild(renderOverviewTab(game));
    } else if (tabId === "missions") {
        const empty = document.createElement("div");
        empty.classList.add("game-detail-empty");
        empty.textContent =
            "Missions and quests will appear here when guide data becomes available.";
        panel.appendChild(empty);
    } else if (tabId === "media") {
        panel.appendChild(renderMediaTab(game, media));
    } else if (tabId === "related") {
        panel.appendChild(renderRelatedTab(game));
    } else if (tabId === "platforms") {
        panel.appendChild(renderPlatformsTab(game));
    } else if (tabId === "more") {
        panel.appendChild(renderMoreTab(game));
    }

    document.querySelectorAll("#game-detail-tabs [role='tab']").forEach(tab => {
        const selected = tab.dataset.gameTab === tabId;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
}

const renderGameDetailTabs = () => {
    const tabs = document.getElementById("game-detail-tabs");
    tabs.replaceChildren();
    GAME_DETAIL_TABS.forEach(({ id, label }) => {
        const tab = document.createElement("button");
        tab.classList.add("game-detail-tab");
        tab.type = "button";
        tab.id = `game-tab-${id}`;
        tab.dataset.gameTab = id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "game-detail-panel");
        tab.textContent = label;
        tabs.appendChild(tab);
    });
};

const showGameDetailMessage = (message, isError = false) => {
    const messageElement = document.getElementById("game-detail-message");
    messageElement.replaceChildren();
    messageElement.dataset.type = isError ? "error" : "status";
    const text = document.createElement("span");
    text.textContent = message;
    messageElement.appendChild(text);
};

const updateGameDetailLibraryControls = status => {
    const controls = document.getElementById("game-detail-library-controls");
    const statusSelect = document.getElementById("game-detail-library-status");
    const removeButton = document.getElementById("game-detail-library-remove");
    const normalizedStatus = normalizeGameStatus(status);

    controls.hidden = !isAuthenticated;
    statusSelect.value = normalizedStatus;
    statusSelect.dataset.savedStatus = normalizedStatus;
    statusSelect.querySelector('option[value="select"]').disabled =
        normalizedStatus !== DEFAULT_GAME_STATUS;
    removeButton.hidden = normalizedStatus === DEFAULT_GAME_STATUS;
};

const loadGameDetail = async gameId => {
    gameDetailController?.abort();
    const controller = new AbortController();
    gameDetailController = controller;
    currentGameDetail = null;
    document.getElementById("game-detail-content").hidden = true;
    showGameDetailMessage("Loading game details…");

    try {
        const game = await requestJson(`${API_URL}/api/games/${gameId}`, {
            signal: controller.signal
        });
        if (controller.signal.aborted) return;

        currentGameDetail = {
            game,
            media: renderGameMedia(game),
            playtime: null,
            playtimeLoading: true,
            playtimeFailed: false
        };
        const libraryControls = document.getElementById("game-detail-library-controls");
        libraryControls.dataset.gameId = String(game.id);
        libraryControls.dataset.gameName = game.name;
        updateGameDetailLibraryControls(DEFAULT_GAME_STATUS);

        if (isAuthenticated) {
            try {
                savedGames = await fetchSavedGames();
                if (controller.signal.aborted) return;
                const savedGame = savedGames.find(
                    item => Number(item.id) === Number(game.id)
                );
                updateGameDetailLibraryControls(
                    savedGame?.status || DEFAULT_GAME_STATUS
                );
            } catch (error) {
                console.error(`Could not load library status for ${game.name}:`, error);
                window.showAppNotice(
                    "Could not load your library status. Please try again.",
                    "error"
                );
            }
        }

        const title = document.getElementById("game-route-title");
        title.textContent = game.name;
        const detailRating = document.getElementById("game-detail-rating");
        const totalRating = Number(game.total_rating);
        const hasRating = game.total_rating !== null &&
            game.total_rating !== undefined &&
            Number.isFinite(totalRating);
        const ratingOutOfTen = hasRating ? totalRating / 10 : null;
        const formattedRating = hasRating
            ? formatRatingOutOfTen(ratingOutOfTen)
            : "—";
        detailRating.textContent = formattedRating;
        detailRating.dataset.ratingLevel = !hasRating
            ? "none"
            : ratingOutOfTen >= 10
                ? "perfect"
                : ratingOutOfTen >= 8
                    ? "great"
                    : ratingOutOfTen >= 6
                        ? "good"
                        : ratingOutOfTen >= 4
                            ? "fair"
                            : "low";
        const ratingCount = Number(game.total_rating_count);
        const hasRatingCount = Number.isFinite(ratingCount) && ratingCount > 0;
        detailRating.setAttribute(
            "aria-label",
            hasRating
                ? `IGDB rating ${formattedRating} out of 10` +
                    `${hasRatingCount ? ` from ${new Intl.NumberFormat("en").format(ratingCount)} votes` : ""}`
                : "No IGDB rating available"
        );
        detailRating.title = detailRating.getAttribute("aria-label");

        const release = document.getElementById("game-detail-release");
        const publishers = getGameCompaniesByRole(game, "publisher");
        const releaseYear = Number(game.first_release_date) > 0
            ? new Date(Number(game.first_release_date) * 1000).getUTCFullYear()
            : null;
        release.textContent = `${publishers.join(", ") || "Publisher not listed"} - ${
            releaseYear || "Release date TBA"
        }`;

        const cover = document.getElementById("game-detail-cover");
        cover.src = game.cover?.image_id
            ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
            : "/assets/no-cover.png";
        cover.alt = `${game.name} cover`;
        cover.hidden = false;

        activeGameDetailTab = "overview";
        renderGameDetailTabs();
        renderGameDetailTab(activeGameDetailTab);
        document.getElementById("game-detail-content").hidden = false;
        showGameDetailMessage("");
        loadGamePlaytime(game.id, controller);
    } catch (error) {
        if (error.name === "AbortError") return;
        console.error(`Could not load game ${gameId}:`, error);
        showGameDetailMessage(
            error.status === 404
                ? "This game could not be found."
                : "Could not load this game's details. Please try again.",
            true
        );
        const retry = document.createElement("button");
        retry.classList.add("game-detail-retry");
        retry.type = "button";
        retry.textContent = "Try again";
        retry.addEventListener("click", () => loadGameDetail(gameId), { once: true });
        document.getElementById("game-detail-message").appendChild(retry);
    }
};

const loadGamePlaytime = async (gameId, controller) => {
    try {
        const result = await requestJson(`${API_URL}/api/games/${gameId}/playtime`, {
            signal: controller.signal
        });
        if (controller.signal.aborted ||
            Number(currentGameDetail?.game.id) !== Number(gameId)) return;

        currentGameDetail.playtime = result.howlongtobeat;
        currentGameDetail.playtimeLoading = false;
        if (activeGameDetailTab === "overview") {
            renderGameDetailTab(activeGameDetailTab);
        }
    } catch (error) {
        if (error.name === "AbortError") return;
        console.error(`Could not load playtime for game ${gameId}:`, error);
        if (Number(currentGameDetail?.game.id) !== Number(gameId)) return;

        currentGameDetail.playtimeLoading = false;
        currentGameDetail.playtimeFailed = true;
        if (activeGameDetailTab === "overview") {
            renderGameDetailTab(activeGameDetailTab);
        }
    }
};

// Create a game card and wire its status and remove controls.
const createGameCard = (
    game,
    savedStatus = DEFAULT_GAME_STATUS,
    addedAt = "",
    returnRoute = "explore"
) => {
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
    const ratingOutOfTen = hasRating ? totalRating / 10 : null;
    const formattedRating = hasRating
        ? formatRatingOutOfTen(ratingOutOfTen)
        : "—";
    rating.textContent = formattedRating;
    rating.dataset.ratingLevel = !hasRating
        ? "none"
        : ratingOutOfTen >= 10
            ? "perfect"
            : ratingOutOfTen >= 8
                ? "great"
                : ratingOutOfTen >= 6
                    ? "good"
                    : ratingOutOfTen >= 4
                        ? "fair"
                        : "low";
    rating.setAttribute(
        "aria-label",
        !hasRating
            ? "No IGDB rating available"
            : `IGDB rating ${formattedRating} out of 10`
    );
    const totalRatingCount = Number(game.total_rating_count);
    const hasRatingCount = Number.isFinite(totalRatingCount) && totalRatingCount > 0;
    rating.title = hasRating
        ? `IGDB rating: ${rating.textContent}` +
            `${hasRatingCount ? ` from ${new Intl.NumberFormat("en").format(totalRatingCount)} votes` : ""}`
        : "No IGDB rating available";

    const ratingMeta = document.createElement("p");
    ratingMeta.classList.add("game-card__rating-meta");
    ratingMeta.textContent = hasRatingCount
        ? `IGDB · ${new Intl.NumberFormat("en").format(totalRatingCount)} votes`
        : "IGDB · No votes yet";

    const media = document.createElement("div");
    media.classList.add("game-card__media");
    const coverLink = document.createElement("a");
    coverLink.classList.add("game-card__cover-link");
    coverLink.href = createGameRoute(game, returnRoute);
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
    statusSelect.value = normalizeGameStatus(savedStatus);
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

            document.dispatchEvent(new CustomEvent("app:library-state-changed", {
                detail: {
                    gameId: game.id,
                    gameName: game.name,
                    status: DEFAULT_GAME_STATUS
                }
            }));
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
    gameLink.href = createGameRoute(game, returnRoute);
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
                savedGamesById.get(Number(game.id))?.status,
                "",
                "explore"
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
        statusSelect.value = normalizeGameStatus(savedGame?.status);
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

        let gamesById = new Map();
        try {
            const games = await requestJson(
                `${API_URL}/api/library?ids=${savedGames.map(game => game.id).join(",")}`
            );
            if (!Array.isArray(games)) {
                throw new Error("The server returned an invalid game details response.");
            }
            gamesById = new Map(games.map(game => [Number(game.id), game]));
        } catch (error) {
            console.error("Could not load catalog details for saved games:", error);
        }

        savedGames.forEach(savedGame => {
            const details = gamesById.get(Number(savedGame.id));
            const game = {
                ...details,
                id: Number(savedGame.id),
                name: details?.name || savedGame.game_name || `Game ${savedGame.id}`
            };
            library.appendChild(
                createGameCard(
                    game,
                    normalizeGameStatus(savedGame.status),
                    savedGame.created_at,
                    "library"
                )
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

    const gameDetailTabs = document.getElementById("game-detail-tabs");
    gameDetailTabs.addEventListener("click", event => {
        const tab = event.target.closest("[data-game-tab]");
        if (!tab) return;
        activeGameDetailTab = tab.dataset.gameTab;
        renderGameDetailTab(activeGameDetailTab);
    });
    gameDetailTabs.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...gameDetailTabs.querySelectorAll("[role='tab']")];
        const currentIndex = tabs.indexOf(document.activeElement);
        if (currentIndex < 0) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? tabs.length - 1
                : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                    tabs.length;
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
    });

    const gameDetailGallery = document.getElementById("game-detail-gallery");
    const selectGameMedia = index => {
        const media = currentGameDetail?.media;
        if (!media?.length) return;
        currentGameMediaIndex = (index + media.length) % media.length;
        setFeaturedGameMedia(
            media[currentGameMediaIndex],
            currentGameMediaIndex,
            media.length
        );
    };
    gameDetailGallery.addEventListener("click", event => {
        const thumbnail = event.target.closest("[data-media-index]");
        if (thumbnail) {
            selectGameMedia(Number(thumbnail.dataset.mediaIndex));
            return;
        }
        const button = event.target.closest("[data-gallery-direction]");
        if (button) {
            selectGameMedia(
                currentGameMediaIndex + Number(button.dataset.galleryDirection)
            );
            document.getElementById("game-detail-featured").focus({
                preventScroll: true
            });
            return;
        }
        if (event.target.closest("#game-detail-featured img")) {
            document.getElementById("game-detail-featured").focus({
                preventScroll: true
            });
        }
    });
    gameDetailGallery.addEventListener("keydown", event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (!currentGameDetail?.media.length) return;
        event.preventDefault();
        selectGameMedia(currentGameMediaIndex + (event.key === "ArrowRight" ? 1 : -1));
    });
    document.getElementById("game-detail-library-remove").addEventListener(
        "click",
        async event => {
            const button = event.currentTarget;
            const game = currentGameDetail?.game;
            if (!game) return;
            button.disabled = true;
            try {
                await requestJson(`${API_URL}/api/remove-item?id=${game.id}`, {
                    credentials: "include"
                });
                document.dispatchEvent(new CustomEvent("app:library-state-changed", {
                    detail: {
                        gameId: game.id,
                        gameName: game.name,
                        status: DEFAULT_GAME_STATUS
                    }
                }));
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
                button.disabled = false;
            }
        }
    );
    document.getElementById("game-detail-panel").addEventListener("click", event => {
        const button = event.target.closest("[data-media-index]");
        if (!button || !currentGameDetail) return;
        const index = Number(button.dataset.mediaIndex);
        selectGameMedia(index);
        document.getElementById("game-detail-featured").scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
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
        const detailGame = currentGameDetail?.game;
        if (detailGame && Number(detailGame.id) === gameId) {
            updateGameDetailLibraryControls(detail.status);
        }
        document.querySelectorAll(
            `#game-catalog .game-card[data-game-id="${gameId}"], ` +
            `#game-library .game-card[data-game-id="${gameId}"]`
        ).forEach(card => {
            const statusSelect = card.querySelector(".game-card__status");
            const nextStatus = normalizeGameStatus(detail.status);
            if (card.parentElement?.id === "game-library" &&
                nextStatus === DEFAULT_GAME_STATUS) {
                card.remove();
                return;
            }
            statusSelect.value = nextStatus;
            statusSelect.dataset.savedStatus = nextStatus;
            card.querySelector(".game-card__remove").hidden =
                nextStatus === DEFAULT_GAME_STATUS;
        });
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

    document.addEventListener("app:navigate", async ({ detail: { route, gameId } }) => {
        setCatalogFiltersOpen(false);
        setLibraryFiltersOpen(false);
        if (route !== "game") gameDetailController?.abort();
        if (!isAuthenticationResolved) return;

        if (route === "explore") {
            await openExplorer();
        } else if (route === "game" && gameId) {
            await loadGameDetail(gameId);
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
        if (!isAuthenticated) {
            updateGameDetailLibraryControls(DEFAULT_GAME_STATUS);
        } else if (currentGameDetail) {
            loadGameDetail(currentGameDetail.game.id);
        }
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
