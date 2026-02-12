import { useEffect } from "react";
import type React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { useAuth } from "./lib/auth";
import { useAdminWs } from "./lib/ws";
import { useData, type LogEntry, type Snapshot } from "./lib/data";
import { Shell } from "./app/Shell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App(): React.JSX.Element {
  const auth = useAuth();
  const data = useData();
  const ws = useAdminWs(auth.token);

  useEffect(() => {
    const msg = ws.lastMessage;
    if (!msg) return;
    if (msg.type === "log:init") data.setLogs(msg.data as LogEntry[]);
    if (msg.type === "log:append") data.appendLog(msg.data as LogEntry);
    if (msg.type === "snapshot") data.setSnapshot(msg.data as Snapshot);
  }, [data, ws.lastMessage]);

  return (
    <Routes>
      <Route path="/login" element={auth.isAuthed ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <Authed>
            <Shell title="控制台">
              <DashboardPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/settings"
        element={
          <Authed>
            <Shell title="配置管理">
              <SettingsPage />
            </Shell>
          </Authed>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Authed(props: { children: React.ReactNode }): React.JSX.Element {
  const auth = useAuth();
  if (!auth.isAuthed) return <Navigate to="/login" replace />;
  return <>{props.children}</>;
}
