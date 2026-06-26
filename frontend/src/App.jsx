import { useState, useEffect } from "react";
import Sidebar from "./components/layout/Sidebar";
import Dashboard from "./pages/Dashboard";
import Leaves from "./pages/Leaves";
import Catchups from "./pages/Catchups";
import { getMe, logout, getUsers, getMyLeaves, getTeamLeaves, getMyCatchups, getManagerCatchups } from "./lib/api";
import { isManager } from "./lib/utils";

export default function App() {
  const [currentUser, setCurrentUser]       = useState(null);
  const [loading, setLoading]               = useState(true);
  const [page, setPage]                     = useState("dashboard");

  const [users, setUsers]                   = useState([]);
  const [myLeaves, setMyLeaves]             = useState({ pending: [], upcoming: [], previous: [] });
  const [teamLeavesData, setTeamLeavesData] = useState({ current: [], upcoming: [] });
  const [myCatchups, setMyCatchups]         = useState({ upcoming: [], previous: [] });
  const [managerCatchups, setManagerCatchups] = useState({ upcoming: [], previous: [] });

  useEffect(() => {
    getMe()
      .then(user => {
        setCurrentUser(user);
        fetchAll(user);
      })
      .catch(() => {
        window.location.href = "http://localhost:8000/auth/login";
      })
      .finally(() => setLoading(false));
  }, []);

  async function fetchAll(user) {
    const managerUser = isManager(user);
    const [usersRes, myLeavesRes, teamLeavesRes, catchupsRes] = await Promise.allSettled([
      getUsers(),
      getMyLeaves(),
      getTeamLeaves(),
      managerUser ? getManagerCatchups() : getMyCatchups(),
    ]);

    if (usersRes.status === "fulfilled") setUsers(usersRes.value);
    if (myLeavesRes.status === "fulfilled") setMyLeaves(myLeavesRes.value);
    if (teamLeavesRes.status === "fulfilled") {
      const d = teamLeavesRes.value;
      setTeamLeavesData({ current: d.current || [], upcoming: d.upcoming || [] });
    }
    if (catchupsRes.status === "fulfilled") {
      managerUser ? setManagerCatchups(catchupsRes.value) : setMyCatchups(catchupsRes.value);
    }
  }

  async function refreshLeaves() {
    if (!currentUser) return;
    const [myLeavesData, teamData] = await Promise.all([getMyLeaves(), getTeamLeaves()]);
    setMyLeaves(myLeavesData);
    setTeamLeavesData({ current: teamData.current || [], upcoming: teamData.upcoming || [] });
  }

  async function refreshCatchups() {
    if (!currentUser) return;
    if (isManager(currentUser)) {
      const data = await getManagerCatchups();
      setManagerCatchups(data);
    } else {
      const data = await getMyCatchups();
      setMyCatchups(data);
    }
  }

  function handleUserUpdate(updatedUser) {
    setCurrentUser(updatedUser);
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
  }

  async function handleLogout() {
    await logout();
    window.location.href = "http://localhost:8000/auth/login";
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (!currentUser) return null;

  const allCatchups = [
    ...myCatchups.upcoming,
    ...myCatchups.previous,
    ...managerCatchups.upcoming,
    ...managerCatchups.previous,
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <Sidebar
        page={page}
        setPage={setPage}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {page === "dashboard" && (
          <Dashboard
            currentUser={currentUser}
            users={users}
            teamLeavesData={teamLeavesData}
            catchups={allCatchups}
            onUserUpdate={handleUserUpdate}
          />
        )}
        {page === "leaves" && (
          <Leaves
            currentUser={currentUser}
            myLeaves={myLeaves}
            onRefresh={refreshLeaves}
          />
        )}
        {page === "catchups" && (
          <Catchups
            currentUser={currentUser}
            users={users}
            myCatchups={myCatchups}
            managerCatchups={managerCatchups}
            onRefresh={refreshCatchups}
          />
        )}
      </main>
    </div>
  );
}