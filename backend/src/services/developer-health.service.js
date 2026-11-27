const { AwsClient } = require("aws4fetch");

const {
    createSupabaseAdminClient
} = require("./supabase.client");

const HEALTH_TIMEOUT_MS = 5000;
const DEGRADED_LATENCY_MS = 1000;

const getEnvironment = env =>
    env || (
        typeof process !== "undefined"
            ? process.env
            : {}
    );

const withTimeout = async operation =>
    Promise.race([
        operation(),
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error("Health check timed out."));
            }, HEALTH_TIMEOUT_MS);
        })
    ]);

const runCheck = async ({
    id,
    label,
    configured = true,
    disabled = false,
    check
}) => {
    if (disabled) {
        return {
            id,
            label,
            status: "disabled",
            latencyMs: null
        };
    }

    if (!configured) {
        return {
            id,
            label,
            status: "not-configured",
            latencyMs: null
        };
    }

    const startedAt = Date.now();

    try {
        await withTimeout(check);

        const latencyMs = Date.now() - startedAt;

        return {
            id,
            label,
            status:
                latencyMs >= DEGRADED_LATENCY_MS
                    ? "degraded"
                    : "online",
            latencyMs
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;

        const status =
            error?.statusCode === 401 ||
                error?.statusCode === 403 ||
                error?.statusCode === 429
                ? "degraded"
                : "offline";

        return {
            id,
            label,
            status,
            latencyMs,
            error:
                typeof error?.message === "string"
                    ? error.message.slice(0, 160)
                    : "Health check failed."
        };
    }

};

const requestJson = async (
    url,
    options = {},
    acceptedStatuses = [200]
) => {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(
            HEALTH_TIMEOUT_MS
        )
    });

    if (!acceptedStatuses.includes(response.status)) {
        throw new Error(
            `Unexpected response (${response.status}).`
        );
    }

    if (
        response.status !== 204 &&
        response.headers
            .get("content-type")
            ?.includes("application/json")
    ) {
        await response.json();
    }
};

const checkSupabase = async env => {
    const supabase =
        createSupabaseAdminClient(env);

    const { error } = await supabase
        .from("games")
        .select("igdb_game_id", {
            count: "exact",
            head: true
        });

    if (error) {
        throw new Error(
            `Supabase query failed: ${error.message}`
        );
    }
};

const checkIgdb = async env => {
    const response = await fetch(
        "https://api.igdb.com/v4/games",
        {
            method: "POST",
            headers: {
                "Client-ID": env.IGDB_CLIENT_ID,
                Authorization:
                    `Bearer ${env.IGDB_ACCESS_TOKEN}`,
                Accept: "application/json"
            },
            body: "fields id; limit 1;",
            signal: AbortSignal.timeout(
                HEALTH_TIMEOUT_MS
            )
        }
    );

    if (!response.ok) {
        throw new Error(
            `IGDB returned ${response.status}.`
        );
    }

    const result = await response.json();

    if (!Array.isArray(result)) {
        throw new Error("IGDB returned invalid data.");
    }
};

const checkFous = async env => {
    await requestJson(
        "https://api.fous.com/v1/runs/gryd-health-check",
        {
            headers: {
                Authorization:
                    `Bearer ${env.FOUS_API_KEY}`,
                Accept: "application/json"
            }
        },
        [200, 404]
    );
};

const checkSteamStore = async () => {
    const url = new URL(
        "https://store.steampowered.com/api/appdetails"
    );

    url.searchParams.set("appids", "292030");
    url.searchParams.set("cc", "ES");
    url.searchParams.set("l", "english");

    await requestJson(url);
};

const checkSteamWeb = async env => {
    const url = new URL(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
    );

    url.searchParams.set(
        "key",
        env.STEAM_WEB_API_KEY
    );
    url.searchParams.set("appid", "292030");
    url.searchParams.set("l", "english");

    await requestJson(url);
};

const checkIgn = async () => {
    const response = await fetch(
        "https://www.ign.com/",
        {
            headers: {
                "User-Agent":
                    "GRYD service health monitor",
                Accept: "text/html"
            },
            signal: AbortSignal.timeout(
                HEALTH_TIMEOUT_MS
            )
        }
    );

    if (!response.ok) {
        throw new Error(
            `IGN returned ${response.status}.`
        );
    }
};

const checkItad = async env => {
    const url = new URL(
        "https://api.isthereanydeal.com/games/search/v1"
    );

    url.searchParams.set("title", "Portal");
    url.searchParams.set("results", "1");

    await requestJson(url, {
        headers: {
            Accept: "application/json",
            "ITAD-API-Key":
                env.ISTHEREANYDEAL_API_KEY
        }
    });
};

const checkEgData = async () => {
    const params = new URLSearchParams({
        query: "Fortnite",
        limit: "1",
        locale: "es-ES"
    });

    const response = await fetch(
        `https://api.egdata.app/autocomplete?${params}`,
        {
            headers: {
                Accept: "application/json"
            },
            signal: AbortSignal.timeout(
                HEALTH_TIMEOUT_MS
            )
        }
    );

    if (!response.ok) {
        const error = new Error(
            `EGData returned ${response.status}.`
        );

        error.statusCode = response.status;

        throw error;
    }

    const result = await response.json();

    if (!Array.isArray(result?.elements)) {
        throw new Error(
            "EGData returned invalid data."
        );
    }
};

const checkGog = async () => {
    const url = new URL(
        "https://api.gog.com/products/prices"
    );

    url.searchParams.set("ids", "1207658924");
    url.searchParams.set("countryCode", "ES");
    url.searchParams.set("currency", "EUR");

    await requestJson(url);
};

const checkNintendo = async () => {
    const url = new URL(
        "https://search.nintendo-europe.com/es/select"
    );

    url.searchParams.set("q", "Mario");
    url.searchParams.set("rows", "1");
    url.searchParams.set("wt", "json");

    await requestJson(url);
};

const checkExternalS3 = async env => {
    const endpoint =
        env.RETRO_S3_ENDPOINT.replace(/\/+$/, "");

    const bucket = encodeURIComponent(
        env.RETRO_S3_BUCKET
    );

    const url = new URL(
        `${endpoint}/${bucket}`
    );

    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1");

    const client = new AwsClient({
        accessKeyId:
            env.RETRO_S3_ACCESS_KEY_ID,
        secretAccessKey:
            env.RETRO_S3_SECRET_ACCESS_KEY,
        region: env.RETRO_S3_REGION,
        service: "s3"
    });

    const response = await client.fetch(
        url.toString(),
        {
            method: "GET",
            signal: AbortSignal.timeout(
                HEALTH_TIMEOUT_MS
            )
        }
    );

    if (!response.ok) {
        throw new Error(
            `External S3 returned ${response.status}.`
        );
    }
};

const getDeveloperHealth = async providedEnv => {
    const env = getEnvironment(providedEnv);

    const checks = [
        {
            id: "supabase",
            label: "Supabase",
            configured: Boolean(
                env.SUPABASE_URL &&
                env.SUPABASE_SECRET_KEY
            ),
            check: () => checkSupabase(env)
        },
        {
            id: "igdb",
            label: "IGDB",
            configured: Boolean(
                env.IGDB_CLIENT_ID &&
                env.IGDB_ACCESS_TOKEN
            ),
            check: () => checkIgdb(env)
        },
        {
            id: "fous",
            label: "FOUS / HowLongToBeat",
            configured: Boolean(
                env.FOUS_API_KEY
            ),
            check: () => checkFous(env)
        },
        {
            id: "steam-store",
            label: "Steam Store API",
            check: checkSteamStore
        },
        {
            id: "steam-web",
            label: "Steam Web API",
            configured: Boolean(
                env.STEAM_WEB_API_KEY
            ),
            check: () => checkSteamWeb(env)
        },
        {
            id: "ign",
            label: "IGN",
            check: checkIgn
        },
        {
            id: "itad",
            label: "IsThereAnyDeal",
            configured: Boolean(
                env.ISTHEREANYDEAL_API_KEY
            ),
            check: () => checkItad(env)
        },
        {
            id: "egdata",
            label: "EGData / Epic Games",
            check: checkEgData
        },
        {
            id: "gog",
            label: "GOG",
            check: checkGog
        },
        {
            id: "nintendo",
            label: "Nintendo",
            check: checkNintendo
        },
        {
            id: "external-s3",
            label: "External S3",
            configured: Boolean(
                env.RETRO_S3_ENDPOINT &&
                env.RETRO_S3_REGION &&
                env.RETRO_S3_BUCKET &&
                env.RETRO_S3_ACCESS_KEY_ID &&
                env.RETRO_S3_SECRET_ACCESS_KEY
            ),
            check: () => checkExternalS3(env)
        }
    ];

    const services = await Promise.all(
        checks.map(runCheck)
    );

    return {
        checkedAt: new Date().toISOString(),
        services
    };
};

module.exports = {
    getDeveloperHealth
};
