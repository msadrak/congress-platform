import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.auth import hash_api_key, new_api_key, require_platform_admin
from app.db import SessionDep
from app.models import Organizer

router = APIRouter(prefix="/api/organizers", tags=["organizers"])


class OrganizerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OrganizerProvisioned(BaseModel):
    id: uuid.UUID
    name: str
    api_key: str = Field(description="Shown once. Only its hash is stored.")


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_platform_admin)],
)
async def provision_organizer(
    body: OrganizerCreate, session: SessionDep
) -> OrganizerProvisioned:
    api_key = new_api_key()
    organizer = Organizer(name=body.name, api_key_hash=hash_api_key(api_key))
    session.add(organizer)
    await session.commit()
    return OrganizerProvisioned(id=organizer.id, name=organizer.name, api_key=api_key)
