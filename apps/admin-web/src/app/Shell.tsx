import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { apiFetch, type ApiError } from "../lib/api";
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
    if (fatalWs400.active) return;
    if (!snapshot?.bot?.startedAt) return;
    const top = data.logs[data.logs.length - 1];
    if (!top) return;
    if (top.message.includes("Unexpected server response: 400")) setFatalWs400({ active: true, msg: top.message });
  }, [data.logs, fatalWs400.active, snapshot?.bot?.startedAt]);

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

  return (
    <div className="appRoot" style={wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})` } : undefined}>
      <div className="shell">
        <aside className="glass nav navDesktop">
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
            <NavLink to="/wallpaper" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              壁纸
            </NavLink>
            <NavLink to="/notifications" className={({ isActive }) => (isActive ? "navLink active" : "navLink")}>
              通知
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
                    <div className="brandSub">WebUI 管理台</div>
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
                  to="/wallpaper"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  壁纸
                </NavLink>
                <NavLink
                  to="/notifications"
                  className={({ isActive }) => (isActive ? "navLink active" : "navLink")}
                  onClick={() => setNavOpen(false)}
                >
                  通知
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
              <div className="topbarHint">
                {isMobile ? (
                  <button className="chip chipBtn" onClick={() => setAlphaOpen(true)}>
                    <span className="dot dot-accent" />
                    <span className="mono">透明度 {Math.round(glassAlpha * 100)}%</span>
                  </button>
                ) : null}
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
    </div>
  );
}
