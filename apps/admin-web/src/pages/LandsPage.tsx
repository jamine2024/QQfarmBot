import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { apiFetch, type ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import waterPng from "../assets/水.png";
import weedPng from "../assets/草.png";
import bugPng from "../assets/虫.png";

type Config = {
  selfIntervalSecMin: number;
  selfIntervalSecMax: number;
  friendIntervalSecMin: number;
  friendIntervalSecMax: number;
  platform: "qq" | "wx";
  automation?: {
    autoHarvest: boolean;
    autoFertilize: boolean;
    autoWater: boolean;
    autoWeed: boolean;
    autoBug: boolean;
    autoPlant: boolean;
    autoFriendFarm: boolean;
    autoTask: boolean;
    autoSell: boolean;
  };
  farming?: {
    forceLowestLevelCrop: boolean;
    forceLatestLevelCrop?: boolean;
    disableAutoRecommend?: boolean;
    fixedSeedId?: number;
  };
};
type ConfigReply = { config: Config };

type SeedListItem = {
  plantId: number;
  seedId: number;
  name: string;
  landLevelNeed: number;
  exp: number;
  totalGrowSec: number | null;
  shopAvailable: boolean;
  shopUnlocked: boolean;
};

type Automation = NonNullable<Config["automation"]>;
type Farming = NonNullable<Config["farming"]>;
type SaveOverrides = Partial<
  Pick<Config, "platform" | "selfIntervalSecMin" | "selfIntervalSecMax" | "friendIntervalSecMin" | "friendIntervalSecMax">
> & {
  automation?: Partial<Automation>;
  farming?: Partial<Farming>;
  fixedSeedIdRaw?: number | "";
};

function formatSec(sec: number | null): string {
  if (sec == null) return "—";
  if (!Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}小时${mm}分` : `${h}小时`;
}

function getPhaseVariant(phase: number | null): string {
  if (phase === 1) return "seed";
  if (phase === 2) return "germination";
  if (phase === 3) return "small";
  if (phase === 4) return "large";
  if (phase === 5) return "blooming";
  if (phase === 6) return "mature";
  if (phase === 7) return "dead";
  return "unknown";
}

export function LandsPage(): React.JSX.Element {
  const auth = useAuth();
  const { snapshot } = useData();

  const lands = snapshot?.bot?.lands ?? null;
  const landsReady = Boolean(lands && lands.items && lands.items.length);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loadedConfig, setLoadedConfig] = useState<Config | null>(null);
  const [seedItems, setSeedItems] = useState<SeedListItem[]>([]);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [platform, setPlatform] = useState<"qq" | "wx">("qq");
  const [selfIntervalSecMin, setSelfIntervalSecMin] = useState(10);
  const [selfIntervalSecMax, setSelfIntervalSecMax] = useState(10);
  const [friendIntervalSecMin, setFriendIntervalSecMin] = useState(1);
  const [friendIntervalSecMax, setFriendIntervalSecMax] = useState(1);

  const effectiveAutomation = snapshot?.config?.automation ?? loadedConfig?.automation ?? {
    autoHarvest: true,
    autoFertilize: true,
    autoWater: true,
    autoWeed: true,
    autoBug: true,
    autoPlant: true,
    autoFriendFarm: true,
    autoTask: true,
    autoSell: true,
  };
  const effectiveFarming = (snapshot?.config?.farming ?? loadedConfig?.farming ?? { forceLowestLevelCrop: false, forceLatestLevelCrop: false, disableAutoRecommend: false }) as Farming;

  const [autoHarvest, setAutoHarvest] = useState(Boolean(effectiveAutomation.autoHarvest));
  const [autoFertilize, setAutoFertilize] = useState(Boolean(effectiveAutomation.autoFertilize));
  const [autoWater, setAutoWater] = useState(Boolean(effectiveAutomation.autoWater));
  const [autoWeed, setAutoWeed] = useState(Boolean(effectiveAutomation.autoWeed));
  const [autoBug, setAutoBug] = useState(Boolean(effectiveAutomation.autoBug));
  const [autoPlant, setAutoPlant] = useState(Boolean(effectiveAutomation.autoPlant));
  const [autoFriendFarm, setAutoFriendFarm] = useState(Boolean(effectiveAutomation.autoFriendFarm));
  const [autoTask, setAutoTask] = useState(Boolean(effectiveAutomation.autoTask));
  const [autoSell, setAutoSell] = useState(Boolean(effectiveAutomation.autoSell));

  const [forceLowestLevelCrop, setForceLowestLevelCrop] = useState(Boolean(effectiveFarming.forceLowestLevelCrop));
  const [forceLatestLevelCrop, setForceLatestLevelCrop] = useState(Boolean(effectiveFarming.forceLatestLevelCrop));
  const [disableAutoRecommend, setDisableAutoRecommend] = useState(Boolean(effectiveFarming.disableAutoRecommend));
  const [fixedSeedId, setFixedSeedId] = useState<number | "">(
    typeof effectiveFarming.fixedSeedId === "number" ? effectiveFarming.fixedSeedId : ""
  );

  const saveSeqRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildBody = useCallback(
    (overrides?: SaveOverrides): Config => {
      const seedRaw = overrides?.fixedSeedIdRaw ?? fixedSeedId;
      const seedId = typeof seedRaw === "number" ? seedRaw : null;

      const nextAutomation: Automation = {
        autoHarvest,
        autoFertilize,
        autoWater,
        autoWeed,
        autoBug,
        autoPlant,
        autoFriendFarm,
        autoTask,
        autoSell,
        ...(overrides?.automation ?? {}),
      };

      const nextFarming: Farming = {
        forceLowestLevelCrop: overrides?.farming?.forceLowestLevelCrop ?? forceLowestLevelCrop,
        forceLatestLevelCrop: overrides?.farming?.forceLatestLevelCrop ?? forceLatestLevelCrop,
        disableAutoRecommend: overrides?.farming?.disableAutoRecommend ?? disableAutoRecommend,
        fixedSeedId: seedId == null ? undefined : seedId,
      };

      return {
        platform: overrides?.platform ?? platform,
        selfIntervalSecMin: overrides?.selfIntervalSecMin ?? selfIntervalSecMin,
        selfIntervalSecMax: overrides?.selfIntervalSecMax ?? selfIntervalSecMax,
        friendIntervalSecMin: overrides?.friendIntervalSecMin ?? friendIntervalSecMin,
        friendIntervalSecMax: overrides?.friendIntervalSecMax ?? friendIntervalSecMax,
        automation: nextAutomation,
        farming: nextFarming,
      };
    },
    [
      autoBug,
      autoFertilize,
      autoHarvest,
      autoPlant,
      autoFriendFarm,
      autoSell,
      autoTask,
      autoWater,
      autoWeed,
      fixedSeedId,
      forceLowestLevelCrop,
      forceLatestLevelCrop,
      disableAutoRecommend,
      friendIntervalSecMax,
      friendIntervalSecMin,
      platform,
      selfIntervalSecMax,
      selfIntervalSecMin,
    ]
  );

  const isValidBody = useCallback((body: Config): boolean => {
    const seedId = body.farming?.fixedSeedId ?? null;
    if (seedId != null && (!Number.isFinite(seedId) || seedId <= 0)) return false;
    if (body.selfIntervalSecMin < 1 || body.selfIntervalSecMax < 1) return false;
    if (body.friendIntervalSecMin < 1 || body.friendIntervalSecMax < 1) return false;
    if (body.selfIntervalSecMin > body.selfIntervalSecMax) return false;
    if (body.friendIntervalSecMin > body.friendIntervalSecMax) return false;
    return true;
  }, []);

  const saveWithOverrides = useCallback(
    async (overrides?: SaveOverrides): Promise<void> => {
      if (!loadedConfig) return;
      const body = buildBody(overrides);
      if (!isValidBody(body)) return;

      setError(null);
      setOk(null);
      setSaving(true);
      const seq = ++saveSeqRef.current;
      try {
        const res = await apiFetch<ConfigReply>("/api/config", { method: "PUT", token: auth.token, body });
        if (seq !== saveSeqRef.current) return;
        setLoadedConfig(res.config);
        setPlatform(res.config.platform);
        setSelfIntervalSecMin(res.config.selfIntervalSecMin);
        setSelfIntervalSecMax(res.config.selfIntervalSecMax);
        setFriendIntervalSecMin(res.config.friendIntervalSecMin);
        setFriendIntervalSecMax(res.config.friendIntervalSecMax);
        const a = res.config.automation ?? {
          autoHarvest: true,
          autoFertilize: true,
          autoWater: true,
          autoWeed: true,
          autoBug: true,
          autoPlant: true,
          autoFriendFarm: true,
          autoTask: true,
          autoSell: true,
        };
        const f = res.config.farming ?? { forceLowestLevelCrop: false, forceLatestLevelCrop: false, disableAutoRecommend: false };
        setAutoHarvest(Boolean(a.autoHarvest));
        setAutoFertilize(Boolean(a.autoFertilize));
        setAutoWater(Boolean(a.autoWater));
        setAutoWeed(Boolean(a.autoWeed));
        setAutoBug(Boolean(a.autoBug));
        setAutoPlant(Boolean(a.autoPlant));
        setAutoFriendFarm(Boolean(a.autoFriendFarm));
        setAutoTask(Boolean(a.autoTask));
        setAutoSell(Boolean(a.autoSell));
        setForceLowestLevelCrop(Boolean(f.forceLowestLevelCrop));
        setForceLatestLevelCrop(Boolean(f.forceLatestLevelCrop));
        setDisableAutoRecommend(Boolean(f.disableAutoRecommend));
        setFixedSeedId(typeof f.fixedSeedId === "number" ? f.fixedSeedId : "");
        setDirty(false);
        setOk("已保存");
      } catch (e: unknown) {
        if (seq !== saveSeqRef.current) return;
        const err = e as ApiError;
        setError(err.message ?? err.code ?? "保存失败");
      } finally {
        if (seq === saveSeqRef.current) setSaving(false);
      }
    },
    [auth.token, buildBody, isValidBody, loadedConfig]
  );

  const scheduleSave = useCallback(
    (overrides: SaveOverrides, delayMs: number): void => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveWithOverrides(overrides);
      }, delayMs);
    },
    [saveWithOverrides]
  );

  const loadConfig = useCallback(async (): Promise<void> => {
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
      setDirty(false);
      const a = res.config.automation ?? {
        autoHarvest: true,
        autoFertilize: true,
        autoWater: true,
        autoWeed: true,
        autoBug: true,
        autoPlant: true,
        autoFriendFarm: true,
        autoTask: true,
        autoSell: true,
      };
      const f = res.config.farming ?? { forceLowestLevelCrop: false, forceLatestLevelCrop: false, disableAutoRecommend: false };
      setAutoHarvest(Boolean(a.autoHarvest));
      setAutoFertilize(Boolean(a.autoFertilize));
      setAutoWater(Boolean(a.autoWater));
      setAutoWeed(Boolean(a.autoWeed));
      setAutoBug(Boolean(a.autoBug));
      setAutoPlant(Boolean(a.autoPlant));
      setAutoFriendFarm(Boolean(a.autoFriendFarm));
      setAutoTask(Boolean(a.autoTask));
      setAutoSell(Boolean(a.autoSell));
      setForceLowestLevelCrop(Boolean(f.forceLowestLevelCrop));
      setForceLatestLevelCrop(Boolean(f.forceLatestLevelCrop));
      setDisableAutoRecommend(Boolean(f.disableAutoRecommend));
      setFixedSeedId(typeof f.fixedSeedId === "number" ? f.fixedSeedId : "");
    } catch (e: unknown) {
      const err = e as ApiError;
      setError(err.code ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, [auth.token]);

  const saveConfig = useCallback(async (): Promise<void> => {
    await saveWithOverrides();
  }, [saveWithOverrides]);

  /**
   * 拉取种子清单（基于 Plant.json 构建）。
   */
  const loadSeeds = useCallback(async (): Promise<void> => {
    setSeedError(null);
    setSeedLoading(true);
    try {
      const res = await apiFetch<{ items: SeedListItem[] }>("/api/seeds?pageSize=50000", { token: auth.token });
      setSeedItems(res.items ?? []);
    } catch (e: unknown) {
      const err = e as ApiError;
      setSeedError(err.message ?? err.code ?? "加载失败");
    } finally {
      setSeedLoading(false);
    }
  }, [auth.token]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void loadSeeds();
  }, [loadSeeds]);

  useEffect(() => {
    const a = snapshot?.config?.automation;
    if (!a) return;
    if (loadedConfig) return;
    if (dirty || saving) return;
    setAutoHarvest(Boolean(a.autoHarvest));
    setAutoFertilize(Boolean(a.autoFertilize));
    setAutoWater(Boolean(a.autoWater));
    setAutoWeed(Boolean(a.autoWeed));
    setAutoBug(Boolean(a.autoBug));
    setAutoPlant(Boolean(a.autoPlant));
    setAutoFriendFarm(Boolean(a.autoFriendFarm));
    setAutoTask(Boolean(a.autoTask));
    setAutoSell(Boolean(a.autoSell));
  }, [dirty, loadedConfig, saving, snapshot?.config?.automation]);

  useEffect(() => {
    const f = snapshot?.config?.farming as Farming | undefined;
    if (!f) return;
    if (loadedConfig) return;
    if (dirty || saving) return;
    setForceLowestLevelCrop(Boolean(f.forceLowestLevelCrop));
    setForceLatestLevelCrop(Boolean(f.forceLatestLevelCrop));
    setDisableAutoRecommend(Boolean(f.disableAutoRecommend));
    setFixedSeedId(typeof f.fixedSeedId === "number" ? f.fixedSeedId : "");
  }, [dirty, loadedConfig, saving, snapshot?.config?.farming]);

  useEffect(() => {
    const p = snapshot?.config?.platform;
    const selfMin = snapshot?.config?.selfIntervalSecMin;
    const selfMax = snapshot?.config?.selfIntervalSecMax;
    const friendMin = snapshot?.config?.friendIntervalSecMin;
    const friendMax = snapshot?.config?.friendIntervalSecMax;
    if (!p || selfMin == null || selfMax == null || friendMin == null || friendMax == null) return;
    if (loadedConfig) return;
    if (dirty || saving) return;
    setPlatform(p);
    setSelfIntervalSecMin(selfMin);
    setSelfIntervalSecMax(selfMax);
    setFriendIntervalSecMin(friendMin);
    setFriendIntervalSecMax(friendMax);
  }, [
    dirty,
    saving,
    loadedConfig,
    snapshot?.config?.friendIntervalSecMax,
    snapshot?.config?.friendIntervalSecMin,
    snapshot?.config?.platform,
    snapshot?.config?.selfIntervalSecMax,
    snapshot?.config?.selfIntervalSecMin,
  ]);

  const cropCounts = useMemo(() => {
    const items = lands?.items ?? [];
    const map = new Map<string, number>();
    for (const x of items) {
      if (!x.unlocked) continue;
      const name = x.cropName ? x.cropName.trim() : "";
      const key = name ? name : "空闲";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const list = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return list;
  }, [lands?.items]);

  const seedOptions = useMemo(() => {
    const items = seedItems.slice();
    const hasShop = items.some((x) => x.shopAvailable);
    const filtered = hasShop ? items.filter((x) => x.shopAvailable) : items;
    filtered.sort((a, b) => {
      if (a.shopUnlocked !== b.shopUnlocked) return a.shopUnlocked ? -1 : 1;
      if (a.exp !== b.exp) return b.exp - a.exp;
      return a.seedId - b.seedId;
    });
    return filtered.map((item) => {
      const expLabel = Number.isFinite(item.exp) ? `经验+${item.exp}` : "经验+0";
      const unlocked = Boolean(item.shopUnlocked);
      const base = `${item.name} · ${expLabel}`;
      return {
        value: String(item.seedId),
        label: unlocked ? base : `${base}（未解锁）`,
        disabled: !unlocked,
      };
    });
  }, [seedItems]);

  const canSave = useMemo(() => {
    if (saving || loading) return false;
    if (!loadedConfig) return false;
    const seedId = typeof fixedSeedId === "number" ? fixedSeedId : null;
    if (seedId != null && (!Number.isFinite(seedId) || seedId <= 0)) return false;
    if (selfIntervalSecMin < 1 || selfIntervalSecMax < 1) return false;
    if (friendIntervalSecMin < 1 || friendIntervalSecMax < 1) return false;
    if (selfIntervalSecMin > selfIntervalSecMax) return false;
    if (friendIntervalSecMin > friendIntervalSecMax) return false;
    return true;
  }, [
    fixedSeedId,
    friendIntervalSecMax,
    friendIntervalSecMin,
    loadedConfig,
    loading,
    saving,
    selfIntervalSecMax,
    selfIntervalSecMin,
  ]);

  return (
    <div className="grid landsPage">
      <div className="gridSpan2">
        <GlassCard
          title="土地"
          subtitle={
            landsReady
              ? `已解锁 ${lands?.unlocked ?? 0}/${lands?.total ?? 0} 块 · ${cropCounts
                  .slice(0, 6)
                  .map(([k, v]) => `${k}${v}`)
                  .join(" / ")}`
              : "等待 bot 登录并拉取土地数据"
          }
          right={
            <div className="row">
              <Button size="sm" variant="ghost" onClick={loadConfig} disabled={loading}>
                {loading ? "刷新中..." : "刷新配置"}
              </Button>
              <Button size="sm" variant="primary" onClick={saveConfig} disabled={!canSave}>
                {saving ? "保存中..." : "保存配置"}
              </Button>
            </div>
          }
          className="compactCard"
        >
          {!landsReady ? (
            <div className="emptyState">
              <div className="emptyTitle">暂无土地数据</div>
              <div className="muted">启动 bot 并等待一次巡田完成后，这里会实时展示每块土地的作物与状态。</div>
            </div>
          ) : (
            <div className="landsGrid">
              {(lands?.items ?? []).map((x) => (
                <div 
                  key={x.id} 
                  className={["landTile", x.unlocked ? "unlocked" : "locked"].join(" ")}
                >
                  <div className="landTop">
                    <div className="landName">{x.cropName ?? "空闲"}</div>
                    <div className="landId">#{x.id}</div>
                  </div>
                  <div className="landSub">
                    <div className="landSubRow">
                      <span
                        className={[
                          "phasePill",
                          `phase-${x.unlocked ? getPhaseVariant(x.phase) : "locked"}`,
                          x.phase === 6 ? "phase-breathe" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {x.phaseName ?? (x.unlocked ? "空闲" : "未解锁")}
                      </span>
                      <div className="landRightCol">
                        {x.progress != null ? (
                          <div className="landProgressBar">
                            <div 
                              className="landProgressFill"
                              style={{ width: `${x.progress}%` }}
                            />
                          </div>
                        ) : null}
                        <span className="landTimeText">
                          {x.timeLeftSec == null ? "—" : `${formatSec(x.timeLeftSec)}`}
                          {x.progress != null ? ` (${x.progress.toFixed(0)}%)` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  {x.needWater || x.needWeed || x.needBug ? (
                    <div className="landIcons" aria-label="异常提示">
                      {x.needWater ? <img className="landIcon" src={waterPng} alt="缺水" title="缺水" /> : null}
                      {x.needWeed ? <img className="landIcon" src={weedPng} alt="有草" title="有草" /> : null}
                      {x.needBug ? <img className="landIcon" src={bugPng} alt="有虫" title="有虫" /> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="gridSpan2">
        <GlassCard
          title="运行配置"
          subtitle="修改后会在下次启动 bot 时生效（已运行的 bot 需要停止后重新启动）"
          className="compactCard"
        >
          <div className="formGrid">
            <label className="field">
              <div className="fieldLabel">平台</div>
              <select
                className="fieldInput select"
                value={platform}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "qq" || v === "wx") {
                    setPlatform(v);
                    setDirty(true);
                    void saveWithOverrides({ platform: v });
                  }
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
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSelfIntervalSecMin(Number.isFinite(next) ? next : 0);
                    setDirty(true);
                    scheduleSave({ selfIntervalSecMin: Number.isFinite(next) ? next : 0 }, 600);
                  }}
                />
                <span className="muted">~</span>
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={selfIntervalSecMax}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setSelfIntervalSecMax(Number.isFinite(next) ? next : 0);
                    setDirty(true);
                    scheduleSave({ selfIntervalSecMax: Number.isFinite(next) ? next : 0 }, 600);
                  }}
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
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFriendIntervalSecMin(Number.isFinite(next) ? next : 0);
                    setDirty(true);
                    scheduleSave({ friendIntervalSecMin: Number.isFinite(next) ? next : 0 }, 600);
                  }}
                />
                <span className="muted">~</span>
                <input
                  className="fieldInput"
                  type="number"
                  min={1}
                  max={3600}
                  value={friendIntervalSecMax}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFriendIntervalSecMax(Number.isFinite(next) ? next : 0);
                    setDirty(true);
                    scheduleSave({ friendIntervalSecMax: Number.isFinite(next) ? next : 0 }, 600);
                  }}
                />
              </div>
              <div className="fieldHint">用于巡查好友农场、帮忙与偷菜；保存后下次启动生效。</div>
            </label>
          </div>
        </GlassCard>
      </div>

      <div className="gridSpan2">
        <GlassCard
          title="自动化开关"
          subtitle="保存后对运行中的 bot 立即生效（无需重启）"
          className="compactCard"
        >
          <div className="switchList">
            <label className="switchRow">
              <span className="switchLabel">自动收获</span>
              <input
                type="checkbox"
                checked={autoHarvest}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoHarvest(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoHarvest: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动施肥</span>
              <input
                type="checkbox"
                checked={autoFertilize}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoFertilize(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoFertilize: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动浇水</span>
              <input
                type="checkbox"
                checked={autoWater}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoWater(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoWater: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动除草</span>
              <input
                type="checkbox"
                checked={autoWeed}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoWeed(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoWeed: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动除虫</span>
              <input
                type="checkbox"
                checked={autoBug}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoBug(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoBug: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动种植</span>
              <input
                type="checkbox"
                checked={autoPlant}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoPlant(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoPlant: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabelRow">
                <span className="switchLabel">巡视好友农场</span>
                {typeof snapshot?.config?.automation?.autoFriendFarm === "boolean" ? (
                  <span className={snapshot.config.automation.autoFriendFarm ? "miniPill ok" : "miniPill off"}>
                    {snapshot.config.automation.autoFriendFarm ? "运行中：开" : "运行中：关"}
                  </span>
                ) : null}
              </span>
              <input
                type="checkbox"
                checked={autoFriendFarm}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoFriendFarm(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoFriendFarm: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动任务（领取奖励）</span>
              <input
                type="checkbox"
                checked={autoTask}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoTask(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoTask: next } });
                }}
              />
            </label>
            <label className="switchRow">
              <span className="switchLabel">自动出售（背包果实）</span>
              <input
                type="checkbox"
                checked={autoSell}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAutoSell(next);
                  setDirty(true);
                  void saveWithOverrides({ automation: { autoSell: next } });
                }}
              />
            </label>
          </div>

          <div className="divider" />

          <div className="formGrid four-cols">
            <label className="field">
              <div className="fieldLabel">固定最低等级作物</div>
              <select
                className="fieldInput select"
                value={forceLowestLevelCrop ? "on" : "off"}
                onChange={(e) => {
                  const next = e.target.value === "on";
                  setForceLowestLevelCrop(next);
                  setDirty(true);
                  if (next) {
                    setForceLatestLevelCrop(false);
                    setFixedSeedId("");
                    void saveWithOverrides({
                      farming: { forceLowestLevelCrop: true, forceLatestLevelCrop: false },
                      fixedSeedIdRaw: "",
                    });
                  } else {
                    void saveWithOverrides({ farming: { forceLowestLevelCrop: false } });
                  }
                }}
              >
                <option value="off">关闭</option>
                <option value="on">开启</option>
              </select>
              <div className="fieldHint">开启后会跳过经验效率分析，固定选择最低等级作物。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">只种最新等级作物</div>
              <select
                className="fieldInput select"
                value={forceLatestLevelCrop ? "on" : "off"}
                onChange={(e) => {
                  const next = e.target.value === "on";
                  setForceLatestLevelCrop(next);
                  setDirty(true);
                  if (next) {
                    setForceLowestLevelCrop(false);
                    setFixedSeedId("");
                    void saveWithOverrides({
                      farming: { forceLowestLevelCrop: false, forceLatestLevelCrop: true },
                      fixedSeedIdRaw: "",
                    });
                  } else {
                    void saveWithOverrides({ farming: { forceLatestLevelCrop: false } });
                  }
                }}
              >
                <option value="off">关闭</option>
                <option value="on">开启</option>
              </select>
              <div className="fieldHint">开启后固定选择当前等级最新解锁的作物。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">禁用自动推荐</div>
              <select
                className="fieldInput select"
                value={disableAutoRecommend ? "on" : "off"}
                onChange={(e) => {
                  const next = e.target.value === "on";
                  setDisableAutoRecommend(next);
                  setDirty(true);
                  void saveWithOverrides({ farming: { disableAutoRecommend: next } });
                }}
              >
                <option value="off">否（启用自动推荐）</option>
                <option value="on">是（禁用自动推荐）</option>
              </select>
              <div className="fieldHint">禁用后，将不会自动选择最佳经验作物。</div>
            </label>

            <label className="field">
              <div className="fieldLabel">指定种子</div>
              <select
                className="fieldInput select"
                value={fixedSeedId === "" ? "auto" : String(fixedSeedId)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "auto") {
                    setFixedSeedId("");
                    setDirty(true);
                    scheduleSave({ fixedSeedIdRaw: "" }, 600);
                    return;
                  }
                  const next = Number(v);
                  if (!Number.isFinite(next) || next <= 0) {
                    setFixedSeedId("");
                    setDirty(true);
                    return;
                  }
                  setForceLowestLevelCrop(false);
                  setForceLatestLevelCrop(false);
                  setFixedSeedId(next);
                  setDirty(true);
                  scheduleSave({ farming: { forceLowestLevelCrop: false, forceLatestLevelCrop: false }, fixedSeedIdRaw: next }, 600);
                }}
              >
                <option value="auto">{disableAutoRecommend ? "自动推荐已禁用" : "自动推荐（最佳经验优先）"}</option>
                {seedOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {seedLoading ? <div className="fieldHint">种子清单加载中…</div> : null}
              {!seedLoading && seedError ? <div className="fieldHint">种子清单加载失败：{seedError}</div> : null}
              {!seedLoading && !seedError ? <div className="fieldHint">优先级高于推荐；不可购买/未解锁时会自动回退到推荐策略。</div> : null}
            </label>
          </div>



          {error ? <div className="formError">{error}</div> : null}
          {ok ? <div className="formOk">{ok}</div> : null}
        </GlassCard>
      </div>
    </div>
  );
}
