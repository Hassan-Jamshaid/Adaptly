from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pypdf import PdfReader
import requests
from bs4 import BeautifulSoup
from app.core.dependencies import get_current_user
from app.core.db import db
from app.models.content_model import build_content_doc
from app.services.text_processing import chunk_text
import io

router = APIRouter(prefix="/content", tags=["content"])


@router.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...), user=Depends(get_current_user)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")

    contents = await file.read()
    reader = PdfReader(io.BytesIO(contents))
    raw_text = ""
    for page in reader.pages:
        raw_text += page.extract_text() or ""

    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from PDF")

    chunks = chunk_text(raw_text)
    doc = build_content_doc(user["uid"], "pdf", file.filename, chunks, source=file.filename)
    result = db.content.insert_one(doc)
    return {"content_id": str(result.inserted_id), "chunk_count": len(chunks)}


@router.post("/paste-text")
def paste_text(title: str = Form(...), text: str = Form(...), user=Depends(get_current_user)):
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    chunks = chunk_text(text)
    doc = build_content_doc(user["uid"], "text", title, chunks)
    result = db.content.insert_one(doc)
    return {"content_id": str(result.inserted_id), "chunk_count": len(chunks)}


@router.post("/from-url")
def from_url(url: str = Form(...), user=Depends(get_current_user)):
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
    except Exception:
        raise HTTPException(status_code=422, detail="Could not fetch URL")

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    raw_text = soup.get_text(separator=" ", strip=True)

    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="No readable content found on page")

    title = soup.title.string if soup.title else url
    chunks = chunk_text(raw_text)
    doc = build_content_doc(user["uid"], "website", title, chunks, source=url)
    result = db.content.insert_one(doc)
    return {"content_id": str(result.inserted_id), "chunk_count": len(chunks)}


@router.get("/list")
def list_content(user=Depends(get_current_user)):
    items = list(db.content.find({"uid": user["uid"]}, {"chunks": 0}))
    for item in items:
        item["_id"] = str(item["_id"])
    return items