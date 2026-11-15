"""Rutina diaria de salud y gamificación cooperativa.

Cada tripulante tiene una rutina del día: chequeo diario, test de reflejos, respiración, ejercicio,
hidratación y una tarea por cada contramedida activa que le prescribe el motor clínico. Completar tareas
da puntos (una vez por tarea y día), sube de nivel, mantiene una racha de días con chequeo y desbloquea
insignias. La meta es cooperativa: el panel muestra el cumplimiento de TODA la tripulación, porque en
aislamiento la competencia entre compañeros genera tensión y una meta común refuerza la cohesión.

Se guarda en disco (runtime/routine.json) y funciona sin conexión.
"""
import json
import os
import threading
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from app.core.i18n import tr

# Tareas fijas de la rutina: id, título, puntos, icono, cómo se completa (auto = lo detecta el sistema)
# Textos como pares (es, en): se resuelven al idioma de la petición en state().
BASE_TASKS = [
    {"id": "checkin", "title": ("Chequeo diario de salud", "Daily health check"), "points": 30, "icon": "clipboard-text",
     "kind": "auto", "hint": ("Presión, pulso, SpO₂, glucosa, temperatura, sueño y ánimo.",
                              "Blood pressure, pulse, SpO₂, glucose, temperature, sleep and mood.")},
    {"id": "pvt", "title": ("Test de reflejos (PVT)", "Reflex test (PVT)"), "points": 20, "icon": "scan", "kind": "auto",
     "hint": ("3 minutos: detecta fatiga antes de una tarea crítica.", "3 minutes: catches fatigue before a critical task.")},
    {"id": "breathing", "title": ("Respiración guiada 0.1 Hz", "Guided breathing 0.1 Hz"), "points": 15, "icon": "wind",
     "kind": "manual", "hint": ("5 minutos inhalando 4 s y exhalando 6 s.", "5 minutes: inhale 4 s, exhale 6 s.")},
    {"id": "exercise", "title": ("Ejercicio ARED y cinta", "ARED and treadmill exercise"), "points": 25, "icon": "barbell",
     "kind": "manual", "hint": ("2.5 h de ejercicio resistivo y aeróbico contra la pérdida ósea y muscular.",
                                "2.5 h of resistive and aerobic exercise against bone and muscle loss.")},
    {"id": "hydration", "title": ("Hidratación 2 L", "Hydration 2 L"), "points": 10, "icon": "drop", "kind": "manual",
     "hint": ("En microgravedad no se siente la sed igual: bebe aunque no la tengas.",
              "Thirst feels different in microgravity: drink even if you are not thirsty.")},
]
CM_POINTS = 20
LEVELS = [(0, ("Cadete", "Cadet")), (150, ("Tripulante", "Crew member")), (400, ("Especialista", "Specialist")),
          (800, ("Oficial de salud", "Health officer")), (1400, ("Comandante de salud", "Health commander"))]
BADGES = {
    "first_checkin": (("Primera medición", "First reading"), "clipboard-text"),
    "streak_3": (("Racha de 3 días", "3-day streak"), "lightning"),
    "streak_7": (("Semana completa", "Full week"), "rocket-launch"),
    "full_day": (("Día perfecto", "Perfect day"), "check-circle"),
    "cm_5": (("Cumplidor de protocolos", "Protocol keeper"), "shield-warning"),
}


class RoutineStore:
    def __init__(self, path: Optional[str]) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._data: Dict[str, Dict[str, Any]] = {}
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._data = json.load(f)

    def _save(self) -> None:
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=1)

    @staticmethod
    def _today() -> str:
        return date.today().isoformat()

    def _member(self, crew_id: str) -> Dict[str, Any]:
        return self._data.setdefault(crew_id, {"days": {}, "points": 0, "cm_done": 0})

    # ------------------------------------------------------------ tareas
    @staticmethod
    def tasks_for(report) -> List[Dict[str, Any]]:
        tasks = [{**t, "title": tr(*t["title"]), "hint": tr(*t["hint"])} for t in BASE_TASKS]
        for cm in report.active_countermeasures:
            if cm.id == "CM-NOM-00":
                continue
            tasks.append({"id": f"cm:{cm.id}", "title": cm.title, "points": CM_POINTS, "icon": "lightning",
                          "kind": "manual", "hint": cm.action_protocol.split("\n")[0].lstrip("1. "),
                          "urgency": cm.urgency})
        return tasks

    def complete(self, crew_id: str, task_id: str, points: int) -> bool:
        """Marca la tarea de hoy; devuelve False si ya estaba hecha (los puntos se dan una sola vez)."""
        with self._lock:
            m = self._member(crew_id)
            done = m["days"].setdefault(self._today(), [])
            if task_id in done:
                return False
            done.append(task_id)
            m["points"] += points
            if task_id.startswith("cm:"):
                m["cm_done"] += 1
            self._save()
            return True

    # ------------------------------------------------------------ estado
    def _streak(self, m: Dict[str, Any]) -> int:
        day, streak = date.today(), 0
        if "checkin" not in m["days"].get(day.isoformat(), []):
            day -= timedelta(days=1)  # hoy aún puede completarse sin romper la racha
        while "checkin" in m["days"].get(day.isoformat(), []):
            streak += 1
            day -= timedelta(days=1)
        return streak

    def state(self, crew_id: str, report, crew_reports: Dict[str, Any]) -> Dict[str, Any]:
        m = self._member(crew_id)
        tasks = self.tasks_for(report)
        done_today = set(m["days"].get(self._today(), []))
        for t in tasks:
            t["done"] = t["id"] in done_today
        level_i = max(i for i, (pts, _) in enumerate(LEVELS) if m["points"] >= pts)
        nxt = LEVELS[level_i + 1] if level_i + 1 < len(LEVELS) else None
        streak = self._streak(m)
        earned = []
        if any("checkin" in d for d in m["days"].values()):
            earned.append("first_checkin")
        if streak >= 3:
            earned.append("streak_3")
        if streak >= 7:
            earned.append("streak_7")
        if any(len(set(d) & {t["id"] for t in BASE_TASKS}) == len(BASE_TASKS) for d in m["days"].values()):
            earned.append("full_day")
        if m["cm_done"] >= 5:
            earned.append("cm_5")
        # Meta cooperativa: cumplimiento de hoy de toda la tripulación
        team = []
        for cid, rep in crew_reports.items():
            t_all = self.tasks_for(rep)
            got = set(self._data.get(cid, {}).get("days", {}).get(self._today(), []))
            team.append({"crew_id": cid, "name": rep.crew_member_name,
                         "pct": round(100 * len([t for t in t_all if t["id"] in got]) / len(t_all))})
        return {
            "date": self._today(),
            "tasks": tasks,
            "done": len([t for t in tasks if t["done"]]),
            "total": len(tasks),
            "points": m["points"],
            "level": tr(*LEVELS[level_i][1]),
            "level_floor": LEVELS[level_i][0],
            "next_level": {"name": tr(*nxt[1]), "points": nxt[0]} if nxt else None,
            "streak": streak,
            "checkin_today": "checkin" in done_today,
            "badges": [{"id": b, "name": tr(*BADGES[b][0]), "icon": BADGES[b][1], "earned": b in earned} for b in BADGES],
            "team": {"members": team, "pct": round(sum(x["pct"] for x in team) / max(1, len(team)))},
        }

    def points_for(self, report, task_id: str) -> Optional[int]:
        return next((t["points"] for t in self.tasks_for(report) if t["id"] == task_id), None)
