const roadmapGrid =
    document.getElementById("roadmap-grid");

const roadmapLoading =
    document.getElementById("roadmap-loading");

const roadmapAddButton =
    document.getElementById("roadmap-add-item");

const roadmapDialog =
    document.getElementById("roadmap-dialog");

const roadmapForm =
    document.getElementById("roadmap-form");

const roadmapFormTitle =
    document.getElementById(
        "roadmap-form-title"
    );

const roadmapFormId =
    document.getElementById(
        "roadmap-form-id"
    );

const roadmapItemTitle =
    document.getElementById(
        "roadmap-form-item-title"
    );

const roadmapIcon =
    document.getElementById(
        "roadmap-form-icon"
    );

const roadmapStatus =
    document.getElementById(
        "roadmap-form-status"
    );

const roadmapOrder =
    document.getElementById(
        "roadmap-form-order"
    );

const roadmapDescription =
    document.getElementById(
        "roadmap-form-description"
    );

const roadmapTasks =
    document.getElementById(
        "roadmap-form-tasks"
    );

const roadmapFormError =
    document.getElementById(
        "roadmap-form-error"
    );

const roadmapFormSubmit =
    document.getElementById(
        "roadmap-form-submit"
    );

const roadmapFormClose =
    document.getElementById(
        "roadmap-form-close"
    );

const roadmapFormCancel =
    document.getElementById(
        "roadmap-form-cancel"
    );

const roadmapIconPreview =
    document.getElementById(
        "roadmap-icon-preview"
    );

const roadmapIconPickerToggle =
    document.getElementById(
        "roadmap-icon-picker-toggle"
    );

const roadmapIconPicker =
    document.getElementById(
        "roadmap-icon-picker"
    );

const roadmapIconSearch =
    document.getElementById(
        "roadmap-icon-search"
    );

const roadmapIconGrid =
    document.getElementById(
        "roadmap-icon-grid"
    );

const roadmapIconCount =
    document.getElementById(
        "roadmap-icon-count"
    );

const roadmapIconEmpty =
    document.getElementById(
        "roadmap-icon-empty"
    );

let roadmapLoaded = false;
let roadmapAdmin = false;
let roadmapSaving = false;
let roadmapItems = [];

let roadmapIconNames = [];
let roadmapIconsLoaded = false;

const ROADMAP_STATUS = {
    available: {
        label: "Available",
        className:
            "roadmap-status--available"
    },
    beta: {
        label: "Beta",
        className:
            "roadmap-status--beta"
    },
    "in-progress": {
        label: "In progress",
        className:
            "roadmap-status--progress"
    },
    planned: {
        label: "Planned",
        className:
            "roadmap-status--planned"
    }
};

const sortRoadmapItems = () => {
    roadmapItems.sort((first, second) => {
        const orderDifference =
            Number(first.sort_order) -
            Number(second.sort_order);

        if (orderDifference !== 0) {
            return orderDifference;
        }

        return Number(first.id) -
            Number(second.id);
    });
};

const createRoadmapCard = item => {
    const card =
        document.createElement("article");

    card.classList.add("roadmap-card");

    card.dataset.roadmapId =
        String(item.id);

    const header =
        document.createElement("div");

    header.classList.add(
        "roadmap-card__header"
    );

    const icon =
        document.createElement("i");

    icon.classList.add(
        "bi",
        item.icon
    );

    icon.setAttribute(
        "aria-hidden",
        "true"
    );

    const status =
        document.createElement("span");

    status.classList.add(
        "roadmap-status"
    );

    const statusConfig =
        ROADMAP_STATUS[item.status] ||
        ROADMAP_STATUS.planned;

    status.classList.add(
        statusConfig.className
    );

    status.textContent =
        statusConfig.label;

    const headerMeta =
        document.createElement("div");

    headerMeta.classList.add(
        "roadmap-card__meta"
    );

    headerMeta.appendChild(status);

    if (roadmapAdmin) {
        const actions =
            document.createElement("div");

        actions.classList.add(
            "roadmap-card__actions"
        );

        const editButton =
            document.createElement("button");

        editButton.type = "button";
        editButton.classList.add(
            "roadmap-card__action"
        );
        editButton.dataset.roadmapAction =
            "edit";
        editButton.dataset.roadmapId =
            String(item.id);
        editButton.setAttribute(
            "aria-label",
            `Edit ${item.title}`
        );
        editButton.innerHTML =
            '<i class="bi bi-pencil" aria-hidden="true"></i>';

        const deleteButton =
            document.createElement("button");

        deleteButton.type = "button";
        deleteButton.classList.add(
            "roadmap-card__action",
            "roadmap-card__action--delete"
        );
        deleteButton.dataset.roadmapAction =
            "delete";
        deleteButton.dataset.roadmapId =
            String(item.id);
        deleteButton.setAttribute(
            "aria-label",
            `Delete ${item.title}`
        );
        deleteButton.innerHTML =
            '<i class="bi bi-trash3" aria-hidden="true"></i>';

        actions.append(
            editButton,
            deleteButton
        );

        headerMeta.appendChild(actions);
    }

    header.append(
        icon,
        headerMeta
    );

    const title =
        document.createElement("h2");

    title.textContent =
        item.title;

    const description =
        document.createElement("p");

    description.textContent =
        item.description;

    const tasks =
        document.createElement("ul");

    const itemTasks =
        Array.isArray(item.tasks)
            ? item.tasks
            : [];

    itemTasks.forEach(task => {
        const listItem =
            document.createElement("li");

        listItem.textContent = task;

        tasks.appendChild(
            listItem
        );
    });

    card.append(
        header,
        title,
        description,
        tasks
    );

    return card;
};

const renderRoadmap = () => {
    sortRoadmapItems();

    const fragment =
        document.createDocumentFragment();

    roadmapItems.forEach(item => {
        fragment.appendChild(
            createRoadmapCard(item)
        );
    });

    roadmapGrid.replaceChildren(
        fragment
    );
};

const loadRoadmap = async () => {
    if (roadmapLoaded) {
        return;
    }

    roadmapLoading.hidden = false;

    roadmapLoading.textContent =
        "Loading roadmap…";

    try {
        const response = await fetch(
            `${API_URL}/api/roadmap`
        );

        const result =
            await response.json();

        if (!response.ok) {
            throw new Error(
                result.error ||
                "Could not load roadmap."
            );
        }

        roadmapItems =
            Array.isArray(result.items)
                ? result.items
                : [];

        renderRoadmap();

        roadmapLoaded = true;
        roadmapLoading.hidden = true;
    } catch (error) {
        console.error(
            "Could not load roadmap:",
            error
        );

        roadmapLoading.hidden = false;

        roadmapLoading.textContent =
            "Could not load the roadmap.";
    }
};

const checkRoadmapAdminAccess =
    async () => {
        if (!window.authStateReady) {
            roadmapAdmin = false;
            roadmapAddButton.hidden = true;
            return;
        }

        const authenticated =
            await window.authStateReady;

        if (!authenticated) {
            roadmapAdmin = false;
            roadmapAddButton.hidden = true;
            return;
        }

        try {
            const response = await fetch(
                `${API_URL}/api/developer/status`,
                {
                    credentials: "include"
                }
            );

            roadmapAdmin = response.ok;

            roadmapAddButton.hidden =
                !roadmapAdmin;

            if (roadmapLoaded) {
                renderRoadmap();
            }
        } catch (error) {
            roadmapAdmin = false;
            roadmapAddButton.hidden = true;

            console.error(
                "Could not check roadmap admin access:",
                error
            );
        }
    };

const getNextRoadmapOrder = () => {
    if (!roadmapItems.length) {
        return 10;
    }

    const highestOrder = Math.max(
        ...roadmapItems.map(item =>
            Number(item.sort_order) || 0
        )
    );

    return highestOrder + 10;
};


const updateRoadmapIconPreview = iconName => {
    const icon =
        document.createElement("i");

    icon.classList.add(
        "bi",
        iconName
    );

    icon.setAttribute(
        "aria-hidden",
        "true"
    );

    roadmapIconPreview.replaceChildren(
        icon
    );
};

const selectRoadmapIcon = iconName => {
    roadmapIcon.value = iconName;

    updateRoadmapIconPreview(
        iconName
    );

    roadmapIconGrid
        .querySelectorAll(
            "[data-roadmap-icon]"
        )
        .forEach(button => {
            const selected =
                button.dataset.roadmapIcon ===
                iconName;

            button.classList.toggle(
                "is-selected",
                selected
            );

            button.setAttribute(
                "aria-selected",
                String(selected)
            );
        });
};

const renderRoadmapIcons = (
    query = ""
) => {
    const normalizedQuery =
        query
            .trim()
            .toLocaleLowerCase();

    const filteredIcons =
        roadmapIconNames.filter(
            iconName =>
                !normalizedQuery ||
                iconName.includes(
                    normalizedQuery
                )
        );

    const fragment =
        document.createDocumentFragment();

    filteredIcons.forEach(iconName => {
        const button =
            document.createElement(
                "button"
            );

        button.type = "button";

        button.classList.add(
            "roadmap-icon-option"
        );

        button.dataset.roadmapIcon =
            `bi-${iconName}`;

        button.setAttribute(
            "role",
            "option"
        );

        button.setAttribute(
            "aria-label",
            iconName
        );

        const selected =
            roadmapIcon.value ===
            `bi-${iconName}`;

        button.setAttribute(
            "aria-selected",
            String(selected)
        );

        if (selected) {
            button.classList.add(
                "is-selected"
            );
        }

        const icon =
            document.createElement("i");

        icon.classList.add(
            "bi",
            `bi-${iconName}`
        );

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        const name =
            document.createElement("span");

        name.textContent = iconName;

        button.append(
            icon,
            name
        );

        fragment.appendChild(
            button
        );
    });

    roadmapIconGrid.replaceChildren(
        fragment
    );

    roadmapIconCount.textContent =
        `${filteredIcons.length.toLocaleString()} icon${filteredIcons.length === 1
            ? ""
            : "s"
        }`;

    roadmapIconEmpty.hidden =
        filteredIcons.length !== 0;
};

const loadRoadmapIcons = async () => {
    if (roadmapIconsLoaded) {
        return;
    }

    roadmapIconCount.textContent =
        "Loading icons…";

    const response = await fetch(
        "/assets/vendor/bootstrap-icons/bootstrap-icons.json"
    );

    if (!response.ok) {
        throw new Error(
            "Could not load Bootstrap Icons."
        );
    }

    const icons =
        await response.json();

    roadmapIconNames =
        Object.keys(icons)
            .sort((first, second) =>
                first.localeCompare(second)
            );

    roadmapIconsLoaded = true;

    renderRoadmapIcons(
        roadmapIconSearch.value
    );
};

const setRoadmapIconPickerOpen =
    async open => {
        roadmapIconPicker.hidden =
            !open;

        roadmapIconPickerToggle
            .setAttribute(
                "aria-expanded",
                String(open)
            );

        if (!open) {
            return;
        }

        try {
            await loadRoadmapIcons();

            roadmapIconSearch.focus();
        } catch (error) {
            console.error(
                "Could not load roadmap icons:",
                error
            );

            roadmapIconCount.textContent =
                "Could not load icons.";
        }
    };

const openAddRoadmapDialog = () => {
    if (
        !roadmapAdmin ||
        roadmapSaving
    ) {
        return;
    }

    roadmapForm.reset();

    roadmapFormId.value = "";

    roadmapFormTitle.textContent =
        "Add roadmap item";

    roadmapFormSubmit.textContent =
        "Create item";

    roadmapIcon.value =
        "bi-signpost-split";

    updateRoadmapIconPreview(
        roadmapIcon.value
    );

    roadmapIconSearch.value = "";

    roadmapIconPicker.hidden = true;

    roadmapIconPickerToggle.setAttribute(
        "aria-expanded",
        "false"
    );

    roadmapStatus.value =
        "planned";

    roadmapOrder.value =
        String(
            getNextRoadmapOrder()
        );

    roadmapFormError.hidden = true;
    roadmapFormError.textContent = "";

    roadmapDialog.showModal();

    roadmapItemTitle.focus();
};

const openEditRoadmapDialog = item => {
    if (
        !roadmapAdmin ||
        roadmapSaving ||
        !item
    ) {
        return;
    }

    roadmapForm.reset();

    roadmapFormId.value =
        String(item.id);

    roadmapFormTitle.textContent =
        "Edit roadmap item";

    roadmapFormSubmit.textContent =
        "Save changes";

    roadmapItemTitle.value =
        item.title || "";

    roadmapIcon.value =
        item.icon ||
        "bi-signpost-split";

    updateRoadmapIconPreview(
        roadmapIcon.value
    );

    roadmapStatus.value =
        item.status || "planned";

    roadmapOrder.value =
        String(
            Number(item.sort_order) || 0
        );

    roadmapDescription.value =
        item.description || "";

    roadmapTasks.value =
        Array.isArray(item.tasks)
            ? item.tasks.join("\n")
            : "";

    roadmapIconSearch.value = "";
    roadmapIconPicker.hidden = true;
    roadmapIconPickerToggle.setAttribute(
        "aria-expanded",
        "false"
    );

    roadmapFormError.hidden = true;
    roadmapFormError.textContent = "";

    roadmapDialog.showModal();
    roadmapItemTitle.focus();
};

const closeRoadmapDialog = () => {
    if (roadmapSaving) {
        return;
    }

    roadmapDialog.close();
};

const getRoadmapFormPayload = () => ({
    title:
        roadmapItemTitle.value.trim(),

    icon:
        roadmapIcon.value.trim(),

    status:
        roadmapStatus.value,

    sortOrder:
        Number(roadmapOrder.value),

    description:
        roadmapDescription.value.trim(),

    tasks:
        roadmapTasks.value
            .split("\n")
            .map(task => task.trim())
            .filter(Boolean)
});

const showRoadmapFormError =
    message => {
        roadmapFormError.textContent =
            message;

        roadmapFormError.hidden = false;
    };

const createRoadmapItem =
    async payload => {
        const response = await fetch(
            `${API_URL}/api/roadmap`,
            {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify(
                    payload
                )
            }
        );

        let result = {};

        try {
            result =
                await response.json();
        } catch {
            result = {};
        }

        if (!response.ok) {
            const error = new Error(
                result.error ||
                "Could not create roadmap item."
            );

            error.status =
                response.status;

            throw error;
        }

        if (!result.item) {
            throw new Error(
                "The server returned an invalid roadmap item."
            );
        }

        return result.item;
    };

const updateRoadmapItem = async (
    id,
    payload
) => {
    const response = await fetch(
        `${API_URL}/api/roadmap/${id}`,
        {
            method: "PATCH",
            credentials: "include",
            headers: {
                "Content-Type":
                    "application/json"
            },
            body: JSON.stringify(payload)
        }
    );

    const result = await response.json();

    if (!response.ok) {
        const error = new Error(
            result.error ||
            "Could not update roadmap item."
        );

        error.status = response.status;
        throw error;
    }

    if (!result.item) {
        throw new Error(
            "The server returned an invalid roadmap item."
        );
    }

    return result.item;
};

const deleteRoadmapItem = async id => {
    const response = await fetch(
        `${API_URL}/api/roadmap/${id}`,
        {
            method: "DELETE",
            credentials: "include"
        }
    );

    if (!response.ok) {
        let result = {};

        try {
            result = await response.json();
        } catch {
            result = {};
        }

        const error = new Error(
            result.error ||
            "Could not delete roadmap item."
        );

        error.status = response.status;
        throw error;
    }
};

roadmapGrid.addEventListener(
    "click",
    async event => {
        const button = event.target.closest(
            "[data-roadmap-action]"
        );

        if (
            !button ||
            !roadmapAdmin ||
            roadmapSaving
        ) {
            return;
        }

        const id = Number(
            button.dataset.roadmapId
        );

        const item = roadmapItems.find(
            roadmapItem =>
                Number(roadmapItem.id) === id
        );

        if (!item) {
            return;
        }

        if (
            button.dataset.roadmapAction ===
            "edit"
        ) {
            openEditRoadmapDialog(item);
            return;
        }

        if (
            button.dataset.roadmapAction !==
            "delete"
        ) {
            return;
        }

        const confirmed = window.confirm(
            `Delete ${item.title} from the roadmap?`
        );

        if (!confirmed) {
            return;
        }

        roadmapSaving = true;
        button.disabled = true;

        try {
            await deleteRoadmapItem(id);

            roadmapItems = roadmapItems.filter(
                roadmapItem =>
                    Number(roadmapItem.id) !== id
            );

            renderRoadmap();

            window.showAppNotice(
                `${item.title} removed from the roadmap.`
            );
        } catch (error) {
            console.error(
                "Could not delete roadmap item:",
                error
            );

            window.showAppNotice(
                error.message ||
                "Could not delete roadmap item.",
                "error"
            );
        } finally {
            roadmapSaving = false;
        }
    }
);

roadmapAddButton.addEventListener(
    "click",
    () => {
        openAddRoadmapDialog();
    }
);

roadmapFormClose.addEventListener(
    "click",
    () => {
        closeRoadmapDialog();
    }
);

roadmapFormCancel.addEventListener(
    "click",
    () => {
        closeRoadmapDialog();
    }
);

roadmapDialog.addEventListener(
    "cancel",
    event => {
        if (roadmapSaving) {
            event.preventDefault();
        }
    }
);

roadmapForm.addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        if (
            !roadmapAdmin ||
            roadmapSaving
        ) {
            return;
        }

        if (!roadmapForm.reportValidity()) {
            return;
        }

        const editingId = Number(
            roadmapFormId.value
        );

        const editing =
            Number.isSafeInteger(editingId) &&
            editingId > 0;

        roadmapSaving = true;
        roadmapFormSubmit.disabled = true;
        roadmapFormError.hidden = true;

        roadmapFormSubmit.textContent =
            editing
                ? "Saving…"
                : "Creating…";

        try {
            const payload =
                getRoadmapFormPayload();

            const item = editing
                ? await updateRoadmapItem(
                    editingId,
                    payload
                )
                : await createRoadmapItem(
                    payload
                );

            if (editing) {
                roadmapItems = roadmapItems.map(
                    roadmapItem =>
                        Number(roadmapItem.id) ===
                            editingId
                            ? item
                            : roadmapItem
                );
            } else {
                roadmapItems.push(item);
            }

            renderRoadmap();
            roadmapDialog.close();

            window.showAppNotice(
                editing
                    ? `${item.title} updated.`
                    : `${item.title} added to the roadmap.`
            );
        } catch (error) {
            console.error(
                editing
                    ? "Could not update roadmap item:"
                    : "Could not create roadmap item:",
                error
            );

            if (error.status === 401) {
                showRoadmapFormError(
                    "Your session has expired."
                );
            } else if (
                error.status === 403
            ) {
                roadmapAdmin = false;
                roadmapAddButton.hidden = true;
                renderRoadmap();

                showRoadmapFormError(
                    "Admin access is required."
                );
            } else {
                showRoadmapFormError(
                    error.message ||
                    (editing
                        ? "Could not update roadmap item."
                        : "Could not create roadmap item.")
                );
            }
        } finally {
            roadmapSaving = false;
            roadmapFormSubmit.disabled = false;

            if (roadmapDialog.open) {
                roadmapFormSubmit.textContent =
                    editing
                        ? "Save changes"
                        : "Create item";
            }
        }
    }
);

roadmapIconPickerToggle.addEventListener(
    "click",
    () => {
        void setRoadmapIconPickerOpen(
            roadmapIconPicker.hidden
        );
    }
);

roadmapIconSearch.addEventListener(
    "input",
    () => {
        renderRoadmapIcons(
            roadmapIconSearch.value
        );
    }
);

roadmapIconGrid.addEventListener(
    "click",
    event => {
        const button =
            event.target.closest(
                "[data-roadmap-icon]"
            );

        if (!button) {
            return;
        }

        selectRoadmapIcon(
            button.dataset.roadmapIcon
        );

        void setRoadmapIconPickerOpen(
            false
        );
    }
);

window.addEventListener(
    "auth:changed",
    ({ detail: { authenticated } }) => {
        if (!authenticated) {
            roadmapAdmin = false;
            roadmapAddButton.hidden = true;

            if (roadmapLoaded) {
                renderRoadmap();
            }

            if (roadmapDialog.open) {
                roadmapDialog.close();
            }

            return;
        }

        void checkRoadmapAdminAccess();
    }
);

document.addEventListener(
    "app:navigate",
    async ({ detail: { route } }) => {
        if (route !== "roadmap") {
            return;
        }

        await Promise.all([
            loadRoadmap(),
            checkRoadmapAdminAccess()
        ]);
    }
);