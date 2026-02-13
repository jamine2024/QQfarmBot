import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useAuth } from "../lib/auth";
import { useData, type LogEntry } from "../lib/data";
import { formatDateTime } from "../lib/format";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";

export function LogsPage(): React.JSX.Element {
  const auth = useAuth();
  const data = useData();

  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const display = useMemo(() => data.logs.slice(-600), [data.logs]);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [autoScroll, display.length]);

  async function exportLogs(): Promise<void> {
    try {
      const res = await fetch("/api/logs/export", { headers: { authorization: `Bearer ${auth.token}` } });
      if (!res.ok) throw new Error("EXPORT_FAILED");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logs-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.ndjson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      return;
    }
  }

  async function clearLogs(): Promise<void> {
    try {
      const ok = window.confirm("确定要清空历史日志吗？此操作不可恢复。");
      if (!ok) return;
      const res = await fetch("/api/logs/clear", { method: "POST", headers: { authorization: `Bearer ${auth.token}` } });
      if (!res.ok) throw new Error("CLEAR_FAILED");
      data.setLogs([]);
      setSelected(null);
    } catch {
      return;
    }
  }

  return (
    <div className="grid">
      <div className="gridSpan2">
        <GlassCard
          title="日志"
          subtitle="实时推送、导出与详情追踪"
          right={
            <div className="row">
              <Button size="sm" variant="ghost" onClick={exportLogs}>
                导出
              </Button>
              <Button size="sm" variant="danger" onClick={clearLogs}>
                清空
              </Button>
            </div>
          }
        >
          <div className="tableTools">
            <label className="toggle">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              <span>自动滚动</span>
            </label>
            <div className="muted">显示最近 {display.length} 条</div>
          </div>

          <div className="logList">
            {display.map((x) => (
              <button key={x.id} className={["logRow", `log-${x.level}`].join(" ")} onClick={() => setSelected(x)}>
                <div className="logTs">{formatDateTime(x.ts)}</div>
                <div className="logScope mono">{x.scope}</div>
                <div className="logMsg">
                  <span className="logMsgText">{x.message}</span>
                  {(x.repeat ?? 1) > 1 ? <span className="logRepeat">×{x.repeat}</span> : null}
                </div>
              </button>
            ))}
            <div ref={bottomRef} />
          </div>
        </GlassCard>
      </div>

      {selected ? (
        <div className="modalBack" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="glass modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <div className="modalTitle">日志详情</div>
                <div className="modalSub">
                  <span className="pill">{selected.level.toUpperCase()}</span>
                  <span className="mono">{selected.scope}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                关闭
              </Button>
            </div>
            <pre className="modalPre">{JSON.stringify(selected, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
