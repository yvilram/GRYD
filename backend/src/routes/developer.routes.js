const { getSessionContext } = require("../services/session.service");
const { isAdminEmail } = require("../middleware/admin");
const {
    createSupabaseAdminClient
} = require("../services/supabase.client");

const {
    isExternalStorageEnabled
} = require("../services/retro-games.service");

module.exports = app => {
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

            const externalStorageEnabled =isExternalStorageEnabled();

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

        const { data, error } = await supabase
            .from("app_settings")
            .select("key, value, updated_at")
            .eq("key", "retro_local_upload_enabled")
            .single();

        if (error) throw error;

        return res.json({
            localRomUploadEnabled: data.value === true,
            updatedAt: data.updated_at
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

            const { data, error } = await supabase
                .from("app_settings")
                .select("value")
                .eq("key", "retro_local_upload_enabled")
                .maybeSingle();

            if (error) throw error;

            return res.json({
                retroLocalUploadEnabled: data?.value === true
            });
        } catch (error) {
            console.error(
                "Could not load application settings:",
                error
            );

            return res.json({
                retroLocalUploadEnabled: false
            });
        }
    });
};
