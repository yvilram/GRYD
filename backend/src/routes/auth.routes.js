const createSupabaseClient = require("../services/supabase.client");
const createSupabaseAdminClient = createSupabaseClient.createSupabaseAdminClient;
const { getSessionContext } = require("../services/session.service");

const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: 60 * 60 * 1000
};

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const AVATAR_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
};

async function updateAuthenticatedUser(env = process.env, accessToken, attributes) {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(attributes)
    });

    const responseText = await response.text();
    let result = {};
    if (responseText.trim()) {
        try {
            const parsedResult = JSON.parse(responseText);
            result = parsedResult && typeof parsedResult === "object"
                ? parsedResult
                : { message: responseText };
        } catch {
            result = { message: responseText };
        }
    }

    if (!response.ok) {
        const requestId = response.headers.get("sb-request-id") ||
            response.headers.get("x-request-id");
        return {
            status: response.status,
            error: result.msg || result.message || result.error_description ||
                result.error ||
                `Supabase could not update the account (HTTP ${response.status}` +
                `${response.statusText ? ` ${response.statusText}` : ""}` +
                `${requestId ? `, request ID ${requestId}` : ""}).`
        };
    }

    return { status: response.status, user: result };
}

module.exports = function registerAuthRoutes(app) {
    app.post("/api/register", async (req, res) => {
        try {
            const supabase = createSupabaseClient(req.env);
            const { email, password1, password2 } = req.body;

            if (password1 !== password2) {
                return res.status(400).json({ error: "Passwords do not match" });
            }

            const { data, error } = await supabase.auth.signUp({
                email,
                password: password1
            });

            if (error) return res.status(400).json({ error: error.message });

            if (!data.session) {
                return res.json({
                    confirmationRequired: true,
                    message: "Account created. Check your email to confirm it."
                });
            }

            res.cookie("session", data.session.access_token, SESSION_COOKIE_OPTIONS);

            res.json({
                confirmationRequired: false,
                message: "Account created and logged in successfully."
            });
        } catch (error) {
            console.error("Error en /api/register:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/confirm-email", async (req, res) => {
        try {
            const tokenHash = typeof req.body?.token_hash === "string"
                ? req.body.token_hash.trim()
                : "";
            if (!tokenHash || tokenHash.length > 512 || req.body?.type !== "email") {
                return res.status(400).json({
                    error: "The confirmation link is invalid or incomplete."
                });
            }

            const supabase = createSupabaseClient(req.env);
            const { data, error } = await supabase.auth.verifyOtp({
                token_hash: tokenHash,
                type: "email"
            });
            if (error) {
                return res.status(400).json({
                    error: "The confirmation link is invalid or has expired. Request a new one."
                });
            }
            if (!data.session) {
                return res.status(400).json({
                    error: "Email was confirmed, but a session could not be started. Please log in."
                });
            }

            res.cookie("session", data.session.access_token, SESSION_COOKIE_OPTIONS);
            res.json({ message: "Email confirmed successfully." });
        } catch (error) {
            console.error("Error en /api/confirm-email:", error);
            res.status(500).json({ error: "Could not confirm the email address." });
        }
    });

    app.post("/api/login", async (req, res) => {
        try {
            const supabase = createSupabaseClient(req.env);
            const { email, password } = req.body;

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                return res.status(401).json({ error: "Invalid email or password" });
            }

            res.cookie("session", data.session.access_token, SESSION_COOKIE_OPTIONS);

            res.json({ message: "Login successful" });
        } catch (error) {
            console.error("Error en /api/login:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/session", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.json({ loggedIn: false });

            res.json({
                loggedIn: true,
                email: session.user.email,
                avatarUrl: session.user.user_metadata?.avatar_url || ""
            });
        } catch (error) {
            console.error("Error en /api/session:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/logout", (req, res) => {
        try {
            res.clearCookie("session", {
                httpOnly: true,
                secure: true,
                sameSite: "none"
            });

            res.json({ message: "Logged out successfully" });
        } catch (error) {
            console.error("Error en /api/logout:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/check-auth", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.json({ authenticated: false });

            res.json({
                authenticated: true,
                user: {
                    id: session.user.id,
                    email: session.user.email
                }
            });
        } catch (error) {
            console.error("Error comprobando sesión:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.patch("/api/profile/email", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const email = typeof req.body?.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: "Enter a valid email address." });
            }
            if (email === session.user.email?.toLowerCase()) {
                return res.status(400).json({ error: "That is already your current email." });
            }

            const result = await updateAuthenticatedUser(
                req.env,
                session.accessToken,
                { email }
            );
            if (result.error) {
                return res.status(result.status >= 400 && result.status < 500 ? 400 : 502)
                    .json({ error: result.error });
            }

            res.json({
                email: result.user.email,
                confirmationRequired:
                    result.user.email !== email || Boolean(result.user.new_email)
            });
        } catch (error) {
            console.error("Could not update the account email:", error);
            res.status(500).json({ error: "Could not update the account email." });
        }
    });

    app.patch("/api/profile/password", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const password = req.body?.password;
            if (typeof password !== "string" || password.length === 0) {
                return res.status(400).json({ error: "Enter a new password." });
            }

            const result = await updateAuthenticatedUser(
                req.env,
                session.accessToken,
                { password }
            );
            if (result.error) {
                return res.status(result.status >= 400 && result.status < 500 ? 400 : 502)
                    .json({ error: result.error });
            }

            res.json({ message: "Password updated successfully." });
        } catch (error) {
            console.error("Could not update the account password:", error);
            res.status(500).json({ error: "Could not update the account password." });
        }
    });

    app.post("/api/profile/avatar/upload-url", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const contentType = req.body?.contentType;
            const fileSize = req.body?.fileSize;
            const extension = AVATAR_TYPES[contentType];
            if (!extension) {
                return res.status(400).json({
                    error: "Choose a JPG, PNG, or WebP image."
                });
            }
            if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_AVATAR_SIZE) {
                return res.status(400).json({
                    error: "The avatar image must be smaller than 2 MB."
                });
            }

            const path = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
            const { data, error } = await session.supabase.storage
                .from(AVATAR_BUCKET)
                .createSignedUploadUrl(path);

            if (error) {
                console.error("Could not create an avatar upload URL:", error);
                return res.status(502).json({
                    error: "Could not prepare the avatar upload. Check the avatars bucket policies."
                });
            }

            res.json({ path, signedUrl: data.signedUrl });
        } catch (error) {
            console.error("Could not prepare the avatar upload:", error);
            res.status(500).json({ error: "Could not prepare the avatar upload." });
        }
    });

    app.patch("/api/profile/avatar", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in" });

            const path = typeof req.body?.path === "string" ? req.body.path : "";
            const allowedPath = new RegExp(
                `^${session.user.id}/[0-9a-f-]{36}\\.(jpg|png|webp)$`
            );
            if (!allowedPath.test(path)) {
                return res.status(400).json({ error: "Invalid avatar image path." });
            }

            const previousPath = session.user.user_metadata?.avatar_path;
            const userAvatarPath = allowedPath;
            const publicUrl = session.supabase.storage
                .from(AVATAR_BUCKET)
                .getPublicUrl(path).data.publicUrl;
            const avatarUrl = `${publicUrl}?v=${Date.now()}`;
            const userMetadata = session.user.user_metadata || {};
            const result = await updateAuthenticatedUser(
                req.env,
                session.accessToken,
                {
                    data: {
                        ...userMetadata,
                        avatar_path: path,
                        avatar_url: avatarUrl
                    }
                }
            );
            if (result.error) {
                const { error: cleanupError } = await session.supabase.storage
                    .from(AVATAR_BUCKET)
                    .remove([path]);
                if (cleanupError) {
                    console.warn("Could not remove the unlinked avatar upload:", cleanupError);
                }
                return res.status(result.status >= 400 && result.status < 500 ? 400 : 502)
                    .json({ error: result.error });
            }

            let cleanupWarning = false;
            if (typeof previousPath === "string" &&
                userAvatarPath.test(previousPath) &&
                previousPath !== path) {
                const { error } = await session.supabase.storage
                    .from(AVATAR_BUCKET)
                    .remove([previousPath]);
                if (error) {
                    cleanupWarning = true;
                    console.warn("Could not remove the previous avatar:", error);
                }
            }

            res.json({ avatarUrl, cleanupWarning });
        } catch (error) {
            console.error("Could not update the profile avatar:", error);
            res.status(500).json({ error: "Could not update the profile avatar." });
        }
    });

    app.delete("/api/profile", async (req, res) => {
        try {
            const session = await getSessionContext(req);
            if (!session) return res.status(401).json({ error: "Not logged in." });

            const password = req.body?.password;
            if (typeof password !== "string" || password.length === 0) {
                return res.status(400).json({ error: "Enter your current password." });
            }
            if (req.body?.confirmation !== "DELETE") {
                return res.status(400).json({
                    error: "Type DELETE exactly to confirm account deletion."
                });
            }

            if (!req.env.SUPABASE_SECRET_KEY) {
                console.error("Could not delete the account: SUPABASE_SECRET_KEY is not configured.");
                return res.status(503).json({
                    error: "Account deletion is not configured on the server."
                });
            }

            const verificationClient = createSupabaseClient(req.env);
            const { data: verification, error: verificationError } =
                await verificationClient.auth.signInWithPassword({
                    email: session.user.email,
                    password
                });
            if (verificationError &&
                ![400, 401].includes(verificationError.status)) {
                console.error("Could not verify the account password:", verificationError);
                return res.status(502).json({
                    error: "Could not verify your password. Please try again."
                });
            }
            if (verificationError || verification.user?.id !== session.user.id) {
                return res.status(401).json({ error: "The current password is incorrect." });
            }

            const adminClient = createSupabaseAdminClient(req.env);
            const { error: gamesError } = await adminClient
                .from("user_game_list")
                .delete()
                .eq("user_id", session.user.id);
            if (gamesError) {
                console.error("Could not delete the user's saved games:", gamesError);
                return res.status(502).json({
                    error: "Could not delete all account data. The account remains active; please try again."
                });
            }

            const avatarBucket = adminClient.storage.from(AVATAR_BUCKET);
            const avatarPaths = [];
            const avatarFilename = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
            let avatarOffset = 0;
            while (true) {
                const { data: files, error: listError } = await avatarBucket.list(
                    session.user.id,
                    {
                        limit: 100,
                        offset: avatarOffset,
                        sortBy: { column: "name", order: "asc" }
                    }
                );
                if (listError) {
                    console.error("Could not list the user's avatar files:", listError);
                    return res.status(502).json({
                        error: "Could not delete all account data. The account remains active; please try again."
                    });
                }

                avatarPaths.push(...files
                    .filter(file => avatarFilename.test(file.name))
                    .map(file => `${session.user.id}/${file.name}`));
                avatarOffset += files.length;
                if (files.length < 100) break;
            }

            for (let index = 0; index < avatarPaths.length; index += 100) {
                const { error: avatarError } = await avatarBucket.remove(
                    avatarPaths.slice(index, index + 100)
                );
                if (avatarError) {
                    console.error("Could not delete the user's avatar files:", avatarError);
                    return res.status(502).json({
                        error: "Could not delete all account data. The account remains active; please try again."
                    });
                }
            }

            const { error: accountError } = await adminClient.auth.admin.deleteUser(
                session.user.id
            );
            if (accountError) {
                console.error("Could not delete the Supabase Auth account:", accountError);
                return res.status(502).json({
                    error: "Account data was partly removed, but the account could not be deleted. Please try again."
                });
            }

            res.clearCookie("session", {
                httpOnly: true,
                secure: true,
                sameSite: "none"
            });
            res.json({ message: "Account and associated data deleted." });
        } catch (error) {
            console.error("Could not delete the account:", error);
            res.status(500).json({ error: "Could not delete the account." });
        }
    });
};
