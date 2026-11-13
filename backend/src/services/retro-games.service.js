const BUCKET_NAME = "retro-gaming";
const ROMS_PATH = "roms";
const COVERS_PATH = "cover";
const EMULATOR_DATA_PATH = "emulatorjs/data";
const ROM_FORMATS = {
    n64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    z64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    v64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    sfc: { core: "snes", system: "Super Nintendo", systemShort: "SNES" },
    smc: { core: "snes", system: "Super Nintendo", systemShort: "SNES" }
};
const COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const STORAGE_PAGE_SIZE = 1000;

const listStorageFiles = async (bucket, rootPath) => {
    const folders = [rootPath];
    const files = [];
    const rootFolders = new Set();

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
                    if (folder === rootPath) rootFolders.add(entry.name);
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

    return { files, rootFolders: [...rootFolders] };
};

const getRetroGames = async supabase => {
    const bucket = supabase.storage.from(BUCKET_NAME);
    const { files: coverFiles } = await listStorageFiles(bucket, COVERS_PATH);
    const coversByName = new Map();

    for (const file of coverFiles) {
        const extension = file.entry.name.split(".").pop()?.toLowerCase();
        if (!COVER_EXTENSIONS.has(extension)) continue;

        const stem = file.relativePath.replace(/\.[^.]+$/, "").toLowerCase();
        if (!coversByName.has(stem)) {
            coversByName.set(stem, bucket.getPublicUrl(file.path).data.publicUrl);
        }
    }

    const { files: romFiles, rootFolders } = await listStorageFiles(bucket, ROMS_PATH);
    const roms = romFiles.flatMap(file => {
        const extension = file.entry.name.split(".").pop()?.toLowerCase();
        const format = ROM_FORMATS[extension];
        if (!format) return [];

        const stem = file.relativePath.replace(/\.[^.]+$/, "").toLowerCase();
        const { data: publicUrl } = bucket.getPublicUrl(file.path);
        return [{
            title: file.entry.name.replace(/\.[^.]+$/, "").replace(/_/g, " "),
            path: file.path,
            url: publicUrl.publicUrl,
            coverUrl: coversByName.get(stem) || null,
            platformId: file.relativePath.includes("/")
                ? file.relativePath.split("/")[0]
                : null,
            ...format
        }];
    });

    roms.sort((first, second) => first.title.localeCompare(second.title));
    const platforms = rootFolders
        .map(id => ({ id, name: id }))
        .sort((first, second) => first.name.localeCompare(second.name));

    const { data: loader } = bucket.getPublicUrl(`${EMULATOR_DATA_PATH}/loader.js`);
    const { data: emulatorData } = bucket.getPublicUrl(EMULATOR_DATA_PATH);

    return {
        games: roms,
        platforms,
        emulator: {
            loaderUrl: loader.publicUrl,
            dataPath: `${emulatorData.publicUrl.replace(/\/+$/, "")}/`
        }
    };
};

module.exports = { getRetroGames };
