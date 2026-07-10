import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase/config";
import axios from "axios";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const routeByBackendProfile = async () => {
    const token = await auth.currentUser.getIdToken();
    const res = await axios.get("http://127.0.0.1:8000/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { mode, corporate_role } = res.data;
    if (mode === "corporate") navigate(corporate_role === "hr_admin" ? "/hr" : "/employee");
    else navigate("/learner");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await routeByBackendProfile();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
      await routeByBackendProfile();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "3rem auto", fontFamily: "sans-serif" }}>
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
          style={{ display: "block", width: "100%", marginBottom: "0.5rem", padding: "0.5rem" }} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ display: "block", width: "100%", marginBottom: "0.5rem", padding: "0.5rem" }} />
        <button type="submit" style={{ width: "100%", padding: "0.6rem" }}>Login</button>
      </form>
      <button onClick={handleGoogleLogin} style={{ width: "100%", padding: "0.6rem", marginTop: "0.5rem" }}>
        Sign in with Google
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}