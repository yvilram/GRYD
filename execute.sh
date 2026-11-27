{
    echo "===== EMULATOR CONFIG ====="
    grep -RniE -C 20 \
        'EJS_|EmulatorJS|emulatorjs|loader.js|dataPath|localization|language' \
        frontend/js \
        frontend/index.html \
        backend/src/routes/retro.routes.js \
        backend/src/services/retro-games.service.js \
        2>/dev/null

    echo
    echo "===== PACKAGE ====="
    grep -nEi \
        'emulatorjs|version' \
        package.json package-lock.json \
        | head -n 80
} > emulatorjs-current-context.txt