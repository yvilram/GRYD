module.exports = async function requestIgdb(endpoint, body) {
    const clientId = process.env.IGDB_CLIENT_ID;
    const accessToken = process.env.IGDB_ACCESS_TOKEN;

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: "POST",
        headers: {
            "Client-ID": clientId,
            "Authorization": `Bearer ${accessToken}`
        },
        body
    });

    if (!response.ok) {
        const responseBody = (await response.text()).trim();
        const error = new Error(
            `IGDB request failed (${response.status})` +
            `${responseBody ? `: ${responseBody.slice(0, 500)}` : "."}`
        );
        error.upstream = true;
        throw error;
    }

    return response.json();
};
