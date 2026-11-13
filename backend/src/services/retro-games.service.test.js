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

test("lists supported retro ROMs and builds EmulatorJS URLs", async () => {
    const supabase = createStorage({
        cover: [
            { id: "cover-1", metadata: { size: 10 }, name: "Super Mario 64 (Europe).webp" }
        ],
        roms: [
            { id: null, metadata: null, name: "n64" },
            { id: null, metadata: null, name: "snes" },
            { id: "1", metadata: { size: 10 }, name: "Super Mario 64 (Europe).n64" },
            { id: "2", metadata: { size: 10 }, name: "not-a-rom.nes" }
        ],
        "roms/n64": [
            { id: null, metadata: null, name: "Europe" }
        ],
        "roms/n64/Europe": [
            { id: "3", metadata: { size: 10 }, name: "Zelda_Ocarina.z64" }
        ],
        "roms/snes": [
            { id: "4", metadata: { size: 10 }, name: "Chrono_Trigger.sfc" }
        ]
    });

    const result = await getRetroGames(supabase);

    assert.deepEqual(result.games.map(game => game.title), [
        "Chrono Trigger",
        "Super Mario 64 (Europe)",
        "Zelda Ocarina"
    ]);
    assert.equal(result.games[0].core, "snes");
    assert.equal(result.games[0].systemShort, "SNES");
    assert.equal(result.games[0].platformId, "snes");
    assert.equal(result.games[1].core, "n64");
    assert.equal(result.games[1].platformId, null);
    assert.equal(result.games[2].path, "roms/n64/Europe/Zelda_Ocarina.z64");
    assert.equal(result.games[2].platformId, "n64");
    assert.deepEqual(result.platforms, [
        { id: "n64", name: "n64" },
        { id: "snes", name: "snes" }
    ]);
    assert.equal(
        result.games[1].url,
        "https://storage.example/retro-gaming/roms/Super Mario 64 (Europe).n64"
    );
    assert.equal(
        result.games[1].coverUrl,
        "https://storage.example/retro-gaming/cover/Super Mario 64 (Europe).webp"
    );
    assert.equal(result.games[2].coverUrl, null);
    assert.deepEqual(result.emulator, {
        loaderUrl: "https://storage.example/retro-gaming/emulatorjs/data/loader.js",
        dataPath: "https://storage.example/retro-gaming/emulatorjs/data/"
    });
});

test("surfaces Supabase listing errors instead of returning an empty catalog", async () => {
    const error = new Error("Storage listing failed");
    await assert.rejects(getRetroGames(createStorage({ roms: error })), error);
});
