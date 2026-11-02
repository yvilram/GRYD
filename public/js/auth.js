const avatarButton = document.getElementById("avatar-button");
const avatarMenu = document.getElementById("avatar-menu");

async function checkSession() {
    try {
        const response = await fetch(`${API_URL}/api/session`, {
            credentials: "include"
        });

        // Si no está autenticado o hay error, salimos limpiamente
        if (!response.ok) {
            return;
        }

        const session = await response.json();

        if (session && session.loggedIn) {
            document.getElementById("user-email").textContent = session.email;
            document.getElementById("avatar-button").textContent = session.email.charAt(0).toUpperCase();
            document.getElementById("session").style.display = "none";
            document.getElementById("user-avatar").style.display = "block";
            return true;
        }else{
            return false;
        }
    } catch (error) {
        // Ignoramos errores de red o parsing si el usuario es anónimo
        console.warn("No active session or server offline.");
    }
}

checkSession();

// NAVEGACIÓN ENTRE SECCIONES
document.getElementById("show-login").addEventListener("click", () => {
    document.getElementById("home").style.display = "none";
    document.getElementById("register-section").style.display = "none";
    document.getElementById("login-section").style.display = "flex";
});

document.getElementById("show-register").addEventListener("click", () => {
    document.getElementById("home").style.display = "none";
    document.getElementById("login-section").style.display = "none";
    document.getElementById("register-section").style.display = "flex";
});

//LOGIN
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const errorMessage = document.getElementById("login-error");


    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (response.ok) {
            window.location.href = "/";
        } else {
            errorMessage.textContent = result.error;
        }
    } catch (error) {
        errorMessage.textContent = "Unable to connect to the server";
    }
});

//REGISTER
document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("register-email").value;
    const password1 = document.getElementById("register-password1").value;
    const password2 = document.getElementById("register-password2").value;
    const errorMessage = document.getElementById("register-error");
    errorMessage.textContent = "";
    errorMessage.style.color = "#f87171";

    if (password1 !== password2) {
        errorMessage.textContent = "Las contraseñas no coinciden";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password1, password2 })
        });

        const result = await response.json();

        if (response.ok) {
            const sessionResponse = await fetch(`${API_URL}/api/session`, {
                credentials: "include"
            });
            const session = await sessionResponse.json();

            if (session.loggedIn) {
                // Hide the forms and show Home
                document.getElementById("register-section").style.display = "none";
                document.getElementById("login-section").style.display = "none";
                document.getElementById("home").style.display = "block";

                // Update the header
                document.getElementById("session").style.display = "none";
                document.getElementById("user-avatar").style.display = "block";

                // Show the user's email and avatar initial
                document.getElementById("user-email").textContent = session.email;
                document.getElementById("avatar-button").textContent =
                    session.email.charAt(0).toUpperCase();

                // Clear the registration form
                document.getElementById("register-form").reset();
                document.getElementById("register-error").textContent = "";
            } else {
                errorMessage.style.color = "#f87171";
                errorMessage.textContent =
                    "Account created, but automatic login failed.";
            }
        } else {
            errorMessage.textContent =
                result.error || "Unable to create account.";
        }

    } catch (error) {
        errorMessage.textContent = "Error al conectar con el servidor";
    }
});

//LOGOUT
document.getElementById("logout").addEventListener("click", async () => {
    await fetch(`${API_URL}/api/logout`, {
        method: "POST",
        credentials: "include"
    });
    window.location.href = "/";
    document.getElementById("session").style.display = "block";
    document.getElementById("user-avatar").style.display = "none";
});



avatarButton.addEventListener("click", () => {
    avatarMenu.style.display =
        avatarMenu.style.display === "block" ? "none" : "block";
});

document.addEventListener("click", (e) => {
    if (!document.getElementById("user-avatar").contains(e.target)) {
        avatarMenu.style.display = "none";
    }
});

async function checkAuth() {
    try {
        const response = await fetch(`${API_URL}/api/check-auth`, {
            credentials: "include"
        });

        if (!response.ok) return false;

        const data = await response.json();

        return data.authenticated;

    } catch (error) {
        console.error(error);
        return false;
    }
}