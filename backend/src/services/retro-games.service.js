const { AwsClient } = require("aws4fetch");
const BUCKET_NAME = "retro-gaming";
const ROMS_PATH = "roms";
const COVERS_PATH = "cover";
const EMULATOR_DATA_PATH = "emulatorjs/data";
const ROM_FORMATS = {
    n64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    z64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    v64: { core: "n64", system: "Nintendo 64", systemShort: "N64" },
    sfc: { core: "snes", system: "Super Nintendo", systemShort: "SNES" },
    smc: { core: "snes", system: "Super Nintendo", systemShort: "SNES" },
    md: { core: "segaMD", system: "Sega Genesis", systemShort: "Sega Genesis" },
    gba: { core: "gba", system: "Game Boy Advance", systemShort: "Game Boy Advance" }
};
const COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const STORAGE_PAGE_SIZE = 1000;

const ENABLE_EXTERNAL_STORAGE = false;
const EXTERNAL_PLATFORMS = {
    ps1: {
        romPath: "roms/psx/",
        coverPath: "psx",
        extensions: ["chd"],
        core: "psx",
        system: "PlayStation",
        systemShort: "PS1"
    }
};

const externalStorageClient = ENABLE_EXTERNAL_STORAGE
    ? new AwsClient({
        accessKeyId: process.env.RETRO_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.RETRO_S3_SECRET_ACCESS_KEY,
        region: process.env.RETRO_S3_REGION,
        service: "s3"
    })
    : null;

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

const encodeStoragePath = path => path
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");

const decodeXml = value => value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const getXmlValues = (xml, tagName) => {
    const expression = new RegExp(
        `<${tagName}>([\\s\\S]*?)</${tagName}>`,
        "g"
    );

    return [...xml.matchAll(expression)]
        .map(match => decodeXml(match[1]));
};

const getExternalObjectUrl = path => {
    const endpoint = process.env.RETRO_S3_ENDPOINT.replace(/\/+$/, "");
    const bucket = encodeURIComponent(process.env.RETRO_S3_BUCKET);

    return `${endpoint}/${bucket}/${encodeStoragePath(path)}`;
};

const getSignedExternalUrl = async path => {
    const url = new URL(getExternalObjectUrl(path));

    url.searchParams.set("X-Amz-Expires", "21600");

    const signedRequest = await externalStorageClient.sign(
        url.toString(),
        {
            method: "GET",
            aws: {
                signQuery: true
            }
        }
    );

    return signedRequest.url;
};

const listExternalFiles = async (prefix, extensions) => {
    const files = [];
    let continuationToken = null;

    do {
        const endpoint = process.env.RETRO_S3_ENDPOINT.replace(/\/+$/, "");
        const bucket = encodeURIComponent(process.env.RETRO_S3_BUCKET);
        const url = new URL(`${endpoint}/${bucket}`);

        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        url.searchParams.set("max-keys", "1000");

        if (continuationToken) {
            url.searchParams.set(
                "continuation-token",
                continuationToken
            );
        }

        const response = await externalStorageClient.fetch(
            url.toString(),
            {
                method: "GET"
            }
        );

        const xml = await response.text();

        if (!response.ok) {
            throw new Error(
                `External storage listing failed (${response.status}): ${xml}`
            );
        }

        const keys = getXmlValues(xml, "Key");

        for (const key of keys) {
            const extension = key
                .split(".")
                .pop()
                ?.toLocaleLowerCase();

            if (extensions.includes(extension)) {
                files.push(key);
            }
        }

        const isTruncated =
            getXmlValues(xml, "IsTruncated")[0] === "true";

        continuationToken = isTruncated
            ? getXmlValues(xml, "NextContinuationToken")[0] || null
            : null;

        if (isTruncated && !continuationToken) {
            throw new Error(
                "External storage returned a truncated listing without a continuation token."
            );
        }
    } while (continuationToken);

    return files;
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
    
    //****************** */
    const externalGames = [];

    if (ENABLE_EXTERNAL_STORAGE) {
        for (const [platformId, platform] of Object.entries(EXTERNAL_PLATFORMS)) {
            const externalFiles = await listExternalFiles(
                platform.romPath,
                platform.extensions
            );

            for (const path of externalFiles) {
                const fileName = path.split("/").pop();

                if (!fileName) continue;

                const title = fileName
                    .replace(/\.[^.]+$/, "")
                    .replace(/_/g, " ");

                const coverStem =
                    `${platform.coverPath}/${fileName.replace(/\.[^.]+$/, "")}`
                        .toLocaleLowerCase();

                const game = {
                    title,
                    path,
                    url: await getSignedExternalUrl(path),
                    coverUrl: coversByName.get(coverStem) || null,
                    platformId,
                    core: platform.core,
                    system: platform.system,
                    systemShort: platform.systemShort,
                    source: "external"
                };

                externalGames.push(game);
                roms.push(game);
            }
        }
    }

    roms.sort((first, second) => first.title.localeCompare(second.title));
    const platforms = rootFolders
        .map(id => ({ id, name: id }));

    for (const game of externalGames) {
        if (!platforms.some(platform => platform.id === game.platformId)) {
            platforms.push({
                id: game.platformId,
                name: game.system
            });
        }
    }

    platforms.sort((first, second) =>
        first.name.localeCompare(second.name)
    );

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
