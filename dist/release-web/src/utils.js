/**
 * 通用工具函数
 */

const Long = require('long');
const EventEmitter = require('events');
const { RUNTIME_HINT_MASK, RUNTIME_HINT_DATA } = require('./config');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 运行事件（供外部 UI/管理端订阅） ============
const botEvents = new EventEmitter();

// ============ 类型转换 ============
function toLong(val) {
    return Long.fromNumber(val);
}

function toNum(val) {
    if (Long.isLong(val)) return val.toNumber();
    return val || 0;
}

// ============ 时间相关 ============
function now() {
    return new Date().toLocaleTimeString();
}

/** 获取当前推算的服务器时间(秒) */
function getServerTimeSec() {
    if (!serverTimeMs) return Math.floor(Date.now() / 1000);
    const elapsed = Date.now() - localTimeAtSync;
    return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
function syncServerTime(ms) {
    serverTimeMs = ms;
    localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
function toTimeSec(val) {
    const n = toNum(val);
    if (n <= 0) return 0;
    if (n > 1e12) return Math.floor(n / 1000);
    return n;
}

// ============ 日志 ============
function log(tag, msg) {
    console.log(`[${now()}] [${tag}] ${msg}`);
    botEvents.emit('log', { level: 'info', tag, message: String(msg) });
}

function logWarn(tag, msg) {
    console.log(`[${now()}] [${tag}] ⚠ ${msg}`);
    botEvents.emit('log', { level: 'warn', tag, message: String(msg) });
}

// ============ 异步工具 ============
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function pickIntervalMs(minMs, maxMs, fallbackMs) {
    const a = Number(minMs);
    const b = Number(maxMs);
    const f = Number(fallbackMs);
    const lo = Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b) : Number.isFinite(f) ? f : 1000;
    const hi = Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : Number.isFinite(f) ? f : 1000;
    const min = Math.max(1, Math.floor(lo));
    const max = Math.max(1, Math.floor(hi));
    if (min >= max) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

let hintPrinted = false;
function decodeRuntimeHint() {
    return String.fromCharCode(...RUNTIME_HINT_DATA.map(n => n ^ RUNTIME_HINT_MASK));
}

/**
 * 输出开源声明：
 * - force=true 时必定输出（用于启动）
 * - 默认低频输出（用于业务流程中的隐性提示）
 */
function emitRuntimeHint(force = false) {
    if (!force) {
        // 约 3.3% 概率，且同一次进程最多输出 2 次
        if (Math.random() > 0.033) return;
        if (hintPrinted && Math.random() > 0.2) return;
    }
    log('声明', decodeRuntimeHint());
    hintPrinted = true;
}

module.exports = {
    toLong, toNum, now,
    getServerTimeSec, syncServerTime, toTimeSec,
    log, logWarn, sleep,
    pickIntervalMs,
    emitRuntimeHint,
    botEvents,
};
