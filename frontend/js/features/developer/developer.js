const developerNavigation =
    document.getElementById("navigation-developer");

const developerStatus =
    document.getElementById("developer-status");

const developerDashboard =
    document.getElementById("developer-dashboard");

const localUploadToggle =
    document.getElementById("developer-local-upload");

let developerAccess = false;

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

    localUploadToggle.disabled = false;
};

const loadDeveloperDashboard = async () => {
    developerStatus.hidden = false;
    developerStatus.textContent = "Loading developer data…";
    developerDashboard.hidden = true;
    localUploadToggle.disabled = true;

    try {
        const response = await fetch(
            `${API_URL}/api/developer/status`,
            {
                credentials: "include"
            }
        );

        if (response.status === 401) {
            developerNavigation.hidden = true;
            navigateToRoute("login", { replace: true });
            return;
        }

        if (response.status === 403) {
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

        const supabaseStatus =
            document.getElementById("developer-supabase-status");

        supabaseStatus.textContent = result.services.supabase;
        supabaseStatus.dataset.status =
            result.services.supabase.toLowerCase();

        document.getElementById(
            "developer-igdb-status"
        ).textContent = result.services.igdb;

        document.getElementById(
            "developer-s3-status"
        ).textContent = result.services.externalS3;

        await loadDeveloperSettings();

        developerStatus.hidden = true;
        developerDashboard.hidden = false;
    } catch (error) {
        console.error(
            "Could not load developer dashboard:",
            error
        );

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

window.addEventListener(
    "auth:changed",
    ({ detail: { authenticated } }) => {
        if (!authenticated) {
            developerAccess = false;
            developerNavigation.hidden = true;
            return;
        }

        checkDeveloperAccess();
    }
);

document.addEventListener(
    "app:navigate",
    async ({ detail: { route } }) => {
        if (route !== "developer") {
            return;
        }

        if (window.authStateReady) {
            await window.authStateReady;
        }

        const allowed =
            await checkDeveloperAccess();

        if (!allowed) {
            navigateToRoute(
                "home",
                { replace: true }
            );
            return;
        }

        await loadDeveloperDashboard();
    }
);

checkDeveloperAccess();