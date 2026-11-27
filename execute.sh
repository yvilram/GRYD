{
    echo "===== APP ROUTE REGISTRATION ====="
    grep -nEi -C 35 \
        'developer.routes|catalog.routes|requestIgdb|registerDeveloper' \
        backend/src/app.js \
        backend/worker.mjs || true

    echo
    echo "===== DEVELOPER ROUTES COMPLETE ====="
    cat backend/src/routes/developer.routes.js

    echo
    echo "===== IGDB CLIENT COMPLETE ====="
    cat backend/src/services/igdb.client.js

    echo
    echo "===== GAME CACHE COMPLETE ====="
    cat backend/src/services/game-cache.service.js

    echo
    echo "===== DATABASE SQL GAMES ====="
    cat supabase/create_games.sql 2>/dev/null || true

} > igdb-cache-sync-context.txt