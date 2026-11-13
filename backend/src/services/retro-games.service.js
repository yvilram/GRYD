const BUCKET_NAME = "retro-gaming";
const ROMS_PATH = "roms";
const COVERS_PATH = "cover";
const EMULATOR_DATA_PATH = "emulatorjs/data";
const ROM_EXTENSIONS = new Set(["n64", "z64", "v64"]);
const COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const STORAGE_PAGE_SIZE = 1000;

const listStorageFiles = async (bucket, rootPath) => {
    const folders = [rootPath];
    const files = [];

    for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
        const folder = folders[folderIndex];
        let offset = 0;

        while (true) {
            const { data, error } = await bucket.list(folder, {
                limit: STORAGE_PAGE_SIZE,
                offset,
                sortBy: { column: "name", order: "asc" }
            });
            if (error) throw error;
            if (!Array.isArray(data)) {
                throw new Error("Supabase returned an invalid retro game listing.");
            }

            for (const entry of data) {
                const path = `${folder}/${entry.name}`;
                if (entry.id === null || entry.metadata === null) {
                    folders.push(path);
                    continue;
                }

                files.push({
                    entry,
                    path,
                    relativePath: path.slice(rootPath.length + 1)
                });
            }

            offset += data.length;
            if (data.length < STORAGE_PAGE_SIZE) break;
        }
    }

    return files;
};

const getRetroGames = async supabase => {
    const bucket = supabase.storage.from(BUCKET_NAME);
    const coverFiles = await listStorageFiles(bucket, COVERS_PATH);
    const coversByName = new Map();

    for (const file of coverFiles) {
        const extension = file.entry.name.split(".").pop()?.toLowerCase();
        if (!COVER_EXTENSIONS.has(extension)) continue;

        const stem = file.relativePath.replace(/\.[^.]+$/, "").toLowerCase();
        if (!coversByName.has(stem)) {
            coversByName.set(stem, bucket.getPublicUrl(file.path).data.publicUrl);
        }
    }

    const romFiles = await listStorageFiles(bucket, ROMS_PATH);
    const roms = romFiles.flatMap(file => {
        const extension = file.entry.name.split(".").pop()?.toLowerCase();
        if (!ROM_EXTENSIONS.has(extension)) return [];

        const stem = file.relativePath.replace(/\.[^.]+$/, "").toLowerCase();
        const { data: publicUrl } = bucket.getPublicUrl(file.path);
        return [{
            title: file.entry.name
                .replace(/\.(?:n64|z64|v64)$/i, "")
                .replace(/_/g, " "),
            path: file.path,
            url: publicUrl.publicUrl,
            coverUrl: coversByName.get(stem) || null
        }];
    });

    roms.sort((first, second) => first.title.localeCompare(second.title));

    const { data: loader } = bucket.getPublicUrl(`${EMULATOR_DATA_PATH}/loader.js`);
    const { data: emulatorData } = bucket.getPublicUrl(EMULATOR_DATA_PATH);

    return {
        games: roms,
        emulator: {
            core: "n64",
            loaderUrl: loader.publicUrl,
            dataPath: `${emulatorData.publicUrl.replace(/\/+$/, "")}/`
        }
    };
};

module.exports = { getRetroGames };
