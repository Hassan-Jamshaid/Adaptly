import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function DashboardLayout({ title, children }) {
  const navigate = useNavigate();
  const { currentUser, profile } = useAuth();

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 2rem", borderBottom: "1px solid #ddd" }}>
        <strong>Adaptly</strong>
        <div>
          <span style={{ marginRight: "1rem" }}>
            {currentUser?.email} ({profile?.mode}{profile?.corporate_role ? ` / ${profile.corporate_role}` : ""})
          </span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </nav>
      <main style={{ padding: "2rem" }}>
        <h2>{title}</h2>
        {children}
      </main>
    </div>
  );
}