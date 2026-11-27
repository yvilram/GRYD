{
    echo "===== GAME DETAIL STATE ====="
    grep -nEi -C 20 \
        'currentGameDetail|currentGameMediaIndex|currentGameTab' \
        frontend/js/features/games/catalog.js \
        | head -n 180

    echo
    echo "===== LOAD GAME DETAIL ====="
    grep -nEi -A 220 \
        'const loadGameDetail' \
        frontend/js/features/games/catalog.js

    echo
    echo "===== RENDER GAME DETAIL ====="
    grep -nEi -A 180 \
        'const renderGameDetail' \
        frontend/js/features/games/catalog.js

    echo
    echo "===== CATALOG CACHE CHANGE ====="
    grep -nEi -A 80 \
        'const handleCatalogCacheChanged' \
        frontend/js/features/games/catalog.js

} > game-detail-revalidation-context.txt