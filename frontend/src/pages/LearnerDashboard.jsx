import { useEffect, useState } from "react";
import axios from "axios";
import { auth } from "../firebase/config";
import DashboardLayout from "../layouts/DashboardLayout";
import { Link } from "react-router-dom";

export default function LearnerDashboard() {
  const [content, setContent] = useState([]);

  useEffect(() => {
    const fetchContent = async () => {
      const token = await auth.currentUser.getIdToken();
      const res = await axios.get("http://127.0.0.1:8000/content/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContent(res.data);
    };
    fetchContent();
  }, []);

  return (
    <DashboardLayout title="Learner Dashboard">
      <Link to="/upload">+ Upload New Content</Link>
      <ul style={{ marginTop: "1rem" }}>
        {content.map((item) => (
          <li key={item._id}>
            {item.title} — {item.type} ({item.status})
          </li>
        ))}
      </ul>
    </DashboardLayout>
  );
}