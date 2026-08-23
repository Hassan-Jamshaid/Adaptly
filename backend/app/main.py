import threading

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.dependencies import get_current_user
from app.routes.user_routes import router as user_router
from app.routes.content_routes import router as content_router
from app.routes.engagement_routes import router as engagement_router

app = FastAPI(title="Adaptly API")

# Tracks whether the engagement model has finished loading, so the frontend can
# say "warming up" instead of showing a blank panel.
_model_ready = threading.Event()


@app.on_event("startup")
def warm_up_engagement_model():
    """
    Load TensorFlow and the engagement model in a BACKGROUND thread.

    TensorFlow is imported lazily (see engagement_model.py) so that uvicorn
    accepts connections in ~0.6s instead of ~20s. That fixed startup, but moved
    the cost to the first prediction: measured at 13.3s, during which the study
    session showed nothing at all.

    Loading it on a background thread at startup gets both. The server is
    reachable immediately, and TensorFlow finishes loading while the user is
    logging in and navigating — so by the time a session has buffered its first
    10 frames the model is already warm and predictions take ~0.2s.

    daemon=True so this thread never blocks shutdown.
    """

    def _load():
        try:
            from app.ml.engagement_model import load_engagement_model

            load_engagement_model()
        except Exception as exc:  # never let a warm-up failure kill startup
            print(f"[startup] engagement model warm-up failed: {exc}")
        finally:
            # Set either way: on failure the first real request will retry and
            # surface a proper error rather than the UI waiting forever.
            _model_ready.set()

    threading.Thread(target=_load, name="engagement-model-warmup", daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    # Vite silently moves to the next free port (5174, 5175, ...) whenever 5173
    # is already taken, and the browser treats localhost and 127.0.0.1 as
    # different origins. Pinning one exact origin meant any of those situations
    # broke every API call with an opaque "Network Error".
    # TIGHTEN THIS to the real deployed origin before going to production.
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router)
app.include_router(content_router)
app.include_router(engagement_router)

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/engagement-model/status")
def engagement_model_status():
    """Lets the study session show 'warming up' rather than an empty panel."""
    return {"ready": _model_ready.is_set()}

@app.get("/me")
def read_current_user(user=Depends(get_current_user)):
    return {"uid": user["uid"], "email": user.get("email")}