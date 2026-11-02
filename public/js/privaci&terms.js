
const legal = document.querySelector(".legal-content");


// Guardamos el contenido original de main
const originalContent = legal.innerHTML;

async function loadLegalPage(page) {
    // Ocultar el contenido original
    legal.innerHTML = "";
    legal.removeAttribute("style");
    

    try {
        const response = await fetch(`../docs/${page}.html`);

        if (!response.ok) {
            throw new Error(`Error loading ${page}`);
        }

        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const content = doc.querySelector("main");

        if (!content) {
            throw new Error("Main element not found");
        }

        legal.innerHTML = content.innerHTML;
        

    } catch (error) {
        console.error(error);
        legal.innerHTML = "<h1>Unable to load this page.</h1>";
    }
}


["privacy", "terms"].forEach(id => {
    document.getElementById(id).addEventListener("click", async () => {
        document.getElementById("games-container").style.display = "none";
        document.getElementById("games-library").style.display = "none";
        document.getElementById("home").style.display = "none";
        loadLegalPage(id);
    });
});
