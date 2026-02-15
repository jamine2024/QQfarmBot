import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatDateTime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";

type BagKind = "gold" | "seed" | "fruit" | "item";
type SortKey = "name" | "id" | "kind" | "count" | "unitPriceGold" | "totalGold";
type SortDir = "asc" | "desc";

/**
 * 以更紧凑的形式格式化金币显示（tabular 视觉更稳定）。
 */
function formatGold(v: number | null | undefined, opts?: { maxFractionDigits?: number }): string {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return "—";
  const maxFractionDigits = typeof opts?.maxFractionDigits === "number" ? opts.maxFractionDigits : 0;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function formatCount(v: number | null | undefined): string {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return "—";
  return Math.floor(n).toLocaleString();
}

/**
 * 显示背包条目的类型名称。
 */
function formatKind(kind: "gold" | "seed" | "fruit" | "item"): string {
  if (kind === "gold") return "货币";
  if (kind === "seed") return "种子";
  if (kind === "fruit") return "果实";
  return "道具";
}

/**
 * 计算条目总价值（金币）。没有单价时返回 null。
 */
function calcTotalGold(count: number, unitPriceGold: number | null): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (typeof unitPriceGold !== "number" || !Number.isFinite(unitPriceGold) || unitPriceGold < 0) return null;
  return Math.round(count * unitPriceGold * 10000) / 10000;
}

type BagItemView = {
  id: number;
  kind: "gold" | "seed" | "fruit" | "item";
  name: string;
  count: number;
  unitPriceGold: number | null;
  totalGold: number | null;
};

/**
 * 合并同一种类、同一 ID、同一单价的背包条目，避免重复 key 导致的渲染残留/错乱。
 */
function compactBagItems(input: BagItemView[]): BagItemView[] {
  const map = new Map<string, BagItemView>();
  for (const x of input) {
    const priceKey = x.unitPriceGold == null ? "n" : String(x.unitPriceGold);
    const key = `${x.kind}:${x.id}:${priceKey}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, x);
      continue;
    }
    const nextCount = prev.count + x.count;
    map.set(key, {
      ...prev,
      count: nextCount,
      totalGold: calcTotalGold(nextCount, prev.unitPriceGold),
    });
  }
  return Array.from(map.values());
}

function useIsNarrow(maxWidthPx: number): boolean {
  const [ok, setOk] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.(`(max-width: ${maxWidthPx}px)`)?.matches ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia?.(`(max-width: ${maxWidthPx}px)`);
    if (!mql) return;
    const onChange = () => setOk(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [maxWidthPx]);

  return ok;
}

function BagSortTh(props: {
  label: string;
  k: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (k: SortKey) => void;
}): React.JSX.Element {
  const active = props.sortKey === props.k;
  const arrow = active ? (props.sortDir === "asc" ? "▲" : "▼") : "↕";
  const cls = ["seedsThBtn", active ? "active" : "", props.align === "right" ? "right" : ""].filter(Boolean).join(" ");
  return (
    <th>
      <button type="button" className={cls} onClick={() => props.onToggle(props.k)}>
        <span>{props.label}</span>
        <span className="seedsThArrow">{arrow}</span>
      </button>
    </th>
  );
}

export function BagPage(): React.JSX.Element {
  const data = useData();
  const bag = data.snapshot?.bot?.bag ?? null;
  const totalCount = bag?.items?.length ?? 0;
  const [kind, setKind] = useState<BagKind>("fruit");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalGold");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const isNarrow = useIsNarrow(720);

  function defaultSortDir(key: SortKey): SortDir {
    if (key === "name") return "asc";
    if (key === "id") return "asc";
    if (key === "kind") return "asc";
    return "desc";
  }

  function toggleSort(key: SortKey): void {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir(defaultSortDir(key));
        return key;
      }
      setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }

  const list = useMemo(() => {
    const raw = bag?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = raw.filter((x) => {
      if (x.kind !== kind) return false;
      if (!q) return true;
      const hay = `${x.name} ${x.id} ${x.kind} ${formatKind(x.kind)}`.toLowerCase();
      return hay.includes(q);
    });

    const withTotal = filtered.map((x) => ({
      ...x,
      totalGold: calcTotalGold(x.count, x.unitPriceGold),
    })) satisfies BagItemView[];

    const compacted = compactBagItems(withTotal);

    compacted.sort((a, b) => {
      const kindRank: Record<(typeof a)["kind"], number> = { fruit: 0, seed: 1, item: 2, gold: 3 };
      const dir = sortDir === "asc" ? 1 : -1;
      const cmpNullLast = (av: number | null, bv: number | null): number => {
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return dir * (av - bv);
      };

      if (sortKey === "name") return dir * a.name.localeCompare(b.name, "zh-Hans-CN") || a.id - b.id;
      if (sortKey === "id") return dir * (a.id - b.id) || a.name.localeCompare(b.name, "zh-Hans-CN");
      if (sortKey === "kind") return dir * (kindRank[a.kind] - kindRank[b.kind]) || a.id - b.id;
      if (sortKey === "count") return dir * (a.count - b.count) || a.id - b.id;
      if (sortKey === "unitPriceGold") return cmpNullLast(a.unitPriceGold, b.unitPriceGold) || a.id - b.id;
      return cmpNullLast(a.totalGold, b.totalGold) || dir * (a.count - b.count) || a.id - b.id;
    });

    return compacted;
  }, [bag?.items, kind, search, sortDir, sortKey]);

  const totalGold = useMemo(() => {
    const items = bag?.items ?? [];
    const acc = items.reduce((sum, x) => {
      const v = calcTotalGold(x.count, x.unitPriceGold);
      if (v == null) return sum;
      return sum + v;
    }, 0);
    if (!items.length) return null;
    if (!Number.isFinite(acc)) return null;
    return Math.round(acc * 100) / 100;
  }, [bag?.items]);

  return (
    <div className="grid">
      <div className="gridSpan2">
        <GlassCard
          title="我的背包"
          subtitle={bag ? `更新时间 ${new Date(bag.updatedAt).toLocaleString(undefined, { hour12: false })}` : "等待数据推送..."}
          right={
            <div className="chip">
              <span className="dot dot-blue" />
              <span className="mono">
                {list.length}/{totalCount} 项
              </span>
              {totalGold != null ? <span className="mono muted">≈ {formatGold(totalGold, { maxFractionDigits: 2 })}</span> : null}
            </div>
          }
        >
          <div className="seedsTools">
            <input className="fieldInput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 名称 / ID / 类型" />
            <div className="bagToolsRight">
              <div className="seg" role="tablist" aria-label="背包类型筛选">
                <button
                  type="button"
                  className={kind === "fruit" ? "segBtn active" : "segBtn"}
                  onClick={(e) => {
                    e.preventDefault();
                    setKind("fruit");
                  }}
                  role="tab"
                  aria-selected={kind === "fruit"}
                >
                  果实
                </button>
                <button
                  type="button"
                  className={kind === "seed" ? "segBtn active" : "segBtn"}
                  onClick={(e) => {
                    e.preventDefault();
                    setKind("seed");
                  }}
                  role="tab"
                  aria-selected={kind === "seed"}
                >
                  种子
                </button>
                <button
                  type="button"
                  className={kind === "item" ? "segBtn active" : "segBtn"}
                  onClick={(e) => {
                    e.preventDefault();
                    setKind("item");
                  }}
                  role="tab"
                  aria-selected={kind === "item"}
                >
                  道具
                </button>
                <button
                  type="button"
                  className={kind === "gold" ? "segBtn active" : "segBtn"}
                  onClick={(e) => {
                    e.preventDefault();
                    setKind("gold");
                  }}
                  role="tab"
                  aria-selected={kind === "gold"}
                >
                  货币
                </button>
              </div>
            </div>
          </div>

          {isNarrow ? (
            <div className="mobileCards">
              {list.length ? (
                list.map((x) => (
                  <div className="mobileCard" key={`${x.kind}-${x.id}-${x.unitPriceGold ?? "n"}`}>
                    <div className="mobileCardTop">
                      <div className="mobileCardTitle mono">{x.name}</div>
                      <div className="mobileCardRight mono">{formatCount(x.count)}</div>
                    </div>
                    <div className="mobileCardMeta">
                      <span className="chip mono">{formatKind(x.kind)}</span>
                      <span className="chip mono">ID {x.id}</span>
                      {x.unitPriceGold != null ? <span className="chip mono">单价 {formatGold(x.unitPriceGold, { maxFractionDigits: 4 })}</span> : null}
                      {x.totalGold != null ? <span className="chip mono">总价 {formatGold(x.totalGold, { maxFractionDigits: 2 })}</span> : null}
                    </div>
                    <div className="mobileCardSub mono muted">{bag ? formatDateTime(new Date(bag.updatedAt).toISOString()) : "—"}</div>
                  </div>
                ))
              ) : (
                <div className="mobileEmpty muted">暂无数据（需要 bot 已连接，且背包轮询成功）</div>
              )}
            </div>
          ) : (
            <div className="seedsTableWrap">
              <table className="seedsTable">
                <thead>
                  <tr>
                    <BagSortTh label="名称" k="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <BagSortTh label="ID" k="id" align="right" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <BagSortTh label="类型" k="kind" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <BagSortTh label="数量" k="count" align="right" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <BagSortTh label="单价(金)" k="unitPriceGold" align="right" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <BagSortTh label="总价(金)" k="totalGold" align="right" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length ? (
                    list.map((x) => (
                      <tr key={`${x.kind}-${x.id}-${x.unitPriceGold ?? "n"}`}>
                        <td className="tdName mono">{x.name}</td>
                        <td className="tdNum mono">{x.id}</td>
                        <td className="mono">{formatKind(x.kind)}</td>
                        <td className="tdNum mono">{formatCount(x.count)}</td>
                        <td className="tdNum mono">{x.unitPriceGold != null ? formatGold(x.unitPriceGold, { maxFractionDigits: 4 }) : "—"}</td>
                        <td className="tdNum mono">{x.totalGold != null ? formatGold(x.totalGold, { maxFractionDigits: 2 }) : "—"}</td>
                        <td className="mono muted">{bag ? formatDateTime(new Date(bag.updatedAt).toISOString()) : "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="muted" colSpan={7}>
                        暂无数据（需要 bot 已连接，且背包轮询成功）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
