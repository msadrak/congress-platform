"""No route is unreachable because an earlier route captures its path.

Routes match in declaration order. If `/api/booths/{booth_id}` is declared above `/api/booths/me`,
a request for `/me` goes to the parameterized route and FastAPI answers 422 ("me" is not a UUID):
static sub-paths must be declared before their parameterized siblings.
"""

import re
from pathlib import Path

from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import BaseRoute, compile_path

from app.main import create_app
from tests.conftest import make_test_settings


def captured_routes(routes: list[BaseRoute]) -> list[str]:
    """Every (earlier, later) pair where the earlier route answers the later one's path and method."""
    declared: list[tuple[str, set[str]]] = [
        (context.path, context.methods or set())
        for context in iter_route_contexts(routes)
        if isinstance(context.original_route, APIRoute) and context.path is not None
    ]
    problems = []
    for index, (later_path, later_methods) in enumerate(declared):
        concrete = re.sub(r"\{[^}]+\}", "__param__", later_path)
        for earlier_path, earlier_methods in declared[:index]:
            shared = earlier_methods & later_methods
            if shared and compile_path(earlier_path)[0].match(concrete):
                problems.append(f"{','.join(sorted(shared))} {earlier_path} is declared before, and captures, {later_path}")
    return problems


def test_static_paths_precede_parameterized_siblings(media_root: Path) -> None:
    routes = create_app(make_test_settings(media_root)).routes
    assert len(list(iter_route_contexts(routes))) > 50
    assert captured_routes(routes) == []
