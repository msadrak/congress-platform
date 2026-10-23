"""Streamed CSV downloads: UTF-8 with a BOM (Excel opens Persian text correctly), formula-safe cells, rows read
from the database in batches so an export never sits in memory whole."""

import csv
from collections.abc import AsyncIterator, Callable, Sequence
from typing import Any, Unpack

from fastapi.responses import StreamingResponse
from sqlalchemy import Row, Select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.security import sanitize_csv_cell

CSV_BATCH_ROWS = 1_000

# A SELECT and a result row of any number of columns of any type.
AnySelect = Select[Unpack[tuple[Any, ...]]]
AnyRow = Row[Unpack[tuple[Any, ...]]]


class _Echo:
    """A file whose `write` returns the text, so `csv.writer(...).writerow` yields one encoded line."""

    def write(self, value: str) -> str:
        return value


async def csv_stream(
    sessionmaker: async_sessionmaker[AsyncSession],
    header: list[str],
    statement: AnySelect,
    to_cells: Callable[[AnyRow], Sequence[object]],
) -> AsyncIterator[bytes]:
    writer = csv.writer(_Echo())
    yield ("﻿" + writer.writerow(header)).encode()
    # Its own session: the request's may be closed while the body is still streaming.
    async with sessionmaker() as session:
        result = await session.stream(statement.execution_options(yield_per=CSV_BATCH_ROWS))
        async for rows in result.partitions():
            yield "".join(writer.writerow([sanitize_csv_cell(c) for c in to_cells(row)]) for row in rows).encode()


def csv_response(filename: str, body: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
