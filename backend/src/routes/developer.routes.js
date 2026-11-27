const { getSessionContext } = require("../services/session.service");
const { isAdminEmail } = require("../middleware/admin");
const {
    createSupabaseAdminClient
} = require("../services/supabase.client");

const {
    isExternalStorageEnabled
} = require("../services/retro-games.service");

const {
    getDeveloperHealth
} = require("../services/developer-health.service");

const {
    finishIgdbCacheSync,
    syncIgdbCacheBatch
} = require(
    "../services/igdb-cache-sync.service"
);

module.exports = (
    app,
    requestIgdb
) => {
    app.get("/api/developer/status", async (req, res) => {
        try {
            const session = await getSessionContext(req);

            if (!session) {
                return res.status(401).json({
                    error: "Not logged in"
                });
            }

            if (!isAdminEmail(session.user.email)) {
                return res.status(403).json({
                    error: "Developer access required"
                });
            }

            const supabase = createSupabaseAdminClient();

            const [
                gamesResult,
                catalogResult,
                missionsResult
            ] = await Promise.all([
                supabase
                    .from("games")
                    .select("*", { count: "exact", head: true }),

                supabase
                    .from("game_catalog_pages")
                    .select("*", { count: "exact", head: true }),

                supabase
                    .from("game_missions")
                    .select("*", { count: "exact", head: true })
            ]);

            const supabaseOnline = !(
                gamesResult.error &&
                catalogResult.error &&
                missionsResult.error
            );

            const externalS3Configured = Boolean(
                process.env.RETRO_S3_ENDPOINT &&
                process.env.RETRO_S3_REGION &&
                process.env.RETRO_S3_BUCKET &&
                process.env.RETRO_S3_ACCESS_KEY_ID &&
                process.env.RETRO_S3_SECRET_ACCESS_KEY
            );

            const igdbConfigured = Boolean(
                process.env.IGDB_CLIENT_ID &&
                process.env.IGDB_ACCESS_TOKEN
            );

            const externalStorageEnabled = isExternalStorageEnabled();

            return res.json({
                developer: true,

                user: {
                    id: session.user.id,
                    email: session.user.email
                },

                database: {
                    games: gamesResult.count ?? 0,
                    catalogPages: catalogResult.count ?? 0,
                    missionRecords: missionsResult.count ?? 0
                },

                retro: {
                    emulator: "EmulatorJS",
                    ps1: "In progress",
                    externalStorage: externalStorageEnabled
                        ? "Enabled"
                        : "Disabled"
                },

                services: {
                    supabase: supabaseOnline
                        ? "Online"
                        : "Offline",
                    igdb: igdbConfigured
                        ? "Configured"
                        : "Not configured",
                    externalS3: externalS3Configured
                        ? "Configured"
                        : "Not configured"
                }
            });

        } catch (error) {
            console.error("Could not load developer status:", error);

            return res.status(500).json({
                error: "Could not load developer status"
            });
        }
    });

    app.get("/api/developer/health", async (req, res) => {
        try {
            const session = await getSessionContext(req);

            if (!session) {
                return res.status(401).json({
                    error: "Not logged in"
                });
            }

            if (!isAdminEmail(session.user.email)) {
                return res.status(403).json({
                    error: "Developer access required"
                });
            }

            const health = await getDeveloperHealth(
                req.env
            );

            return res.json(health);
        } catch (error) {
            console.error(
                "Could not load developer health:",
                error
            );

            return res.status(500).json({
                error: "Could not load developer health"
            });
        }
    });

    app.get("/api/developer/settings", async (req, res) => {
        try {
            const session = await getSessionContext(req);

            if (!session) {
                return res.status(401).json({
                    error: "Not logged in"
                });
            }

            if (!isAdminEmail(session.user.email)) {
                return res.status(403).json({
                    error: "Developer access required"
                });
            }

            const supabase = createSupabaseAdminClient();

            const [
                localUploadResult,
                gameMissionsResult,
                homeCinematicResult
            ] = await Promise.all([
                supabase
                    .from("app_settings")
                    .select("value, updated_at")
                    .eq("key", "retro_local_upload_enabled")
                    .maybeSingle(),

                supabase
                    .from("app_settings")
                    .select("value, updated_at")
                    .eq("key", "game_missions_enabled")
                    .maybeSingle(),
                supabase
                    .from("app_settings")
                    .select("value, updated_at")
                    .eq("key", "home_cinematic_enabled")
                    .maybeSingle()
            ]);

            if (localUploadResult.error) {
                throw localUploadResult.error;
            }

            if (gameMissionsResult.error) {
                throw gameMissionsResult.error;
            }

            if (homeCinematicResult.error) {
                throw homeCinematicResult.error;
            }

            return res.json({
                localRomUploadEnabled:
                    localUploadResult.data?.value === true,

                gameMissionsEnabled:
                    gameMissionsResult.data?.value !== false,

                homeCinematicEnabled:
                    homeCinematicResult.data?.value === true
            });
        } catch (error) {
            console.error(
                "Could not load developer settings:",
                error
            );

            return res.status(500).json({
                error: "Could not load developer settings"
            });
        }
    });

    app.patch(
        "/api/developer/settings/local-rom-upload",
        async (req, res) => {
            try {
                const session = await getSessionContext(req);

                if (!session) {
                    return res.status(401).json({
                        error: "Not logged in"
                    });
                }

                if (!isAdminEmail(session.user.email)) {
                    return res.status(403).json({
                        error: "Developer access required"
                    });
                }

                const { enabled } = req.body;

                if (typeof enabled !== "boolean") {
                    return res.status(400).json({
                        error: "enabled must be a boolean"
                    });
                }

                const supabase = createSupabaseAdminClient();

                const { data, error } = await supabase
                    .from("app_settings")
                    .upsert(
                        {
                            key: "retro_local_upload_enabled",
                            value: enabled,
                            updated_at: new Date().toISOString()
                        },
                        {
                            onConflict: "key"
                        }
                    )
                    .select("value, updated_at")
                    .single();

                if (error) throw error;

                return res.json({
                    localRomUploadEnabled: data.value === true,
                    updatedAt: data.updated_at
                });
            } catch (error) {
                console.error(
                    "Could not update developer settings:",
                    error
                );

                return res.status(500).json({
                    error: "Could not update developer settings"
                });
            }
        }
    );

    app.get("/api/app-settings", async (req, res) => {
        try {
            const supabase = createSupabaseAdminClient();

            const [
                localUploadResult,
                homeCinematicResult
            ] = await Promise.all([
                supabase
                    .from("app_settings")
                    .select("value")
                    .eq(
                        "key",
                        "retro_local_upload_enabled"
                    )
                    .maybeSingle(),

                supabase
                    .from("app_settings")
                    .select("value")
                    .eq(
                        "key",
                        "home_cinematic_enabled"
                    )
                    .maybeSingle()
            ]);

            if (localUploadResult.error) {
                throw localUploadResult.error;
            }

            if (homeCinematicResult.error) {
                throw homeCinematicResult.error;
            }

            return res.json({
                retroLocalUploadEnabled:
                    localUploadResult.data?.value === true,

                homeCinematicEnabled:
                    homeCinematicResult.data?.value === true
            });
        } catch (error) {
            console.error(
                "Could not load application settings:",
                error
            );

            return res.json({
                retroLocalUploadEnabled: false,
                homeCinematicEnabled: false
            });
        }
    });

    app.patch(
        "/api/developer/settings/game-missions",
        async (req, res) => {
            try {
                const session = await getSessionContext(req);

                if (!session) {
                    return res.status(401).json({
                        error: "Not logged in"
                    });
                }

                if (!isAdminEmail(session.user.email)) {
                    return res.status(403).json({
                        error: "Developer access required"
                    });
                }

                const { enabled } = req.body;

                if (typeof enabled !== "boolean") {
                    return res.status(400).json({
                        error: "enabled must be a boolean"
                    });
                }

                const supabase = createSupabaseAdminClient();

                const { data, error } = await supabase
                    .from("app_settings")
                    .upsert(
                        {
                            key: "game_missions_enabled",
                            value: enabled,
                            updated_at: new Date().toISOString()
                        },
                        {
                            onConflict: "key"
                        }
                    )
                    .select("value, updated_at")
                    .single();

                if (error) throw error;

                return res.json({
                    gameMissionsEnabled: data.value === true,
                    updatedAt: data.updated_at
                });
            } catch (error) {
                console.error(
                    "Could not update Game Missions setting:",
                    error
                );

                return res.status(500).json({
                    error: "Could not update Game Missions setting"
                });
            }
        }
    );

    app.patch(
        "/api/developer/settings/home-cinematic",
        async (req, res) => {
            try {
                const session =
                    await getSessionContext(req);

                if (!session) {
                    return res.status(401).json({
                        error: "Not logged in"
                    });
                }

                if (
                    !isAdminEmail(
                        session.user.email
                    )
                ) {
                    return res.status(403).json({
                        error:
                            "Developer access required"
                    });
                }

                const { enabled } = req.body;

                if (
                    typeof enabled !== "boolean"
                ) {
                    return res.status(400).json({
                        error:
                            "enabled must be a boolean"
                    });
                }

                const supabase =
                    createSupabaseAdminClient();

                const { data, error } =
                    await supabase
                        .from("app_settings")
                        .upsert(
                            {
                                key:
                                    "home_cinematic_enabled",
                                value: enabled,
                                updated_at:
                                    new Date()
                                        .toISOString()
                            },
                            {
                                onConflict: "key"
                            }
                        )
                        .select(
                            "value, updated_at"
                        )
                        .single();

                if (error) {
                    throw error;
                }

                return res.json({
                    homeCinematicEnabled:
                        data.value === true,
                    updatedAt:
                        data.updated_at
                });
            } catch (error) {
                console.error(
                    "Could not update Home Cinematic setting:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Could not update Home Cinematic setting"
                });
            }
        }
    );

    app.post(
        "/api/developer/igdb-cache/sync",
        async (req, res) => {
            try {
                const session =
                    await getSessionContext(req);

                if (!session) {
                    return res.status(401).json({
                        error: "Not logged in"
                    });
                }

                if (!isAdminEmail(session.user.email)) {
                    return res.status(403).json({
                        error: "Developer access required"
                    });
                }

                const afterId = Number(
                    req.body?.afterId || 0
                );

                if (
                    !Number.isSafeInteger(afterId) ||
                    afterId < 0
                ) {
                    return res.status(400).json({
                        error:
                            "afterId must be a non-negative integer."
                    });
                }

                const supabase =
                    createSupabaseAdminClient(
                        req.env
                    );

                const result =
                    await syncIgdbCacheBatch(
                        supabase,
                        requestIgdb,
                        afterId
                    );

                return res.json(result);
            } catch (error) {
                console.error(
                    "Could not synchronize IGDB cache:",
                    error
                );

                return res.status(
                    error.status || 500
                ).json({
                    error:
                        "Could not synchronize IGDB cache."
                });
            }
        }
    );

    app.post(
        "/api/developer/igdb-cache/finish",
        async (req, res) => {
            try {
                const session =
                    await getSessionContext(req);

                if (!session) {
                    return res.status(401).json({
                        error: "Not logged in"
                    });
                }

                if (!isAdminEmail(session.user.email)) {
                    return res.status(403).json({
                        error: "Developer access required"
                    });
                }

                const supabase =
                    createSupabaseAdminClient(
                        req.env
                    );

                const result =
                    await finishIgdbCacheSync(
                        supabase
                    );

                return res.json(result);
            } catch (error) {
                console.error(
                    "Could not finish IGDB cache synchronization:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Could not finish IGDB cache synchronization."
                });
            }
        }
    );
};
