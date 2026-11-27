{
    echo "===== ROADMAP HTML ====="
    grep -nEi -C 120 \
        'view-roadmap|roadmap' \
        frontend/index.html || true

    echo
    echo "===== ROADMAP SCSS ====="
    grep -RniE -C 60 \
        'roadmap' \
        frontend/styles/scss || true

    echo
    echo "===== ROADMAP JS ====="
    grep -RniE -C 50 \
        'roadmap' \
        frontend/js || true

    echo
    echo "===== ADMIN FRONTEND ====="
    grep -RniE -C 35 \
        'developerAccess|ADMIN|admin|developer/status|isAdmin' \
        frontend/js \
        | head -n 350 || true

    echo
    echo "===== ADMIN BACKEND ====="
    grep -RniE -C 30 \
        'isAdminEmail|getSessionContext' \
        backend/src/routes \
        backend/src/middleware \
        | head -n 350 || true

} > roadmap-current-context.txt