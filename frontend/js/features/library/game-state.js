const libraryGridIds = ["game-catalog", "game-library"];

// Save the selected status for the game card that changed.
const saveGameStatus = async event => {
    const statusSelect = event.target;
    if (!(statusSelect instanceof HTMLSelectElement)) return;

    const gameCard = statusSelect.closest(".game-card");
    const gameName = gameCard?.querySelector(".game-card__name")?.textContent.trim();
    if (!gameCard || !gameName) return;

    const previousStatus = statusSelect.dataset.savedStatus || "select";
    const status = statusSelect.value;
    statusSelect.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/game_state`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                gameId: gameCard.dataset.gameId,
                gameName,
                status
            })
        });

        let result = {};
        try {
            result = await response.json();
        } catch {
            if (response.ok) {
                throw new Error("The server returned an invalid response.");
            }
        }
        if (!response.ok) {
            throw new Error(result.error || `Could not update game status (${response.status}).`);
        }

        statusSelect.dataset.savedStatus = status;
        document.dispatchEvent(new CustomEvent("app:library-state-changed", {
            detail: {
                gameId: gameCard.dataset.gameId,
                gameName,
                status,
                savedAt: new Date().toISOString()
            }
        }));
        const statusLabel = statusSelect.selectedOptions[0]?.textContent || status;
        window.showAppNotice(`${gameName} moved to ${statusLabel}.`);
    } catch (error) {
        console.error(`Could not save status for "${gameName}":`, error);
        statusSelect.value = previousStatus;
        document.dispatchEvent(new CustomEvent("app:library-state-changed", {
            detail: {
                gameId: gameCard.dataset.gameId,
                gameName,
                status: previousStatus
            }
        }));
        window.showAppNotice(
            error.status === 401
                ? "Your session has expired. Log in again to manage your library."
                : `Could not update ${gameName}. Check your connection and try again.`,
            "error"
        );
    } finally {
        statusSelect.disabled = false;
    }
};

libraryGridIds.forEach(id => {
    document.getElementById(id).addEventListener("change", saveGameStatus);
});
