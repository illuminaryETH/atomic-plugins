import { Routes, Route, Navigate } from "react-router-dom";
import { hasToken } from "./api";
import Landing from "./pages/Landing";
import Success from "./pages/Success";
import Dashboard from "./pages/Dashboard";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!hasToken()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/auth/verify" element={<Verify />} />
        <Route path="/success" element={<Success />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  );
}
