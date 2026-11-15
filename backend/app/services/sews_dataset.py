"""Dataset de telemetría por días de misión que alimenta el motor clínico SEWS.

Se lee una vez y se mantiene en memoria; sólo se recarga si el archivo cambia en disco.
Las evaluaciones SEWS se calculan una vez por versión del archivo, no en cada petición.

Panel de simulación: `simulate()` superpone valores introducidos por el operador sobre el último
registro de un tripulante (sin tocar el archivo) y el motor clínico lo reevalúa al instante.
`reset()` vuelve a los datos de misión. El registro simulado se marca con `is_simulated=True`.

Chequeo diario: `checkin()` guarda lo que el propio astronauta midió (presión, pulso, glucosa, temperatura,
sueño, ánimo). Se persiste en disco (runtime/checkins.json) y pasa a ser su estado actual. Prioridad al
combinar: datos de misión < chequeo del astronauta < valores del panel de simulación.
"""
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.schemas.clinical import HealthStatusReport
from app.services.clinical_engine import SpaceClinicalEngine
from app.services.data_adapter import NASADataAdapter


class SewsDataset:
    def __init__(self, path: str, checkins_path: Optional[str] = None) -> None:
        self.path = path
        self.checkins_path = checkins_path
        self._checkins: Dict[str, Dict[str, Any]] = {}
        if checkins_path and os.path.exists(checkins_path):
            with open(checkins_path, "r", encoding="utf-8") as f:
                self._checkins = json.load(f)
        self._lock = threading.Lock()
        self._mtime: Optional[float] = None
        self._history: Dict[str, List[Dict[str, Any]]] = {}
        self._reports: Dict[str, HealthStatusReport] = {}
        self._overrides: Dict[str, Dict[str, Any]] = {}

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
            for rows in history.values():
                rows.sort(key=lambda r: r["mission_day"])
            self._history, self._mtime = history, mtime
            self._reports = {cid: self._evaluate(self._merged(cid)) for cid in history}

    # ------------------------------------------------------------ evaluación
    @staticmethod
    def _evaluate(rec: Dict[str, Any]) -> HealthStatusReport:
        return SpaceClinicalEngine.evaluate_crew_member(
            record=NASADataAdapter.from_hackathon_raw_dict(rec),
            name=rec.get("name", rec["crew_id"]), role=rec.get("role", "Astronaut"),
            mission_day=rec.get("mission_day", 1))

    def _merged(self, crew_id: str) -> Dict[str, Any]:
        rec = {**self._history[crew_id][-1], **self._checkins.get(crew_id, {})}
        extra = self._overrides.get(crew_id)
        return {**rec, **extra, "is_simulated": True} if extra else rec

    # ------------------------------------------------------------ chequeo diario del astronauta
    def checkin(self, crew_id: str, values: Dict[str, Any]) -> Optional[HealthStatusReport]:
        self._refresh()
        if crew_id not in self._history:
            return None
        with self._lock:
            entry = {**self._checkins.get(crew_id, {}), **values,
                     "checkin_at": datetime.now(timezone.utc).isoformat()}
            self._checkins[crew_id] = entry
            if self.checkins_path:
                os.makedirs(os.path.dirname(self.checkins_path), exist_ok=True)
                with open(self.checkins_path, "w", encoding="utf-8") as f:
                    json.dump(self._checkins, f, ensure_ascii=False, indent=1)
            self._reports[crew_id] = self._evaluate(self._merged(crew_id))
        return self._reports[crew_id]

    # ------------------------------------------------------------ simulación
    def simulate(self, crew_id: str, values: Dict[str, Any]) -> Optional[HealthStatusReport]:
        self._refresh()
        if crew_id not in self._history:
            return None
        with self._lock:
            self._overrides[crew_id] = {**self._overrides.get(crew_id, {}), **values}
            self._reports[crew_id] = self._evaluate(self._merged(crew_id))
        return self._reports[crew_id]

    def reset(self, crew_id: Optional[str] = None) -> None:
        self._refresh()
        with self._lock:
            ids = [crew_id] if crew_id else list(self._overrides)
            for cid in ids:
                self._overrides.pop(cid, None)
                if cid in self._history:
                    self._reports[cid] = self._evaluate(self._merged(cid))

    def recompute(self) -> None:
        """Reevalúa a toda la tripulación (p. ej. al cambiar el entorno de misión y sus umbrales)."""
        self._refresh()
        with self._lock:
            self._reports = {cid: self._evaluate(self._merged(cid)) for cid in self._history}

    def simulated(self, crew_id: str) -> bool:
        return crew_id in self._overrides

    # ------------------------------------------------------------ lectura
    def crew_ids(self) -> List[str]:
        self._refresh()
        return list(self._history)

    def history(self, crew_id: str) -> Optional[List[Dict[str, Any]]]:
        self._refresh()
        return self._history.get(crew_id)

    def latest(self, crew_id: str) -> Optional[Dict[str, Any]]:
        """Último registro (con los valores simulados superpuestos, si los hay)."""
        self._refresh()
        return self._merged(crew_id) if crew_id in self._history else None

    def report(self, crew_id: str) -> Optional[HealthStatusReport]:
        self._refresh()
        return self._reports.get(crew_id)
