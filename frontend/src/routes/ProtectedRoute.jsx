import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedMode, allowedRole }) {
  const { currentUser, profile, loading } = useAuth();

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;
  if (!currentUser) return <Navigate to="/login" />;
  if (currentUser && !profile) return <p style={{ padding: "2rem" }}>Loading profile...</p>;
  if (allowedMode && profile.mode !== allowedMode) return <Navigate to="/login" />;
  if (allowedRole && profile.corporate_role !== allowedRole) return <Navigate to="/login" />;

  return children;
}