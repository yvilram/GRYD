(() => {
    const storageKey = "gryd-theme";
    const root = document.documentElement;
    const allowedThemes = new Set(["dark", "light"]);

    const updateThemeControl = theme => {
        const button = document.getElementById("theme-toggle");
        if (!button) return;

        const isLight = theme === "light";
        button.setAttribute("aria-pressed", String(isLight));
        button.querySelector("i").className = `bi ${isLight ? "bi-moon" : "bi-sun"}`;
        document.getElementById("theme-toggle-label").textContent =
            isLight ? "Dark theme" : "Light theme";
    };

    const setTheme = theme => {
        if (!allowedThemes.has(theme)) {
            throw new Error(`Unsupported theme: ${theme}`);
        }

        root.dataset.theme = theme;
        updateThemeControl(theme);
        try {
            window.localStorage.setItem(storageKey, theme);
        } catch (error) {
            console.error("Could not save the selected theme:", error);
        }

        document.querySelector('meta[name="theme-color"]')
            ?.setAttribute("content", theme === "light" ? "#f4f6fb" : "#090b12");
    };

    try {
        const savedTheme = window.localStorage.getItem(storageKey);
        root.dataset.theme = allowedThemes.has(savedTheme) ? savedTheme : "dark";
    } catch (error) {
        console.error("Could not read the saved theme:", error);
        root.dataset.theme = "dark";
    }

    document.addEventListener("DOMContentLoaded", () => {
        updateThemeControl(root.dataset.theme);
    });

    document.addEventListener("click", event => {
        const toggle = event.target instanceof Element
            ? event.target.closest("[data-theme-toggle]")
            : null;
        if (!toggle) return;

        setTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
})();
