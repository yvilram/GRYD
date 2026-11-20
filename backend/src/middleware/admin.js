const getAdminEmails = () =>
    new Set(
        (process.env.ADMIN_EMAILS || "")
            .split(",")
            .map(email => email.trim().toLowerCase())
            .filter(Boolean)
    );

const isAdminEmail = email => {
    if (typeof email !== "string") {
        return false;
    }

    return getAdminEmails().has(email.trim().toLowerCase());
};

module.exports = {
    isAdminEmail
};