const developerNavigation =
    document.getElementById("navigation-developer");

const developerStatus =
    document.getElementById("developer-status");

const developerDashboard =
    document.getElementById("developer-dashboard");

const localUploadToggle =
    document.getElementById("developer-local-upload");

const gameMissionsToggle =
    document.getElementById("developer-game-missions");

const homeCinematicToggle =
    document.getElementById("developer-home-cinematic");

const HOME_HERO_MODE_KEY = "gryd-home-hero-mode";

const HOME_HERO_VIDEOS = [
    "/assets/videos/home/hero-01.mp4",
    "/assets/videos/home/hero-02.mp4",
    "/assets/videos/home/hero-03.mp4",
    "/assets/videos/home/hero-04.mp4"
];

const CATALOG_SYNC_CHANNEL =
    "gryd-catalog-state";

const catalogSyncChannel =
    "BroadcastChannel" in window
        ? new BroadcastChannel(
            CATALOG_SYNC_CHANNEL
        )
        : null;

const setHomeHeroMode = mode => {
    const art = document.getElementById("home-hero-art");
    const controller =
        art?.querySelector(".home-hero-controller");
    const cinematic =
        art?.querySelector(".home-hero-cinematic");
    const video =
        document.getElementById("home-hero-video");

    if (!art || !controller || !cinematic || !video) {
        return;
    }

    const cinematicEnabled = mode === "cinematic";

    const resolvedMode = cinematicEnabled
        ? "cinematic"
        : "controller";

    art.dataset.homeHeroMode = resolvedMode;
    document.documentElement.dataset.homeHeroMode =
        resolvedMode;

    if (!cinematicEnabled) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        return;
    }

    let videoIndex = Number(
        video.dataset.videoIndex || 0
    );

    if (
        !Number.isSafeInteger(videoIndex) ||
        videoIndex < 0 ||
        videoIndex >= HOME_HERO_VIDEOS.length
    ) {
        videoIndex = 0;
    }

    video.dataset.videoIndex = String(videoIndex);

    if (!video.getAttribute("src")) {
        video.src = HOME_HERO_VIDEOS[videoIndex];
    }

    video.play().catch(error => {
        console.warn(
            "Could not autoplay home cinematic:",
            error
        );
    });
};

const loadHomeHeroPreference = () => {
    let mode = "controller";

    try {
        if (
            window.localStorage.getItem(
                HOME_HERO_MODE_KEY
            ) === "cinematic"
        ) {
            mode = "cinematic";
        }
    } catch (error) {
        console.warn(
            "Could not read home hero preference:",
            error
        );
    }

    homeCinematicToggle.checked =
        mode === "cinematic";

    setHomeHeroMode(mode);
};

let developerAccess = false;
let developerDashboardLoaded = false;
let developerHealthInterval = null;
let developerHealthLoading = false;

const DEVELOPER_HEALTH_INTERVAL_KEY =
    "gryd-developer-health-interval";

const DEVELOPER_HEALTH_INTERVALS = [
    10000,
    30000,
    60000
];

let developerHealthIntervalMs = 10000;

const developerHealthIntervalSelect =
    document.getElementById(
        "developer-health-interval"
    );

const developerHealthRefreshButton =
    document.getElementById(
        "developer-health-refresh"
    );

try {
    const storedInterval = Number(
        window.localStorage.getItem(
            DEVELOPER_HEALTH_INTERVAL_KEY
        )
    );

    if (
        DEVELOPER_HEALTH_INTERVALS.includes(
            storedInterval
        )
    ) {
        developerHealthIntervalMs =
            storedInterval;
    }
} catch (error) {
    console.warn(
        "Could not load developer health interval:",
        error
    );
}

if (developerHealthIntervalSelect) {
    developerHealthIntervalSelect.value =
        String(developerHealthIntervalMs);
}

const getDeveloperHealthElements = () => ({
    list: document.getElementById(
        "developer-health-list"
    ),
    summary: document.getElementById(
        "developer-health-summary"
    ),
    summaryDot: document.getElementById(
        "developer-health-summary-dot"
    ),
    checkedAt: document.getElementById(
        "developer-health-checked-at"
    )
});

const renderDeveloperHealth = health => {
    const {
        list,
        summary,
        summaryDot,
        checkedAt
    } = getDeveloperHealthElements();

    if (
        !list ||
        !summary ||
        !summaryDot ||
        !checkedAt
    ) {
        return;
    }

    const services = Array.isArray(
        health?.services
    )
        ? health.services
        : [];

    list.replaceChildren();

    services.forEach(service => {
        const row = document.createElement("div");
        row.classList.add("developer-health-row");

        const serviceInfo =
            document.createElement("div");

        serviceInfo.classList.add(
            "developer-health-row__service"
        );

        const dot = document.createElement("span");
        dot.classList.add(
            "developer-health-row__dot"
        );
        dot.dataset.status = service.status;

        const label = document.createElement("span");
        label.textContent = service.label;

        serviceInfo.append(dot, label);

        const status =
            document.createElement("span");

        status.classList.add(
            "developer-health-row__status"
        );
        status.dataset.status = service.status;

        status.textContent = {
            online: "Online",
            degraded: "Degraded",
            offline: "Offline",
            "not-configured": "Not configured",
            disabled: "Disabled"
        }[service.status] || service.status;

        const latency =
            document.createElement("span");

        latency.classList.add(
            "developer-health-row__latency"
        );

        latency.textContent =
            Number.isFinite(service.latencyMs)
                ? `${service.latencyMs} ms`
                : "—";

        row.append(
            serviceInfo,
            status,
            latency
        );

        if (service.error) {
            row.title = service.error;
        }

        list.appendChild(row);
    });

    const configuredServices = services.filter(
        service =>
            service.status !== "not-configured" &&
            service.status !== "disabled"
    );

    const offlineCount =
        configuredServices.filter(
            service => service.status === "offline"
        ).length;

    const degradedCount =
        configuredServices.filter(
            service => service.status === "degraded"
        ).length;

    const overallStatus = offlineCount
        ? "offline"
        : degradedCount
            ? "degraded"
            : "online";

    summaryDot.dataset.status = overallStatus;

    summary.textContent = offlineCount
        ? `${offlineCount} service${offlineCount === 1 ? "" : "s"} offline`
        : degradedCount
            ? `${degradedCount} service${degradedCount === 1 ? "" : "s"} degraded`
            : "All configured services online";

    checkedAt.textContent = health.checkedAt
        ? new Date(
            health.checkedAt
        ).toLocaleTimeString()
        : "—";
};

const loadDeveloperHealth = async () => {
    if (developerHealthLoading) {
        return;
    }

    developerHealthLoading = true;

    try {
        const response = await fetch(
            `${API_URL}/api/developer/health`,
            {
                credentials: "include"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Developer health request failed (${response.status}).`
            );
        }

        const health = await response.json();

        renderDeveloperHealth(health);
    } catch (error) {
        console.error(
            "Could not load developer health:",
            error
        );

        const {
            summary,
            summaryDot
        } = getDeveloperHealthElements();

        if (summary && summaryDot) {
            summary.textContent =
                "Health check unavailable";

            summaryDot.dataset.status =
                "offline";
        }
    } finally {
        developerHealthLoading = false;
    }
};

const stopDeveloperHealthPolling = () => {
    if (developerHealthInterval) {
        window.clearInterval(
            developerHealthInterval
        );

        developerHealthInterval = null;
    }
};

const startDeveloperHealthPolling = () => {
    stopDeveloperHealthPolling();

    void loadDeveloperHealth();

    developerHealthInterval =
        window.setInterval(() => {
            const developerView =
                document.getElementById(
                    "view-developer"
                );

            if (
                !developerView ||
                developerView.hidden
            ) {
                stopDeveloperHealthPolling();
                return;
            }

            void loadDeveloperHealth();
        }, developerHealthIntervalMs);
};

developerHealthRefreshButton?.addEventListener(
    "click",
    async () => {
        developerHealthRefreshButton.disabled = true;

        try {
            await loadDeveloperHealth();
        } finally {
            developerHealthRefreshButton.disabled = false;
        }
    }
);

developerHealthIntervalSelect?.addEventListener(
    "change",
    () => {
        const interval = Number(
            developerHealthIntervalSelect.value
        );

        if (
            !DEVELOPER_HEALTH_INTERVALS.includes(
                interval
            )
        ) {
            return;
        }

        developerHealthIntervalMs = interval;

        try {
            window.localStorage.setItem(
                DEVELOPER_HEALTH_INTERVAL_KEY,
                String(interval)
            );
        } catch (error) {
            console.warn(
                "Could not save developer health interval:",
                error
            );
        }

        const developerView =
            document.getElementById(
                "view-developer"
            );

        if (
            developerView &&
            !developerView.hidden
        ) {
            startDeveloperHealthPolling();
        }
    }
);

const checkDeveloperAccess = async () => {
    try {
        const response = await fetch(
            `${API_URL}/api/developer/status`,
            {
                credentials: "include"
            }
        );

        developerAccess = response.ok;
        developerNavigation.hidden = !developerAccess;

        return developerAccess;
    } catch (error) {
        console.error(
            "Could not check developer access:",
            error
        );

        developerAccess = false;
        developerNavigation.hidden = true;

        return false;
    }
};

const loadDeveloperSettings = async () => {
    const response = await fetch(
        `${API_URL}/api/developer/settings`,
        {
            credentials: "include"
        }
    );

    if (response.status === 401) {
        throw new Error("Not logged in");
    }

    if (response.status === 403) {
        throw new Error("Developer access required");
    }

    if (!response.ok) {
        throw new Error(
            "Could not load developer settings."
        );
    }

    const settings = await response.json();

    localUploadToggle.checked =
        settings.localRomUploadEnabled === true;

    gameMissionsToggle.checked =
        settings.gameMissionsEnabled === true;

    localUploadToggle.disabled = false;
    gameMissionsToggle.disabled = false;
};

const loadDeveloperDashboard = async () => {

    developerStatus.hidden = true;
    developerStatus.textContent = "Loading developer data…";
    developerDashboard.hidden = false;

    localUploadToggle.disabled = true;
    gameMissionsToggle.disabled = true;

    try {
        const response = await fetch(
            `${API_URL}/api/developer/status`,
            {
                credentials: "include"
            }
        );

        if (response.status === 401) {
            developerDashboardLoaded = false;
            developerNavigation.hidden = true;
            navigateToRoute("login", { replace: true });
            return;
        }

        if (response.status === 403) {
            developerDashboardLoaded = false;
            developerNavigation.hidden = true;
            navigateToRoute("home", { replace: true });
            return;
        }

        if (!response.ok) {
            throw new Error(
                "Could not load developer information."
            );
        }

        const result = await response.json();

        document.getElementById(
            "developer-user-email"
        ).textContent = result.user.email;

        document.getElementById(
            "developer-games-count"
        ).textContent = result.database.games.toLocaleString();

        document.getElementById(
            "developer-catalog-count"
        ).textContent = result.database.catalogPages.toLocaleString();

        document.getElementById(
            "developer-missions-count"
        ).textContent = result.database.missionRecords.toLocaleString();

        document.getElementById(
            "developer-external-storage"
        ).textContent = result.retro.externalStorage;

        document.getElementById(
            "developer-ps1-status"
        ).textContent = result.retro.ps1;

        await loadDeveloperSettings();

        developerStatus.hidden = true;
        developerDashboard.hidden = false;
        developerDashboardLoaded = true;
    } catch (error) {
        console.error(
            "Could not load developer dashboard:",
            error
        );

        developerDashboardLoaded = false;

        developerStatus.hidden = false;
        developerStatus.textContent =
            "Could not load developer information.";
        developerDashboard.hidden = true;
    }
};

localUploadToggle.addEventListener(
    "change",
    async () => {
        const enabled = localUploadToggle.checked;

        localUploadToggle.disabled = true;

        try {
            const response = await fetch(
                `${API_URL}/api/developer/settings/local-rom-upload`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        enabled
                    })
                }
            );

            if (response.status === 401) {
                navigateToRoute("login", {
                    replace: true
                });
                return;
            }

            if (response.status === 403) {
                developerNavigation.hidden = true;

                navigateToRoute("home", {
                    replace: true
                });

                return;
            }

            if (!response.ok) {
                throw new Error(
                    "Could not update local game upload."
                );
            }

            const result = await response.json();

            localUploadToggle.checked =
                result.localRomUploadEnabled === true;

            window.showAppNotice(
                result.localRomUploadEnabled
                    ? "Local game upload enabled."
                    : "Local game upload disabled."
            );

            window.dispatchEvent(
                new CustomEvent(
                    "app:settings-changed",
                    {
                        detail: {
                            retroLocalUploadEnabled:
                                result.localRomUploadEnabled
                        }
                    }
                )
            );
        } catch (error) {
            localUploadToggle.checked = !enabled;

            console.error(
                "Could not update local game upload:",
                error
            );

            window.showAppNotice(
                "Could not update local game upload.",
                "error"
            );
        } finally {
            localUploadToggle.disabled = false;
        }
    }
);

gameMissionsToggle.addEventListener(
    "change",
    async () => {
        const enabled = gameMissionsToggle.checked;

        gameMissionsToggle.disabled = true;

        try {
            const response = await fetch(
                `${API_URL}/api/developer/settings/game-missions`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        enabled
                    })
                }
            );

            if (response.status === 401) {
                navigateToRoute("login", {
                    replace: true
                });
                return;
            }

            if (response.status === 403) {
                developerNavigation.hidden = true;

                navigateToRoute("home", {
                    replace: true
                });

                return;
            }

            if (!response.ok) {
                throw new Error(
                    "Could not update Game Missions."
                );
            }

            const result = await response.json();

            gameMissionsToggle.checked =
                result.gameMissionsEnabled === true;

            window.showAppNotice(
                result.gameMissionsEnabled
                    ? "Game Missions enabled."
                    : "Game Missions disabled."
            );

            window.dispatchEvent(
                new CustomEvent(
                    "app:settings-changed",
                    {
                        detail: {
                            gameMissionsEnabled:
                                result.gameMissionsEnabled
                        }
                    }
                )
            );
        } catch (error) {
            gameMissionsToggle.checked = !enabled;

            console.error(
                "Could not update Game Missions:",
                error
            );

            window.showAppNotice(
                "Could not update Game Missions.",
                "error"
            );
        } finally {
            gameMissionsToggle.disabled = false;
        }
    }
);

const igdbSyncButton =
    document.getElementById("developer-igdb-sync");

const igdbSyncProgress =
    document.getElementById(
        "developer-igdb-sync-progress"
    );

const igdbSyncStatus =
    document.getElementById(
        "developer-igdb-sync-status"
    );

const igdbSyncPercent =
    document.getElementById(
        "developer-igdb-sync-percent"
    );

const igdbSyncBar =
    document.getElementById(
        "developer-igdb-sync-bar"
    );

const igdbSyncProcessed =
    document.getElementById(
        "developer-igdb-sync-processed"
    );

const igdbSyncUpdated =
    document.getElementById(
        "developer-igdb-sync-updated"
    );

const igdbSyncUnavailable =
    document.getElementById(
        "developer-igdb-sync-unavailable"
    );

let igdbSyncRunning = false;

const updateIgdbSyncProgress = ({
    processed,
    updated,
    unavailable,
    percent,
    status
}) => {
    igdbSyncProcessed.textContent =
        processed.toLocaleString();

    igdbSyncUpdated.textContent =
        updated.toLocaleString();

    igdbSyncUnavailable.textContent =
        unavailable.toLocaleString();

    igdbSyncPercent.textContent =
        `${percent}%`;

    igdbSyncBar.style.width =
        `${percent}%`;

    igdbSyncStatus.textContent = status;
};

const runIgdbCacheSync = async () => {
    if (igdbSyncRunning) {
        return;
    }

    igdbSyncRunning = true;
    igdbSyncButton.disabled = true;
    igdbSyncProgress.hidden = false;

    let afterId = 0;
    let total = 0;
    let processed = 0;
    let updated = 0;
    let unavailable = 0;
    let complete = false;

    updateIgdbSyncProgress({
        processed: 0,
        updated: 0,
        unavailable: 0,
        percent: 0,
        status: "Synchronizing cached games…"
    });

    const catalogChangeDetail = {
        type: "igdb-cache-synchronized",
        updatedAt: new Date().toISOString()
    };

    document.dispatchEvent(
        new CustomEvent(
            "app:catalog-cache-changed",
            {
                detail: catalogChangeDetail
            }
        )
    );

    catalogSyncChannel?.postMessage(
        catalogChangeDetail
    );

    try {
        while (!complete) {
            const response = await fetch(
                `${API_URL}/api/developer/igdb-cache/sync`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        afterId
                    })
                }
            );

            if (response.status === 401) {
                navigateToRoute(
                    "login",
                    { replace: true }
                );
                return;
            }

            if (response.status === 403) {
                developerNavigation.hidden = true;

                navigateToRoute(
                    "home",
                    { replace: true }
                );

                return;
            }

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error ||
                    "Could not synchronize IGDB cache."
                );
            }

            total = Number(result.total || total || 0);

            processed += Number(
                result.processed || 0
            );

            updated += Number(
                result.updated || 0
            );

            unavailable += Number(
                result.unavailable || 0
            );

            complete =
                result.complete === true;

            if (
                result.nextAfterId != null
            ) {
                afterId = Number(
                    result.nextAfterId
                );
            }

            const percent = total > 0
                ? Math.min(
                    99,
                    Math.round(
                        (processed / total) * 100
                    )
                )
                : 0;

            updateIgdbSyncProgress({
                processed,
                updated,
                unavailable,
                percent: complete ? 99 : percent,
                status: complete
                    ? "Finalizing…"
                    : `Synchronizing… ${processed.toLocaleString()} / ${total.toLocaleString()}`
            });
        }

        const finishResponse = await fetch(
            `${API_URL}/api/developer/igdb-cache/finish`,
            {
                method: "POST",
                credentials: "include"
            }
        );

        const finishResult =
            await finishResponse.json();

        if (!finishResponse.ok) {
            throw new Error(
                finishResult.error ||
                "Could not finalize IGDB cache synchronization."
            );
        }

        updateIgdbSyncProgress({
            processed,
            updated,
            unavailable,
            percent: 100,
            status: "Synchronization complete"
        });

        window.showAppNotice(
            `IGDB cache synchronized: ${updated.toLocaleString()} games updated.`
        );

        /*
         * Database counters may have changed, so force
         * Development summary data to refresh next time.
         */
        developerDashboardLoaded = false;
    } catch (error) {
        console.error(
            "Could not synchronize IGDB cache:",
            error
        );

        igdbSyncStatus.textContent =
            "Synchronization failed";

        window.showAppNotice(
            "Could not synchronize IGDB cache.",
            "error"
        );
    } finally {
        igdbSyncRunning = false;
        igdbSyncButton.disabled = false;
    }
};

igdbSyncButton?.addEventListener(
    "click",
    () => {
        void runIgdbCacheSync();
    }
);


const homeHeroVideo =
    document.getElementById("home-hero-video");

homeHeroVideo?.addEventListener("ended", () => {
    const currentIndex = Number(
        homeHeroVideo.dataset.videoIndex || 0
    );

    const nextIndex =
        (currentIndex + 1) % HOME_HERO_VIDEOS.length;

    homeHeroVideo.dataset.videoIndex =
        String(nextIndex);

    homeHeroVideo.src =
        HOME_HERO_VIDEOS[nextIndex];

    homeHeroVideo.play().catch(error => {
        console.warn(
            "Could not continue home cinematic:",
            error
        );
    });
});

homeCinematicToggle?.addEventListener(
    "change",
    () => {
        const mode = homeCinematicToggle.checked
            ? "cinematic"
            : "controller";

        try {
            window.localStorage.setItem(
                HOME_HERO_MODE_KEY,
                mode
            );
        } catch (error) {
            console.warn(
                "Could not save home hero preference:",
                error
            );
        }

        setHomeHeroMode(mode);

        window.showAppNotice(
            mode === "cinematic"
                ? "Cinematic home hero enabled."
                : "Controller home hero enabled."
        );
    }
);

loadHomeHeroPreference();

window.addEventListener(
    "auth:changed",
    ({ detail: { authenticated } }) => {
        if (!authenticated) {
            developerAccess = false;
            developerDashboardLoaded = false;

            developerNavigation.hidden = true;

            stopDeveloperHealthPolling();

            return;
        }

        checkDeveloperAccess();
    }
);

document.addEventListener(
    "app:navigate",
    async ({ detail: { route } }) => {
        if (route !== "developer") {
            stopDeveloperHealthPolling();
            return;
        }

        if (window.authStateReady) {
            await window.authStateReady;
        }

        const allowed =
            await checkDeveloperAccess();

        if (!allowed) {
            stopDeveloperHealthPolling();

            navigateToRoute(
                "home",
                { replace: true }
            );
            return;
        }

        if (!developerDashboardLoaded) {
            await loadDeveloperDashboard();
        }

        if (!developerDashboardLoaded) {
            stopDeveloperHealthPolling();
            return;
        }

        startDeveloperHealthPolling();
    }
);

checkDeveloperAccess();