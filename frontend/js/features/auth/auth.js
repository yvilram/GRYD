const accountMenu = document.getElementById("account-menu");
const accountMenuButton = document.getElementById("account-menu-trigger");
const accountMenuPanel = document.getElementById("account-menu-panel");
const accountAvatar = document.getElementById("account-avatar");
const accountAvatarIcon = accountMenuButton.querySelector("i");
let isLoggedIn = false;
let currentEmail = "";
let currentAvatarUrl = "";

function updateAvatarImages(url = "") {
    const profileImage = document.getElementById("profile-avatar-image");
    const profilePlaceholder = document.getElementById("profile-avatar-placeholder");
    const hasAvatar = typeof url === "string" && url.startsWith("https://");
    currentAvatarUrl = hasAvatar ? url : "";

    if (hasAvatar) {
        profileImage.src = url;
        accountAvatar.src = url;
    } else {
        profileImage.removeAttribute("src");
        accountAvatar.removeAttribute("src");
    }
    profileImage.hidden = !hasAvatar;
    profilePlaceholder.hidden = hasAvatar;
    accountAvatar.hidden = !hasAvatar;
    accountAvatarIcon.hidden = hasAvatar;
}

document.getElementById("profile-avatar-image").addEventListener("error", () => {
    if (currentAvatarUrl) updateAvatarImages();
});
accountAvatar.addEventListener("error", () => {
    if (currentAvatarUrl) updateAvatarImages();
});

function updateAuthenticationState(authenticated, email = "", avatarUrl = "") {
    isLoggedIn = authenticated;
    currentEmail = authenticated ? email : "";

    document.getElementById("auth-actions").hidden = authenticated;
    accountMenu.hidden = !authenticated;
    document.getElementById("navigation-library").hidden = !authenticated;
    document.getElementById("home-register").hidden = authenticated;

    if (authenticated) {
        document.getElementById("account-email").textContent = currentEmail;
        document.getElementById("profile-email").value = currentEmail;
    }
    updateAvatarImages(authenticated ? avatarUrl : "");

    window.dispatchEvent(new CustomEvent("auth:changed", {
        detail: { authenticated, email: currentEmail, avatarUrl: currentAvatarUrl }
    }));
}

async function checkSession() {
    try {
        const response = await fetch(`${API_URL}/api/session`, {
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error(`Session check failed (${response.status})`);
        }

        const session = await response.json();

        if (session && session.loggedIn) {
            updateAuthenticationState(true, session.email, session.avatarUrl);
            return true;
        }

        updateAuthenticationState(false);
        return false;
    } catch (error) {
        console.error("Could not check the current session:", error);
        updateAuthenticationState(false);
        return false;
    }
}

async function confirmEmailFromUrl() {
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type");
    if (!tokenHash && !type) return null;

    url.searchParams.delete("token_hash");
    url.searchParams.delete("type");
    window.history.replaceState(null, "", url);

    try {
        const response = await fetch(`${API_URL}/api/confirm-email`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token_hash: tokenHash, type })
        });
        const result = await response.json();
        if (!response.ok) {
            return {
                success: false,
                message: result.error || "Could not confirm your email address."
            };
        }
        return { success: true, message: "Email confirmed. You are now logged in." };
    } catch (error) {
        console.error("Email confirmation request failed:", error);
        return {
            success: false,
            message: "Could not connect to confirm your email. Please try again."
        };
    }
}

const sessionReady = (async () => {
    const confirmation = await confirmEmailFromUrl();
    const authenticated = await checkSession();

    if (confirmation) {
        window.showAppNotice(confirmation.message, confirmation.success ? "success" : "error");
        navigateToRoute(confirmation.success || authenticated ? "home" : "login", {
            replace: true
        });
    }

    return authenticated;
})();
window.authStateReady = sessionReady;

window.addEventListener("auth:session-expired", () => {
    updateAuthenticationState(false);
});

document.getElementById("auth-login-trigger").addEventListener("click", () => {
    navigateToRoute("login");
});

document.getElementById("auth-register-trigger").addEventListener("click", () => {
    navigateToRoute("register");
});

document.getElementById("home-register").addEventListener("click", () => {
    navigateToRoute("register");
});

document.getElementById("login-to-register").addEventListener("click", () => {
    navigateToRoute("register");
});

document.getElementById("register-to-login").addEventListener("click", () => {
    navigateToRoute("login");
});

document.addEventListener("app:navigate", async ({ detail: { route } }) => {
    if (route !== "profile") return;

    accountMenuPanel.hidden = true;
    accountMenuButton.setAttribute("aria-expanded", "false");
    await sessionReady;
    if (!isLoggedIn) {
        navigateToRoute("login", { replace: true });
        return;
    }

    document.getElementById("profile-email").value = currentEmail;
});

const profileAvatarFile = document.getElementById("profile-avatar-file");
const profileAvatarButton = document.getElementById("profile-avatar-change");
const profileAvatarMessage = document.getElementById("profile-avatar-message");
const profileAvatarCropDialog = document.getElementById("profile-avatar-crop-dialog");
const profileAvatarCropCanvas = document.getElementById("profile-avatar-crop-canvas");
const profileAvatarCropContext = profileAvatarCropCanvas.getContext("2d");
const profileAvatarCropZoom = document.getElementById("profile-avatar-crop-zoom");
const profileAvatarCropSave = document.getElementById("profile-avatar-crop-save");
const profileAvatarCropMessage = document.getElementById("profile-avatar-crop-message");
const AVATAR_CROP_SIZE = profileAvatarCropCanvas.width;
let profileAvatarCropImage = null;
let profileAvatarCropUrl = "";
let profileAvatarCropScale = 1;
let profileAvatarCropOffsetX = 0;
let profileAvatarCropOffsetY = 0;
let profileAvatarCropDrag = null;

profileAvatarButton.addEventListener("click", () => profileAvatarFile.click());

const renderAvatarCrop = () => {
    if (!profileAvatarCropImage) return;
    const fitScale = Math.max(
        AVATAR_CROP_SIZE / profileAvatarCropImage.naturalWidth,
        AVATAR_CROP_SIZE / profileAvatarCropImage.naturalHeight
    );
    profileAvatarCropScale = fitScale * Number(profileAvatarCropZoom.value);
    const renderedWidth = profileAvatarCropImage.naturalWidth * profileAvatarCropScale;
    const renderedHeight = profileAvatarCropImage.naturalHeight * profileAvatarCropScale;
    const maxOffsetX = Math.max(0, (renderedWidth - AVATAR_CROP_SIZE) / 2);
    const maxOffsetY = Math.max(0, (renderedHeight - AVATAR_CROP_SIZE) / 2);
    profileAvatarCropOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, profileAvatarCropOffsetX));
    profileAvatarCropOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, profileAvatarCropOffsetY));

    profileAvatarCropContext.clearRect(0, 0, AVATAR_CROP_SIZE, AVATAR_CROP_SIZE);
    profileAvatarCropContext.drawImage(
        profileAvatarCropImage,
        (AVATAR_CROP_SIZE - renderedWidth) / 2 + profileAvatarCropOffsetX,
        (AVATAR_CROP_SIZE - renderedHeight) / 2 + profileAvatarCropOffsetY,
        renderedWidth,
        renderedHeight
    );
};

const uploadProfileAvatar = async file => {
    const signedResponse = await fetch(`${API_URL}/api/profile/avatar/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, fileSize: file.size })
    });
    const signedResult = await signedResponse.json();
    if (!signedResponse.ok) {
        throw new Error(signedResult.error || "Could not prepare the avatar upload.");
    }

    const uploadResponse = await fetch(signedResult.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
    });
    if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        throw new Error(uploadError || "Avatar upload failed.");
    }

    const updateResponse = await fetch(`${API_URL}/api/profile/avatar`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: signedResult.path })
    });
    const updateResult = await updateResponse.json();
    if (!updateResponse.ok) {
        throw new Error(updateResult.error || "Could not save the avatar.");
    }

    updateAvatarImages(updateResult.avatarUrl);
    profileAvatarMessage.classList.add("form-message--success");
    profileAvatarMessage.textContent = updateResult.cleanupWarning
        ? "Avatar updated, but the previous image could not be removed."
        : "Your avatar has been updated.";
};

profileAvatarFile.addEventListener("change", async () => {
    const file = profileAvatarFile.files?.[0];
    if (!file) return;

    profileAvatarMessage.classList.remove("form-message--success");
    profileAvatarMessage.textContent = "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        profileAvatarMessage.textContent = "Choose a JPG, PNG, or WebP image.";
        profileAvatarFile.value = "";
        return;
    }
    if (file.size === 0 || file.size > 2 * 1024 * 1024) {
        profileAvatarMessage.textContent = "The avatar image must be smaller than 2 MB.";
        profileAvatarFile.value = "";
        return;
    }

    if (profileAvatarCropUrl) URL.revokeObjectURL(profileAvatarCropUrl);
    profileAvatarCropUrl = URL.createObjectURL(file);
    profileAvatarCropImage = new Image();
    profileAvatarButton.disabled = true;
    try {
        profileAvatarCropImage.src = profileAvatarCropUrl;
        await profileAvatarCropImage.decode();
        profileAvatarCropOffsetX = 0;
        profileAvatarCropOffsetY = 0;
        profileAvatarCropZoom.value = "1";
        profileAvatarCropMessage.textContent = "";
        renderAvatarCrop();
        profileAvatarCropDialog.showModal();
    } catch (error) {
        console.error("Could not load the selected avatar image:", error);
        profileAvatarMessage.textContent = "Could not open that image. Choose a valid image file.";
        URL.revokeObjectURL(profileAvatarCropUrl);
        profileAvatarCropUrl = "";
        profileAvatarCropImage = null;
    } finally {
        profileAvatarButton.disabled = false;
        profileAvatarFile.value = "";
    }
});

profileAvatarCropZoom.addEventListener("input", renderAvatarCrop);

profileAvatarCropCanvas.addEventListener("pointerdown", event => {
    if (!profileAvatarCropImage) return;
    event.preventDefault();
    profileAvatarCropCanvas.setPointerCapture(event.pointerId);
    const bounds = profileAvatarCropCanvas.getBoundingClientRect();
    const scale = AVATAR_CROP_SIZE / bounds.width;
    profileAvatarCropDrag = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: profileAvatarCropOffsetX,
        offsetY: profileAvatarCropOffsetY,
        scale
    };
    profileAvatarCropCanvas.classList.add("is-dragging");
});

profileAvatarCropCanvas.addEventListener("pointermove", event => {
    if (!profileAvatarCropDrag) return;
    profileAvatarCropOffsetX = profileAvatarCropDrag.offsetX +
        (event.clientX - profileAvatarCropDrag.pointerX) * profileAvatarCropDrag.scale;
    profileAvatarCropOffsetY = profileAvatarCropDrag.offsetY +
        (event.clientY - profileAvatarCropDrag.pointerY) * profileAvatarCropDrag.scale;
    renderAvatarCrop();
});

profileAvatarCropCanvas.addEventListener("keydown", event => {
    const movement = event.shiftKey ? 20 : 5;
    if (event.key === "ArrowLeft") profileAvatarCropOffsetX -= movement;
    else if (event.key === "ArrowRight") profileAvatarCropOffsetX += movement;
    else if (event.key === "ArrowUp") profileAvatarCropOffsetY -= movement;
    else if (event.key === "ArrowDown") profileAvatarCropOffsetY += movement;
    else return;

    event.preventDefault();
    renderAvatarCrop();
});

const finishAvatarCropDrag = () => {
    profileAvatarCropDrag = null;
    profileAvatarCropCanvas.classList.remove("is-dragging");
};
profileAvatarCropCanvas.addEventListener("pointerup", finishAvatarCropDrag);
profileAvatarCropCanvas.addEventListener("pointercancel", finishAvatarCropDrag);
profileAvatarCropCanvas.addEventListener("lostpointercapture", finishAvatarCropDrag);

document.getElementById("profile-avatar-crop-cancel").addEventListener("click", () => {
    profileAvatarCropDialog.close();
});

profileAvatarCropDialog.addEventListener("close", () => {
    if (profileAvatarCropUrl) URL.revokeObjectURL(profileAvatarCropUrl);
    profileAvatarCropUrl = "";
    profileAvatarCropImage = null;
    profileAvatarCropDrag = null;
});

profileAvatarCropSave.addEventListener("click", async () => {
    profileAvatarCropSave.disabled = true;
    profileAvatarCropMessage.textContent = "";
    profileAvatarCropSave.textContent = "Uploading...";
    try {
        const croppedBlob = await new Promise((resolve, reject) => {
            profileAvatarCropCanvas.toBlob(
                blob => blob
                    ? resolve(blob)
                    : reject(new Error("Could not prepare the cropped avatar image.")),
                "image/webp",
                0.9
            );
        });
        if (croppedBlob.size === 0 || croppedBlob.size > 2 * 1024 * 1024) {
            throw new Error("The cropped avatar image must be smaller than 2 MB.");
        }

        await uploadProfileAvatar(croppedBlob);
        profileAvatarCropDialog.close();
    } catch (error) {
        console.error("Avatar update failed:", error);
        profileAvatarCropMessage.textContent =
            error.message || "Unable to update your avatar.";
    } finally {
        profileAvatarCropSave.disabled = false;
        profileAvatarCropSave.textContent = "Use this crop";
    }
});

const accountDeleteDialog = document.getElementById("account-delete-dialog");
const accountDeleteForm = document.getElementById("account-delete-form");
const accountDeleteMessage = document.getElementById("account-delete-message");
const accountDeleteSubmit = document.getElementById("account-delete-submit");

document.getElementById("profile-delete-trigger").addEventListener("click", () => {
    accountDeleteForm.reset();
    accountDeleteMessage.textContent = "";
    accountDeleteDialog.showModal();
});

document.getElementById("account-delete-cancel").addEventListener("click", () => {
    accountDeleteDialog.close();
});

accountDeleteForm.addEventListener("submit", async event => {
    event.preventDefault();
    accountDeleteMessage.textContent = "";
    accountDeleteMessage.classList.remove("form-message--success");

    const formData = new FormData(accountDeleteForm);
    const password = formData.get("password");
    const confirmation = formData.get("confirmation");
    if (confirmation !== "DELETE") {
        accountDeleteMessage.textContent = "Type DELETE exactly to confirm.";
        return;
    }

    accountDeleteSubmit.disabled = true;
    accountDeleteSubmit.textContent = "Deleting...";
    try {
        const response = await fetch(`${API_URL}/api/profile`, {
            method: "DELETE",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password, confirmation })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Could not delete the account.");
        }

        window.location.replace("/");
    } catch (error) {
        console.error("Account deletion failed:", error);
        accountDeleteMessage.textContent =
            error.message || "Unable to connect to the server.";
        accountDeleteSubmit.disabled = false;
        accountDeleteSubmit.textContent = "Delete Account";
    }
});

document.getElementById("profile-email-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = document.getElementById("profile-email").value.trim();
    const message = document.getElementById("profile-email-message");
    message.classList.remove("form-message--success");
    message.textContent = "";

    try {
        const response = await fetch(`${API_URL}/api/profile/email`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to update email.");

        if (result.confirmationRequired) {
            message.classList.add("form-message--success");
            message.textContent = `Confirm the email change using the link sent to ${email}.`;
            return;
        }

        currentEmail = result.email;
        document.getElementById("account-email").textContent = currentEmail;
        document.getElementById("profile-email").value = currentEmail;
        message.classList.add("form-message--success");
        message.textContent = "Your email address has been updated.";
    } catch (error) {
        console.error("Email update request failed:", error);
        message.textContent = error.message || "Unable to connect to the server.";
    }
});

document.getElementById("profile-password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const password = document.getElementById("profile-password").value;
    const confirmation = document.getElementById("profile-password-confirmation").value;
    const message = document.getElementById("profile-password-message");
    message.classList.remove("form-message--success");
    message.textContent = "";

    if (password !== confirmation) {
        message.textContent = "The passwords do not match.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/profile/password`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to update password.");

        document.getElementById("profile-password-form").reset();
        message.classList.add("form-message--success");
        message.textContent = "Your password has been updated.";
    } catch (error) {
        console.error("Password update request failed:", error);
        message.textContent = error.message || "Unable to connect to the server.";
    }
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const errorMessage = document.getElementById("login-error");
    errorMessage.classList.remove("form-message--success");
    errorMessage.textContent = "";

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
            errorMessage.textContent = result.error || "Unable to log in.";
        }
    } catch (error) {
        console.error("Login request failed:", error);
        errorMessage.textContent = "Unable to connect to the server";
    }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await sessionReady;

    const email = document.getElementById("register-email").value;
    const password1 = document.getElementById("register-password").value;
    const password2 = document.getElementById("register-password-confirmation").value;
    const errorMessage = document.getElementById("register-error");
    errorMessage.classList.remove("form-message--success");
    errorMessage.textContent = "";

    if (password1 !== password2) {
        errorMessage.textContent = "Passwords do not match.";
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

        if (response.ok && result.confirmationRequired) {
            document.getElementById("register-form").reset();
            errorMessage.classList.add("form-message--success");
            errorMessage.textContent =
                "Account created. Check your inbox and confirm your email before logging in.";
        } else if (response.ok) {
            const sessionResponse = await fetch(`${API_URL}/api/session`, {
                credentials: "include"
            });
            const session = await sessionResponse.json();

            if (session.loggedIn) {
                updateAuthenticationState(true, session.email);
                document.getElementById("register-form").reset();
                navigateToRoute("home");
            } else {
                errorMessage.textContent =
                    "Account created, but automatic login failed.";
            }
        } else {
            errorMessage.textContent =
                result.error || "Unable to create account.";
        }

    } catch (error) {
        console.error("Registration request failed:", error);
        errorMessage.textContent = "Could not connect to the server. Please try again.";
    }
});

document.getElementById("auth-logout").addEventListener("click", async () => {
    try {
        const response = await fetch(`${API_URL}/api/logout`, {
            method: "POST",
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error(`Logout failed (${response.status})`);
        }

        window.location.href = "/";
    } catch (error) {
        console.error("Logout request failed:", error);
    }
});

accountMenuButton.addEventListener("click", () => {
    accountMenuPanel.hidden = !accountMenuPanel.hidden;
    accountMenuButton.setAttribute("aria-expanded", String(!accountMenuPanel.hidden));
});

document.addEventListener("click", (e) => {
    if (!accountMenu.contains(e.target)) {
        accountMenuPanel.hidden = true;
        accountMenuButton.setAttribute("aria-expanded", "false");
    }
});