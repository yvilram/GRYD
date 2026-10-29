document.getElementById("games-container").addEventListener("change", async (event) => {
    if (event.target.matches("select")) {

        const card = event.target.closest(".game-card");
        const gameName = card.querySelector(".game-title span").textContent;

        const gameId = card.id;
        const status = event.target.value;

        try {
            const response = await fetch("/api/game_state", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    gameId,
                    gameName,
                    status
                })
            });

            if(!response.ok){
                throw new Error("Error saving game state");
            }
            const data = await response.json();
            console.log(data);
            
        } catch (error) {
            console.error("Fail connection server:", error);
        }
    }
});