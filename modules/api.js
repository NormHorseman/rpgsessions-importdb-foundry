import { GetKristina } from '../kristina.js'

export default class RPGSessionsImporter {
    static async showDialog() {

        let actors = [];
        game.actors.forEach(actor => {
            actors.push(actor);
        });
        console.log(actors);
        let data = {};
        data.actors = actors;
        data.item = "HELLP";


        const html = await renderTemplate(`modules/rpgsessions-importer/templates/actorDialog.html`, data);


        let d = new Dialog({
            content: html,
            buttons: {
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Cancel'
                },
                yes: {
                    icon: '<i class="fas fa-check"></i>',
                    label: 'Submit',
                    callback: async (html) => {
                        let actorId = html.find('[name="actor-id"]').val();
                        let rpgsJsonId = html.find('[name="rpgs-json-id"]').val();
                        console.log(actorId, rpgsJsonId);
                        let actor = game.actors.getName(actorId);
                        if (!actor) {
                            actor = await game.ffg.ActorFFG.create({ name: actorId, type: "character" })
                        }
                        this.executeImport(actor, rpgsJsonId);
                    }
                },
            },
            close: () => {
                console.log('Example Dialog Closed');
            }
        }).render(true);
    }

    static async executeImport(actor, jsonId) {
        //jsonId = "6281cf580100969293ee4354"
        //actorId = "HgxONTtzrA0TNAk5";


        let rpgsJson = await GetRequest("https://api.rpgsessions.com/character/" + jsonId);
        //let rpgsJson = GetKristina();


        await this.importCharacteristics(rpgsJson, actor);
        await this.importSkills(rpgsJson, actor);

        let folderName = actor.name + " Imports";
        let folder = game.folders.getName(folderName);
        if (!folder) {
            folder = await Folder.create({ name: actor.name + " Imports", type: "Item" });
        }
        await this.importTalents(rpgsJson, actor, folder);
    }

    static async importCharacteristics(rpgsJson, actor) {
        rpgsJson.characteristics.forEach(async (c) => {
            let name = c.type.split(']')[1].trim(); //handle nds
            name = capitalizeFirstLetter(name);
            await actor.update({ [`data.attributes.${name}.value`]: c.value });
        });
    }

    static async importSkills(rpgsJson, actor) {
        rpgsJson.skills.forEach(async (skill) => {
            let name = skill.name;
            let json = { [`data.attributes.${name}.value`]: skill.ranks };
            await actor.update(json);
        });
    }

    static async importTalents(rpgsJson, actor, folder) {
        let talentHash = {};
        await rpgsJson.talents.talents.forEach(async (talent) => {
            let name = talent.name;

            name = name.replace(/[0-9]/g, '');
            name = name.trim();
            talent.name = name;

            if (talentHash[name]) {
                //Encountered Talent
                talentHash[name].ranks += 1;
                talentHash[name].hits += 1; //Track hits instead of ranks due to user mistakes
            } else {
                //New Talent
                talentHash[name] = talent;
                if (talent.ranked && talent.ranks == 0) {
                    talentHash[name].ranks = 1;
                }
                talentHash[name].hits = 1;
            }

        });

        //Create new talents
        console.log("Creating New Talents");
        await this.createNewTalents(talentHash, folder);
        console.log("Finished Creating New Talents");

        console.log("Start Creating Embedded");
        await this.CreateEmbeddedTalents(talentHash, actor);
        console.log("Finished Creating Embedded");


        //Update the talents with ranks
        let items = actor.items.filter(a => a.type == "talent")
        await items.forEach(async item => {
            let talent = talentHash[item.name];
            let ranks = Math.max(talent.hits, talent.ranks)

            try {
                let update = this.createTalentUpdate(item.id, item.data.data.ranked, ranks)
                await actor.updateEmbeddedDocuments("Item", update);
            } catch (e) {

                console.error(e);
                console.log(item);
                console.log(talentHash)
            }
        })
    }

    static async createNewTalents(talentHash, folder,) {
        let keys = Object.keys(talentHash);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let talent = talentHash[key];
            let name = talent.name;
            let existingTalent = game.items.getName(name);
            try {
                if (!existingTalent) {
                    let createdItem = await this.createTalent(name, talent, folder);
                    console.log(createdItem);
                } else {
                    console.log(existingTalent);
                }
            } catch (e) {
                console.log("Error with talent:");
                console.log(talent)
                console.error(e);
            }
        }
    }

    static async CreateEmbeddedTalents(talentHash, actor) {
        let keys = Object.keys(talentHash);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let talent = talentHash[key];
            let existingEmbedded = actor.items.getName(talent.name);
            if (!existingEmbedded) {
                let gameItem = game.items.getName(talent.name);
                let embeddedItem = await game.ffg.ItemFFG.create(gameItem.data, { parent: actor });
                console.log(embeddedItem);
            }
        }
    }

    static async importExistingTalent(actor, name, existingTalent, ranks, isRanked) {
        let myTalent = actor.items.getName(name);
        if (!myTalent) {
            existingTalent.data.data.ranks.current = ranks;
            myTalent = await game.ffg.ItemFFG.create(existingTalent.data, { parent: actor });
        }
        if (isRanked) {
            return this.createTalentUpdate(existingTalent.id, isRanked, ranks)
        }
    }

    static createTalentUpdate(id, ranked, ranks) {
        let updateData = [
            {
                _id: id,
                data: {
                    ranks: { current: ranks, ranked: ranked, min: 0 }
                },
            },
        ];
        return updateData;
    }

    static async createTalent(name, talent, folder) {
        let ranks = talent.ranks;
        let hits = talent.hits;
        let isRanked = talent.ranked
        if (ranks > 0 || talent.ranked) {
            isRanked = true;
        }
        //Used in case Rpg sessions messes up or users mess up
        if (hits > ranks && hits > 1) {
            isRanked = true;
            ranks = hits;
        }
        let newTalent = await game.ffg.ItemFFG.create({
            name: name,
            type: "talent",
            folder: folder,
            data: {
                description: talent.description,
                tier: parseInt(talent.xpCost/4),
                ranks: {
                    current: 1,
                    ranked: isRanked,
                    min: 0
                }
            }
        });
        return newTalent;
    }

    async importWeapons(rpgsJson, actor) {
        rpgsJson.weapons.forEach(async (weapon) => {
            try {
                let name = weapon.name;
                let existingWeapon = game.items.getName(name);
                if (existingWeapon) {
                    await importExistingWeapon(actor, name, existingTalent, ranks, isRanked);
                } else {
                    let newWeapon = await createWeapon(name, talent, isRanked);
                    newWeapon.data.data.ranks.current = ranks;
                    let created = await game.ffg.ItemFFG.create(newWeapon.data, { parent: actor });
                }
            } catch (e) {
                console.log("Error with talent:");
                console.log(talent)
                console.error(e);
            }
        });
    }

    async importExistingWeapon(actor, name, existingWeapon, ranks, isRanked) {
        let myWeapon = actor.items.getName(name);
        if (!myWeapon) {
            existingWeapon.data.data.ranks.current = ranks;
            myWeapon = await game.ffg.ItemFFG.create(existingWeapon.data, { parent: actor });
        }
        if (isRanked) {
            await actor.updateEmbeddedDocuments("Item", [
                {
                    _id: myWeapon.id,
                    data: {
                        ranks: { current: ranks, ranked: true, min: 0 }
                    },
                },
            ]);
        }
    }

    async createWeapon(name, weapon, isRanked) {
        let folder = game.folders.getName("Imports");
        let newWeapon = await game.ffg.ItemFFG.create({
            name: name, type: "weapon",
            description: weapon.description,
            folder: folder,
            data: {
                crit: {
                    value: weapon.crit,
                    type: 'Number', label: 'Critical Rating', abrev: 'Crit', adjusted: 0
                },
                damage: {
                    value: weapon.damage,
                    type: 'Number', label: 'Damage', abrev: 'Dam', adjusted: 0
                },

                ranks: {
                    current: 1,
                    ranked: isRanked,
                    min: 0
                }
            }
        });
        return newWeapon;
    }

    static KristinaJson() {
        return GetKristina();
    }

    static KristinaActor() {
        return game.actors.get("HgxONTtzrA0TNAk5");
    }
}

function iterateTalents() {
    let rpgsJson = game.RPGSessionsImporter.PrideJson();
    let talentNameHash = {};
    rpgsJson.talents.talents.forEach(async (talent) => {
        let name = talent.name;
        let ranks = talent.ranks;
        let isRanked = false;
        if (ranks > 0) {
            isRanked = true;
        }
        name = name.replace(/[0-9]/g, '');
        name = name.trim();
        console.log(name);
        let existingTalent = game.items.getName(name);
        if (existingTalent || talentNameHash[name]) {
            talentNameHash[name] += 1;
        } else {
            talentNameHash[name] = 1;
        }
    });
    console.log(talentNameHash);

}

async function addTalent(name) {

    let data = [game.items.getName(name).data];
    let actor = game.actors.getName("Charles");
    let created = await game.ffg.ItemFFG.create(data, { parent: actor });
}



function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function GetRequest(url) {
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('get', url, true);
        xhr.responseType = 'json';
        xhr.onload = function () {
            var status = xhr.status;
            if (status == 200) {
                resolve(xhr.response);
            } else {
                reject(status);
            }
        };
        xhr.send();
    });
}

async function schemaPageHandler() {
    try {
        var parser = new window.DOMParser();
        var remoteCode = await GetRequest('https://schema.org/docs/full.html');
        var sourceDoc = parser.parseFromString(remoteCode, 'text/html');
        var thingList = sourceDoc.getElementById("C.Thing");
        document.getElementById("structured-data-types").appendChild(thingList);
    } catch (error) {
        console.log("Error fetching remote HTML: ", error);
    }
}

async function importCharacter(id) {
    return axios.get("https://api.rpgsessions.com/character/" + id);
}