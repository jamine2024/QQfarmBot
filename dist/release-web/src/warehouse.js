/**
 * 仓库系统 - 自动出售果实
 * 协议说明：BagReply 使用 item_bag（ItemBag），item_bag.items 才是背包物品列表
 */

const { types } = require('./proto');
const { sendMsgAsync } = require('./network');
const { CONFIG } = require('./config');
const { toLong, toNum, log, logWarn, emitRuntimeHint } = require('./utils');
const { getFruitName } = require('./gameConfig');
let seedShopData = { rows: [] };
try {
    seedShopData = require('../tools/seed-shop-merged-export.json');
} catch (e) {
    logWarn('仓库', `缺少种子商店数据文件: ${e && e.message ? e.message : 'unknown'}`);
}

// 游戏内金币和点券的物品 ID (GlobalData.GodItemId / DiamondItemId)
const GOLD_ITEM_ID = 1001;
const FRUIT_ID_SET = new Set(
    ((seedShopData && seedShopData.rows) || [])
        .map(row => Number(row.fruitId))
        .filter(Number.isFinite)
);

let sellTimer = null;
let sellInterval = 60000;

function isFruitIdBySeedData(id) {
    return FRUIT_ID_SET.has(toNum(id));
}

/**
 * 从 SellReply 中提取获得的金币数量
 * 新版 SellReply 返回 get_items (repeated Item)，其中 id=1001 为金币
 */
function extractGold(sellReply) {
    if (sellReply.get_items && sellReply.get_items.length > 0) {
        for (const item of sellReply.get_items) {
            const id = toNum(item.id);
            if (id === GOLD_ITEM_ID) {
                return toNum(item.count);
            }
        }
        return 0;
    }
    if (sellReply.gold !== undefined && sellReply.gold !== null) {
        return toNum(sellReply.gold);
    }
    return 0;
}

async function getBag() {
    const body = types.BagRequest.encode(types.BagRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', body);
    return types.BagReply.decode(replyBody);
}

/**
 * 将 item 转为 Sell 请求所需格式（id/count/uid 保留 Long 或转成 Long，与游戏一致）
 */
function toSellItem(item) {
    const id = item.id != null ? toLong(item.id) : undefined;
    const count = item.count != null ? toLong(item.count) : undefined;
    const uid = item.uid != null ? toLong(item.uid) : undefined;
    return { id, count, uid };
}

async function sellItems(items) {
    const payload = items.map(toSellItem);
    const body = types.SellRequest.encode(types.SellRequest.create({ items: payload })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Sell', body);
    return types.SellReply.decode(replyBody);
}

/**
 * 从 BagReply 取出物品列表（兼容 item_bag 与旧版 items）
 */
function getBagItems(bagReply) {
    if (bagReply.item_bag && bagReply.item_bag.items && bagReply.item_bag.items.length)
        return bagReply.item_bag.items;
    return bagReply.items || [];
}

async function sellAllFruits() {
    if (!CONFIG.autoSell) return;
    try {
        const bagReply = await getBag();
        const items = getBagItems(bagReply);

        const toSell = [];
        const names = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const uid = item.uid ? toNum(item.uid) : 0;
            if (isFruitIdBySeedData(id) && count > 0) {
                if (uid === 0) continue;  // 跳过无效格子
                toSell.push(item);
                names.push(`${getFruitName(id)}x${count}`);
            }
        }

        if (toSell.length === 0) return;

        const reply = await sellItems(toSell);
        const totalGold = extractGold(reply);
        log('仓库', `出售 ${names.join(', ')}，获得 ${totalGold} 金币`);
        emitRuntimeHint(false);
    } catch (e) {
        logWarn('仓库', `出售失败: ${e.message}`);
    }
}

async function debugSellFruits() {
    try {
        log('仓库', '正在检查背包...');
        const bagReply = await getBag();
        const items = getBagItems(bagReply);
        log('仓库', `背包共 ${items.length} 种物品`);

        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            const isFruit = isFruitIdBySeedData(id);
            if (isFruit) {
                const name = getFruitName(id);
                log('仓库', `  [果实] ${name}(${id}) x${count}`);
            }
        }

        const toSell = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            if (isFruitIdBySeedData(id) && count > 0)
                toSell.push(item);
        }

        if (toSell.length === 0) {
            log('仓库', '没有果实可出售');
            return;
        }

        log('仓库', `准备出售 ${toSell.length} 种果实...`);
        const reply = await sellItems(toSell);
        const totalGold = extractGold(reply);
        log('仓库', `出售完成，共获得 ${totalGold} 金币`);
        emitRuntimeHint(false);
    } catch (e) {
        logWarn('仓库', `调试出售失败: ${e.message}`);
        console.error(e);
    }
}

function startSellLoop(interval = 60000) {
    if (!CONFIG.autoSell) return;
    if (sellTimer) return;
    sellInterval = interval;
    setTimeout(() => {
        sellAllFruits();
        sellTimer = setInterval(() => sellAllFruits(), sellInterval);
    }, 10000);
}

function stopSellLoop() {
    if (sellTimer) {
        clearInterval(sellTimer);
        sellTimer = null;
    }
}

module.exports = {
    getBag,
    sellItems,
    sellAllFruits,
    debugSellFruits,
    getBagItems,
    startSellLoop,
    stopSellLoop,
};
