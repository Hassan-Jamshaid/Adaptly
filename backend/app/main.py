from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.dependencies import get_current_user
from app.routes.user_routes import router as user_router
from app.routes.content_routes import router as content_router

app = FastAPI(title="Adaptly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router)
app.include_router(content_router)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/me")
def read_current_user(user=Depends(get_current_user)):
    return {"uid": user["uid"], "email": user.get("email")}