const API_ORIGIN = "https://gryd-api.yagovrama.workers.dev";

export async function onRequest({ request }) {
    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        API_ORIGIN
    );

    return fetch(new Request(upstreamUrl, request));
}
