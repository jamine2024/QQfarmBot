import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatBytes, formatDateTime, formatUptime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { apiFetch, type ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

type DashboardTab = "logs" | "board" | "overview";

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

  const [deltaSnapshot, setDeltaSnapshot] = useState<{
    ts: string;
    gainsGold: number;
    gainsExp: number;
    harvest: number;
    steal: number;
    water: number;
    bug: number;
    weed: number;
    fertilize: number;
    plant: number;
  } | null>(null);
  const [deltaCrops, setDeltaCrops] = useState<Array<{ name: string; delta: number; total: number }>>([]);

  const botRunning = Boolean(snapshot?.bot?.running);

  function triggerFlash(keys: string[]): void {
    if (!keys.length) return;
    setFlashKeys((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
    if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current);
    clearFlashTimerRef.current = window.setTimeout(() => setFlashKeys({}), 760);
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
    const deltas: Array<{ name: string; delta: number; total: number }> = [];
    for (const [name, count] of sortedCrops) {
      const prevCount = prev.get(name) ?? 0;
      if (count > prevCount) {
        changed.push(`crop:${name}`);
        deltas.push({ name, delta: count - prevCount, total: count });
      }
      prev.set(name, count);
    }
    triggerFlash(changed);
    if (deltas.length) {
      deltas.sort((a, b) => b.delta - a.delta);
      setDeltaCrops(deltas.slice(0, 16));
    }
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
    const delta = {
      ts: counters.updatedAt,
      gainsGold: Math.max(0, next.gainsGold - prev.gainsGold),
      gainsExp: Math.max(0, next.gainsExp - prev.gainsExp),
      water: Math.max(0, next.water - prev.water),
      bug: Math.max(0, next.bug - prev.bug),
      fertilize: Math.max(0, next.fertilize - prev.fertilize),
      plant: Math.max(0, next.plant - prev.plant),
      harvest: Math.max(0, next.harvest - prev.harvest),
      weed: Math.max(0, next.weed - prev.weed),
      steal: Math.max(0, next.steal - prev.steal),
    };
    if (next.gainsGold > prev.gainsGold) changed.push("counter:gainsGold");
    if (next.gainsExp > prev.gainsExp) changed.push("counter:gainsExp");
    if (next.water > prev.water) changed.push("counter:water");
    if (next.bug > prev.bug) changed.push("counter:bug");
    if (next.fertilize > prev.fertilize) changed.push("counter:fertilize");
    if (next.plant > prev.plant) changed.push("counter:plant");
    if (next.harvest > prev.harvest) changed.push("counter:harvest");
    if (next.weed > prev.weed) changed.push("counter:weed");
    triggerFlash(changed);
    setDeltaSnapshot((prevDelta) => {
      const merged = {
        ts: delta.ts,
        gainsGold: delta.gainsGold,
        gainsExp: delta.gainsExp,
        harvest: delta.harvest,
        steal: delta.steal,
        water: delta.water,
        bug: delta.bug,
        weed: delta.weed,
        fertilize: delta.fertilize,
        plant: delta.plant,
      };
      if (!prevDelta) return merged;
      const hasAny = Object.entries(merged).some(([k, v]) => k !== "ts" && typeof v === "number" && v > 0);
      return hasAny ? merged : prevDelta;
    });
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
    return filtered.slice(-1200);
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
          <div className="dashTitle">数据 & 日志</div>
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
            className={activeTab === "board" ? "segBtn active" : "segBtn"}
            onClick={() => setActiveTab("board")}
            role="tab"
            aria-selected={activeTab === "board"}
          >
            统计面板
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
              title="实时日志"
              subtitle={`显示最近 ${logDisplay.length} 条`}
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

      {activeTab === "board" ? (
        <div className="grid">
          <div>
            <GlassCard
              title="新增统计"
              subtitle={deltaSnapshot ? `最近更新 ${formatDateTime(deltaSnapshot.ts)}` : "等待统计变化..."}
              right={<span className="chip">闪烁高亮</span>}
              className="compactCard"
            >
              <div className="boardGrid">
                <div className="boardRow">
                  <div className="mono boardKey">金币</div>
                  <div className={deltaSnapshot?.gainsGold ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.gainsGold}` : "—"}</div>
                  <div className="muted boardTotal">{counters ? counters.gains.gold : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">经验</div>
                  <div className={deltaSnapshot?.gainsExp ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.gainsExp}` : "—"}</div>
                  <div className="muted boardTotal">{counters ? counters.gains.exp : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">收获</div>
                  <div className={deltaSnapshot?.harvest ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.harvest}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.harvest : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">偷菜</div>
                  <div className={deltaSnapshot?.steal ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.steal}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.steal : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">浇水</div>
                  <div className={deltaSnapshot?.water ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.water}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.water : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">除虫</div>
                  <div className={deltaSnapshot?.bug ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.bug}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.bug : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">除草</div>
                  <div className={deltaSnapshot?.weed ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.weed}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.weed : "—"}</div>
                </div>
                <div className="boardRow">
                  <div className="mono boardKey">施肥</div>
                  <div className={deltaSnapshot?.fertilize ? "boardVal valueFlash" : "boardVal"}>{deltaSnapshot ? `+${deltaSnapshot.fertilize}` : "—"}</div>
                  <div className="muted boardTotal">{actionCounters ? actionCounters.fertilize : "—"}</div>
                </div>
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard title="新增作物 TOP" subtitle={deltaCrops.length ? "按最近变化排序" : "等待收成变化..."} className="compactCard">
              <div className="boardGrid">
                {deltaCrops.length ? (
                  deltaCrops.map((x) => (
                    <div className="boardRow" key={x.name}>
                      <div className="mono boardKey">{x.name}</div>
                      <div className="boardVal valueFlash">+{x.delta}</div>
                      <div className="muted boardTotal">{x.total}</div>
                    </div>
                  ))
                ) : (
                  <div className="muted">暂无新增</div>
                )}
              </div>
            </GlassCard>
          </div>
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <div className="grid">
          <div className="gridSpan2">
            <GlassCard
              title="运行概览（紧凑）"
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
                  <div className="statK">Platform</div>
                  <div className="statV">{snapshot ? snapshot.config.platform.toUpperCase() : "—"}</div>
                </div>
                <div className="stat">
                  <div className="statK">User</div>
                  <div className="statV">{user ? user.name : "—"}</div>
                </div>
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard
              title="操作统计"
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
                  <div className={flashKeys["counter:gainsGold"] ? "valueFlash" : ""}>{counters ? counters.gains.gold : "—"}</div>
                  <div className="muted">累计</div>
                </div>
                <div className="trow">
                  <div className="mono">获得经验</div>
                  <div className={flashKeys["counter:gainsExp"] ? "valueFlash" : ""}>{counters ? counters.gains.exp : "—"}</div>
                  <div className="muted">累计</div>
                </div>
                <div className="trow">
                  <div className="mono">浇水</div>
                  <div className={flashKeys["counter:water"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.water : "—"}</div>
                  <div className="muted">农场/好友</div>
                </div>
                <div className="trow">
                  <div className="mono">捉虫</div>
                  <div className={flashKeys["counter:bug"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.bug : "—"}</div>
                  <div className="muted">除虫</div>
                </div>
                <div className="trow">
                  <div className="mono">施肥</div>
                  <div className={flashKeys["counter:fertilize"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.fertilize : "—"}</div>
                  <div className="muted">逐块统计</div>
                </div>
                <div className="trow">
                  <div className="mono">种植</div>
                  <div className={flashKeys["counter:plant"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.plant : "—"}</div>
                  <div className="muted">农场</div>
                </div>
                <div className="trow">
                  <div className="mono">收获</div>
                  <div className={flashKeys["counter:harvest"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.harvest : "—"}</div>
                  <div className="muted">农场</div>
                </div>
                <div className="trow">
                  <div className="mono">偷菜</div>
                  <div className="muted">{actionCounters ? actionCounters.steal : "—"}</div>
                  <div className="muted">好友</div>
                </div>
                <div className="trow">
                  <div className="mono">除草</div>
                  <div className={flashKeys["counter:weed"] ? "valueFlash" : ""}>{actionCounters ? actionCounters.weed : "—"}</div>
                  <div className="muted">农场/好友</div>
                </div>
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard title="作物统计" subtitle="按收获/偷菜累计（从日志解析）" className="compactCard">
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
                      <div className={flashKeys[`crop:${name}`] ? "valueFlash" : ""}>{count}</div>
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
