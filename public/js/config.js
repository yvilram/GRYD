const API_URL = location.hostname.endsWith("github.dev")
    ? `https://${location.hostname.replace("-3000", "-8787")}`
    : "https://gryd-api.yagovrama.workers.dev";