import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatDateTime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";

type BagKind = "all" | "gold" | "seed" | "fruit" | "item";
type SortKey = "value_desc" | "count_desc" | "name_asc";

/**
 * 以更紧凑的形式格式化金币显示（tabular 视觉更稳定）。
 */
function formatGold(v: number | null | undefined): string {
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
  if (typeof unitPriceGold !== "number" || !Number.isFinite(unitPriceGold) || unitPriceGold <= 0) return null;
  return Math.round(count * unitPriceGold * 10000) / 10000;
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

export function BagPage(): React.JSX.Element {
  const data = useData();
  const bag = data.snapshot?.bot?.bag ?? null;
  const [kind, setKind] = useState<BagKind>("all");
  const [sortKey, setSortKey] = useState<SortKey>("value_desc");
  const [search, setSearch] = useState("");
  const isNarrow = useIsNarrow(720);

  const list = useMemo(() => {
    const raw = bag?.items ?? [];
    const q = search.trim().toLowerCase();

    const filtered = raw.filter((x) => {
      if (kind !== "all" && x.kind !== kind) return false;
      if (!q) return true;
      const hay = `${x.name} ${x.id} ${x.kind}`.toLowerCase();
      return hay.includes(q);
    });

    const withTotal = filtered.map((x) => ({
      ...x,
      totalGold: calcTotalGold(x.count, x.unitPriceGold),
    }));

    withTotal.sort((a, b) => {
      if (sortKey === "count_desc") return b.count - a.count || a.id - b.id;
      if (sortKey === "name_asc") return a.name.localeCompare(b.name) || a.id - b.id;
      const av = a.totalGold ?? -1;
      const bv = b.totalGold ?? -1;
      return bv - av || b.count - a.count || a.id - b.id;
    });

    return withTotal;
  }, [bag?.items, kind, search, sortKey]);

  const totalGold = useMemo(() => {
    const items = bag?.items ?? [];
    const acc = items.reduce((sum, x) => {
      const v = calcTotalGold(x.count, x.unitPriceGold);
      if (v == null) return sum;
      return sum + v;
    }, 0);
    if (!items.length) return null;
    if (!Number.isFinite(acc) || acc <= 0) return null;
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
              <span className="mono">{list.length} 项</span>
              {totalGold != null ? <span className="mono muted">≈ {formatGold(totalGold)}</span> : null}
            </div>
          }
        >
          <div className="seedsTools">
            <input className="fieldInput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 名称 / ID / 类型" />
            <div className="bagToolsRight">
              <div className="seg" role="tablist" aria-label="背包类型筛选">
                <button className={kind === "all" ? "segBtn active" : "segBtn"} onClick={() => setKind("all")} role="tab" aria-selected={kind === "all"}>
                  全部
                </button>
                <button className={kind === "gold" ? "segBtn active" : "segBtn"} onClick={() => setKind("gold")} role="tab" aria-selected={kind === "gold"}>
                  货币
                </button>
                <button className={kind === "seed" ? "segBtn active" : "segBtn"} onClick={() => setKind("seed")} role="tab" aria-selected={kind === "seed"}>
                  种子
                </button>
                <button className={kind === "fruit" ? "segBtn active" : "segBtn"} onClick={() => setKind("fruit")} role="tab" aria-selected={kind === "fruit"}>
                  果实
                </button>
                <button className={kind === "item" ? "segBtn active" : "segBtn"} onClick={() => setKind("item")} role="tab" aria-selected={kind === "item"}>
                  道具
                </button>
              </div>
              <div className="seg" role="tablist" aria-label="背包排序">
                <button
                  className={sortKey === "value_desc" ? "segBtn active" : "segBtn"}
                  onClick={() => setSortKey("value_desc")}
                  role="tab"
                  aria-selected={sortKey === "value_desc"}
                >
                  按总价
                </button>
                <button
                  className={sortKey === "count_desc" ? "segBtn active" : "segBtn"}
                  onClick={() => setSortKey("count_desc")}
                  role="tab"
                  aria-selected={sortKey === "count_desc"}
                >
                  按数量
                </button>
                <button
                  className={sortKey === "name_asc" ? "segBtn active" : "segBtn"}
                  onClick={() => setSortKey("name_asc")}
                  role="tab"
                  aria-selected={sortKey === "name_asc"}
                >
                  按名称
                </button>
              </div>
            </div>
          </div>

          {isNarrow ? (
            <div className="mobileCards">
              {list.length ? (
                list.map((x) => (
                  <div className="mobileCard" key={`${x.kind}-${x.id}`}>
                    <div className="mobileCardTop">
                      <div className="mobileCardTitle mono">{x.name}</div>
                      <div className="mobileCardRight mono">{formatGold(x.count)}</div>
                    </div>
                    <div className="mobileCardMeta">
                      <span className="chip mono">{formatKind(x.kind)}</span>
                      <span className="chip mono">ID {x.id}</span>
                      {x.unitPriceGold != null ? <span className="chip mono">单价 {formatGold(x.unitPriceGold)}</span> : null}
                      {x.totalGold != null ? <span className="chip mono">总价 {formatGold(x.totalGold)}</span> : null}
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
                    <th>名称</th>
                    <th className="tdNum">ID</th>
                    <th>类型</th>
                    <th className="tdNum">数量</th>
                    <th className="tdNum">单价(金)</th>
                    <th className="tdNum">总价(金)</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length ? (
                    list.map((x) => (
                      <tr key={`${x.kind}-${x.id}`}>
                        <td className="tdName mono">{x.name}</td>
                        <td className="tdNum mono">{x.id}</td>
                        <td className="mono">{formatKind(x.kind)}</td>
                        <td className="tdNum mono">{formatGold(x.count)}</td>
                        <td className="tdNum mono">{x.unitPriceGold != null ? formatGold(x.unitPriceGold) : "—"}</td>
                        <td className="tdNum mono">{x.totalGold != null ? formatGold(x.totalGold) : "—"}</td>
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
