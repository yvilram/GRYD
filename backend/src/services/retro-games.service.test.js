const assert = require("node:assert/strict");
const test = require("node:test");
const { getRetroGames } = require("./retro-games.service");

const createStorage = listings => ({
    storage: {
        from(bucketName) {
            assert.equal(bucketName, "retro-gaming");
            return {
                async list(folder) {
                    if (listings[folder] instanceof Error) {
                        return { data: null, error: listings[folder] };
                    }
                    return { data: listings[folder] || [], error: null };
                },
                getPublicUrl(path) {
                    return {
                        data: { publicUrl: `https://storage.example/${bucketName}/${path}` }
                    };
                }
            };
        }
    }
});

test("lists nested Nintendo 64 ROMs and builds EmulatorJS URLs", async () => {
    const supabase = createStorage({
        cover: [
            { id: "cover-1", metadata: { size: 10 }, name: "Super Mario 64 (Europe).webp" }
        ],
        roms: [
            { id: null, metadata: null, name: "Europe" },
            { id: "1", metadata: { size: 10 }, name: "Super Mario 64 (Europe).n64" },
            { id: "2", metadata: { size: 10 }, name: "not-a-rom.nes" }
        ],
        "roms/Europe": [
            { id: "3", metadata: { size: 10 }, name: "Zelda_Ocarina.z64" }
        ]
    });

    const result = await getRetroGames(supabase);

    assert.deepEqual(result.games.map(game => game.title), [
        "Super Mario 64 (Europe)",
        "Zelda Ocarina"
    ]);
    assert.equal(result.games[1].path, "roms/Europe/Zelda_Ocarina.z64");
    assert.equal(
        result.games[0].url,
        "https://storage.example/retro-gaming/roms/Super Mario 64 (Europe).n64"
    );
    assert.equal(
        result.games[0].coverUrl,
        "https://storage.example/retro-gaming/cover/Super Mario 64 (Europe).webp"
    );
    assert.equal(result.games[1].coverUrl, null);
    assert.deepEqual(result.emulator, {
        core: "n64",
        loaderUrl: "https://storage.example/retro-gaming/emulatorjs/data/loader.js",
        dataPath: "https://storage.example/retro-gaming/emulatorjs/data/"
    });
});

test("surfaces Supabase listing errors instead of returning an empty catalog", async () => {
    const error = new Error("Storage listing failed");
    await assert.rejects(getRetroGames(createStorage({ roms: error })), error);
});
