import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PublicRoute({ children }) {
  const { currentUser, profile, loading } = useAuth();

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  if (currentUser && profile) {
    if (profile.mode === "corporate") {
      return <Navigate to={profile.corporate_role === "hr_admin" ? "/hr" : "/employee"} />;
    }
    return <Navigate to="/learner" />;
  }

  return children;
}