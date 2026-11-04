"""The migration chain as written in migrations/versions, read without Alembic.

Head tests compare Alembic's view against this, so a merge that adds or re-chains a migration needs no edit to
them: they derive the expected head and order from the files themselves and fail only when the chain is not
one straight line (two heads, a gap, an orphan or a cycle).
"""
import ast
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _assigned(module: ast.Module, name: str) -> object:
    for node in module.body:
        target: ast.expr
        if isinstance(node, ast.AnnAssign) and node.value is not None:
            target, value = node.target, node.value
        elif isinstance(node, ast.Assign) and len(node.targets) == 1:
            target, value = node.targets[0], node.value
        else:
            continue
        if isinstance(target, ast.Name) and target.id == name:
            return ast.literal_eval(value)
    raise AssertionError(f"no module-level {name} assignment")


def read_revisions(versions_dir: Path = VERSIONS_DIR) -> dict[str, str | None]:
    """revision -> down_revision for every migration file (a merge revision would be a tuple; none exist)."""
    chain: dict[str, str | None] = {}
    for path in sorted(versions_dir.glob("*.py")):
        module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        revision, down = _assigned(module, "revision"), _assigned(module, "down_revision")
        assert isinstance(revision, str), f"{path.name}: revision must be a string"
        assert down is None or isinstance(down, str), f"{path.name}: down_revision must be one revision (no merges)"
        assert revision not in chain, f"{path.name}: revision {revision} is defined twice"
        chain[revision] = down
    return chain


def linear_chain(versions_dir: Path = VERSIONS_DIR) -> list[str]:
    """Revisions from head to base; asserts the files form exactly one line."""
    chain = read_revisions(versions_dir)
    referenced = {down for down in chain.values() if down is not None}
    heads = sorted(set(chain) - referenced)
    assert len(heads) == 1, f"expected one head, found {heads}"
    order: list[str] = []
    current: str | None = heads[0]
    while current is not None:
        assert current in chain, f"{order[-1]} points at {current}, which has no migration file"
        assert current not in order, f"cycle at {current}"
        order.append(current)
        current = chain[current]
    assert len(order) == len(chain), f"not on the line from the head: {sorted(set(chain) - set(order))}"
    return order


def expected_head(versions_dir: Path = VERSIONS_DIR) -> str:
    return linear_chain(versions_dir)[0]
