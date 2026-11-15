"""Entornos de misión: el mismo sistema se adapta a dónde está la tripulación.

Cada entorno define lo que cambia de verdad la evaluación y la respuesta médica:
  · latencia con la Tierra (y si el cirujano de vuelo puede atender en tiempo real),
  · gravedad (frena la pérdida muscular y ósea en la proyección),
  · radiación esperable en ese lugar (umbrales de vigilancia y de evento solar),
  · volumen de cabina (en un rover pequeño el CO2 se acumula antes),
  · opción de evacuación médica.
Los textos son pares (es, en); routers/mission.py los resuelve al idioma de la petición.
Valores aproximados basados en publicaciones de la NASA (dosimetría ISS, MSL-RAD en Marte, LND en la Luna).
"""

ENVIRONMENTS = {
    "mars_transit": {
        "name": ("Nave en tránsito a Marte", "Spacecraft in transit to Mars"), "short": ("Tránsito a Marte", "Mars transit"), "icon": "rocket-launch",
        "latency_min": 14.2, "latency_text": ("14 min una vía (4–24 min)", "14 min one way (4–24 min)"), "realtime_surgeon": False,
        "gravity_g": 0.0, "gravity_text": ("Microgravedad (0 g)", "Microgravity (0 g)"),
        "radiation_watch": 35.0, "radiation_spe": 80.0, "co2_max": 4.0,
        "evacuation": ("Sin evacuación posible: la Tierra está a meses de viaje.", "No evacuation possible: Earth is months away."),
    },
    "iss": {
        "name": ("Estación espacial en órbita baja", "Low Earth orbit space station"), "short": ("Estación orbital", "Orbital station"), "icon": "planet",
        "latency_min": 0.01, "latency_text": ("< 1 s (enlace casi continuo)", "< 1 s (near-continuous link)"), "realtime_surgeon": True,
        "gravity_g": 0.0, "gravity_text": ("Microgravedad (0 g)", "Microgravity (0 g)"),
        "radiation_watch": 35.0, "radiation_spe": 80.0, "co2_max": 4.0,
        "evacuation": ("Regreso de emergencia a la Tierra en unas 6 horas.", "Emergency return to Earth in about 6 hours."),
    },
    "lunar_base": {
        "name": ("Base lunar Artemis", "Artemis lunar base"), "short": ("Base lunar", "Lunar base"), "icon": "moon-stars",
        "latency_min": 0.022, "latency_text": ("1.3 s una vía", "1.3 s one way"), "realtime_surgeon": True,
        "gravity_g": 0.16, "gravity_text": ("Gravedad lunar (0.16 g)", "Lunar gravity (0.16 g)"),
        "radiation_watch": 60.0, "radiation_spe": 110.0, "co2_max": 4.0,
        "evacuation": ("Regreso a la Tierra en unos 3 días.", "Return to Earth in about 3 days."),
    },
    "mars_base": {
        "name": ("Base en la superficie de Marte", "Mars surface base"), "short": ("Base en Marte", "Mars base"), "icon": "globe-hemisphere-west",
        "latency_min": 12.5, "latency_text": ("12.5 min una vía (4–24 min)", "12.5 min one way (4–24 min)"), "realtime_surgeon": False,
        "gravity_g": 0.38, "gravity_text": ("Gravedad marciana (0.38 g)", "Martian gravity (0.38 g)"),
        "radiation_watch": 40.0, "radiation_spe": 90.0, "co2_max": 4.0,
        "evacuation": ("Sin evacuación: hay ventana de regreso cada 26 meses.", "No evacuation: return windows open every 26 months."),
    },
    "rover": {
        "name": ("Rover presurizado en Marte", "Pressurized Mars rover"), "short": ("Rover presurizado", "Pressurized rover"), "icon": "gauge",
        "latency_min": 12.5, "latency_text": ("12.5 min una vía", "12.5 min one way"), "realtime_surgeon": False,
        "gravity_g": 0.38, "gravity_text": ("Gravedad marciana (0.38 g)", "Martian gravity (0.38 g)"),
        "radiation_watch": 40.0, "radiation_spe": 90.0, "co2_max": 3.0,
        "evacuation": ("Regreso a la base en horas; cabina pequeña: el CO2 sube rápido.", "Back to base in hours; small cabin: CO2 rises fast."),
    },
}
DEFAULT_ENVIRONMENT = "mars_transit"
