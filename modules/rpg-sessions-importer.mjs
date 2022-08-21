import RPGSessionsImporter from "./api.js"

Hooks.on("init", async () => {
    console.log("Initializing RPGSessions Importer");
    game.RpgSessionsImporter = RPGSessionsImporter
});

CONFIG.module = "RPGSessions Importer";

