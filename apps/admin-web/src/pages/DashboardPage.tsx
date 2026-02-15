import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatBytes, formatDateTime, formatUptime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { apiFetch, type ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

type DashboardTab = "logs" | "overview";
type LogFilter = "all" | "farm" | "warehouse" | "gain" | "limit" | "friend" | "bot";
type QrCreateReply = { success: boolean; qrsig?: string; qrcode?: string; url?: string; isMiniProgram?: boolean };
type QrCheckReply = {
  success: boolean;
  ret?: string;
  msg?: string;
  code?: string;
  uin?: string;
  ticket?: string;
  avatar?: string;
};

/**
 * 渲染用于标题前缀的轻量 SVG 图标。
 */
function Icon(props: { name: "pulse" | "logs" | "bolt" | "leaf" | "qr" }): React.JSX.Element {
  const common = { className: "miniIcon", viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" };
  if (props.name === "logs") {
    return (
      <svg {...common}>
        <path d="M7 6.5h10M7 12h10M7 17.5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M5 6.5h.01M5 12h.01M5 17.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (props.name === "pulse") {
    return (
      <svg {...common}>
        <path
          d="M3 12h4l2.2-5.2L13 17l2.1-5H21"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (props.name === "bolt") {
    return (
      <svg {...common}>
        <path
          d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (props.name === "qr") {
    return (
      <svg {...common}>
        <path
          d="M4 4h6v6H4V4Zm0 10h6v6H4v-6Zm10-10h6v6h-6V4Zm1 1v4h4V5h-4Zm-10 1v4h4V6H5Zm0 10v4h4v-4H5Zm10 2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4-4h6v2h-6v-2Zm0 6h2v2h-2v-2Zm4-6h2v4h-2v-4Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        d="M20 4c-7 1-12 6-13 13 0 2.5 1.5 4 4 4 7-1 12-6 13-13 0-2.5-1.5-4-4-4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9.5 14.5 14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 以更紧凑的形式格式化金币显示。
 */
function formatGold(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.floor(v).toLocaleString();
}

export function DashboardPage(): React.JSX.Element {
  const data = useData();
  const { snapshot } = data;
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashKeys, setFlashKeys] = useState<Record<string, boolean>>({});
  const clearFlashTimerRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("logs");

  const [logSelectedId, setLogSelectedId] = useState<string | null>(null);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [logScopeFilter, setLogScopeFilter] = useState<LogFilter>("all");
  const [logSearch, setLogSearch] = useState("");
  const logBottomRef = useRef<HTMLDivElement | null>(null);
  const [logClearing, setLogClearing] = useState(false);
  const [deltaKeys, setDeltaKeys] = useState<Record<string, number>>({});
  const [deltaCrops, setDeltaCrops] = useState<Record<string, number>>({});
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("等待扫码");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrQrsig, setQrQrsig] = useState<string | null>(null);
  const [qrUin, setQrUin] = useState<string | null>(null);
  const [qrAvatar, setQrAvatar] = useState<string | null>(null);
  const qrPollRef = useRef<number | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startPlatform, setStartPlatform] = useState<"qq" | "wx">("qq");
  const [startError, setStartError] = useState<string | null>(null);

  const botRunning = Boolean(snapshot?.bot?.running);
  const qrUserKey = "farm-qr-user";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(qrUserKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { uin?: string; avatar?: string };
      if (typeof parsed.uin === "string" && parsed.uin) setQrUin(parsed.uin);
      if (typeof parsed.avatar === "string" && parsed.avatar) setQrAvatar(parsed.avatar);
    } catch {
      return;
    }
  }, [qrUserKey]);

  /**
   * 高亮更新值，并在相邻位置显示 +N 的动效。
   */
  function triggerFlash(keys: string[], deltas?: { keys?: Record<string, number>; crops?: Record<string, number> }): void {
    if (!keys.length) return;
    setFlashKeys((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
    if (deltas?.keys) setDeltaKeys(deltas.keys);
    if (deltas?.crops) setDeltaCrops(deltas.crops);
    if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current);
    clearFlashTimerRef.current = window.setTimeout(() => {
      setFlashKeys({});
      setDeltaKeys({});
      setDeltaCrops({});
    }, 760);
  }

  useEffect(() => {
    return () => {
      if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current);
    };
  }, []);

  /**
   * 清空服务端历史日志并同步清空前端显示窗口。
   */
  async function clearLogs(): Promise<void> {
    if (logClearing) return;
    const ok = window.confirm("确定要清空历史日志吗？此操作不可恢复。");
    if (!ok) return;
    setLogClearing(true);
    try {
      await apiFetch("/api/logs/clear", { method: "POST", token: auth.token });
      data.setLogs([]);
      setLogSelectedId(null);
    } catch {
      return;
    } finally {
      setLogClearing(false);
    }
  }

  /**
   * 停止扫码状态轮询。
   */
  function stopQrPolling(): void {
    if (qrPollRef.current !== null) window.clearInterval(qrPollRef.current);
    qrPollRef.current = null;
  }

  /**
   * 轮询二维码状态并在成功时自动填充登录 code。
   */
  async function checkQrStatus(qrsig: string): Promise<void> {
    try {
      const data = await apiFetch<QrCheckReply>("/api/qrlib/qr/check", {
        method: "POST",
        token: auth.token,
        body: { qrsig, preset: "farm" },
      });
      if (!data?.success) {
        setQrStatus("扫码状态异常");
        return;
      }
      if (data.ret === "0") {
        if (!data.code) {
          setQrStatus("登录成功但 code 为空");
          stopQrPolling();
          return;
        }
        const nextUin = typeof data.uin === "string" && data.uin ? data.uin : null;
        const nextAvatar = typeof data.avatar === "string" && data.avatar ? data.avatar : null;
        setQrUin(nextUin);
        setQrAvatar(nextAvatar);
        try {
          if (nextUin || nextAvatar) {
            localStorage.setItem(qrUserKey, JSON.stringify({ uin: nextUin, avatar: nextAvatar }));
          } else {
            localStorage.removeItem(qrUserKey);
          }
        } catch {
          return;
        }
        const nextCode = data.code;
        setCode(nextCode);
        setQrStatus("登录成功，正在启动 bot...");
        stopQrPolling();
        setQrOpen(false);

        if (!botRunning) {
          await startBotWithCode(nextCode, startPlatform, "qr");
        } else {
          setActionError("已填入 code，bot 已在运行");
        }
        return;
      }
      if (data.ret === "65") {
        setQrStatus("二维码已失效，请刷新");
        stopQrPolling();
        return;
      }
      if (data.ret === "66") {
        setQrStatus(data.msg || "等待扫码");
        return;
      }
      setQrStatus(data.msg || "扫码中");
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 401 || apiErr?.code === "UNAUTHORIZED") {
        setQrStatus("登录已过期，请重新登录");
        stopQrPolling();
        auth.logout();
        setTimeout(() => {
          location.href = "/login";
        }, 0);
        return;
      }
      if (apiErr?.code === "QRLIB_UNAVAILABLE") {
        setQrStatus("扫码服务不可用，请确认 QRLib 已启动");
        stopQrPolling();
        return;
      }
      if (apiErr?.code === "QRLIB_UPSTREAM_ERROR") {
        setQrStatus("扫码服务返回异常");
        return;
      }
      setQrStatus("扫码状态异常");
    }
  }

  /**
   * 启动 bot 并根据触发来源展示错误信息。
   */
  async function startBotWithCode(
    nextCode: string,
    platform: "qq" | "wx",
    source: "qr" | "manual"
  ): Promise<boolean> {
    setActionError(null);
    if (source === "manual") setStartError(null);
    setActionLoading(true);
    try {
      await apiFetch("/api/bot/start", { method: "POST", token: auth.token, body: { code: nextCode, platform } });
      setCode("");
      return true;
    } catch (e: unknown) {
      const err = e as ApiError;
      const msg = err.message ?? err.code ?? "启动失败";
      if (source === "manual") setStartError(msg);
      else setActionError(msg);
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 启动扫码轮询。
   */
  function startQrPolling(qrsig: string): void {
    stopQrPolling();
    void checkQrStatus(qrsig);
    qrPollRef.current = window.setInterval(() => {
      void checkQrStatus(qrsig);
    }, 2500);
  }

  /**
   * 获取二维码并更新弹窗状态。
   */
  async function createQrCode(): Promise<void> {
    setQrLoading(true);
    setQrError(null);
    setQrStatus("等待扫码");
    try {
      const data = await apiFetch<QrCreateReply>("/api/qrlib/qr/create", {
        method: "POST",
        token: auth.token,
        body: { preset: "farm" },
      });
      if (!data?.success || !data.qrsig || !data.qrcode) {
        setQrError("二维码获取失败");
        return;
      }
      setQrImage(data.qrcode);
      setQrQrsig(data.qrsig);
      startQrPolling(data.qrsig);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 401 || apiErr?.code === "UNAUTHORIZED") {
        setQrError("登录已过期，请重新登录");
        auth.logout();
        setTimeout(() => {
          location.href = "/login";
        }, 0);
        return;
      }
      if (apiErr?.code === "QRLIB_UNAVAILABLE") {
        setQrError("扫码服务不可用，请确认 QRLib 已启动");
        return;
      }
      setQrError("二维码获取失败");
    } finally {
      setQrLoading(false);
    }
  }

  /**
   * 打开扫码弹窗并初始化二维码。
   */
  async function openQrModal(): Promise<void> {
    setQrOpen(true);
    setQrImage(null);
    setQrQrsig(null);
    setQrError(null);
    setQrStatus("等待扫码");
    setQrUin(null);
    setQrAvatar(null);
    await createQrCode();
  }

  /**
   * 关闭扫码弹窗并清理状态。
   */
  function closeQrModal(): void {
    stopQrPolling();
    setQrOpen(false);
  }

  useEffect(() => {
    return () => {
      stopQrPolling();
    };
  }, []);

  /**
   * 点击启动或停止按钮时触发的主入口。
   */
  async function toggleBot(): Promise<void> {
    setActionError(null);
    setActionLoading(true);
    try {
      if (botRunning) {
        await apiFetch("/api/bot/stop", { method: "POST", token: auth.token });
      } else {
        setStartError(null);
        setStartOpen(true);
      }
    } catch (e: unknown) {
      const err = e as ApiError;
      setActionError(err.message ?? err.code ?? (botRunning ? "停止失败" : "启动失败"));
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * 打开手动启动弹窗。
   */
  function openStartModal(): void {
    setStartError(null);
    setQrUin(null);
    setQrAvatar(null);
    try {
      localStorage.removeItem(qrUserKey);
    } catch {
      return;
    }
    setStartOpen(true);
  }

  /**
   * 关闭手动启动弹窗并清理错误提示。
   */
  function closeStartModal(): void {
    setStartError(null);
    setStartOpen(false);
  }

  /**
   * 提交手动启动表单并执行启动。
   */
  async function submitStart(): Promise<void> {
    const nextCode = code.trim();
    if (!nextCode) {
      setStartError("请输入 code");
      return;
    }
    const ok = await startBotWithCode(nextCode, startPlatform, "manual");
    if (ok) setStartOpen(false);
  }

  const counters = snapshot?.counters;
  const actionCounters = counters?.actions ?? null;
  const cropCounters = counters?.crops ?? null;
  const user = snapshot?.bot?.user ?? null;
  const sortedCrops = useMemo(() => {
    if (!cropCounters) return [];
    return Object.entries(cropCounters)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 160);
  }, [cropCounters]);

  const prevVisibleCropsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const prev = prevVisibleCropsRef.current;
    const changed: string[] = [];
    const cropDeltaMap: Record<string, number> = {};
    for (const [name, count] of sortedCrops) {
      const prevCount = prev.get(name) ?? 0;
      if (count > prevCount) {
        changed.push(`crop:${name}`);
        cropDeltaMap[name] = count - prevCount;
      }
      prev.set(name, count);
    }
    if (!changed.length) return;
    const top = Object.entries(cropDeltaMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24);
    triggerFlash(changed, top.length ? { crops: Object.fromEntries(top) as Record<string, number> } : undefined);
  }, [sortedCrops]);

  const prevCounterFlatRef = useRef<{
    gainsGold: number;
    gainsExp: number;
    water: number;
    bug: number;
    fertilize: number;
    plant: number;
    harvest: number;
    weed: number;
    steal: number;
  } | null>(null);
  useEffect(() => {
    if (!counters || !actionCounters) return;
    const next = {
      gainsGold: counters.gains.gold,
      gainsExp: counters.gains.exp,
      water: actionCounters.water,
      bug: actionCounters.bug,
      fertilize: actionCounters.fertilize,
      plant: actionCounters.plant,
      harvest: actionCounters.harvest,
      weed: actionCounters.weed,
      steal: actionCounters.steal,
    };
    const prev = prevCounterFlatRef.current;
    prevCounterFlatRef.current = next;
    if (!prev) return;

    const changed: string[] = [];
    const deltaMap: Record<string, number> = {};
    const gainsGoldDelta = Math.max(0, next.gainsGold - prev.gainsGold);
    const gainsExpDelta = Math.max(0, next.gainsExp - prev.gainsExp);
    const waterDelta = Math.max(0, next.water - prev.water);
    const bugDelta = Math.max(0, next.bug - prev.bug);
    const fertilizeDelta = Math.max(0, next.fertilize - prev.fertilize);
    const plantDelta = Math.max(0, next.plant - prev.plant);
    const harvestDelta = Math.max(0, next.harvest - prev.harvest);
    const weedDelta = Math.max(0, next.weed - prev.weed);
    const stealDelta = Math.max(0, next.steal - prev.steal);

    if (gainsGoldDelta > 0) {
      changed.push("counter:gainsGold");
      deltaMap["counter:gainsGold"] = gainsGoldDelta;
    }
    if (gainsExpDelta > 0) {
      changed.push("counter:gainsExp");
      deltaMap["counter:gainsExp"] = gainsExpDelta;
    }
    if (waterDelta > 0) {
      changed.push("counter:water");
      deltaMap["counter:water"] = waterDelta;
    }
    if (bugDelta > 0) {
      changed.push("counter:bug");
      deltaMap["counter:bug"] = bugDelta;
    }
    if (fertilizeDelta > 0) {
      changed.push("counter:fertilize");
      deltaMap["counter:fertilize"] = fertilizeDelta;
    }
    if (plantDelta > 0) {
      changed.push("counter:plant");
      deltaMap["counter:plant"] = plantDelta;
    }
    if (harvestDelta > 0) {
      changed.push("counter:harvest");
      deltaMap["counter:harvest"] = harvestDelta;
    }
    if (weedDelta > 0) {
      changed.push("counter:weed");
      deltaMap["counter:weed"] = weedDelta;
    }
    if (stealDelta > 0) {
      deltaMap["counter:steal"] = stealDelta;
    }
    if (changed.length) triggerFlash(changed, Object.keys(deltaMap).length ? { keys: deltaMap } : undefined);
  }, [
    counters,
    actionCounters,
    counters?.gains.gold,
    counters?.gains.exp,
    actionCounters?.water,
    actionCounters?.bug,
    actionCounters?.fertilize,
    actionCounters?.plant,
    actionCounters?.harvest,
    actionCounters?.weed,
  ]);

  const levelProgress = useMemo(() => {
    if (!user) return null;
    const prog = user.expProgress;
    if (!prog) return null;
    const cur = Number(prog.current);
    const need = Number(prog.needed);
    const left = need - cur;
    if (!Number.isFinite(cur) || !Number.isFinite(need) || !Number.isFinite(left) || need <= 0) return null;
    return { cur, need, left: Math.max(0, left) };
  }, [user]);

  const logSelected = useMemo(() => {
    if (!logSelectedId) return null;
    return data.logs.find((x) => x.id === logSelectedId) ?? null;
  }, [data.logs, logSelectedId]);

  const logDisplay = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const filtered = data.logs.filter((x) => {
      if (logScopeFilter !== "all") {
        const scopeMap: Record<string, LogFilter> = {
          "农场": "farm",
          "仓库": "warehouse",
          "收益": "gain",
          "限制": "limit",
          "好友": "friend",
          "系统": "bot",
          "种植": "farm",
          "商店": "farm",
          "施肥": "farm",
          "除草": "farm",
          "除虫": "farm",
          "浇水": "farm",
          "收获": "farm",
          "铲除": "farm",
          "购买": "farm",
          "任务": "bot",
          "巡田": "friend",
        };
        const mapped = scopeMap[x.scope];
        if (mapped !== logScopeFilter) return false;
      }
      if (!q) return true;
      return (
        x.scope.toLowerCase().includes(q) ||
        x.message.toLowerCase().includes(q) ||
        x.ts.toLowerCase().includes(q)
      );
    });
    return filtered.slice(-50);
  }, [data.logs, logScopeFilter, logSearch]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    if (!logAutoScroll) return;
    logBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeTab, logAutoScroll, logDisplay.length]);

  return (
    <div className="dash">
      <section className="glass dashBar">
        <div className="dashBarLeft">
          <div className="dashTitleRow">
            <div className="dashTitle">
              <span className="titleWithIcon">
                <Icon name="pulse" />
                <span>数据 & 日志</span>
              </span>
            </div>
            <div className="dashBarTabs seg" role="tablist" aria-label="数据视图">
              <button
                className={activeTab === "logs" ? "segBtn active" : "segBtn"}
                onClick={() => setActiveTab("logs")}
                role="tab"
                aria-selected={activeTab === "logs"}
              >
                日志
              </button>
              <button
                className={activeTab === "overview" ? "segBtn active" : "segBtn"}
                onClick={() => setActiveTab("overview")}
                role="tab"
                aria-selected={activeTab === "overview"}
              >
                概览
              </button>
            </div>
          </div>
          <div className="dashSub muted">{snapshot ? `更新时间 ${formatDateTime(snapshot.ts)}` : "等待数据推送..."}</div>
        </div>
        <div className="dashBarRight">
          {qrUin || qrAvatar ? (
            <div className="dashQrUser">
              {qrAvatar ? <img className="dashQrAvatar" src={qrAvatar} alt="QQ Avatar" /> : <span className="dashQrAvatarFallback">QQ</span>}
              <span className="dashQrUin">{qrUin ? `QQ ${qrUin}` : "QQ"}</span>
            </div>
          ) : null}
          <div className="dashBotInline">
            <Button
              size="sm"
              variant="ghost"
              className="iconBtn"
              onClick={openQrModal}
              disabled={botRunning || actionLoading}
              aria-label="扫码登录"
              title="扫码登录"
            >
              <Icon name="qr" />
            </Button>
            <Button
              size="sm"
              variant={botRunning ? "danger" : "primary"}
              disabled={actionLoading}
              onClick={botRunning ? toggleBot : openStartModal}
            >
              {actionLoading ? (botRunning ? "停止中..." : "启动中...") : botRunning ? "停止" : "启动"}
            </Button>
          </div>
        </div>
      </section>

      {actionError ? <div className="formError">{actionError}</div> : null}

      {startOpen ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={closeStartModal}>
          <div className="glass modal startModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">启动 bot</div>
                <div className="modalSub">
                  <span className="pill">选择平台并输入 code</span>
                  <span className="muted">启动后会在后台持续运行</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={closeStartModal}>
                关闭
              </Button>
            </div>
            <div className="formGrid">
              <label className="field">
                <div className="fieldLabel">平台</div>
                <div className="seg startPlatformSeg" role="tablist" aria-label="平台选择">
                  <button
                    className={startPlatform === "qq" ? "segBtn active" : "segBtn"}
                    onClick={() => setStartPlatform("qq")}
                    type="button"
                    role="tab"
                    aria-selected={startPlatform === "qq"}
                  >
                    QQ
                  </button>
                  <button
                    className={startPlatform === "wx" ? "segBtn active" : "segBtn"}
                    onClick={() => setStartPlatform("wx")}
                    type="button"
                    role="tab"
                    aria-selected={startPlatform === "wx"}
                  >
                    微信
                  </button>
                </div>
              </label>
              <label className="field">
                <div className="fieldLabel">登录 code</div>
                <input
                  className="fieldInput"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="请输入登录 code"
                  disabled={actionLoading}
                />
              </label>
            </div>
            {startError ? <div className="formError">{startError}</div> : null}
            <div className="row startModalActions" style={{ marginTop: 12 }}>
              <Button size="sm" variant="primary" onClick={submitStart} disabled={actionLoading}>
                {actionLoading ? "启动中..." : "确认启动"}
              </Button>
              <Button size="sm" variant="ghost" onClick={closeStartModal} disabled={actionLoading}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {qrOpen ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={closeQrModal}>
          <div className="glass modal qrModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">扫码获取登录 code</div>
                <div className="modalSub">
                  <span className="pill">QQ 农场</span>
                  <span className="muted">二维码有效期短，请尽快扫码</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={closeQrModal}>
                关闭
              </Button>
            </div>
            <div className="qrBody">
              <div className="qrImageWrap">
                {qrImage ? <img className="qrImage" src={qrImage} alt="QR Code" /> : <div className="qrPlaceholder" />}
              </div>
              <div className="qrMeta">
                <div className="qrStatus">{qrStatus}</div>
                {qrError ? <div className="formError">{qrError}</div> : null}
                <div className="qrActions">
                  <Button size="sm" variant="primary" onClick={createQrCode} disabled={qrLoading}>
                    {qrLoading ? "获取中..." : "刷新二维码"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeQrModal} disabled={qrLoading}>
                    关闭
                  </Button>
                </div>
                {qrQrsig ? <div className="qrHint">已绑定 qrsig，扫码成功后自动填入</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "logs" ? (
        <div className="grid">
          <div className="gridSpan2">
            <GlassCard
              title={
                <span className="titleWithIcon">
                  <Icon name="logs" />
                  <span>实时日志</span>
                </span>
              }
              subtitle={`显示最近 ${data.logs.length} 条`}
              right={
                <div className="row">
                  <label className="toggle">
                    <input type="checkbox" checked={logAutoScroll} onChange={(e) => setLogAutoScroll(e.target.checked)} />
                    <span>自动滚动</span>
                  </label>
                  <Button size="sm" variant="danger" onClick={clearLogs} disabled={logClearing || !data.logs.length}>
                    {logClearing ? "清空中..." : "清空"}
                  </Button>
                </div>
              }
              className="compactCard"
            >
              <div className="dashLogTools">
                <div className="logFilters">
                  <button
                    className={logScopeFilter === "all" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("all")}
                  >
                    所有
                  </button>
                  <button
                    className={logScopeFilter === "farm" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("farm")}
                  >
                    农场
                  </button>
                  <button
                    className={logScopeFilter === "warehouse" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("warehouse")}
                  >
                    仓库
                  </button>
                  <button
                    className={logScopeFilter === "gain" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("gain")}
                  >
                    收益
                  </button>
                  <button
                    className={logScopeFilter === "limit" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("limit")}
                  >
                    限制
                  </button>
                  <button
                    className={logScopeFilter === "friend" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("friend")}
                  >
                    好友
                  </button>
                  <button
                    className={logScopeFilter === "bot" ? "logFilterBtn active" : "logFilterBtn"}
                    onClick={() => setLogScopeFilter("bot")}
                  >
                    BOT
                  </button>
                </div>
                <input className="fieldInput" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="搜索 scope / message / 时间" />
              </div>

              <div className="dashLogList">
                {logDisplay.map((x) => (
                  <button key={x.id} className={["logRow", `log-${x.level}`].join(" ")} onClick={() => setLogSelectedId(x.id)}>
                    <div className="logTs">{formatDateTime(x.ts)}</div>
                    <div className="logScope mono">{x.scope}</div>
                    <div className="logMsg">
                      <span className="logMsgText">{x.message}</span>
                      {(x.repeat ?? 1) > 1 ? <span className="logRepeat">×{x.repeat}</span> : null}
                    </div>
                  </button>
                ))}
                <div ref={logBottomRef} />
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <div className="grid">
          <div className="gridSpan2">
            <GlassCard
              title={
                <span className="titleWithIcon">
                  <Icon name="pulse" />
                  <span>运行概览（紧凑）</span>
                </span>
              }
              subtitle={snapshot ? `更新时间 ${formatDateTime(snapshot.ts)}` : "等待数据推送..."}
              className="compactCard"
            >
              <div className="stats statsCompact">
                <div className="stat">
                  <div className="statK">Uptime</div>
                  <div className="statV">{snapshot ? formatUptime(snapshot.stats.uptimeSec) : "—"}</div>
                </div>
                <div className="stat">
                  <div className="statK">Memory</div>
                  <div className="statV">{snapshot ? formatBytes(snapshot.stats.memoryRss) : "—"}</div>
                </div>
                <div className="stat">
                  <div className="statK">金币</div>
                  <div className="statV">{user ? formatGold(user.gold) : "—"}</div>
                </div>
                <div className="stat">
                  <div className="statK">账号等级</div>
                  <div className="statV">{user ? `${user.name} · Lv.${user.level}` : "—"}</div>
                </div>
                <div className="stat">
                  <div className="statK">距离升级</div>
                  <div className="statV">
                    {!user
                      ? "—"
                      : levelProgress == null
                        ? `经验 ${formatGold(user.exp)}`
                        : `还差 ${Math.max(0, Math.floor(levelProgress.left))} 点(${Math.floor(levelProgress.cur)}/${Math.floor(levelProgress.need)})`}
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard
              title={
                <span className="titleWithIcon">
                  <Icon name="bolt" />
                  <span>操作统计</span>
                </span>
              }
              subtitle={counters ? `更新时间 ${formatDateTime(counters.updatedAt)}` : "等待统计..."}
              right={<span className="chip">累计</span>}
              className="compactCard"
            >
              <div className="table">
                <div className="thead">
                  <div>操作</div>
                  <div>次数</div>
                  <div>说明</div>
                </div>
                <div className="trow">
                  <div className="mono">获得金币</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:gainsGold"] ? "valueFlash" : ""}>{counters ? counters.gains.gold : "—"}</span>
                    {deltaKeys["counter:gainsGold"] ? <span className="deltaPop">+{deltaKeys["counter:gainsGold"]}</span> : null}
                  </div>
                  <div className="muted">累计</div>
                </div>
                <div className="trow">
                  <div className="mono">获得经验</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:gainsExp"] ? "valueFlash" : ""}>{counters ? counters.gains.exp : "—"}</span>
                    {deltaKeys["counter:gainsExp"] ? <span className="deltaPop">+{deltaKeys["counter:gainsExp"]}</span> : null}
                  </div>
                  <div className="muted">累计</div>
                </div>
                <div className="trow">
                  <div className="mono">浇水</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:water"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.water : "—"}</span>
                    {deltaKeys["counter:water"] ? <span className="deltaPop">+{deltaKeys["counter:water"]}</span> : null}
                  </div>
                  <div className="muted">农场/好友</div>
                </div>
                <div className="trow">
                  <div className="mono">捉虫</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:bug"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.bug : "—"}</span>
                    {deltaKeys["counter:bug"] ? <span className="deltaPop">+{deltaKeys["counter:bug"]}</span> : null}
                  </div>
                  <div className="muted">除虫</div>
                </div>
                <div className="trow">
                  <div className="mono">施肥</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:fertilize"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.fertilize : "—"}</span>
                    {deltaKeys["counter:fertilize"] ? <span className="deltaPop">+{deltaKeys["counter:fertilize"]}</span> : null}
                  </div>
                  <div className="muted">逐块统计</div>
                </div>
                <div className="trow">
                  <div className="mono">种植</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:plant"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.plant : "—"}</span>
                    {deltaKeys["counter:plant"] ? <span className="deltaPop">+{deltaKeys["counter:plant"]}</span> : null}
                  </div>
                  <div className="muted">农场</div>
                </div>
                <div className="trow">
                  <div className="mono">收获</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:harvest"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.harvest : "—"}</span>
                    {deltaKeys["counter:harvest"] ? <span className="deltaPop">+{deltaKeys["counter:harvest"]}</span> : null}
                  </div>
                  <div className="muted">农场</div>
                </div>
                <div className="trow">
                  <div className="mono">偷菜</div>
                  <div className="valWithDelta">
                    <span className="muted">{actionCounters ? actionCounters.steal : "—"}</span>
                    {deltaKeys["counter:steal"] ? <span className="deltaPop">+{deltaKeys["counter:steal"]}</span> : null}
                  </div>
                  <div className="muted">好友</div>
                </div>
                <div className="trow">
                  <div className="mono">除草</div>
                  <div className="valWithDelta">
                    <span className={flashKeys["counter:weed"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.weed : "—"}</span>
                    {deltaKeys["counter:weed"] ? <span className="deltaPop">+{deltaKeys["counter:weed"]}</span> : null}
                  </div>
                  <div className="muted">农场/好友</div>
                </div>
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard
              title={
                <span className="titleWithIcon">
                  <Icon name="leaf" />
                  <span>作物统计</span>
                </span>
              }
              subtitle="按收获/偷菜累计（从日志解析）"
              className="compactCard"
            >
              <div className="table cropTable tableCompact">
                <div className="thead">
                  <div>作物</div>
                  <div>数量</div>
                  <div>备注</div>
                </div>
                {sortedCrops.length ? (
                  sortedCrops.map(([name, count]) => (
                    <div className="trow" key={name}>
                      <div className="mono">{name}</div>
                      <div className="valWithDelta">
                        <span className={flashKeys[`crop:${name}`] ? "valueFlash" : ""}>{count}</span>
                        {deltaCrops[name] ? <span className="deltaPop">+{deltaCrops[name]}</span> : null}
                      </div>
                      <div className="muted">累计</div>
                    </div>
                  ))
                ) : (
                  <div className="trow">
                    <div className="muted">暂无</div>
                    <div className="muted">—</div>
                    <div className="muted">等待收获/偷菜日志</div>
                  </div>
                )}
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      {logSelected ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={() => setLogSelectedId(null)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">日志详情</div>
                <div className="modalSub">
                  <span className="pill">{logSelected.level.toUpperCase()}</span>
                  <span className="mono">{logSelected.scope}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setLogSelectedId(null)}>
                关闭
              </Button>
            </div>
            <pre className="modalPre">{JSON.stringify(logSelected, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
