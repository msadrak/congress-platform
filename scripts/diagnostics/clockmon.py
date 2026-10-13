"""Logs wall-clock steps relative to the monotonic clock (diagnostic).

    python clockmon.py <seconds>   # writes /tmp/clockmon.log; run beside the test suite
"""
import time, sys
log = open("/tmp/clockmon.log", "a", buffering=1)
w0, m0 = time.time(), time.monotonic()
end = m0 + float(sys.argv[1])
while time.monotonic() < end:
    time.sleep(0.02)
    w, m = time.time(), time.monotonic()
    drift = (w - w0) - (m - m0)
    if abs(drift) > 0.05:
        log.write(f"{w:.3f} step {drift:+.3f}s\n")
    w0, m0 = w, m
