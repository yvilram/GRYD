const ROUTE_VIEWS = {
    home: "view-home",
    explore: "view-explorer",
    library: "view-library",
    login: "view-login",
    register: "view-register",
    profile: "view-profile",
    privacy: "view-legal",
    terms: "view-legal"
};

const isValidRoute = route => Object.hasOwn(ROUTE_VIEWS, route);
const navigationToggle = document.getElementById("site-header-toggle");
const navigationMenu = document.getElementById("site-header-menu");
const appNotice = document.getElementById("app-notice");
let appNoticeTimer = 0;

window.showAppNotice = (message, type = "success") => {
    window.clearTimeout(appNoticeTimer);
    appNotice.textContent = message;
    appNotice.dataset.type = type === "error" ? "error" : "success";
    appNotice.setAttribute("role", type === "error" ? "alert" : "status");
    appNotice.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    appNotice.hidden = false;
    appNoticeTimer = window.setTimeout(() => {
        appNotice.hidden = true;
    }, 5000);
};

const setNavigationMenuOpen = isOpen => {
    navigationMenu.dataset.open = String(isOpen);
    navigationToggle.setAttribute("aria-expanded", String(isOpen));
    navigationToggle.setAttribute(
        "aria-label",
        isOpen ? "Close navigation menu" : "Open navigation menu"
    );
    navigationToggle.querySelector("i").className = isOpen
        ? "bi bi-x-lg"
        : "bi bi-list";
};

navigationToggle.addEventListener("click", () => {
    setNavigationMenuOpen(navigationToggle.getAttribute("aria-expanded") !== "true");
});

// Show the requested view and notify features that need to load its content.
const renderRoute = (route, game = null) => {
    setNavigationMenuOpen(false);
    const activeRoute = route === "game" && game
        ? "game"
        : isValidRoute(route)
            ? route
            : "home";
    const activeViewId = activeRoute === "game" ? "view-game" : ROUTE_VIEWS[activeRoute];

    document.querySelectorAll("[data-view]").forEach(view => {
        view.hidden = view.id !== activeViewId;
    });

    if (activeRoute === "game") {
        const backLink = document.getElementById("game-detail-back");
        const returnRoute = game.returnRoute === "library" ? "library" : "explore";
        const hasReturnGame = Boolean(game.returnGameId && game.returnGameSlug);
        const returnGameRoute = hasReturnGame
            ? `#game/${game.returnGameId}/${game.returnGameSlug}` +
                `?from=${returnRoute}&tab=${game.returnTab || "related"}`
            : `#${returnRoute}`;
        backLink.hidden = Boolean(game.missionId);
        backLink.href = returnGameRoute;
        document.getElementById("game-detail-back-label").textContent =
            hasReturnGame
                ? `Back to ${game.returnGameName || "previous game"}`
                : returnRoute === "library" ? "Back to Library" : "Back to Explore";
        const missionBackLink = document.getElementById("game-mission-page-back");
        missionBackLink.href =
            `#game/${game.id}/${game.slug}?from=${returnRoute}&tab=missions`;
        missionBackLink.hidden = !game.missionId;
    }

    document.querySelectorAll(".primary-nav [data-view-target]").forEach(button => {
        if (button.dataset.viewTarget === activeRoute) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    document.dispatchEvent(new CustomEvent("app:navigate", {
        detail: {
            route: activeRoute,
            viewId: activeViewId,
            gameId: game?.id || null,
            gameSlug: game?.slug || null,
            missionId: game?.missionId || null,
            tabId: game?.tabId || null,
            returnGameId: game?.returnGameId || null,
            returnGameSlug: game?.returnGameSlug || null,
            returnGameName: game?.returnGameName || null,
            returnTab: game?.returnTab || null
        }
    }));
};

// Change views through the URL so reloads and browser history keep working.
const navigateToRoute = (route, { replace = false } = {}) => {
    if (!isValidRoute(route)) {
        throw new Error(`Unknown application route: ${route}`);
    }

    const url = new URL(window.location.href);
    url.hash = route;

    if (replace) {
        window.history.replaceState(null, "", url);
    } else if (window.location.hash !== `#${route}`) {
        window.history.pushState(null, "", url);
    }

    renderRoute(route);
};

// Restore the current route when browser history changes.
const restoreRouteFromUrl = () => {
    const route = window.location.hash.slice(1);
    const [path, queryString = ""] = route.split("?", 2);
    const gameMatch =
        /^game\/([1-9]\d*)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/mission\/([1-9]\d*))?$/
            .exec(path);
    if (gameMatch) {
        const query = new URLSearchParams(queryString);
        const returnGameId = query.get("fromGameId");
        const returnGameSlug = query.get("fromGameSlug");
        const validReturnGame = /^[1-9]\d*$/.test(returnGameId || "") &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(returnGameSlug || "") &&
            query.get("fromTab") === "related";
        renderRoute("game", {
            id: gameMatch[1],
            slug: gameMatch[2],
            missionId: gameMatch[3] || null,
            returnRoute: query.get("from") === "library" ? "library" : "explore",
            tabId: ["overview", "missions", "media", "related", "platforms", "more"]
                .includes(query.get("tab"))
                ? query.get("tab")
                : null,
            returnGameId: validReturnGame ? returnGameId : null,
            returnGameSlug: validReturnGame ? returnGameSlug : null,
            returnGameName: validReturnGame
                ? query.get("fromGameName")
                : null,
            returnTab: validReturnGame ? query.get("fromTab") : null
        });
        return;
    }

    if (!isValidRoute(route)) {
        navigateToRoute("home", { replace: true });
        return;
    }

    renderRoute(route);
};

document.addEventListener("click", event => {
    const target = event.target instanceof Element
        ? event.target.closest("[data-view-target], #auth-login-trigger, #auth-register-trigger")
        : null;
    if (!target) return;

    if (target.dataset.viewTarget) {
        navigateToRoute(target.dataset.viewTarget);
        setNavigationMenuOpen(false);
    } else {
        setNavigationMenuOpen(false);
    }
});

document.addEventListener("click", event => {
    if (!navigationMenu.dataset.open || navigationMenu.contains(event.target) ||
        navigationToggle.contains(event.target)) {
        return;
    }
    setNavigationMenuOpen(false);
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && navigationMenu.dataset.open === "true") {
        setNavigationMenuOpen(false);
        navigationToggle.focus();
    }
});

window.addEventListener("hashchange", restoreRouteFromUrl);
