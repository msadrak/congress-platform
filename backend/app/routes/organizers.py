"""Platform-admin organizer provisioning and API-key lifecycle (X-Admin-Token).

Keys are random 256-bit secrets returned exactly once; only their SHA-256 is stored. Rotation replaces
the hash in one transaction, so the old key stops working immediately. Revocation keeps the tenant and
all its data but rejects its key like an unknown one. Responses never contain hashes or old keys."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.auth import hash_api_key, new_api_key, require_platform_admin
from app.db import SessionDep
from app.models import Organizer

router = APIRouter(prefix="/api/organizers", tags=["organizers"], dependencies=[Depends(require_platform_admin)])


class OrganizerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OrganizerProvisioned(BaseModel):
    id: uuid.UUID
    name: str
    api_key: str = Field(description="Shown once. Only its hash is stored.")


class OrganizerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: datetime
    revoked_at: datetime | None
    key_rotated_at: datetime | None


async def _organizer(session: SessionDep, organizer_id: uuid.UUID) -> Organizer:
    organizer = await session.scalar(select(Organizer).where(Organizer.id == organizer_id).with_for_update())
    if organizer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organizer not found")
    return organizer


@router.post("", status_code=status.HTTP_201_CREATED)
async def provision_organizer(body: OrganizerCreate, session: SessionDep) -> OrganizerProvisioned:
    api_key = new_api_key()
    organizer = Organizer(name=body.name, api_key_hash=hash_api_key(api_key))
    session.add(organizer)
    await session.commit()
    return OrganizerProvisioned(id=organizer.id, name=organizer.name, api_key=api_key)


@router.get("")
async def list_organizers(session: SessionDep) -> list[OrganizerOut]:
    rows = await session.scalars(select(Organizer).order_by(Organizer.created_at, Organizer.id))
    return [OrganizerOut.model_validate(row) for row in rows]


@router.post("/{organizer_id}/rotate-key")
async def rotate_organizer_key(organizer_id: uuid.UUID, session: SessionDep) -> OrganizerProvisioned:
    """New key shown once; the previous key is rejected from this commit on. Also reinstates a revoked
    organizer (rotation is how a compromised tenant gets access back)."""
    organizer = await _organizer(session, organizer_id)
    api_key = new_api_key()
    organizer.api_key_hash = hash_api_key(api_key)
    organizer.key_rotated_at = datetime.now(timezone.utc)
    organizer.revoked_at = None
    await session.commit()
    return OrganizerProvisioned(id=organizer.id, name=organizer.name, api_key=api_key)


@router.post("/{organizer_id}/revoke")
async def revoke_organizer_key(organizer_id: uuid.UUID, session: SessionDep) -> OrganizerOut:
    organizer = await _organizer(session, organizer_id)
    if organizer.revoked_at is None:
        organizer.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(organizer)
    return OrganizerOut.model_validate(organizer)
