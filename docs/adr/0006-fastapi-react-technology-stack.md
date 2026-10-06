# 0006: FastAPI and React Technology Stack

## Context
Initial design considered Django + DRF for rapid back-office generation. However, the project architecture requires high-concurrency asynchronous I/O, native OpenAPI contract generation, Pydantic type safety, and a dedicated, responsive React frontend for attendee onboarding and offline kiosk operations.

## Decision
We select **FastAPI (Python)** for the backend and **React (TypeScript)** for the frontend:
1. **Backend (FastAPI):**
   - Asynchronous ASGI architecture (`async`/`await`) on Uvicorn.
   - **Pydantic v2** for strict request/response data contracts and automated schema validation.
   - **SQLAlchemy 2.0 (async)** with **Alembic** for relational database migrations against **PostgreSQL**.
   - **Redis** for atomic inventory reservations and background task processing.
2. **Frontend (React):**
   - Single-Page Application (SPA) with React and TypeScript.
   - Progressive Web App (PWA) capabilities with Service Worker and IndexedDB for the offline-capable check-in kiosk.

## Consequences
- Enables high throughput and low latency during traffic spikes.
- Decouples client presentation completely from backend logic via clean, automatically generated OpenAPI schemas.
- Replaces Django Admin with lightweight, API-driven React administration views.
