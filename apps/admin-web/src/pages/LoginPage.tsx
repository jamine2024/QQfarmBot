import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiFetch, type ApiError } from "../lib/api";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";

type LoginReply = {
  token: string;
  user: { id: string; username: string; role: string };
};

type BootstrapStatusReply = { required: boolean };

export function LoginPage(): React.JSX.Element {
  const auth = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState<"loading" | "bootstrap" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await apiFetch<BootstrapStatusReply>("/api/auth/bootstrap");
        if (cancelled) return;
        setMode(res.required ? "bootstrap" : "login");
      } catch {
        if (cancelled) return;
        setMode("login");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (username.trim().length < 3) return false;
    if (password.length < 1) return false;
    if (mode === "bootstrap" && password !== password2) return false;
    return true;
  }, [loading, mode, password, password2, username]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "bootstrap" ? "/api/auth/bootstrap" : "/api/auth/login";
      const res = await apiFetch<LoginReply>(endpoint, { method: "POST", body: { username, password } });
      auth.setToken(res.token);
      nav("/", { replace: true });
    } catch (e2: unknown) {
      const apiErr = e2 as ApiError;
      if (apiErr.code === "BOOTSTRAP_REQUIRED") {
        setMode("bootstrap");
        setError("请先初始化管理员账号");
      } else if (apiErr.code === "ALREADY_BOOTSTRAPPED") {
        setMode("login");
        setError("已初始化过管理员账号，请直接登录");
      } else if (apiErr.code === "INVALID_CREDENTIALS") {
        setError("账号或密码错误");
      } else {
        setError(mode === "bootstrap" ? "初始化失败，请稍后重试" : "登录失败，请稍后重试");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="appRoot">
      <div className="bgMesh" />
      <div className="grain" />

      <div className="loginWrap">
        <div className="loginHero">
          <div className="loginTitle">
            <div className="heroKicker">QQ/微信 农场挂机脚本</div>
            <div className="heroH">WebUI 可视化管理系统</div>
            <div className="heroP">实时面板 · 日志检索 · 参数下发 · 权限控制</div>
          </div>
          <div className="heroBadges">
            <span className="chip">
              <span className="dot dot-accent" />
              <span>动态数据</span>
            </span>
            <span className="chip">
              <span className="dot dot-blue" />
              <span>WebSocket</span>
            </span>
            <span className="chip">
              <span className="dot dot-warn" />
              <span>可审计日志</span>
            </span>
          </div>
        </div>

        <form className="glass loginCard" onSubmit={onSubmit}>
          <div className="loginCardHead">
            <div className="loginCardH">{mode === "bootstrap" ? "初始化管理员" : "登录控制台"}</div>
            <div className="loginCardSub">{mode === "bootstrap" ? "首次运行请设置管理员账号密码" : "请输入账号密码登录"}</div>
          </div>

          <div className="loginFields">
            <TextField label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <TextField label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            {mode === "bootstrap" ? (
              <TextField
                label="确认密码"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            ) : null}
            {error ? <div className="formError">{error}</div> : null}
          </div>

          <div className="loginActions">
            <Button type="submit" disabled={!canSubmit} variant="primary">
              {loading ? (mode === "bootstrap" ? "初始化中..." : "登录中...") : mode === "bootstrap" ? "初始化并进入" : "登录"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => (location.href = "/")}>
              刷新
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
