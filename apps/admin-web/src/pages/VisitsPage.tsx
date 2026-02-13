import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useData } from "../lib/data";
import { formatDateTime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";

type DirFilter = "all" | "incoming" | "outgoing";
type KindFilter = "all" | "visit" | "steal" | "weed" | "bug" | "water";

/**
 * 将到访类型转换为更直观的中文标签。
 */
function formatKind(kind: "visit" | "steal" | "weed" | "bug" | "water"): string {
  if (kind === "visit") return "巡访";
  if (kind === "steal") return "偷菜";
  if (kind === "weed") return "放草";
  if (kind === "bug") return "放虫";
  return "浇水";
}

/**
 * 将方向转换为中文。
 */
function formatDirection(dir: "incoming" | "outgoing"): string {
  return dir === "incoming" ? "来访" : "我去";
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

export function VisitsPage(): React.JSX.Element {
  const data = useData();
  const visits = data.snapshot?.bot?.visits ?? null;
  const [dir, setDir] = useState<DirFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const isNarrow = useIsNarrow(720);

  const list = useMemo(() => {
    const raw = visits?.items ?? [];
    const q = search.trim().toLowerCase();
    return raw
      .filter((x) => {
        if (dir !== "all" && x.direction !== dir) return false;
        if (kind !== "all" && x.kind !== kind) return false;
        if (!q) return true;
        const name = x.name ? x.name : "";
        const hay = `${x.ts} ${x.gid} ${name} ${x.kind} ${x.direction} ${x.message}`.toLowerCase();
        return hay.includes(q);
      })
      .slice()
      .sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id));
  }, [dir, kind, search, visits?.items]);

  const stats = useMemo(() => {
    const raw = visits?.items ?? [];
    let incoming = 0;
    let outgoing = 0;
    const byKind: Record<string, number> = {};
    for (const x of raw) {
      if (x.direction === "incoming") incoming += 1;
      else outgoing += 1;
      byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    }
    return { incoming, outgoing, byKind };
  }, [visits?.items]);

  return (
    <div className="grid">
      <div className="gridSpan2">
        <GlassCard
          title="到访记录"
          subtitle={visits ? `更新时间 ${new Date(visits.updatedAt).toLocaleString(undefined, { hour12: false })}` : "等待数据推送..."}
          right={
            <div className="row">
              <span className="chip">
                <span className="dot dot-accent" />
                <span className="mono">来访 {stats.incoming}</span>
              </span>
              <span className="chip">
                <span className="dot dot-blue" />
                <span className="mono">我去 {stats.outgoing}</span>
              </span>
            </div>
          }
        >
          <div className="seedsTools">
            <input className="fieldInput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 时间 / gid / 名称 / 动作 / 描述" />
            <div className="row seedsPager">
              <select className="fieldInput select" value={dir} onChange={(e) => setDir(e.target.value as DirFilter)}>
                <option value="all">全部方向</option>
                <option value="incoming">来访</option>
                <option value="outgoing">我去</option>
              </select>
              <select className="fieldInput select" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
                <option value="all">全部动作</option>
                <option value="visit">巡访</option>
                <option value="steal">偷菜</option>
                <option value="weed">放草</option>
                <option value="bug">放虫</option>
                <option value="water">浇水</option>
              </select>
            </div>
          </div>

          {isNarrow ? (
            <div className="mobileCards">
              {list.length ? (
                list.map((x) => (
                  <div className="mobileCard" key={x.id}>
                    <div className="mobileCardTop">
                      <div className="mobileCardTitle mono">{x.name ?? `GID ${x.gid}`}</div>
                      <div className="mobileCardRight mono">{formatDirection(x.direction)}</div>
                    </div>
                    <div className="mobileCardMeta">
                      <span className="chip mono">{formatKind(x.kind)}</span>
                      <span className="chip mono">GID {x.gid}</span>
                      <span className="chip mono">{formatDateTime(x.ts)}</span>
                    </div>
                    <div className="mobileCardSub mono muted">{x.message}</div>
                  </div>
                ))
              ) : (
                <div className="mobileEmpty muted">暂无数据（来访：从土地数据的偷菜/放草/放虫痕迹推断；我去：从好友巡查动作汇总）</div>
              )}
            </div>
          ) : (
            <div className="seedsTableWrap">
              <table className="seedsTable">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方向</th>
                    <th className="tdNum">GID</th>
                    <th>好友</th>
                    <th>动作</th>
                    <th>描述</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length ? (
                    list.map((x) => (
                      <tr key={x.id}>
                        <td className="mono">{formatDateTime(x.ts)}</td>
                        <td className="mono">{formatDirection(x.direction)}</td>
                        <td className="tdNum mono">{x.gid}</td>
                        <td className="tdName mono">{x.name ?? "—"}</td>
                        <td className="mono">{formatKind(x.kind)}</td>
                        <td className="mono muted">{x.message}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="muted" colSpan={6}>
                        暂无数据（来访：从土地数据的偷菜/放草/放虫痕迹推断；我去：从好友巡查动作汇总）
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
