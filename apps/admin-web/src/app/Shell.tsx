import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { apiFetch, type ApiError } from "../lib/api";
import { formatBytes, formatDateTime, formatUptime } from "../lib/format";
import { Button } from "../ui/Button";

type ShellProps = {
  title?: string;
  children: React.ReactNode;
};

export function Shell(props: ShellProps): React.JSX.Element {
  const auth = useAuth();
  const data = useData();
  const { snapshot } = data;
  const serverWallpaperMode = snapshot?.config?.ui?.wallpaper?.mode;
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  const [wallpaperMode, setWallpaperMode] = useState<"local" | "off">("local");
  const [glassAlpha, setGlassAlpha] = useState(0.5);
  const wallpaperObjectUrlRef = useRef<string | null>(null);
  const [wallpaperReloadSeq, setWallpaperReloadSeq] = useState(0);
  const [fatalWs400, setFatalWs400] = useState<{ active: boolean; msg: string }>({ active: false, msg: "" });
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const [shutdownLoading, setShutdownLoading] = useState(false);
  const [shutdownError, setShutdownError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [alphaOpen, setAlphaOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(max-width: 980px)")?.matches ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia?.("(max-width: 980px)");
    if (!mql) return;
    const onChange = () => {
      setIsMobile(mql.matches);
      if (!mql.matches) setNavOpen(false);
    };
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  useEffect(() => {
    if (!alphaOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAlphaOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [alphaOpen]);

  useEffect(() => {
    if (!statusOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStatusOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [statusOpen]);

  useEffect(() => {
    if (!isMobile) setStatusOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (fatalWs400.active) return;
    if (!snapshot?.bot?.startedAt) return;
    const top = data.logs[data.logs.length - 1];
    if (!top) return;
    if (top.message.includes("Unexpected server response: 400")) setFatalWs400({ active: true, msg: top.message });
  }, [data.logs, fatalWs400.active, snapshot?.bot?.startedAt]);

  const user = snapshot?.bot?.user;
  const expProgress = user?.expProgress;

  const formatGold = (v: number | null | undefined): string => {
    const n = typeof v === "number" ? v : NaN;
    if (!Number.isFinite(n)) return "—";
    return Math.floor(n).toLocaleString();
  };

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (!("caches" in window)) return;
        const cache = await caches.open("farm-wallpaper-v1");
        const keys = await cache.keys();

        const localKeys = keys.filter((k) => k.url.includes("/__wallpaper/local/"));
        const effectiveMode: "local" | "off" = wallpaperMode === "local" && localKeys.length === 0 ? "off" : wallpaperMode;

        if (effectiveMode === "off") {
          if (wallpaperObjectUrlRef.current) URL.revokeObjectURL(wallpaperObjectUrlRef.current);
          wallpaperObjectUrlRef.current = null;
          setWallpaperUrl(null);
          return;
        }

        const pickFrom = localKeys.length ? localKeys : keys;
        if (!pickFrom.length) return;
        const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];
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
  }, [wallpaperMode, wallpaperReloadSeq]);

  useEffect(() => {
    const onWallpaperChanged = (evt: Event) => {
      const detail = (evt as CustomEvent<{ mode?: "local" | "off" }>)?.detail;
      if (detail?.mode === "local" || detail?.mode === "off") setWallpaperMode(detail.mode);
      setWallpaperReloadSeq((x) => x + 1);
    };
    window.addEventListener("ui:wallpaper", onWallpaperChanged);
    return () => window.removeEventListener("ui:wallpaper", onWallpaperChanged);
  }, []);

  useEffect(() => {
    if (serverWallpaperMode === "local" || serverWallpaperMode === "off") {
      setWallpaperMode(serverWallpaperMode);
    } else {
      setWallpaperMode("local");
    }
  }, [serverWallpaperMode]);

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

  function requestShutdown(): void {
    if (shutdownLoading) return;
    if (!window.confirm("确认退出程序？退出后需要手动重启服务。")) return;
    void shutdownApp();
  }

  return (
    <div className="appRoot" style={wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})` } : undefined}>
      <div className="shell">
        <aside className="glass nav navDesktop">
          <div className="navBrand">
            <Link to="/" className="brand">
              <div className="brandText">
                <div className="brandName">Farm Console</div>
                <div className="brandSub">WebUI 管理台 <span className="mono">V1.9.0</span></div>
              </div>
            </Link>
          </div>

          <nav className="navLinks">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              数据 & 日志
            </NavLink>
            <NavLink to="/lands" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              土地
            </NavLink>
            <NavLink to="/bag" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              我的背包
            </NavLink>
            <NavLink to="/visits" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              到访记录
            </NavLink>
            <NavLink to="/seeds" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              种子清单
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              设置
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              关于
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

        {navOpen ? (
          <div
            className="navDrawerOverlay"
            role="presentation"
            onClick={() => setNavOpen(false)}
          >
            <aside className="glass nav navDrawer" onClick={(e) => e.stopPropagation()}>
              <div className="navBrand">
                <Link
                  to="/"
                  className="brand"
                  onClick={() => {
                    setNavOpen(false);
                  }}
                >
                  <div className="brandText">
                    <div className="brandName">Farm Console</div>
                    <div className="brandSub">WebUI 管理台 <span className="mono">V1.9.0</span></div>
                  </div>
                </Link>
              </div>

              <div className="navPanel navPanelPrimary">
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

              <nav className="navLinks">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  数据 & 日志
                </NavLink>
                <NavLink
                  to="/lands"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  土地
                </NavLink>
                <NavLink
                  to="/bag"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  我的背包
                </NavLink>
                <NavLink
                  to="/visits"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  到访记录
                </NavLink>
                <NavLink
                  to="/seeds"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  种子清单
                </NavLink>
                <NavLink
                  to="/settings"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  设置
                </NavLink>
                <NavLink
                  to="/about"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  关于
                </NavLink>
              </nav>

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
          </div>
        ) : null}

        <main className="main">
          <header className="glass topbar">
            <div className="topbarTitle">
              <div className="topbarLeft">
                {isMobile ? (
                  <button className="navHamburger" onClick={() => setNavOpen(true)} aria-label="打开菜单">
                    <span className="navHamburgerIcon" />
                  </button>
                ) : null}
                <div className="topbarH">{props.title ?? "控制台"}</div>
              </div>
              {!isMobile ? (
                <div className="topbarHint">
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
                  <div className="topbarShutdown">
                    <Button variant="danger" size="sm" onClick={requestShutdown} disabled={shutdownLoading}>
                      {shutdownLoading ? "退出中..." : "退出程序"}
                    </Button>
                  </div>
                  {shutdownError ? <span className="chip">{shutdownError}</span> : null}
                </div>
              ) : null}
            </div>
          </header>

          <div className="content">{props.children}</div>
        </main>
      </div>

      {isMobile ? (
        <button className="glass floatingStatusBtn" onClick={() => setStatusOpen(true)} aria-label="查看状态参数">
          <span className={snapshot?.bot?.running ? "dot dot-accent" : "dot dot-danger"} />
          <span>状态</span>
        </button>
      ) : null}

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

      {alphaOpen ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={() => setAlphaOpen(false)}>
          <div className="glass alphaModal" onClick={(e) => e.stopPropagation()}>
            <div className="alphaModalHead">
              <div>
                <div className="modalTitle">UI 透明度</div>
                <div className="modalSub">
                  <span className="chip mono">{Math.round(glassAlpha * 100)}%</span>
                  <span className="muted">影响侧栏、卡片与弹层</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setAlphaOpen(false)}>
                关闭
              </Button>
            </div>
            <div className="alphaModalBody">
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
          </div>
        </div>
      ) : null}

      {isMobile && statusOpen ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={() => setStatusOpen(false)}>
          <div className="glass statusModal" onClick={(e) => e.stopPropagation()}>
            <div className="statusModalHead">
              <div>
                <div className="modalTitle">运行状态</div>
                <div className="modalSub">
                  <span className="chip mono">{snapshot ? `更新时间 ${formatDateTime(snapshot.ts)}` : "等待数据推送..."}</span>
                  <span className="muted">移动端快捷查看</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setStatusOpen(false)}>
                关闭
              </Button>
            </div>
            <div className="stats statsCompact statusStats">
              <div className="stat">
                <div className="statK">连接状态</div>
                <div className="statV">
                  <span className={snapshot?.bot?.connected ? "miniPill ok" : "miniPill off"}>
                    {snapshot?.bot?.connected ? "已连接" : "未连接"}
                  </span>
                </div>
              </div>
              <div className="stat">
                <div className="statK">WS 客户端</div>
                <div className="statV">{snapshot?.stats.wsClients ?? 0}</div>
              </div>
              <div className="stat">
                <div className="statK">运行状态</div>
                <div className="statV">
                  <span className={snapshot?.bot?.running ? "miniPill ok" : "miniPill off"}>
                    {snapshot?.bot?.running ? "RUNNING" : "STOPPED"}
                  </span>
                </div>
              </div>
              <div className="stat">
                <div className="statK">运行平台</div>
                <div className="statV">{snapshot?.bot?.platform === "wx" ? "微信" : "QQ"}</div>
              </div>
              <div className="stat">
                <div className="statK">运行时长</div>
                <div className="statV">{snapshot ? formatUptime(snapshot.stats.uptimeSec) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">启动时间</div>
                <div className="statV">{snapshot?.bot?.startedAt ? formatDateTime(snapshot.bot.startedAt) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">内存 RSS</div>
                <div className="statV">{snapshot ? formatBytes(snapshot.stats.memoryRss) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">Heap Used</div>
                <div className="statV">{snapshot ? formatBytes(snapshot.stats.heapUsed) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">Heap Total</div>
                <div className="statV">{snapshot ? formatBytes(snapshot.stats.heapTotal) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">账号</div>
                <div className="statV">{user ? `${user.name} · Lv.${user.level}` : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">GID</div>
                <div className="statV">{user?.gid ?? "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">金币</div>
                <div className="statV">{user ? formatGold(user.gold) : "—"}</div>
              </div>
              <div className="stat">
                <div className="statK">经验进度</div>
                <div className="statV">
                  {!user
                    ? "—"
                    : expProgress == null
                      ? `经验 ${formatGold(user.exp)}`
                      : `还差 ${Math.max(0, Math.floor(expProgress.needed - expProgress.current))} 点`}
                </div>
              </div>
              <div className="stat">
                <div className="statK">透明度</div>
                <div className="statV">
                  <div className="row">
                    <span className="mono">{Math.round(glassAlpha * 100)}%</span>
                    <button
                      className="chip chipBtn"
                      onClick={() => {
                        setStatusOpen(false);
                        setAlphaOpen(true);
                      }}
                    >
                      调整
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
