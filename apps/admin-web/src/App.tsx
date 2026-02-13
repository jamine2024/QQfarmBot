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
import { NotificationsPage } from "./pages/NotificationsPage";
import { LandsPage } from "./pages/LandsPage";
import { WallpaperPage } from "./pages/WallpaperPage";
import { SeedsPage } from "./pages/SeedsPage";
import { BagPage } from "./pages/BagPage";
import { VisitsPage } from "./pages/VisitsPage";
import { AboutPage } from "./pages/AboutPage";

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
            <Navigate to="/lands" replace />
          </Authed>
        }
      />
      <Route
        path="/notifications"
        element={
          <Authed>
            <Shell title="通知">
              <NotificationsPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/lands"
        element={
          <Authed>
            <Shell title="土地">
              <LandsPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/wallpaper"
        element={
          <Authed>
            <Shell title="壁纸">
              <WallpaperPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/seeds"
        element={
          <Authed>
            <Shell title="种子清单">
              <SeedsPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/bag"
        element={
          <Authed>
            <Shell title="我的背包">
              <BagPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/visits"
        element={
          <Authed>
            <Shell title="到访记录">
              <VisitsPage />
            </Shell>
          </Authed>
        }
      />
      <Route
        path="/about"
        element={
          <Authed>
            <Shell title="关于">
              <AboutPage />
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
