import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useAuth } from "../lib/auth";
import { apiFetch, type ApiError } from "../lib/api";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";

type Config = {
  selfIntervalSecMin: number;
  selfIntervalSecMax: number;
  friendIntervalSecMin: number;
  friendIntervalSecMax: number;
  platform: "qq" | "wx";
  ui?: {
    wallpaper?: {
      sync: boolean;
      mode: "local" | "off";
    };
  };
};
type ConfigReply = { config: Config };

export function WallpaperPage(): React.JSX.Element {
  const auth = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loadedConfig, setLoadedConfig] = useState<Config | null>(null);

  const [platform, setPlatform] = useState<"qq" | "wx">("qq");
  const [selfIntervalSecMin, setSelfIntervalSecMin] = useState(10);
  const [selfIntervalSecMax, setSelfIntervalSecMax] = useState(10);
  const [friendIntervalSecMin, setFriendIntervalSecMin] = useState(1);
  const [friendIntervalSecMax, setFriendIntervalSecMax] = useState(1);

  const [wallpaperMode, setWallpaperMode] = useState<"local" | "off">("local");
  const [wallpaperSaving, setWallpaperSaving] = useState(false);

  const saveWallpaperConfig = useCallback(
    async (next: { mode: "local" | "off" }): Promise<void> => {
      setError(null);
      setOk(null);
      setWallpaperSaving(true);
      try {
        const base = loadedConfig ?? {
          platform,
          selfIntervalSecMin,
          selfIntervalSecMax,
          friendIntervalSecMin,
          friendIntervalSecMax,
        };
        const body: Omit<Config, "smtp"> = {
          platform: base.platform,
          selfIntervalSecMin: base.selfIntervalSecMin,
          selfIntervalSecMax: base.selfIntervalSecMax,
          friendIntervalSecMin: base.friendIntervalSecMin,
          friendIntervalSecMax: base.friendIntervalSecMax,
          ui: { wallpaper: { sync: true, mode: next.mode } },
        };
        const res = await apiFetch<ConfigReply>("/api/config", { method: "PUT", token: auth.token, body });
        setLoadedConfig(res.config);
        const ui = res.config.ui?.wallpaper;
        const mode: "local" | "off" = ui?.mode === "off" ? "off" : "local";
        setWallpaperMode(mode);
        window.dispatchEvent(new CustomEvent("ui:wallpaper", { detail: { mode } }));
        setOk("已保存");
      } catch (e: unknown) {
        const err = e as ApiError;
        setError(err.message ?? err.code ?? "保存失败");
      } finally {
        setWallpaperSaving(false);
      }
    },
    [
      auth.token,
      friendIntervalSecMax,
      friendIntervalSecMin,
      loadedConfig,
      platform,
      selfIntervalSecMax,
      selfIntervalSecMin,
    ]
  );

  const onPickLocalWallpaper = useCallback(
    async (files: FileList | null): Promise<void> => {
      try {
        if (!files?.length) return;
        if (!("caches" in window)) return;
        const cache = await caches.open("farm-wallpaper-v1");
        const now = Date.now();
        const list = Array.from(files).slice(0, 20);
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          if (!f.type.startsWith("image/")) continue;
          const key = new Request(`/__wallpaper/local/${now}-${i}`, { method: "GET" });
          await cache.put(key, new Response(f, { headers: { "content-type": f.type || "image/jpeg" } }));
        }
        await saveWallpaperConfig({ mode: "local" });
      } catch {
        return;
      }
    },
    [saveWallpaperConfig]
  );

  const onChangeWallpaperMode = useCallback(
    (mode: "local" | "off"): void => {
      setWallpaperMode(mode);
      void saveWallpaperConfig({ mode });
    },
    [saveWallpaperConfig]
  );

  const clearWallpaperCache = useCallback(async (): Promise<void> => {
    try {
      if (!("caches" in window)) return;
      await caches.delete("farm-wallpaper-v1");
      window.dispatchEvent(new Event("ui:wallpaper"));
    } catch {
      return;
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setOk(null);
    setLoading(true);
    try {
      const res = await apiFetch<ConfigReply>("/api/config", { token: auth.token });
      setLoadedConfig(res.config);
      setPlatform(res.config.platform);
      setSelfIntervalSecMin(res.config.selfIntervalSecMin);
      setSelfIntervalSecMax(res.config.selfIntervalSecMax);
      setFriendIntervalSecMin(res.config.friendIntervalSecMin);
      setFriendIntervalSecMax(res.config.friendIntervalSecMax);
      const ui = res.config.ui?.wallpaper;
      setWallpaperMode(ui?.mode === "off" ? "off" : "local");
    } catch (e: unknown) {
      const err = e as ApiError;
      setError(err.code ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  const canChange = useMemo(() => !wallpaperSaving && !loading, [loading, wallpaperSaving]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return;
  }, []);

  return (
    <div className="grid settingsPage">
      <div className="gridSpan2">
        <GlassCard
          title="壁纸"
          subtitle="默认多端同步；仅支持本地壁纸或关闭（本地壁纸存储在浏览器缓存）"
          right={
            <div className="row">
              <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
                {loading ? "刷新中..." : "刷新"}
              </Button>
              <Button size="sm" variant="danger" onClick={clearWallpaperCache} disabled={!canChange}>
                清空本地壁纸
              </Button>
            </div>
          }
          className="compactCard"
        >
          <div className="formGrid">
            <label className="field">
              <div className="fieldLabel">模式</div>
              <select className="fieldInput select" value={wallpaperMode} onChange={(e) => onChangeWallpaperMode(e.target.value as "local" | "off")} disabled={!canChange}>
                <option value="local">本地</option>
                <option value="off">关闭</option>
              </select>
              <div className="fieldHint">所有浏览器/设备保持一致（通过服务端配置同步）。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">导入本地壁纸</div>
              <input className="fieldInput" type="file" accept="image/*" multiple onChange={(e) => void onPickLocalWallpaper(e.target.files)} disabled={!canChange} />
              <div className="fieldHint">选择后自动切换到“本地”模式（最多一次导入 20 张）。</div>
            </label>
          </div>

          {error ? <div className="formError">{error}</div> : null}
          {ok ? <div className="formOk">{ok}</div> : null}
        </GlassCard>
      </div>
    </div>
  );
}
