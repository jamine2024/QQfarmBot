import { useEffect, useMemo, useRef, useState } from "react";

export type WsMessage =
  | { type: "log:init"; data: unknown[] }
  | { type: "log:append"; data: unknown }
  | { type: "snapshot"; data: unknown }
  | { type: "pong" };

type WsState = {
  connected: boolean;
  lastMessage: WsMessage | null;
};

export function useAdminWs(token: string | null): WsState {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    if (!token) return null;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${location.host}/ws?token=${encodeURIComponent(token)}`;
  }, [token]);

  useEffect(() => {
    if (!wsUrl) return;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WsMessage;
        setLastMessage(msg);
      } catch {
        return;
      }
    };

    const pingTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        return;
      }
    }, 25_000);

    return () => {
      clearInterval(pingTimer);
      try {
        ws.close();
      } catch {
        return;
      }
    };
  }, [wsUrl]);

  return { connected, lastMessage };
}
