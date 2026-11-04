const isGitHubCodespace = location.hostname.endsWith("github.dev");
const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);

const API_URL = isGitHubCodespace
    ? `https://${location.hostname.replace("-3000", "-8787")}`
    : isLocalDevelopment
        ? `http://${location.hostname}:8787`
        : "https://gryd-api.yagovrama.workers.dev";