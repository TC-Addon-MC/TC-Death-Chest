import { world, system } from "@minecraft/server";
import { ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";


const TC_DEBUG = true;


const TC_VOID_TRACK_Y = -65;
const TC_VOID_TRACK_Y_END = 0;
const TC_SNAPSHOT_KEY = "void_snapshot";
const TC_DEFAULT_FORMAT = "§c§l☠ DEATH CHEST ☠\n§f/Player/ §7| §e/Time/\n§b/X/ /Y/ /Z/ §7| §d/Dim/";
const TC_FORMAT_KEY = "death_chest_format_string";


const TC_ChestJOINED_PROPERTY = "has_joined_before";
world.afterEvents.playerSpawn.subscribe((event) => {
    const { player, initialSpawn } = event;

    if (!initialSpawn) return;

    const hasJoinedBefore = player.getDynamicProperty(TC_ChestJOINED_PROPERTY);

    if (!hasJoinedBefore) {

        player.setDynamicProperty(TC_ChestJOINED_PROPERTY, true);

        player.sendMessage(
            `§6[TC Death Chest] §fThank you for using my TC Death Chest addon. ` +
            `This addon automatically creates a secure chest when you die, even if you fall into the void, so your items are never lost. ` +
            `§eHow to configure: §fUse an item named "./settingTC" (Operator only) to open the settings menu and customize the chest display format using tags like /Player/, /Time/, /X/, /Y/, /Z/, /Dim/. ` +
            `I will continue improving it in the future. ` +
            `\nIf you’d like to support me, you can donate via PayPal: §b§llikavn1919@gmail.com.`
        );
    }
});

function TC_showDeathConfigMenu(player) {
    const rawFormat = world.getDynamicProperty(TC_FORMAT_KEY);
    const currentFormat = (rawFormat && rawFormat !== "") ? rawFormat : TC_DEFAULT_FORMAT;
    const form = new ModalFormData()
        .title("§lDeath Chests Settings")

        .textField(
            `Current Format:\n===============================\n ${currentFormat}\n==============================\n§7Tags: /Player/, /Time/, /X/, /Y/, /Z/, /Dim/ \n§eUse "\\n" for a new line`,
            "Enter format here...",
            { defaultValue: rawFormat || "" }
        );
    form.show(player).then((response) => {
        if (response.canceled) return;

        const format = response.formValues[0];


        world.setDynamicProperty(TC_FORMAT_KEY, format);

        player.sendMessage("§aDeath Chest configuration updated!");
    });
}

function TC_applyFormat(format, data) {
    return format
        .replaceAll("\\n", "\n")
        .replaceAll("/Player/", data.player)
        .replaceAll("/Time/", data.time)
        .replaceAll("/X/", data.x)
        .replaceAll("/Y/", data.y)
        .replaceAll("/Z/", data.z)
        .replaceAll("/Dim/", data.dimension); //
}

world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    if (!player || player.typeId !== "minecraft:player") return;

    const item = event.itemStack;
    if (!item) return;

    if (item.nameTag === "./settingTC") {
        const isAdmin = player.playerPermissionLevel;

        if (isAdmin == 2)
            TC_showDeathConfigMenu(player);
    }
});


system.runInterval(() => {

    for (const player of world.getPlayers()) {
        let TC_voidLimit;

        if (player.dimension.id === "minecraft:the_end") {
            TC_voidLimit = TC_VOID_TRACK_Y_END;
        } else {
            TC_voidLimit = TC_VOID_TRACK_Y;
        }

        if (player.location.y >= TC_voidLimit) {
            if (player.getDynamicProperty(TC_SNAPSHOT_KEY)) {
                player.setDynamicProperty(TC_SNAPSHOT_KEY, undefined);
            }
            continue;
        }

        if (player.getDynamicProperty(TC_SNAPSHOT_KEY)) continue;

        const inv = player.getComponent("inventory")?.container;
        if (!inv) continue;

        const snapshot = [];

        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (item) {
                snapshot.push({
                    typeId: item.typeId,
                    amount: item.amount
                });
            }
        }

        player.setDynamicProperty(TC_SNAPSHOT_KEY, JSON.stringify(snapshot));
    }

}, 20);


function debug(msg) {
    if (TC_DEBUG) {
        console.warn("[DEATH_DEBUG] " + msg);
    }
}

world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (dead.typeId !== "minecraft:player") return;
    let TC_voidLimit;

    if (dead.dimension.id === "minecraft:the_end") {
        TC_voidLimit = TC_VOID_TRACK_Y_END;
    } else {
        TC_voidLimit = TC_VOID_TRACK_Y;
    }

    if (dead.location.y < TC_voidLimit) {
        TC_handleVoidDeath(dead);
        return;
    }
    TC_clearDangerBlocks(dead.dimension, {
        x: Math.floor(dead.location.x),
        y: Math.floor(dead.location.y),
        z: Math.floor(dead.location.z)
    });
    const dimension = dead.dimension;

    const limits = TC_getDimensionLimits(dead.dimension);

    let x = Math.floor(dead.location.x);
    let y = Math.floor(dead.location.y);
    let z = Math.floor(dead.location.z);

    if (y < limits.minY) {
        const spawn = dead.getSpawnPoint();
        if (spawn) {
            x = Math.floor(spawn.x);
            y = Math.floor(spawn.y);
            z = Math.floor(spawn.z);
        } else {
            y = limits.minY + 1;
        }
    }

    if (y > limits.maxY) {
        y = limits.maxY - 1;
    }

    const deathLocation = { x, y, z };
    let centerBlock;

    try {
        centerBlock = dimension.getBlock(deathLocation);
    } catch {
        return;
    }

    let TC_chestLocation;

    if (centerBlock && centerBlock.typeId === "minecraft:air") {
        TC_chestLocation = {
            x: deathLocation.x,
            y: deathLocation.y,
            z: deathLocation.z
        };
    }
    else {
        TC_chestLocation = TC_findChestLocation(dimension, dead.location);
    }
    system.runTimeout(() => {

        const items = dimension.getEntities({
            type: "minecraft:item",
            location: deathLocation,
            maxDistance: 5
        });

        if (items.length === 0) return;

        const itemStacks = [];

        for (const itemEntity of items) {

            const itemComp = itemEntity.getComponent("item");
            if (!itemComp) continue;

            itemStacks.push({
                stack: itemComp.itemStack,
                entity: itemEntity
            });
        }

        const totalStacks = itemStacks.length;
        let textSpawnLocation = {
            x: TC_chestLocation.x + 0.5,
            y: TC_chestLocation.y + 1.5,
            z: TC_chestLocation.z + 0.5
        };
        let TC_secondChestPos = null;
        if (totalStacks <= 27) {
            dimension.runCommand(
                `setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} barrel destroy`
            );
            textSpawnLocation = {
                x: TC_chestLocation.x + 0.5,
                y: TC_chestLocation.y + 0.5,
                z: TC_chestLocation.z + 0.5
            };
        }
        else {
            const check = TC_canPlaceDoubleChest(dimension, TC_chestLocation);

            if (!check.valid) {

                dimension.runCommand(`setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} chest destroy`);
                dimension.runCommand(`setblock ${TC_chestLocation.x + 1} ${TC_chestLocation.y} ${TC_chestLocation.z} chest destroy`);
                textSpawnLocation = {
                    x: TC_chestLocation.x + 1,
                    y: TC_chestLocation.y + 0.5,
                    z: TC_chestLocation.z + 0.5
                };
                TC_secondChestPos = {
                    x: TC_chestLocation.x + 1,
                    y: TC_chestLocation.y + 0.5,
                    z: TC_chestLocation.z + 0.5
                };
            } else {
                TC_secondChestPos = check.secondPos;
                dimension.runCommand(
                    `setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} chest ["minecraft:cardinal_direction"="${check.direction}"] destroy`
                );

                dimension.runCommand(
                    `setblock ${check.secondPos.x} ${check.secondPos.y} ${check.secondPos.z} chest ["minecraft:cardinal_direction"="${check.direction}"] destroy`
                );
                textSpawnLocation = {
                    x: (TC_chestLocation.x + check.secondPos.x) / 2 + 0.5,
                    y: TC_chestLocation.y + 0.5,
                    z: (TC_chestLocation.z + check.secondPos.z) / 2 + 0.5
                };
            }

        }
        const time = new Date();
        const timeString =
            ("0" + time.getHours()).slice(-2) + ":" +
            ("0" + time.getMinutes()).slice(-2) + ":" +
            ("0" + time.getSeconds()).slice(-2);

        const text = dimension.spawnEntity("tc:text_display", textSpawnLocation);
        const deathTimestamp = Date.now();
        text.addTag(`death_time:${deathTimestamp}`);
        text.addTag(`death_loc:${TC_chestLocation.x},${TC_chestLocation.y},${TC_chestLocation.z}`);
        text.addTag(`death_player:${dead.name}`);

        if (TC_secondChestPos) {
            text.addTag(`death_loc_2:${TC_secondChestPos.x},${TC_secondChestPos.y},${TC_secondChestPos.z}`);
            text.addTag("double");
        }
        const dimName = dead.dimension.id.replace("minecraft:", "");
        text.nameTag =
            "§c§l☠ DEATH CHEST ☠\n" +
            "§f" + dead.name + " §7| §e0s\n" +
            "§b" + TC_chestLocation.x + " " + TC_chestLocation.y + " " + TC_chestLocation.z +
            " §7| §d" + dimName;
        system.runTimeout(() => {

            const chestBlock = dimension.getBlock(TC_chestLocation);
            if (!chestBlock) return;

            const chestInv = chestBlock.getComponent("inventory")?.container;
            if (!chestInv) return;

            for (const data of itemStacks) {
                const leftover = chestInv.addItem(data.stack);
                if (!leftover) {
                    data.entity.remove();
                }
            }

        }, 1);

    }, 3);
});

world.afterEvents.entityDie.subscribe((event) => {

    const dead = event.deadEntity;
    if (!dead || dead.typeId !== "minecraft:player") return;

    const { x, y, z } = dead.location;
    const dimId = dead.dimension.id.replace("minecraft:", "");

    const rx = Math.floor(x);
    const ry = Math.floor(y);
    const rz = Math.floor(z);

    const time = new Date();
    const timeString =
        ("0" + time.getHours()).slice(-2) + ":" +
        ("0" + time.getMinutes()).slice(-2) + ":" +
        ("0" + time.getSeconds()).slice(-2);

    const paper = new ItemStack("minecraft:paper", 1);

    paper.nameTag = "§c§l☠ Death Location ☠";

    paper.setLore([
        `§fPlayer: §e${dead.name}`,
        `§fTime: §6${timeString}`,
        `§fX: §b${rx}`,
        `§fY: §b${ry}`,
        `§fZ: §b${rz}`,
        `§fDimension: §d${dimId}`,
        `§7--------------------`,
        `§aYour items are safe in a chest!`
    ]);

    // Delay 10 ticks để đảm bảo player đã respawn
    system.runTimeout(() => {

        const inv = dead.getComponent("minecraft:inventory")?.container;
        if (!inv) return;

        inv.addItem(paper);

    }, 10);
});
function TC_clearDangerBlocks(dimension, center, radius = 2) {

    for (let x = center.x - radius; x <= center.x + radius; x++) {
        for (let y = center.y - radius; y <= center.y + radius; y++) {
            for (let z = center.z - radius; z <= center.z + radius; z++) {

                const block = dimension.getBlock({ x, y, z });
                if (!block) continue;

                if (
                    block.typeId === "minecraft:lava" ||
                    block.typeId === "minecraft:flowing_lava"
                ) {
                    dimension.runCommand(
                        `setblock ${x} ${y} ${z} air`
                    );
                }
            }
        }
    }
}
function TC_formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function TC_isReplaceable(typeId) {
    return (
        typeId === "minecraft:air" ||
        typeId === "minecraft:water" ||
        typeId === "minecraft:flowing_water" ||
        typeId === "minecraft:lava" ||
        typeId === "minecraft:flowing_lava"
    );
}

function TC_canPlaceDoubleChest(dimension, loc) {

    const possibleDirections = ["north", "south", "east", "west"];

    for (const dir of possibleDirections) {

        let offsets = [];

        if (dir === "north" || dir === "south") {
            offsets = [
                { x: 1, z: 0 },
                { x: -1, z: 0 }
            ];
        }
        else {
            offsets = [
                { x: 0, z: 1 },
                { x: 0, z: -1 }
            ];
        }

        for (const offset of offsets) {

            const secondPos = {
                x: loc.x + offset.x,
                y: loc.y,
                z: loc.z + offset.z
            };

            const block = dimension.getBlock(secondPos);
            if (!block) continue;

            if (TC_isReplaceable(block.typeId)) {
                return {
                    valid: true,
                    direction: dir,
                    secondPos
                };
            }
        }
    }

    return { valid: false };
}

function TC_getDimensionLimits(dimension) {
    const id = dimension.id;

    switch (id) {
        case "minecraft:overworld":
            return { minY: -64, maxY: 320 };

        case "minecraft:nether":
            return { minY: 0, maxY: 128 };

        case "minecraft:the_end":
            return { minY: 0, maxY: 256 };

        default:
            return { minY: -64, maxY: 320 };
    }
}

function TC_findChestLocation(dimension, center) {
    const centerX = Math.floor(center.x);
    const centerY = Math.floor(center.y);
    const centerZ = Math.floor(center.z);

    const centerBlock = dimension.getBlock({
        x: centerX,
        y: centerY,
        z: centerZ
    });

    if (centerBlock) {
        const typeId = centerBlock.typeId;

        if (
            typeId === "minecraft:air" ||
            typeId === "minecraft:water" ||
            typeId === "minecraft:flowing_water" ||
            typeId === "minecraft:lava" ||
            typeId === "minecraft:flowing_lava"
        ) {
            return { x: centerX, y: centerY, z: centerZ };
        }
    }

    let targetLoc = { x: centerX, y: centerY, z: centerZ };
    let foundPriority = 4;

    for (let x = centerX - 2; x <= centerX + 2; x++) {
        for (let y = centerY - 2; y <= centerY + 2; y++) {
            for (let z = centerZ - 2; z <= centerZ + 2; z++) {

                const block = dimension.getBlock({ x, y, z });
                if (!block) continue;

                const typeId = block.typeId;

                if (typeId === "minecraft:air") {
                    if (foundPriority > 1) {
                        targetLoc = { x, y, z };
                        foundPriority = 1;
                    }
                }
                else if (typeId === "minecraft:water" || typeId === "minecraft:flowing_water") {
                    if (foundPriority > 2) {
                        targetLoc = { x, y, z };
                        foundPriority = 2;
                    }
                }
                else if (typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava") {
                    if (foundPriority > 3) {
                        targetLoc = { x, y, z };
                        foundPriority = 3;
                    }
                }

                if (foundPriority === 1) break;
            }
            if (foundPriority === 1) break;
        }
        if (foundPriority === 1) break;
    }

    return targetLoc;
}

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    const block = event.block;
    if (!block) return;

    if (block.typeId !== "minecraft:chest" &&
        block.typeId !== "minecraft:barrel") return;

    TC_removeDeathTextByTag(block);
});

world.afterEvents.playerBreakBlock.subscribe((event) => {

    const brokenType = event.brokenBlockPermutation.type.id;

    if (brokenType !== "minecraft:chest" &&
        brokenType !== "minecraft:barrel") return;

    TC_removeDeathTextByTag(event.block);
});

function TC_removeDeathTextByTag(block) {
    const dimension = block.dimension;
    const loc = block.location;
    const tag1 = `death_loc:${loc.x},${loc.y},${loc.z}`;
    const tag2 = `death_loc_2:${loc.x},${loc.y},${loc.z}`;
    const texts = dimension.getEntities({
        type: "tc:text_display",
        location: loc,
        maxDistance: 1
    });
    for (const text of texts) {

        const isDouble = text.hasTag("double");

        if (isDouble) {
            if (text.hasTag(tag1) || text.hasTag(tag2)) {
                text.remove();
            }
        } else {
            if (text.hasTag(tag1)) {
                text.remove();
            }

        }
    }
}

function TC_updateDeathElapsed(text) {

    const tags = text.getTags();

    const timeTag = tags.find(t => t.startsWith("death_time:"));
    if (!timeTag) return;

    const deathTime = Number(timeTag.split(":")[1]);
    const elapsedMs = Date.now() - deathTime;
    const elapsedString = TC_formatElapsed(elapsedMs);

    const locTag = tags.find(t => t.startsWith("death_loc:"));
    if (!locTag) return;

    const playerTag = tags.find(t => t.startsWith("death_player:"));
    const dimTag = tags.find(t => t.startsWith("death_dim:"));

    const playerName = playerTag ? playerTag.split(":")[1] : "Unknown";
    const dimName = dimTag ? dimTag.split(":")[1] : "overworld";

    const coords = locTag.split(":")[1];
    const [x, y, z] = coords.split(",").map(Number);
    const currentFormat = world.getDynamicProperty(TC_FORMAT_KEY) || TC_DEFAULT_FORMAT;

    text.nameTag = TC_applyFormat(currentFormat, {
        player: playerName,
        time: elapsedString,
        x: x.toString(),
        y: y.toString(),
        z: z.toString(),
        dimension: dimName
    });
}

system.runInterval(() => {
    const dimensions = [
        world.getDimension("overworld"),
        world.getDimension("nether"),
        world.getDimension("the_end")
    ];

    for (const dimension of dimensions) {

        const texts = dimension.getEntities({
            type: "tc:text_display"
        });

        for (const text of texts) {

            TC_updateDeathElapsed(text);

            const tags = text.getTags();
            const tag1 = tags.find(t => t.startsWith("death_loc:"));
            const tag2 = tags.find(t => t.startsWith("death_loc_2:"));

            let chest1Destroyed = false;
            let chest2Destroyed = false;

            // ===== Kiểm tra rương 1 =====
            if (tag1) {

                const [, coords] = tag1.split(":");
                const [x, y, z] = coords.split(",").map(Number);

                const block = dimension.getBlock({ x, y, z });

                // Nếu chunk chưa load → block = undefined → bỏ qua
                if (!block) continue;

                if (block.typeId !== "minecraft:chest" &&
                    block.typeId !== "minecraft:barrel") {
                    chest1Destroyed = true;
                }
            }

            // ===== Kiểm tra rương 2 =====
            if (tag2) {

                const [, coords] = tag2.split(":");
                const [x, y, z] = coords.split(",").map(Number);

                const block = dimension.getBlock({ x, y, z });

                if (!block) continue;

                if (block.typeId !== "minecraft:chest") {
                    chest2Destroyed = true;
                }
            }

            // ===== Logic xóa =====
            if (tag2) {
                if (chest1Destroyed && chest2Destroyed) {
                    text.remove();
                }
            } else {
                if (chest1Destroyed) {
                    text.remove();
                }
            }
        }
    }

}, 20);

function TC_handleVoidDeath(dead) {

    const raw = dead.getDynamicProperty(TC_SNAPSHOT_KEY);
    if (!raw) return;

    let snapshot;

    try {
        snapshot = JSON.parse(raw);
    } catch {
        return;
    }

    dead.setDynamicProperty(TC_SNAPSHOT_KEY, undefined);

    const dimension = dead.dimension;
    const limits = TC_getDimensionLimits(dimension);

    let x = Math.floor(dead.location.x);
    let y = Math.floor(dead.location.y);
    let z = Math.floor(dead.location.z);

    if (y < limits.minY) y = limits.minY + 1;
    if (y > limits.maxY) y = limits.maxY - 1;

    // ✅ đổi const -> let để có thể gán lại
    let TC_chestLocation = { x, y, z };

    try {
        const block = dimension.getBlock(TC_chestLocation);

        // Nếu block không tồn tại hoặc không replace được
        if (!block || !TC_isReplaceable(block.typeId)) {

            // ✅ dùng dead.location thay vì spawn (không tồn tại)
            TC_chestLocation = TC_findChestLocation(dimension, dead.location);
        }

    } catch {
        return;
    }

    const totalStacks = snapshot.length;

    let textSpawnLocation = {
        x: TC_chestLocation.x + 0.5,
        y: TC_chestLocation.y + 0.5,
        z: TC_chestLocation.z + 0.5
    };

    let TC_secondChestPos = null;

    // ===== 1 CHEST =====
    if (totalStacks <= 27) {

        dimension.runCommand(
            `setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} barrel destroy`
        );

    }
    // ===== DOUBLE CHEST =====
    else {

        const check = TC_canPlaceDoubleChest(dimension, TC_chestLocation);

        if (!check.valid) {

            dimension.runCommand(
                `setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} chest destroy`
            );

            dimension.runCommand(
                `setblock ${TC_chestLocation.x + 1} ${TC_chestLocation.y} ${TC_chestLocation.z} chest destroy`
            );

            TC_secondChestPos = {
                x: TC_chestLocation.x + 1,
                y: TC_chestLocation.y,
                z: TC_chestLocation.z
            };

        } else {

            TC_secondChestPos = check.secondPos;

            dimension.runCommand(
                `setblock ${TC_chestLocation.x} ${TC_chestLocation.y} ${TC_chestLocation.z} chest ["minecraft:cardinal_direction"="${check.direction}"] destroy`
            );

            dimension.runCommand(
                `setblock ${TC_secondChestPos.x} ${TC_secondChestPos.y} ${TC_secondChestPos.z} chest ["minecraft:cardinal_direction"="${check.direction}"] destroy`
            );

            textSpawnLocation = {
                x: (TC_chestLocation.x + TC_secondChestPos.x) / 2 + 0.5,
                y: TC_chestLocation.y + 0.5,
                z: (TC_chestLocation.z + TC_secondChestPos.z) / 2 + 0.5
            };
        }
    }

    // ===== TEXT ENTITY =====
    const text = dimension.spawnEntity("tc:text_display", textSpawnLocation);
    const deathTimestamp = Date.now();

    text.addTag(`death_time:${deathTimestamp}`);
    text.addTag(`death_loc:${TC_chestLocation.x},${TC_chestLocation.y},${TC_chestLocation.z}`);
    text.addTag(`death_player:${dead.name}`);
    text.addTag(`death_dim:${dimension.id.replace("minecraft:", "")}`);

    if (TC_secondChestPos) {
        text.addTag(`death_loc_2:${TC_secondChestPos.x},${TC_secondChestPos.y},${TC_secondChestPos.z}`);
        text.addTag("double");
    }

    text.nameTag =
        "§c§l☠ VOID DEATH CHEST ☠\n" +
        "§f" + dead.name + " §7| §e0s\n" +
        "§b" + TC_chestLocation.x + " " + TC_chestLocation.y + " " + TC_chestLocation.z;

    // ===== ADD ITEMS =====
    system.runTimeout(() => {

        const block = dimension.getBlock(TC_chestLocation);
        if (!block) return;

        const inv = block.getComponent("inventory")?.container;
        if (!inv) return;

        for (const data of snapshot) {
            try {
                const item = new ItemStack(data.typeId, data.amount);
                inv.addItem(item);
            } catch {
                console.warn("Lỗi tạo item:", data.typeId);
            }
        }

    }, 1);
}