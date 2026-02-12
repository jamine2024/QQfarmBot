import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useAuth } from "../lib/auth";
import { apiFetch, type ApiError } from "../lib/api";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { useData } from "../lib/data";

type Config = {
  selfIntervalSecMin: number;
  selfIntervalSecMax: number;
  friendIntervalSecMin: number;
  friendIntervalSecMax: number;
  platform: "qq" | "wx";
  smtp?: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    passSet: boolean;
    from: string;
    to: string;
  };
};
type ConfigReply = { config: Config };

export function SettingsPage(): React.JSX.Element {
  const auth = useAuth();
  const { snapshot } = useData();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [platform, setPlatform] = useState<"qq" | "wx">("qq");
  const [selfIntervalSecMin, setSelfIntervalSecMin] = useState(10);
  const [selfIntervalSecMax, setSelfIntervalSecMax] = useState(10);
  const [friendIntervalSecMin, setFriendIntervalSecMin] = useState(1);
  const [friendIntervalSecMax, setFriendIntervalSecMax] = useState(1);

  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTo, setSmtpTo] = useState("");

  const canSave = useMemo(() => {
    if (saving) return false;
    if (selfIntervalSecMin < 1 || selfIntervalSecMax < 1) return false;
    if (friendIntervalSecMin < 1 || friendIntervalSecMax < 1) return false;
    if (selfIntervalSecMin > selfIntervalSecMax) return false;
    if (friendIntervalSecMin > friendIntervalSecMax) return false;
    if (!smtpEnabled) return true;
    if (!smtpHost.trim()) return false;
    if (!smtpPort) return false;
    if (!smtpFrom.trim()) return false;
    if (!smtpTo.trim()) return false;
    return true;
  }, [
    friendIntervalSecMax,
    friendIntervalSecMin,
    saving,
    selfIntervalSecMax,
    selfIntervalSecMin,
    smtpEnabled,
    smtpFrom,
    smtpHost,
    smtpPort,
    smtpTo,
  ]);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await apiFetch<ConfigReply>("/api/config", { token: auth.token });
      setPlatform(res.config.platform);
      setSelfIntervalSecMin(res.config.selfIntervalSecMin);
      setSelfIntervalSecMax(res.config.selfIntervalSecMax);
      setFriendIntervalSecMin(res.config.friendIntervalSecMin);
      setFriendIntervalSecMax(res.config.friendIntervalSecMax);
      const smtp = res.config.smtp;
      setSmtpEnabled(Boolean(smtp?.enabled));
      setSmtpHost(smtp?.host ?? "");
      setSmtpPort(smtp?.port ?? 587);
      setSmtpSecure(Boolean(smtp?.secure));
      setSmtpUser(smtp?.user ?? "");
      setSmtpPass("");
      setSmtpPassSet(Boolean(smtp?.passSet));
      setSmtpFrom(smtp?.from ?? "");
      setSmtpTo(smtp?.to ?? "");
    } catch (e: unknown) {
      const err = e as ApiError;
      setError(err.code ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  async function save(): Promise<void> {
    setError(null);
    setOk(null);
    setSaving(true);
    try {
      const body: Omit<Config, "smtp"> & { smtp: Omit<NonNullable<Config["smtp"]>, "passSet"> & { pass?: string } } = {
        platform,
        selfIntervalSecMin,
        selfIntervalSecMax,
        friendIntervalSecMin,
        friendIntervalSecMax,
        smtp: {
          enabled: smtpEnabled,
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom,
          to: smtpTo,
        },
      };
      await apiFetch("/api/config", { method: "PUT", token: auth.token, body });
      setOk("已保存");
    } catch (e: unknown) {
      const err = e as ApiError;
      setError(err.message ?? err.code ?? "保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid">
      <div className="gridSpan2">
        <GlassCard
          title="运行配置"
          subtitle="修改后会在下次启动 bot 时生效（已运行的 bot 需要停止后重新启动）"
          right={
            <div className="row">
              <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
                {loading ? "刷新中..." : "刷新"}
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={!canSave}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </div>
          }
        >
          <div className="formGrid">
            <label className="field">
              <div className="fieldLabel">平台</div>
              <select
                className="fieldInput select"
                value={platform}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "qq" || v === "wx") setPlatform(v);
                }}
              >
                <option value="qq">QQ</option>
                <option value="wx">微信</option>
              </select>
              <div className="fieldHint">决定 bot 使用的 login 流程与协议差异。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">自己农场巡查间隔范围（秒）</div>
              <div className="row">
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={selfIntervalSecMin}
                  onChange={(e) => setSelfIntervalSecMin(Number(e.target.value))}
                />
                <span className="muted">~</span>
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={selfIntervalSecMax}
                  onChange={(e) => setSelfIntervalSecMax(Number(e.target.value))}
                />
              </div>
              <div className="fieldHint">每次循环会在范围内随机取值；保存后下次启动生效。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">好友巡查间隔范围（秒）</div>
              <div className="row">
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={friendIntervalSecMin}
                  onChange={(e) => setFriendIntervalSecMin(Number(e.target.value))}
                />
                <span className="muted">~</span>
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={friendIntervalSecMax}
                  onChange={(e) => setFriendIntervalSecMax(Number(e.target.value))}
                />
              </div>
              <div className="fieldHint">用于巡查好友农场、帮忙与偷菜；保存后下次启动生效。</div>
            </label>
          </div>

          {error ? <div className="formError">{error}</div> : null}
          {ok ? <div className="formOk">{ok}</div> : null}
        </GlassCard>
      </div>

      <div className="gridSpan2">
        <GlassCard title="邮件通知（SMTP）" subtitle="当检测到 WS 400 错误时停止 bot 并邮件提醒">
          <div className="formGrid">
            <label className="field">
              <div className="fieldLabel">启用</div>
              <select className="fieldInput select" value={smtpEnabled ? "on" : "off"} onChange={(e) => setSmtpEnabled(e.target.value === "on")}>
                <option value="off">关闭</option>
                <option value="on">开启</option>
              </select>
              <div className="fieldHint">关闭后不会发邮件，但仍可保留配置。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">服务器 Host</div>
              <input className="fieldInput" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </label>

            <label className="field">
              <div className="fieldLabel">端口</div>
              <input className="fieldInput" type="number" min={0} max={65535} value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
            </label>

            <label className="field">
              <div className="fieldLabel">TLS</div>
              <select className="fieldInput select" value={smtpSecure ? "secure" : "starttls"} onChange={(e) => setSmtpSecure(e.target.value === "secure")}>
                <option value="starttls">STARTTLS</option>
                <option value="secure">SSL/TLS</option>
              </select>
              <div className="fieldHint">一般 465 选 SSL/TLS；587 选 STARTTLS。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">用户名</div>
              <input className="fieldInput" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="user@example.com" />
            </label>

            <label className="field">
              <div className="fieldLabel">密码</div>
              <input
                className="fieldInput"
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtpPassSet ? "已设置（留空则不改）" : "请输入 SMTP 密码"}
              />
            </label>

            <label className="field">
              <div className="fieldLabel">From</div>
              <input className="fieldInput" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="Farm Console <noreply@example.com>" />
            </label>

            <label className="field">
              <div className="fieldLabel">To</div>
              <input className="fieldInput" value={smtpTo} onChange={(e) => setSmtpTo(e.target.value)} placeholder="a@example.com, b@example.com" />
            </label>
          </div>
        </GlassCard>
      </div>

      <div className="gridSpan2">
        <GlassCard title="当前状态" subtitle="来自实时快照（WebSocket 推送）">
          <div className="stats">
            <div className="stat">
              <div className="statK">Bot</div>
              <div className="statV">{snapshot?.bot?.running ? "RUNNING" : "STOPPED"}</div>
            </div>
            <div className="stat">
              <div className="statK">Connected</div>
              <div className="statV">{snapshot?.bot?.connected ? "YES" : "NO"}</div>
            </div>
            <div className="stat">
              <div className="statK">User</div>
              <div className="statV">{snapshot?.bot?.user?.name ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="statK">GID</div>
              <div className="statV">{snapshot?.bot?.user?.gid ?? "—"}</div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
