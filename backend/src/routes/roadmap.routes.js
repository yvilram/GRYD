const {
    getSessionContext
} = require("../services/session.service");

const {
    isAdminEmail
} = require("../middleware/admin");

const {
    createSupabaseAdminClient
} = require("../services/supabase.client");

const ROADMAP_STATUSES = new Set([
    "available",
    "beta",
    "in-progress",
    "planned"
]);

const sanitizeRoadmapItem = body => {
    const title =
        typeof body?.title === "string"
            ? body.title.trim()
            : "";

    const description =
        typeof body?.description === "string"
            ? body.description.trim()
            : "";

    const icon =
        typeof body?.icon === "string"
            ? body.icon.trim()
            : "";

    const status =
        typeof body?.status === "string"
            ? body.status.trim()
            : "";

    const tasks = Array.isArray(body?.tasks)
        ? body.tasks
            .filter(task =>
                typeof task === "string"
            )
            .map(task => task.trim())
            .filter(Boolean)
        : [];

    const sortOrder =
        Number(body?.sortOrder);

    if (!title) {
        const error = new Error(
            "Title is required."
        );
        error.status = 400;
        throw error;
    }

    if (!description) {
        const error = new Error(
            "Description is required."
        );
        error.status = 400;
        throw error;
    }

    if (
        !/^bi-[a-z0-9-]+$/i.test(icon)
    ) {
        const error = new Error(
            "A valid Bootstrap icon class is required."
        );
        error.status = 400;
        throw error;
    }

    if (!ROADMAP_STATUSES.has(status)) {
        const error = new Error(
            "Invalid roadmap status."
        );
        error.status = 400;
        throw error;
    }

    if (
        !Number.isSafeInteger(sortOrder) ||
        sortOrder < 0
    ) {
        const error = new Error(
            "sortOrder must be a non-negative integer."
        );
        error.status = 400;
        throw error;
    }

    return {
        icon,
        title,
        description,
        tasks,
        status,
        sort_order: sortOrder
    };
};

const requireRoadmapAdmin = async req => {
    const session =
        await getSessionContext(req);

    if (!session) {
        const error = new Error(
            "Not logged in"
        );
        error.status = 401;
        throw error;
    }

    if (!isAdminEmail(session.user.email)) {
        const error = new Error(
            "Admin access required"
        );
        error.status = 403;
        throw error;
    }

    return session;
};

const handleRoadmapError = (
    res,
    error,
    fallbackMessage
) => {
    if (
        error.status === 400 ||
        error.status === 401 ||
        error.status === 403 ||
        error.status === 404
    ) {
        return res.status(error.status).json({
            error: error.message
        });
    }

    console.error(
        fallbackMessage,
        error
    );

    return res.status(500).json({
        error: fallbackMessage
    });
};

module.exports = app => {
    app.get(
        "/api/roadmap",
        async (req, res) => {
            try {
                const supabase =
                    createSupabaseAdminClient();

                const {
                    data,
                    error
                } = await supabase
                    .from("roadmap_items")
                    .select(
                        "id, icon, title, description, " +
                        "tasks, status, sort_order, " +
                        "created_at, updated_at"
                    )
                    .order(
                        "sort_order",
                        { ascending: true }
                    )
                    .order(
                        "id",
                        { ascending: true }
                    );

                if (error) {
                    throw error;
                }

                return res.json({
                    items: data || []
                });
            } catch (error) {
                return handleRoadmapError(
                    res,
                    error,
                    "Could not load roadmap."
                );
            }
        }
    );

    app.post(
        "/api/roadmap",
        async (req, res) => {
            try {
                await requireRoadmapAdmin(req);

                const item =
                    sanitizeRoadmapItem(
                        req.body
                    );

                const supabase =
                    createSupabaseAdminClient();

                const {
                    data,
                    error
                } = await supabase
                    .from("roadmap_items")
                    .insert(item)
                    .select()
                    .single();

                if (error) {
                    throw error;
                }

                return res
                    .status(201)
                    .json({
                        item: data
                    });
            } catch (error) {
                return handleRoadmapError(
                    res,
                    error,
                    "Could not create roadmap item."
                );
            }
        }
    );

    app.patch(
        "/api/roadmap/:id",
        async (req, res) => {
            try {
                await requireRoadmapAdmin(req);

                const id =
                    Number(req.params.id);

                if (
                    !Number.isSafeInteger(id) ||
                    id < 1
                ) {
                    const error = new Error(
                        "Invalid roadmap item ID."
                    );
                    error.status = 400;
                    throw error;
                }

                const item =
                    sanitizeRoadmapItem(
                        req.body
                    );

                const supabase =
                    createSupabaseAdminClient();

                const {
                    data,
                    error
                } = await supabase
                    .from("roadmap_items")
                    .update({
                        ...item,
                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq("id", id)
                    .select()
                    .maybeSingle();

                if (error) {
                    throw error;
                }

                if (!data) {
                    const error = new Error(
                        "Roadmap item not found."
                    );
                    error.status = 404;
                    throw error;
                }

                return res.json({
                    item: data
                });
            } catch (error) {
                return handleRoadmapError(
                    res,
                    error,
                    "Could not update roadmap item."
                );
            }
        }
    );

    app.delete(
        "/api/roadmap/:id",
        async (req, res) => {
            try {
                await requireRoadmapAdmin(req);

                const id =
                    Number(req.params.id);

                if (
                    !Number.isSafeInteger(id) ||
                    id < 1
                ) {
                    const error = new Error(
                        "Invalid roadmap item ID."
                    );
                    error.status = 400;
                    throw error;
                }

                const supabase =
                    createSupabaseAdminClient();

                const {
                    data,
                    error
                } = await supabase
                    .from("roadmap_items")
                    .delete()
                    .eq("id", id)
                    .select("id")
                    .maybeSingle();

                if (error) {
                    throw error;
                }

                if (!data) {
                    const error = new Error(
                        "Roadmap item not found."
                    );
                    error.status = 404;
                    throw error;
                }

                return res.status(204).end();
            } catch (error) {
                return handleRoadmapError(
                    res,
                    error,
                    "Could not delete roadmap item."
                );
            }
        }
    );
};