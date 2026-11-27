{
    echo "===== APP SETTINGS ====="
    grep -nEi -C 35 \
        'app_settings|game_missions_enabled|local.*upload|carousel|cinematic|slideshow' \
        backend/src/routes/developer.routes.js \
        frontend/js/features/developer/developer.js

    echo
    echo "===== CAROUSEL TOGGLE ====="
    grep -RniE -C 25 \
        'carousel|slideshow|cinematic|hero.*mode|toggle' \
        frontend/js \
        frontend/index.html \
        | head -n 400
} > carousel-settings-context.txt