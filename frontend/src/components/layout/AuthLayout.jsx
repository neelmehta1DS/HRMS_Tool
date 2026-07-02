import { useState, useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { getMe } from "../../lib/api";
import { UserContext } from "../../contexts/UserContext";
import Sidebar from "./Sidebar";

export default function AuthLayout() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <UserContext.Provider value={{ user, setUser }}>
      <div className="flex h-screen overflow-hidden bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </UserContext.Provider>
  );
}
