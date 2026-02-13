/**
 * 自己的农场操作 - 收获/浇水/除草/除虫/铲除/种植/商店/巡田
 */

const protobuf = require('protobufjs');
const { CONFIG, PlantPhase, PHASE_NAMES } = require('./config');
const { types } = require('./proto');
const { sendMsgAsync, getUserState, networkEvents } = require('./network');
const { toLong, toNum, getServerTimeSec, toTimeSec, log, logWarn, sleep, pickIntervalMs, botEvents } = require('./utils');
const { getPlantNameBySeedId, getPlantName, getPlantExp, formatGrowTime, getPlantGrowTime } = require('./gameConfig');
const { getPlantingRecommendation } = require('../tools/calc-exp-yield');

// ============ 内部状态 ============
let isCheckingFarm = false;
let isFirstFarmCheck = true;
let farmCheckTimer = null;
let farmLoopRunning = false;
let lastAllLandsReply = null;
let lastFarmSummary = null;

const recentIncomingVisitAtMs = new Map();
const INCOMING_VISIT_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * 从 AllLandsReply 中提取“来访/作恶”痕迹（偷菜/放草/放虫），并通过 botEvents 上报给管理端。
 * @param {any} landsReply
 * @param {number} myGid
 */
function emitIncomingVisitsFromLandsReply(landsReply, myGid) {
    const lands = (landsReply && landsReply.lands) || [];
    const nowMs = Date.now();

    for (const land of lands) {
        const landId = toNum(land && land.id);
        const plant = land && land.plant;
        if (!plant) continue;

        const stealers = (plant.stealers || []).map(toNum).filter(Boolean);
        const weedOwners = (plant.weed_owners || []).map(toNum).filter(Boolean);
        const insectOwners = (plant.insect_owners || []).map(toNum).filter(Boolean);

        for (const gid of stealers) {
            if (!gid || gid === myGid) continue;
            const key = `${gid}:steal`;
            const last = recentIncomingVisitAtMs.get(key) || 0;
            if (nowMs - last < INCOMING_VISIT_DEDUPE_WINDOW_MS) continue;
            recentIncomingVisitAtMs.set(key, nowMs);
            botEvents.emit('visit', {
                direction: 'incoming',
                gid,
                name: null,
                ts: new Date().toISOString(),
                kind: 'steal',
                message: `偷菜痕迹 (地块#${landId})`,
            });
        }

        for (const gid of weedOwners) {
            if (!gid || gid === myGid) continue;
            const key = `${gid}:weed`;
            const last = recentIncomingVisitAtMs.get(key) || 0;
            if (nowMs - last < INCOMING_VISIT_DEDUPE_WINDOW_MS) continue;
            recentIncomingVisitAtMs.set(key, nowMs);
            botEvents.emit('visit', {
                direction: 'incoming',
                gid,
                name: null,
                ts: new Date().toISOString(),
                kind: 'weed',
                message: `放草痕迹 (地块#${landId})`,
            });
        }

        for (const gid of insectOwners) {
            if (!gid || gid === myGid) continue;
            const key = `${gid}:bug`;
            const last = recentIncomingVisitAtMs.get(key) || 0;
            if (nowMs - last < INCOMING_VISIT_DEDUPE_WINDOW_MS) continue;
            recentIncomingVisitAtMs.set(key, nowMs);
            botEvents.emit('visit', {
                direction: 'incoming',
                gid,
                name: null,
                ts: new Date().toISOString(),
                kind: 'bug',
                message: `放虫痕迹 (地块#${landId})`,
            });
        }
    }
}

// ============ 农场 API ============

// 操作限制更新回调 (由 friend.js 设置)
let onOperationLimitsUpdate = null;
function setOperationLimitsCallback(callback) {
    onOperationLimitsUpdate = callback;
}

async function getAllLands() {
    const body = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', body);
    const reply = types.AllLandsReply.decode(replyBody);
    // 更新操作限制
    if (reply.operation_limits && onOperationLimitsUpdate) {
        onOperationLimitsUpdate(reply.operation_limits);
    }
    return reply;
}

async function harvest(landIds) {
    const state = getUserState();
    const body = types.HarvestRequest.encode(types.HarvestRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
        is_all: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    return types.HarvestReply.decode(replyBody);
}

async function waterLand(landIds) {
    const state = getUserState();
    const body = types.WaterLandRequest.encode(types.WaterLandRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WaterLand', body);
    return types.WaterLandReply.decode(replyBody);
}

async function weedOut(landIds) {
    const state = getUserState();
    const body = types.WeedOutRequest.encode(types.WeedOutRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'WeedOut', body);
    return types.WeedOutReply.decode(replyBody);
}

async function insecticide(landIds) {
    const state = getUserState();
    const body = types.InsecticideRequest.encode(types.InsecticideRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Insecticide', body);
    return types.InsecticideReply.decode(replyBody);
}

// 普通肥料 ID
const NORMAL_FERTILIZER_ID = 1011;

/**
 * 施肥 - 必须逐块进行，服务器不支持批量
 * 游戏中拖动施肥间隔很短，这里用 50ms
 */
async function fertilize(landIds, fertilizerId = NORMAL_FERTILIZER_ID) {
    let successCount = 0;
    for (const landId of landIds) {
        try {
            const body = types.FertilizeRequest.encode(types.FertilizeRequest.create({
                land_ids: [toLong(landId)],
                fertilizer_id: toLong(fertilizerId),
            })).finish();
            await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
            successCount++;
        } catch (e) {
            // 施肥失败（可能肥料不足），停止继续
            break;
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return successCount;
}

async function removePlant(landIds) {
    const body = types.RemovePlantRequest.encode(types.RemovePlantRequest.create({
        land_ids: landIds.map(id => toLong(id)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'RemovePlant', body);
    return types.RemovePlantReply.decode(replyBody);
}

// ============ 商店 API ============

async function getShopInfo(shopId) {
    const body = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
        shop_id: toLong(shopId),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
    return types.ShopInfoReply.decode(replyBody);
}

async function buyGoods(goodsId, num, price) {
    const body = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
        goods_id: toLong(goodsId),
        num: toLong(num),
        price: toLong(price),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
    return types.BuyGoodsReply.decode(replyBody);
}

// ============ 种植 ============

function encodePlantRequest(seedId, landIds) {
    const writer = protobuf.Writer.create();
    const itemWriter = writer.uint32(18).fork();
    itemWriter.uint32(8).int64(seedId);
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
        idsWriter.int64(id);
    }
    idsWriter.ldelim();
    itemWriter.ldelim();
    return writer.finish();
}

/**
 * 种植 - 游戏中拖动种植间隔很短，这里用 50ms
 */
async function plantSeeds(seedId, landIds) {
    let successCount = 0;
    for (const landId of landIds) {
        try {
            const body = encodePlantRequest(seedId, [landId]);
            const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', body);
            types.PlantReply.decode(replyBody);
            successCount++;
        } catch (e) {
            logWarn('种植', `土地#${landId} 失败: ${e.message}`);
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return successCount;
}

/**
 * 从商店可购买种子中选择“最优种子”。
 * - forceLowestLevelCrop=true 时固定选择最低等级作物
 * - 否则尝试按经验效率推荐挑选；失败则走兜底策略
 * @param {number | null | undefined} landsCount
 * @returns {Promise<null | { goods: any; goodsId: number; seedId: number; price: number; requiredLevel: number }>}
 */
async function findBestSeed(landsCount) {
    const SEED_SHOP_ID = 2;
    const shopReply = await getShopInfo(SEED_SHOP_ID);
    if (!shopReply.goods_list || shopReply.goods_list.length === 0) {
        logWarn('商店', '种子商店无商品');
        return null;
    }

    const state = getUserState();
    const available = [];
    for (const goods of shopReply.goods_list) {
        if (!goods.unlocked) continue;

        let meetsConditions = true;
        let requiredLevel = 0;
        const conds = goods.conds || [];
        for (const cond of conds) {
            if (toNum(cond.type) === 1) {
                requiredLevel = toNum(cond.param);
                if (state.level < requiredLevel) {
                    meetsConditions = false;
                    break;
                }
            }
        }
        if (!meetsConditions) continue;

        const limitCount = toNum(goods.limit_count);
        const boughtNum = toNum(goods.bought_num);
        if (limitCount > 0 && boughtNum >= limitCount) continue;

        available.push({
            goods,
            goodsId: toNum(goods.id),
            seedId: toNum(goods.item_id),
            price: toNum(goods.price),
            requiredLevel,
        });
    }

    if (available.length === 0) {
        logWarn('商店', '没有可购买的种子');
        return null;
    }

    const fixedSeedId = toNum(CONFIG.fixedSeedId);
    if (fixedSeedId > 0) {
        const hit = available.find(x => x.seedId === fixedSeedId);
        if (hit) return hit;
        logWarn('商店', `指定种子不可购买或未解锁: seedId=${fixedSeedId}，将改用自动推荐`);
    }

    if (CONFIG.forceLowestLevelCrop) {
        available.sort((a, b) => a.requiredLevel - b.requiredLevel || a.price - b.price);
        return available[0];
    }

    try {
        log('商店', `等级: ${state.level}，土地数量: ${landsCount}`);

        const rec = getPlantingRecommendation(state.level, landsCount == null ? 18 : landsCount, { top: 50 });
        const rankedSeedIds = rec.candidatesNormalFert.map(x => x.seedId);
        for (const seedId of rankedSeedIds) {
            const hit = available.find(x => x.seedId === seedId);
            if (hit) return hit;
        }
    } catch (e) {
        logWarn('商店', `经验效率推荐失败，使用兜底策略: ${e.message}`);
    }

    if (state.level && state.level <= 28) {
        available.sort((a, b) => a.requiredLevel - b.requiredLevel);
    } else {
        available.sort((a, b) => b.requiredLevel - a.requiredLevel);
    }
    return available[0];
}

/**
 * 自动补种空地：铲除枯死/残留 -> 购买 -> 种植 -> 施肥。
 * @param {number[]} deadLandIds
 * @param {number[]} emptyLandIds
 * @param {number | null | undefined} unlockedLandCount
 */
async function autoPlantEmptyLands(deadLandIds, emptyLandIds, unlockedLandCount) {
    if (!CONFIG.autoPlant) return;
    let landsToPlant = [...emptyLandIds];
    const state = getUserState();

    // 1. 铲除枯死/收获残留植物（一键操作）
    if (deadLandIds.length > 0) {
        try {
            await removePlant(deadLandIds);
            log('铲除', `已铲除 ${deadLandIds.length} 块 (${deadLandIds.join(',')})`);
            landsToPlant.push(...deadLandIds);
        } catch (e) {
            logWarn('铲除', `批量铲除失败: ${e.message}`);
            // 失败时仍然尝试种植
            landsToPlant.push(...deadLandIds);
        }
    }

    if (landsToPlant.length === 0) return;

    // 2. 查询种子商店
    let bestSeed;
    try {
        bestSeed = await findBestSeed(unlockedLandCount);
    } catch (e) {
        logWarn('商店', `查询失败: ${e.message}`);
        return;
    }
    if (!bestSeed) return;

    const seedName = getPlantNameBySeedId(bestSeed.seedId);
    const growTime = getPlantGrowTime(1020000 + (bestSeed.seedId - 20000));  // 转换为植物ID
    const growTimeStr = growTime > 0 ? ` 生长${formatGrowTime(growTime)}` : '';
    log('商店', `最佳种子: ${seedName} (${bestSeed.seedId}) 价格=${bestSeed.price}金币${growTimeStr}`);

    // 3. 购买
    const needCount = landsToPlant.length;
    const totalCost = bestSeed.price * needCount;
    if (totalCost > state.gold) {
        logWarn('商店', `金币不足! 需要 ${totalCost} 金币, 当前 ${state.gold} 金币`);
        const canBuy = Math.floor(state.gold / bestSeed.price);
        if (canBuy <= 0) return;
        landsToPlant = landsToPlant.slice(0, canBuy);
        log('商店', `金币有限，只种 ${canBuy} 块地`);
    }

    let actualSeedId = bestSeed.seedId;
    try {
        const buyReply = await buyGoods(bestSeed.goodsId, landsToPlant.length, bestSeed.price);
        if (buyReply.get_items && buyReply.get_items.length > 0) {
            const gotItem = buyReply.get_items[0];
            const gotId = toNum(gotItem.id);
            const gotCount = toNum(gotItem.count);
            log('购买', `获得物品: id=${gotId} count=${gotCount}`);
            if (gotId > 0) actualSeedId = gotId;
        }
        if (buyReply.cost_items) {
            for (const item of buyReply.cost_items) {
                state.gold -= toNum(item.count);
            }
        }
        const boughtName = getPlantNameBySeedId(actualSeedId);
        log('购买', `已购买 ${boughtName}种子 x${landsToPlant.length}, 花费 ${bestSeed.price * landsToPlant.length} 金币`);
    } catch (e) {
        logWarn('购买', e.message);
        return;
    }

    // 4. 种植（逐块拖动，间隔50ms）
    let plantedLands = [];
    try {
        const planted = await plantSeeds(actualSeedId, landsToPlant);
        log('种植', `已在 ${planted} 块地种植 (${landsToPlant.join(',')})`);
        if (planted > 0) {
            plantedLands = landsToPlant.slice(0, planted);
        }
    } catch (e) {
        logWarn('种植', e.message);
    }

    // 5. 施肥（逐块拖动，间隔50ms）
    if (CONFIG.autoFertilize && plantedLands.length > 0) {
        const fertilized = await fertilize(plantedLands);
        if (fertilized > 0) {
            log('施肥', `已为 ${fertilized}/${plantedLands.length} 块地施肥`);
        }
    }
}

// ============ 土地分析 ============

/**
 * 根据服务器时间确定当前实际生长阶段
 */
function getCurrentPhase(phases, debug, landLabel) {
    if (!phases || phases.length === 0) return null;

    const nowSec = getServerTimeSec();

    if (debug) {
        console.log(`    ${landLabel} 服务器时间=${nowSec} (${new Date(nowSec * 1000).toLocaleTimeString()})`);
        for (let i = 0; i < phases.length; i++) {
            const p = phases[i];
            const bt = toTimeSec(p.begin_time);
            const phaseName = PHASE_NAMES[p.phase] || `阶段${p.phase}`;
            const diff = bt > 0 ? (bt - nowSec) : 0;
            const diffStr = diff > 0 ? `(未来 ${diff}s)` : diff < 0 ? `(已过 ${-diff}s)` : '';
            console.log(`    ${landLabel}   [${i}] ${phaseName}(${p.phase}) begin=${bt} ${diffStr} dry=${toTimeSec(p.dry_time)} weed=${toTimeSec(p.weeds_time)} insect=${toTimeSec(p.insect_time)}`);
        }
    }

    for (let i = phases.length - 1; i >= 0; i--) {
        const beginTime = toTimeSec(phases[i].begin_time);
        if (beginTime > 0 && beginTime <= nowSec) {
            if (debug) {
                console.log(`    ${landLabel}   → 当前阶段: ${PHASE_NAMES[phases[i].phase] || phases[i].phase}`);
            }
            return phases[i];
        }
    }

    if (debug) {
        console.log(`    ${landLabel}   → 所有阶段都在未来，使用第一个: ${PHASE_NAMES[phases[0].phase] || phases[0].phase}`);
    }
    return phases[0];
}

function analyzeLands(lands) {
    const result = {
        harvestable: [], needWater: [], needWeed: [], needBug: [],
        growing: [], empty: [], dead: [],
        harvestableInfo: [],  // 收获植物的详细信息 { id, name, exp }
    };

    const nowSec = getServerTimeSec();
    const debug = false;

    if (debug) {
        console.log('');
        console.log('========== 首次巡田详细日志 ==========');
        console.log(`  服务器时间(秒): ${nowSec}  (${new Date(nowSec * 1000).toLocaleString()})`);
        console.log(`  总土地数: ${lands.length}`);
        console.log('');
    }

    for (const land of lands) {
        const id = toNum(land.id);
        if (!land.unlocked) {
            if (debug) console.log(`  土地#${id}: 未解锁`);
            continue;
        }

        const plant = land.plant;
        if (!plant || !plant.phases || plant.phases.length === 0) {
            result.empty.push(id);
            if (debug) console.log(`  土地#${id}: 空地`);
            continue;
        }

        const plantName = plant.name || '未知作物';
        const landLabel = `土地#${id}(${plantName})`;

        if (debug) {
            console.log(`  ${landLabel}: phases=${plant.phases.length} dry_num=${toNum(plant.dry_num)} weed_owners=${(plant.weed_owners||[]).length} insect_owners=${(plant.insect_owners||[]).length}`);
        }

        const currentPhase = getCurrentPhase(plant.phases, debug, landLabel);
        if (!currentPhase) {
            result.empty.push(id);
            continue;
        }
        const phaseVal = currentPhase.phase;

        if (phaseVal === PlantPhase.DEAD) {
            result.dead.push(id);
            if (debug) console.log(`    → 结果: 枯死`);
            continue;
        }

        if (phaseVal === PlantPhase.MATURE) {
            result.harvestable.push(id);
            // 收集植物信息用于日志
            const plantId = toNum(plant.id);
            const plantNameFromConfig = getPlantName(plantId);
            const plantExp = getPlantExp(plantId);
            result.harvestableInfo.push({
                landId: id,
                plantId,
                name: plantNameFromConfig || plantName,
                exp: plantExp,
            });
            if (debug) console.log(`    → 结果: 可收获 (${plantNameFromConfig} +${plantExp}经验)`);
            continue;
        }

        let landNeeds = [];
        const dryNum = toNum(plant.dry_num);
        const dryTime = toTimeSec(currentPhase.dry_time);
        if (dryNum > 0 || (dryTime > 0 && dryTime <= nowSec)) {
            result.needWater.push(id);
            landNeeds.push('缺水');
        }

        const weedsTime = toTimeSec(currentPhase.weeds_time);
        const hasWeeds = (plant.weed_owners && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
        if (hasWeeds) {
            result.needWeed.push(id);
            landNeeds.push('有草');
        }

        const insectTime = toTimeSec(currentPhase.insect_time);
        const hasBugs = (plant.insect_owners && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);
        if (hasBugs) {
            result.needBug.push(id);
            landNeeds.push('有虫');
        }

        result.growing.push(id);
        if (debug) {
            const needStr = landNeeds.length > 0 ? ` 需要: ${landNeeds.join(',')}` : '';
            console.log(`    → 结果: 生长中(${PHASE_NAMES[phaseVal] || phaseVal})${needStr}`);
        }
    }

    if (debug) {
        console.log('');
        console.log('========== 巡田分析汇总 ==========');
        console.log(`  可收获: ${result.harvestable.length} [${result.harvestable.join(',')}]`);
        console.log(`  生长中: ${result.growing.length} [${result.growing.join(',')}]`);
        console.log(`  缺水:   ${result.needWater.length} [${result.needWater.join(',')}]`);
        console.log(`  有草:   ${result.needWeed.length} [${result.needWeed.join(',')}]`);
        console.log(`  有虫:   ${result.needBug.length} [${result.needBug.join(',')}]`);
        console.log(`  空地:   ${result.empty.length} [${result.empty.join(',')}]`);
        console.log(`  枯死:   ${result.dead.length} [${result.dead.join(',')}]`);
        console.log('====================================');
        console.log('');
    }

    return result;
}

/**
 * 将作物名称数组聚合为 “名称数量/名称数量” 的紧凑格式。
 * @param {Array<string>} names
 * @returns {string}
 */
function formatNameCounts(names) {
    const map = new Map();
    for (const raw of names) {
        const name = String(raw || '').trim();
        if (!name) continue;
        map.set(name, (map.get(name) || 0) + 1);
    }
    const pairs = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return pairs.map(([n, c]) => `${n}${c}`).join('/');
}

// ============ 巡田主循环 ============

async function checkFarm() {
    const state = getUserState();
    if (isCheckingFarm || !state.gid) return;
    isCheckingFarm = true;

    try {
        const landsReply = await getAllLands();
        lastAllLandsReply = landsReply;
        emitIncomingVisitsFromLandsReply(landsReply, state.gid);
        if (!landsReply.lands || landsReply.lands.length === 0) {
            log('农场', '没有土地数据');
            return;
        }

        const lands = landsReply.lands;
        const status = analyzeLands(lands);
        const unlockedLandCount = lands.filter(land => land && land.unlocked).length;
        isFirstFarmCheck = false;
        lastFarmSummary = {
            updatedAt: Date.now(),
            total: lands.length,
            harvestable: status.harvestable.length,
            growing: status.growing.length,
            needWater: status.needWater.length,
            needWeed: status.needWeed.length,
            needBug: status.needBug.length,
            empty: status.empty.length,
            dead: status.dead.length,
        };

        // 构建状态摘要
        const statusParts = [];
        if (status.harvestable.length) statusParts.push(`收:${status.harvestable.length}`);
        if (status.needWeed.length) statusParts.push(`草:${status.needWeed.length}`);
        if (status.needBug.length) statusParts.push(`虫:${status.needBug.length}`);
        if (status.needWater.length) statusParts.push(`水:${status.needWater.length}`);
        if (status.dead.length) statusParts.push(`枯:${status.dead.length}`);
        if (status.empty.length) statusParts.push(`空:${status.empty.length}`);
        statusParts.push(`长:${status.growing.length}`);

        const hasWork = status.harvestable.length || status.needWeed.length || status.needBug.length
            || status.needWater.length || status.dead.length || status.empty.length;

        // 执行操作并收集结果
        const actions = [];

        // 一键操作：除草、除虫、浇水可以并行执行（游戏中都是一键完成）
        const batchOps = [];
        if (CONFIG.autoWeed && status.needWeed.length > 0) {
            batchOps.push(weedOut(status.needWeed).then(() => actions.push(`除草${status.needWeed.length}`)).catch(e => logWarn('除草', e.message)));
        }
        if (CONFIG.autoBug && status.needBug.length > 0) {
            batchOps.push(insecticide(status.needBug).then(() => actions.push(`除虫${status.needBug.length}`)).catch(e => logWarn('除虫', e.message)));
        }
        if (CONFIG.autoWater && status.needWater.length > 0) {
            batchOps.push(waterLand(status.needWater).then(() => actions.push(`浇水${status.needWater.length}`)).catch(e => logWarn('浇水', e.message)));
        }
        if (batchOps.length > 0) {
            await Promise.all(batchOps);
        }

        // 收获（一键操作）
        let harvestedLandIds = [];
        if (CONFIG.autoHarvest && status.harvestable.length > 0) {
            try {
                await harvest(status.harvestable);
                const detail = formatNameCounts((status.harvestableInfo || []).map(x => x && x.name).filter(Boolean));
                actions.push(`收获${status.harvestable.length}${detail ? '(' + detail + ')' : ''}`);
                harvestedLandIds = [...status.harvestable];
            } catch (e) { logWarn('收获', e.message); }
        }

        // 铲除 + 种植 + 施肥（需要顺序执行）
        const allDeadLands = [...status.dead, ...harvestedLandIds];
        const allEmptyLands = [...status.empty];
        if (CONFIG.autoPlant && (allDeadLands.length > 0 || allEmptyLands.length > 0)) {
            try {
                await autoPlantEmptyLands(allDeadLands, allEmptyLands, unlockedLandCount);
                actions.push(`种植${allDeadLands.length + allEmptyLands.length}`);
            } catch (e) { logWarn('种植', e.message); }
        }

        // 输出一行日志
        const actionStr = actions.length > 0 ? ` → ${actions.join('/')}` : '';
        if(hasWork) {
            log('农场', `[${statusParts.join(' ')}]${actionStr}${!hasWork ? ' 无需操作' : ''}`)
        }
    } catch (err) {
        logWarn('巡田', `检查失败: ${err.message}`);
    } finally {
        isCheckingFarm = false;
    }
}

/**
 * 农场巡查循环 - 本次完成后等待指定秒数再开始下次
 */
async function farmCheckLoop() {
    while (farmLoopRunning) {
        await checkFarm();
        if (!farmLoopRunning) break;
        await sleep(pickIntervalMs(CONFIG.farmCheckIntervalMin, CONFIG.farmCheckIntervalMax, CONFIG.farmCheckInterval));
    }
}

function startFarmCheckLoop() {
    if (farmLoopRunning) return;
    farmLoopRunning = true;

    // 监听服务器推送的土地变化事件
    networkEvents.on('landsChanged', onLandsChangedPush);

    // 延迟 2 秒后启动循环
    farmCheckTimer = setTimeout(() => farmCheckLoop(), 2000);
}

/**
 * 处理服务器推送的土地变化
 */
let lastPushTime = 0;
function onLandsChangedPush(lands) {
    if (isCheckingFarm) return;
    const now = Date.now();
    if (now - lastPushTime < 500) return;  // 500ms 防抖
    
    lastPushTime = now;
    log('农场', `收到推送: ${lands.length}块土地变化，检查中...`);
    
    setTimeout(async () => {
        if (!isCheckingFarm) {
            await checkFarm();
        }
    }, 100);
}

function stopFarmCheckLoop() {
    farmLoopRunning = false;
    if (farmCheckTimer) { clearTimeout(farmCheckTimer); farmCheckTimer = null; }
    networkEvents.removeListener('landsChanged', onLandsChangedPush);
}

/**
 * 获取最近一次获取到的土地数据（用于 WebUI 展示）。
 */
function getLastAllLandsReply() {
    return lastAllLandsReply;
}

/**
 * 获取最近一次巡田汇总（用于 WebUI 面板展示）。
 */
function getLastFarmSummary() {
    return lastFarmSummary;
}

module.exports = {
    checkFarm, startFarmCheckLoop, stopFarmCheckLoop,
    getCurrentPhase,
    setOperationLimitsCallback,
    getLastAllLandsReply,
    getLastFarmSummary,
};
