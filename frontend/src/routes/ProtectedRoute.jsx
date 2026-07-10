import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedMode, allowedRole }) {
  const { currentUser, profile } = useAuth();

  if (!currentUser) return <Navigate to="/login" />;
  if (!profile) return <Navigate to="/login" />;
  if (allowedMode && profile.mode !== allowedMode) return <Navigate to="/login" />;
  if (allowedRole && profile.corporate_role !== allowedRole) return <Navigate to="/login" />;

  return children;
}