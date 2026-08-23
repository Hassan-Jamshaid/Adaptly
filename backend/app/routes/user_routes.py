from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.authorization import get_current_profile, require_hr_admin
from app.core.db import db
from app.core.dependencies import get_current_user
from app.core.roles import (
    VALID_CORPORATE_ROLES,
    MODE_CORPORATE,
    resolve_registration_role,
)
from app.models.user_model import build_user_doc

router = APIRouter(prefix="/users", tags=["users"])

# Only these keys may be written into accessibility_settings. Previously the
# endpoint accepted whatever object the client sent, so a caller could store
# arbitrary data on their own profile document.
ALLOWED_ACCESSIBILITY_KEYS = {"font_size", "contrast", "font_family"}


@router.post("/register")
def register_profile(mode: str, role: str = None, user=Depends(get_current_user)):
    existing = db.users.find_one({"uid": user["uid"]})
    if existing:
        raise HTTPException(status_code=400, detail="Profile already exists")

    # The client used to choose its own mode and role with no checks at all,
    # so anyone could register as hr_admin. resolve_registration_role validates
    # the values and refuses to grant privileged roles on request.
    try:
        resolved_mode, resolved_role = resolve_registration_role(
            mode, role, user.get("email")
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    doc = build_user_doc(user["uid"], user.get("email"), resolved_mode, resolved_role)
    db.users.insert_one(doc)
    return {"message": "Profile created", "mode": resolved_mode, "role": resolved_role}


@router.get("/me")
def get_profile(user=Depends(get_current_user)):
    profile = db.users.find_one({"uid": user["uid"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/me")
def update_profile(payload: dict, user=Depends(get_current_user)):
    # Deliberately a strict allowlist: mode and corporate_role are NOT updatable
    # here, otherwise this endpoint would reopen the privilege-escalation hole
    # that /register just closed.
    settings = payload.get("accessibility_settings")
    if not isinstance(settings, dict):
        raise HTTPException(status_code=400, detail="accessibility_settings object is required")

    cleaned = {k: v for k, v in settings.items() if k in ALLOWED_ACCESSIBILITY_KEYS}
    if not cleaned:
        raise HTTPException(
            status_code=400,
            detail=f"No valid settings. Allowed: {', '.join(sorted(ALLOWED_ACCESSIBILITY_KEYS))}",
        )

    result = db.users.update_one(
        {"uid": user["uid"]},
        {"$set": {
            "accessibility_settings": cleaned,
            # kept current so the shared contract's updated_at is meaningful
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"message": "Profile updated", "accessibility_settings": cleaned}


@router.put("/{target_uid}/corporate-role")
def set_corporate_role(
    target_uid: str,
    payload: dict,
    admin=Depends(require_hr_admin),
):
    """
    Grant or change another user's corporate role. HR administrators only.

    This is the ONLY path to a privileged role once the HR_ADMIN_EMAILS
    bootstrap has been used to create the first administrator, so privilege
    escalation requires an existing administrator to act deliberately.
    """
    role = payload.get("role")
    if role not in VALID_CORPORATE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"role must be one of: {', '.join(sorted(VALID_CORPORATE_ROLES))}",
        )

    target = db.users.find_one({"uid": target_uid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("mode") != MODE_CORPORATE:
        raise HTTPException(
            status_code=400, detail="Only corporate accounts can hold a corporate role"
        )

    db.users.update_one({"uid": target_uid}, {"$set": {"corporate_role": role}})
    return {"message": "Role updated", "uid": target_uid, "corporate_role": role}


@router.get("/directory")
def list_corporate_users(admin=Depends(require_hr_admin)):
    """
    Minimal roster so an HR administrator can find the uid of someone to promote.

    Returns identifiers only — never session content, engagement data or chat
    history, per the access rules in the scope document.
    """
    users = db.users.find(
        {"mode": MODE_CORPORATE},
        {"_id": 0, "uid": 1, "email": 1, "corporate_role": 1},
    )
    return list(users)
