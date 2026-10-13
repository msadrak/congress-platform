"""pytest plugin (diagnostic only): logs why JWT decoding fails, without changing behaviour.

    cd backend && PYTHONPATH=../scripts/diagnostics pytest -q -p jwtdiag   # writes /tmp/jwtdiag.log
"""
import json, sys, time
import jwt

LOG = "/tmp/jwtdiag.log"

def pytest_configure(config):
    config._diag_current = None

def pytest_collection_finish(session):
    config = session.config
    import app.security as sec
    orig = sec.decode_access_token
    def wrapped(token, secret):
        result = orig(token, secret)
        if result is None:
            try:
                claims = jwt.decode(token, options={"verify_signature": False})
            except Exception:
                claims = {}
            reason = "?"
            try:
                jwt.decode(token, secret, algorithms=["HS256"])
            except Exception as e:  # noqa: BLE001
                reason = f"{type(e).__name__}: {e}"
            with open(LOG, "a") as f:
                f.write(json.dumps({"t": time.time(), "test": config._diag_current, "reason": reason,
                                    "iat": claims.get("iat"), "exp": claims.get("exp"), "type": claims.get("type")}) + "\n")
        return result
    patched = []
    for name, mod in list(sys.modules.items()):
        if name.startswith("app") and getattr(mod, "decode_access_token", None) is orig:
            mod.decode_access_token = wrapped
            patched.append(name)
    with open(LOG, "a") as f:
        f.write(json.dumps({"patched": patched, "t": time.time()}) + "\n")

def pytest_runtest_setup(item):
    item.config._diag_current = item.nodeid
