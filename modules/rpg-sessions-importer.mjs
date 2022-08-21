import RPGSessionsImporter from "./api.js"

console.log("Hello World");
Hooks.on("init", async () => {
    console.log("Initializing RPGSessions Importer");
    game.RpgSessionsImporter = RPGSessionsImporter
});

CONFIG.module = "RPGSessions Importer";

