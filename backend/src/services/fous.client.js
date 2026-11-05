const FOUS_URL = "https://api.fous.com/v1/runs";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;
const MAX_POLL_DURATION_MS = 120000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function getHowLongToBeatData(gameName, apiKey) {
    if (!apiKey) {
        throw new Error("FOUS_API_KEY is not configured.");
    }

    const deadline = Date.now() + MAX_POLL_DURATION_MS;
    let response = await fetch(FOUS_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            method: "howlongtobeat.com/get_game_length",
            input: { game: gameName }
        }),
        signal: AbortSignal.timeout(Math.min(30000, deadline - Date.now()))
    });

    let run = await response.json();
    for (let attempt = 0; response.status === 202; attempt += 1) {
        if (attempt >= MAX_POLL_ATTEMPTS || Date.now() >= deadline || !run.id) {
            throw new Error("Fous did not complete the game-time lookup.");
        }

        await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error("Fous did not complete the game-time lookup.");
        }
        response = await fetch(`${FOUS_URL}/${encodeURIComponent(run.id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(Math.min(30000, remainingMs))
        });
        run = await response.json();
    }

    if (!response.ok) {
        const error = new Error(
            run.error?.message || `Fous request failed (${response.status}).`
        );
        error.upstream = true;
        throw error;
    }

    return run.data && typeof run.data === "object" ? run.data : null;
};
