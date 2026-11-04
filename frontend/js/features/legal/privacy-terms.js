
const legalView = document.getElementById("view-legal");

async function loadLegalPage(page) {
    legalView.innerHTML = "";

    try {
        const response = await fetch(`/legal/${page}.html`);

        if (!response.ok) {
            throw new Error(`Error loading ${page}`);
        }

        const html = await response.text();
        if (window.location.hash !== `#${page}`) return;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const content = doc.querySelector("main");

        if (!content) {
            throw new Error("Main element not found");
        }

        legalView.innerHTML = content.innerHTML;

    } catch (error) {
        console.error(`Could not load the ${page} page:`, error);
        legalView.innerHTML = "<h1>Unable to load this page.</h1>";
    }
}

document.addEventListener("app:navigate", ({ detail: { route } }) => {
    if (route === "privacy" || route === "terms") {
        loadLegalPage(route);
    }
});
