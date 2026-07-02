import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import AuthLayout from "./components/layout/AuthLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Leaves from "./pages/Leaves";
import Catchups from "./pages/Catchups";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<AuthLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/leaves" element={<Leaves />} />
          <Route path="/catchups" element={<Catchups />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
