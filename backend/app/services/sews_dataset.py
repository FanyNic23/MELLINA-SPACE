"""Dataset de telemetría por días de misión que alimenta el motor clínico SEWS.

Se lee una vez y se mantiene en memoria; sólo se recarga si el archivo cambia en disco.
Las evaluaciones SEWS se calculan una vez por versión del archivo, no en cada petición.
"""
import json
import os
import threading
from typing import Any, Dict, List, Optional

from app.schemas.clinical import HealthStatusReport
from app.services.clinical_engine import SpaceClinicalEngine
from app.services.data_adapter import NASADataAdapter


class SewsDataset:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._mtime: Optional[float] = None
        self._history: Dict[str, List[Dict[str, Any]]] = {}
        self._reports: Dict[str, HealthStatusReport] = {}

    def _refresh(self) -> None:
        try:
            mtime = os.path.getmtime(self.path)
        except OSError:
            mtime = None
        if mtime == self._mtime:
            return
        with self._lock:
            if mtime == self._mtime:
                return
            records: List[Dict[str, Any]] = []
            if mtime is not None:
                with open(self.path, "r", encoding="utf-8") as f:
                    records = json.load(f)
            history: Dict[str, List[Dict[str, Any]]] = {}
            for r in records:
                history.setdefault(r["crew_id"], []).append(r)
            reports = {}
            for cid, rows in history.items():
                rows.sort(key=lambda r: r["mission_day"])
                latest = rows[-1]
                reports[cid] = SpaceClinicalEngine.evaluate_crew_member(
                    record=NASADataAdapter.from_hackathon_raw_dict(latest),
                    name=latest.get("name", cid), role=latest.get("role", "Astronaut"),
                    mission_day=latest.get("mission_day", 1))
            self._history, self._reports, self._mtime = history, reports, mtime

    def crew_ids(self) -> List[str]:
        self._refresh()
        return list(self._history)

    def history(self, crew_id: str) -> Optional[List[Dict[str, Any]]]:
        self._refresh()
        return self._history.get(crew_id)

    def latest(self, crew_id: str) -> Optional[Dict[str, Any]]:
        rows = self.history(crew_id)
        return rows[-1] if rows else None

    def report(self, crew_id: str) -> Optional[HealthStatusReport]:
        self._refresh()
        return self._reports.get(crew_id)
