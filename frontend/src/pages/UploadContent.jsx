import { useState } from "react";
import axios from "axios";
import { auth } from "../firebase/config";
import DashboardLayout from "../layouts/DashboardLayout";

export default function UploadContent() {
  const [tab, setTab] = useState("pdf"); // pdf | text | url
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");

  const getAuthHeader = async () => {
    const token = await auth.currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const handlePdfUpload = async (e) => {
    e.preventDefault();
    setStatus("Uploading...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers = await getAuthHeader();
      const res = await axios.post("http://127.0.0.1:8000/content/upload-pdf", formData, { headers });
      setStatus(`Success — ${res.data.chunk_count} chunks created.`);
    } catch (err) {
      setStatus(err.response?.data?.detail || "Upload failed");
    }
  };

  const handleTextUpload = async (e) => {
    e.preventDefault();
    setStatus("Processing...");
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("text", text);
      const headers = await getAuthHeader();
      const res = await axios.post("http://127.0.0.1:8000/content/paste-text", formData, { headers });
      setStatus(`Success — ${res.data.chunk_count} chunks created.`);
    } catch (err) {
      setStatus(err.response?.data?.detail || "Processing failed");
    }
  };

  const handleUrlUpload = async (e) => {
    e.preventDefault();
    setStatus("Fetching URL...");
    try {
      const formData = new FormData();
      formData.append("url", url);
      const headers = await getAuthHeader();
      const res = await axios.post("http://127.0.0.1:8000/content/from-url", formData, { headers });
      setStatus(`Success — ${res.data.chunk_count} chunks created.`);
    } catch (err) {
      setStatus(err.response?.data?.detail || "Fetch failed");
    }
  };

  return (
    <DashboardLayout title="Upload Content">
      <div style={{ marginBottom: "1rem" }}>
        <button onClick={() => setTab("pdf")}>PDF</button>
        <button onClick={() => setTab("text")} style={{ marginLeft: "0.5rem" }}>Paste Text</button>
        <button onClick={() => setTab("url")} style={{ marginLeft: "0.5rem" }}>Website URL</button>
      </div>

      {tab === "pdf" && (
        <form onSubmit={handlePdfUpload}>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} required />
          <button type="submit" style={{ marginLeft: "0.5rem" }}>Upload PDF</button>
        </form>
      )}

      {tab === "text" && (
        <form onSubmit={handleTextUpload}>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required
            style={{ display: "block", marginBottom: "0.5rem", padding: "0.5rem", width: "100%" }} />
          <textarea placeholder="Paste text here" value={text} onChange={(e) => setText(e.target.value)} required rows={6}
            style={{ display: "block", marginBottom: "0.5rem", padding: "0.5rem", width: "100%" }} />
          <button type="submit">Process Text</button>
        </form>
      )}

      {tab === "url" && (
        <form onSubmit={handleUrlUpload}>
          <input placeholder="https://example.com/article" value={url} onChange={(e) => setUrl(e.target.value)} required
            style={{ display: "block", marginBottom: "0.5rem", padding: "0.5rem", width: "100%" }} />
          <button type="submit">Fetch & Process</button>
        </form>
      )}

      {status && <p style={{ marginTop: "1rem" }}>{status}</p>}
    </DashboardLayout>
  );
}