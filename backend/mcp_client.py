import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from . import config

_state = {"lock": None, "session": None, "stdio": None, "tools": None}


def _lock():
    if _state["lock"] is None:
        _state["lock"] = asyncio.Lock()
    return _state["lock"]


async def _close():
    session, stdio = _state["session"], _state["stdio"]
    _state.update(session=None, stdio=None, tools=None)
    for manager in (session, stdio):
        if manager is not None:
            try:
                await manager.__aexit__(None, None, None)
            except Exception:
                pass


async def _ensure():
    if _state["session"] is not None:
        return _state["session"]
    async with _lock():
        if _state["session"] is not None:
            return _state["session"]
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "backend.mcp_server"],
            cwd=str(config.BASE_DIR),
            env=dict(os.environ),
        )
        stdio = None
        session = None
        try:
            stdio = stdio_client(params)
            read, write = await stdio.__aenter__()
            _state["stdio"] = stdio
            session = ClientSession(read, write)
            await session.__aenter__()
            _state["session"] = session
            await session.initialize()
            listed = await session.list_tools()
            _state.update(session=session, stdio=stdio, tools=listed.tools)
            return session
        except Exception as exc:
            if session is not None:
                _state["session"] = session
            if stdio is not None:
                _state["stdio"] = stdio
            await _close()
            raise RuntimeError("journal tool server unavailable") from exc


async def get_tools():
    await _ensure()
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or "",
                "parameters": tool.input_schema,
            },
        }
        for tool in (_state["tools"] or [])
    ]


async def call_tool(name, arguments):
    session = await _ensure()
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}
    try:
        result = await session.call_tool(name, arguments)
        return "\n".join(text for block in result.content if (text := getattr(block, "text", None)))
    except Exception:
        await reset()
        raise


async def reset():
    async with _lock():
        await _close()