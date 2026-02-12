import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import ReactECharts from "echarts-for-react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { formatBytes } from "../lib/format";
import { apiFetch, type ApiError } from "../lib/api";
import { Button } from "../ui/Button";

type ShellProps = {
  title?: string;
  children: React.ReactNode;
};

/**
 * 将 ISO 时间戳格式化为仅包含时间的字符串，用于侧边栏日志紧凑展示。
 */
function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function Shell(props: ShellProps): React.JSX.Element {
  const auth = useAuth();
  const data = useData();
  const { snapshot } = data;
  const history = data.snapshotHistory;
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [glassAlpha, setGlassAlpha] = useState(0.5);
  const wallpaperObjectUrlRef = useRef<string | null>(null);
  const [fatalWs400, setFatalWs400] = useState<{ active: boolean; msg: string }>({ active: false, msg: "" });
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const sidebarLogs = useMemo(() => data.logs.slice(-10).reverse(), [data.logs]);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const lastTopLogIdRef = useRef<string | null>(null);
  const [flashLogId, setFlashLogId] = useState<string | null>(null);
  const [shutdownLoading, setShutdownLoading] = useState(false);
  const [shutdownError, setShutdownError] = useState<string | null>(null);

  useEffect(() => {
    const topId = sidebarLogs[0]?.id ?? null;
    if (!topId) return;
    if (topId === lastTopLogIdRef.current) return;
    lastTopLogIdRef.current = topId;

    const el = logListRef.current;
    if (el) {
      const isNearTop = el.scrollTop <= 12;
      if (isNearTop) el.scrollTo({ top: 0, behavior: "smooth" });
    }

    setFlashLogId(topId);
    const t = window.setTimeout(() => setFlashLogId(null), 750);
    return () => window.clearTimeout(t);
  }, [sidebarLogs]);

  useEffect(() => {
    if (fatalWs400.active) return;
    if (!snapshot?.bot?.startedAt) return;
    const top = sidebarLogs[0];
    if (!top) return;
    if (top.message.includes("Unexpected server response: 400")) {
      setFatalWs400({ active: true, msg: top.message });
    }
  }, [fatalWs400.active, sidebarLogs, snapshot?.bot?.startedAt]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (!("caches" in window)) return;
        const cache = await caches.open("farm-wallpaper-v1");
        let keys = await cache.keys();
        if (keys.length < 15) {
          const res = await fetch(`https://box.fiime.cn/random/srandom.php?t=${Date.now()}`, { cache: "no-store" });
          if (res.ok) {
            const blob = await res.blob();
            const key = new Request(`/__wallpaper/${Date.now()}`, { method: "GET" });
            await cache.put(
              key,
              new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg" } })
            );
            keys = await cache.keys();
          }
        }

        if (!keys.length) return;
        const pick = keys[Math.floor(Math.random() * keys.length)];
        const cached = await cache.match(pick);
        if (!cached) return;
        const blob = await cached.blob();
        const obj = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(obj);
          return;
        }
        if (wallpaperObjectUrlRef.current) URL.revokeObjectURL(wallpaperObjectUrlRef.current);
        wallpaperObjectUrlRef.current = obj;
        setWallpaperUrl(obj);
      } catch {
        return;
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (wallpaperObjectUrlRef.current) URL.revokeObjectURL(wallpaperObjectUrlRef.current);
      wallpaperObjectUrlRef.current = null;
    };
  }, []);

  async function restartBot(): Promise<void> {
    setRecoveryError(null);
    setRecoveryLoading(true);
    try {
      await apiFetch("/api/bot/start", { method: "POST", token: auth.token, body: { code: recoveryCode } });
      setFatalWs400({ active: false, msg: "" });
      setRecoveryCode("");
    } catch (e: unknown) {
      const err = e as ApiError;
      setRecoveryError(err.message ?? err.code ?? "启动失败");
    } finally {
      setRecoveryLoading(false);
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem("ui:glassAlpha");
    if (!raw) return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    setGlassAlpha(Math.min(0.9, Math.max(0.3, v)));
  }, []);

  useEffect(() => {
    const a = Math.min(0.9, Math.max(0.3, glassAlpha));
    const a2 = Math.min(0.85, Math.max(0.2, a - 0.1));
    document.documentElement.style.setProperty("--glass-alpha", String(a));
    document.documentElement.style.setProperty("--glass-alpha2", String(a2));
    localStorage.setItem("ui:glassAlpha", String(a));
  }, [glassAlpha]);

  async function shutdownApp(): Promise<void> {
    setShutdownError(null);
    setShutdownLoading(true);
    try {
      await apiFetch("/api/system/shutdown", { method: "POST", token: auth.token });
    } catch (e: unknown) {
      const err = e as ApiError;
      setShutdownError(err.message ?? err.code ?? "退出失败");
    } finally {
      setShutdownLoading(false);
    }
  }

  const memOption = useMemo(() => {
    const x = history.map((p) => formatTimeOnly(p.ts));
    return {
      backgroundColor: "transparent",
      grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: false },
      tooltip: { trigger: "axis", confine: true },
      xAxis: { type: "category", data: x, show: false },
      yAxis: { type: "value", show: false },
      series: [
        {
          name: "Heap Used",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: history.map((p) => p.heapUsed),
          lineStyle: { width: 2, color: "#6fffb8" },
          areaStyle: { color: "rgba(111,255,184,.10)" },
        },
        {
          name: "RSS",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: history.map((p) => p.rss),
          lineStyle: { width: 2, color: "#7aa2ff" },
          areaStyle: { color: "rgba(122,162,255,.08)" },
        },
      ],
    };
  }, [history]);

  return (
    <div className="appRoot" style={wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})` } : undefined}>
      <div className="shell">
        <aside className="glass nav">
          <div className="navBrand">
            <Link to="/" className="brand">
              <div className="brandText">
                <div className="brandName">Farm Console</div>
                <div className="brandSub">WebUI 管理台</div>
              </div>
            </Link>
          </div>

          <nav className="navLinks">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              数据 & 日志
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              配置
            </NavLink>
          </nav>

          <div className="navPanel">
            <div className="navPanelHead">
              <div className="navPanelTitle">UI 透明度</div>
              <div className="navPanelSub">{Math.round(glassAlpha * 100)}%</div>
            </div>
            <input
              className="range"
              type="range"
              min={30}
              max={90}
              step={1}
              value={Math.round(glassAlpha * 100)}
              onChange={(e) => setGlassAlpha(Number(e.target.value) / 100)}
            />
          </div>

          <div className="navPanel">
            <div className="navPanelHead">
              <div className="navPanelTitle">内存趋势</div>
              <div className="navPanelSub">{snapshot ? formatBytes(snapshot.stats.memoryRss) : "—"}</div>
            </div>
            <div className="navPanelChart">
              <ReactECharts option={memOption} style={{ height: 120, width: "100%" }} notMerge={true} lazyUpdate={true} />
            </div>
          </div>

          <div className="navPanel">
            <div className="navPanelHead">
              <div className="navPanelTitle">最新日志</div>
              <div className="navPanelSub">最近 10 条</div>
            </div>
            <div className="navLogList" ref={logListRef}>
              {sidebarLogs.length ? (
                sidebarLogs.map((x) => (
                  <div
                    key={x.id}
                    className={[
                      "navLogRow",
                      `navLog-${x.level}`,
                      flashLogId === x.id ? "navLogFlash" : "",
                    ].join(" ")}
                  >
                    <div className="navLogTs mono">{formatTimeOnly(x.ts)}</div>
                    <div className="navLogScope mono">{x.scope}</div>
                    <div className="navLogMsg">{x.message}</div>
                  </div>
                ))
              ) : (
                <div className="navLogEmpty muted">暂无日志</div>
              )}
            </div>
          </div>

          <div className="navFooter">
            <div className="chip">
              <span className="dot dot-accent" />
              <span>已登录</span>
            </div>
            <button className="navLogout" onClick={auth.logout}>
              退出登录
            </button>
          </div>
        </aside>

        <main className="main">
          <header className="glass topbar">
            <div className="topbarTitle">
              <div className="topbarH">{props.title ?? "控制台"}</div>
              <div className="topbarHint">
                <span className="chip">
                  <span className="dot dot-blue" />
                  <span>WebSocket 实时推送</span>
                </span>
                <Button variant="danger" size="sm" onClick={shutdownApp} disabled={shutdownLoading}>
                  {shutdownLoading ? "退出中..." : "退出程序"}
                </Button>
                {shutdownError ? <span className="chip">{shutdownError}</span> : null}
              </div>
            </div>
          </header>

          <div className="content">{props.children}</div>
        </main>
      </div>

      {fatalWs400.active ? (
        <div className="fatalOverlay" role="dialog" aria-modal="true">
          <div className="glass fatalCard">
            <div className="fatalHead">
              <div className="fatalIcon" />
              <div className="fatalTitle">连接异常：WS 400</div>
            </div>
            <div className="fatalMsg mono">{fatalWs400.msg}</div>
            <div className="fatalHint muted">系统已自动停止 bot。请输入新的 code 后重新启动。</div>
            <div className="fatalActions">
              <input
                className="fieldInput fatalInput"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="输入新 code"
                disabled={recoveryLoading}
              />
              <Button size="sm" variant="primary" onClick={restartBot} disabled={recoveryLoading || recoveryCode.trim().length < 5}>
                {recoveryLoading ? "启动中..." : "重新启动"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFatalWs400({ active: false, msg: "" })} disabled={recoveryLoading}>
                关闭提示
              </Button>
            </div>
            {recoveryError ? <div className="formError">{recoveryError}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
