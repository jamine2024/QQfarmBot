import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatBytes, formatDateTime, formatUptime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { apiFetch, type ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

type DashboardTab = "logs" | "overview";

/**
 * 渲染用于标题前缀的轻量 SVG 图标。
 */
function Icon(props: { name: "pulse" | "logs" | "bolt" | "leaf" }): React.JSX.Element {
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
  const [logScopeFilter, setLogScopeFilter] = useState<"all" | "farm" | "friend">("all");
  const [logSearch, setLogSearch] = useState("");
  const logBottomRef = useRef<HTMLDivElement | null>(null);
  const [deltaKeys, setDeltaKeys] = useState<Record<string, number>>({});
  const [deltaCrops, setDeltaCrops] = useState<Record<string, number>>({});

  const botRunning = Boolean(snapshot?.bot?.running);

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

  async function toggleBot(): Promise<void> {
    setActionError(null);
    setActionLoading(true);
    try {
      if (botRunning) {
        await apiFetch("/api/bot/stop", { method: "POST", token: auth.token });
      } else {
        await apiFetch("/api/bot/start", { method: "POST", token: auth.token, body: { code } });
        setCode("");
      }
    } catch (e: unknown) {
      const err = e as ApiError;
      setActionError(err.message ?? err.code ?? (botRunning ? "停止失败" : "启动失败"));
    } finally {
      setActionLoading(false);
    }
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
    const need = (user.level + 1) * 200 + 200;
    const cur = user.exp;
    const left = need - cur;
    if (!Number.isFinite(need) || !Number.isFinite(cur) || !Number.isFinite(left)) return null;
    return { cur, need, left: Math.max(0, left) };
  }, [user]);

  const logSelected = useMemo(() => {
    if (!logSelectedId) return null;
    return data.logs.find((x) => x.id === logSelectedId) ?? null;
  }, [data.logs, logSelectedId]);

  const logDisplay = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const filtered = data.logs.filter((x) => {
      if (logScopeFilter === "farm" && !x.scope.includes("农场")) return false;
      if (logScopeFilter === "friend" && !x.scope.includes("好友")) return false;
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
          <div className="dashTitle">
            <span className="titleWithIcon">
              <Icon name="pulse" />
              <span>数据 & 日志</span>
            </span>
          </div>
          <div className="dashSub muted">{snapshot ? `更新时间 ${formatDateTime(snapshot.ts)}` : "等待数据推送..."}</div>
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
        <div className="dashBarRight">
          <span className="chip">
            <span className={snapshot?.bot?.connected ? "dot dot-accent" : "dot dot-danger"} />
            <span>{snapshot?.bot?.connected ? "已连接" : "未连接"}</span>
          </span>
          <span className="chip">
            <span className="dot dot-blue" />
            <span>WS {snapshot?.stats.wsClients ?? 0}</span>
          </span>
          <span className="chip">
            <span className={snapshot?.bot?.running ? "dot dot-warn" : "dot dot-danger"} />
            <span>{snapshot?.bot?.running ? "RUNNING" : "STOPPED"}</span>
          </span>
          <div className="dashBotInline">
            <input
              className="fieldInput dashBotInput"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="登录 code"
              disabled={botRunning}
            />
            <Button
              size="sm"
              variant={botRunning ? "danger" : "primary"}
              disabled={actionLoading || (!botRunning && !code)}
              onClick={toggleBot}
            >
              {actionLoading ? (botRunning ? "停止中..." : "启动中...") : botRunning ? "停止" : "启动"}
            </Button>
          </div>
        </div>
      </section>

      {actionError ? <div className="formError">{actionError}</div> : null}

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
                </div>
              }
              className="compactCard"
            >
              <div className="dashLogTools">
                <div className="seg">
                  <button
                    className={logScopeFilter === "all" ? "segBtn active" : "segBtn"}
                    onClick={() => setLogScopeFilter("all")}
                  >
                    所有
                  </button>
                  <button
                    className={logScopeFilter === "farm" ? "segBtn active" : "segBtn"}
                    onClick={() => setLogScopeFilter("farm")}
                  >
                    农场
                  </button>
                  <button
                    className={logScopeFilter === "friend" ? "segBtn active" : "segBtn"}
                    onClick={() => setLogScopeFilter("friend")}
                  >
                    好友
                  </button>
                </div>
                <input className="fieldInput" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="搜索 scope / message / 时间" />
              </div>

              <div className="dashLogList">
                {logDisplay.map((x) => (
                  <button key={x.id} className={["logRow", `log-${x.level}`].join(" ")} onClick={() => setLogSelectedId(x.id)}>
                    <div className="logTs">{formatDateTime(x.ts)}</div>
                    <div className="logScope mono">{x.scope}</div>
                    <div className="logMsg">{x.message}</div>
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
                    {levelProgress == null
                      ? "—"
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
