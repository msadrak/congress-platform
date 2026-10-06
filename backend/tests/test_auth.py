from httpx import AsyncClient


USER_PAYLOAD = {
    "email": "dr.rezaei@example.com",
    "password": "StrongPassword123!",
    "full_name": "Dr. Mohammad Rezaei",
    "organization": "Tehran University of Medical Sciences",
    "title": "Associate Professor",
}


async def test_attendee_can_register_and_receives_access_token(
    client: AsyncClient,
) -> None:
    response = await client.post("/api/auth/register", json=USER_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    user = body["user"]
    assert user["email"] == "dr.rezaei@example.com"
    assert user["full_name"] == "Dr. Mohammad Rezaei"
    assert user["organization"] == "Tehran University of Medical Sciences"
    assert user["title"] == "Associate Professor"
    assert "password" not in user
    assert "password_hash" not in user


async def test_duplicate_email_registration_is_rejected(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)
    duplicate = await client.post("/api/auth/register", json=USER_PAYLOAD)

    assert duplicate.status_code == 409


async def test_attendee_can_login_with_correct_credentials(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "dr.rezaei@example.com", "password": "StrongPassword123!"},
    )

    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    # Verify /api/auth/me using the token
    me_resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "dr.rezaei@example.com"


async def test_login_with_wrong_password_is_rejected(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)

    wrong_login = await client.post(
        "/api/auth/login",
        json={"email": "dr.rezaei@example.com", "password": "WrongPassword!"},
    )

    assert wrong_login.status_code == 401
