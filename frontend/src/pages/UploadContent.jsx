import { useState } from "react";
import axios from "axios";
import { auth } from "../firebase/config";
import DashboardLayout from "../layouts/DashboardLayout";

export default function UploadContent() {
  const [tab, setTab] = useState("pdf");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [file, setFile] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
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

  const handleYoutubeUpload = async (e) => {
    e.preventDefault();
    setStatus("Fetching transcript...");
    try {
      const formData = new FormData();
      formData.append("url", youtubeUrl);
      const headers = await getAuthHeader();
      const res = await axios.post("http://127.0.0.1:8000/content/from-youtube", formData, { headers });
      setStatus(`Success — ${res.data.chunk_count} chunks created.`);
    } catch (err) {
      setStatus(err.response?.data?.detail || "Transcript fetch failed");
    }
  };

  const handleVideoUpload = async (e) => {
    e.preventDefault();
    setStatus("Uploading and transcribing... this may take a while.");
    try {
      const formData = new FormData();
      formData.append("file", videoFile);
      const headers = await getAuthHeader();
      const res = await axios.post("http://127.0.0.1:8000/content/upload-video", formData, { headers });
      setStatus(`Success — ${res.data.chunk_count} chunks created.`);
    } catch (err) {
      setStatus(err.response?.data?.detail || "Video transcription failed");
    }
  };

  const tabButtonStyle = (name) => ({
    marginRight: "0.5rem",
    fontWeight: tab === name ? "bold" : "normal",
    textDecoration: tab === name ? "underline" : "none",
  });

  return (
    <DashboardLayout title="Upload Content">
      <div style={{ marginBottom: "1rem" }}>
        <button style={tabButtonStyle("pdf")} onClick={() => setTab("pdf")}>PDF</button>
        <button style={tabButtonStyle("text")} onClick={() => setTab("text")}>Paste Text</button>
        <button style={tabButtonStyle("url")} onClick={() => setTab("url")}>Website URL</button>
        <button style={tabButtonStyle("youtube")} onClick={() => setTab("youtube")}>YouTube</button>
        <button style={tabButtonStyle("video")} onClick={() => setTab("video")}>Upload Video</button>
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

      {tab === "youtube" && (
        <form onSubmit={handleYoutubeUpload}>
          <input placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} required
            style={{ display: "block", marginBottom: "0.5rem", padding: "0.5rem", width: "100%" }} />
          <button type="submit">Fetch Transcript</button>
        </form>
      )}

      {tab === "video" && (
        <form onSubmit={handleVideoUpload}>
          <input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm" onChange={(e) => setVideoFile(e.target.files[0])} required />
          <button type="submit" style={{ marginLeft: "0.5rem" }}>Upload & Transcribe</button>
          <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.5rem" }}>
            Note: video transcription requires backend configuration and may not be active yet.
          </p>
        </form>
      )}

      {status && <p style={{ marginTop: "1rem" }}>{status}</p>}
    </DashboardLayout>
  );
}