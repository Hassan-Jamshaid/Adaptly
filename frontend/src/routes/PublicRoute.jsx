import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PublicRoute({ children }) {
  const { currentUser, profile } = useAuth();

  if (currentUser && profile) {
    if (profile.mode === "corporate") {
      return <Navigate to={profile.corporate_role === "hr_admin" ? "/hr" : "/employee"} />;
    }
    return <Navigate to="/learner" />;
  }

  return children;
}