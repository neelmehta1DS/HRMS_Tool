import { Navigate, Outlet } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";

// One guard for every admin page, instead of one copy per page.
export default function AdminRoute() {
  const { user } = useUser();
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return <Outlet />;
}
