const LIBRARY_SYNC_CHANNEL = "gryd-library-state";
const librarySyncChannel =
    "BroadcastChannel" in window
        ? new BroadcastChannel(LIBRARY_SYNC_CHANNEL)
        : null;

const dispatchLibraryStateChange = (
    detail,
    {
        broadcast = true
    } = {}
) => {
    document.dispatchEvent(
        new CustomEvent(
            "app:library-state-changed",
            {
                detail
            }
        )
    );

    if (broadcast) {
        librarySyncChannel?.postMessage(detail);
    }
};

librarySyncChannel?.addEventListener(
    "message",
    event => {
        const detail = event.data;

        if (
            !detail ||
            typeof detail !== "object" ||
            !detail.gameId ||
            typeof detail.status !== "string"
        ) {
            return;
        }

        dispatchLibraryStateChange(
            {
                ...detail,
                external: true
            },
            {
                broadcast: false
            }
        );
    }
);

window.dispatchLibraryStateChange =
    dispatchLibraryStateChange;

const libraryGridIds = ["game-catalog", "game-library"];

// Save the selected status for the game card that changed.
const saveGameStatus = async event => {
    const statusSelect = event.target;
    if (!(statusSelect instanceof HTMLSelectElement)) return;

    const gameCard = statusSelect.closest(".game-card");
    const detailControls = statusSelect.closest(".game-detail-library-controls");
    const gameId = gameCard?.dataset.gameId || detailControls?.dataset.gameId;
    const gameName = gameCard?.querySelector(".game-card__name")?.textContent.trim() ||
        detailControls?.dataset.gameName;
    if ((!statusSelect.matches(".game-card__status, .game-detail-library-status")) ||
        !gameId || !gameName) return;

    const previousStatus = statusSelect.dataset.savedStatus || "select";
    const status = statusSelect.value;
    statusSelect.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/game_state`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                gameId,
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
            const error = new Error(
                result.error || `Could not update game status (${response.status}).`
            );
            error.status = response.status;
            throw error;
        }

        statusSelect.dataset.savedStatus = status;
        dispatchLibraryStateChange({
            gameId,
            gameName,
            status,
            savedAt: new Date().toISOString()
        });

        const statusLabel = statusSelect.selectedOptions[0]?.textContent || status;
        window.showAppNotice(`${gameName} moved to ${statusLabel}.`);
    } catch (error) {
        console.error(`Could not save status for "${gameName}":`, error);
        statusSelect.value = previousStatus;
        dispatchLibraryStateChange(
            {
                gameId,
                gameName,
                status: previousStatus
            },
            {
                broadcast: false
            }
        );
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
document.getElementById("game-detail-library-controls")
    .addEventListener("change", saveGameStatus);
