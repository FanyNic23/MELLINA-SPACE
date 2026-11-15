"""Tripulación de la misión: única fuente de identidad para todo el sistema.

La usan el simulador de telemetría en tiempo real (FHIR) y el generador de datos SEWS
(scripts/generate_synthetic_data.py), para que un ASTRO-xx sea la misma persona en ambos motores.
`hr`, `sys` y `dia` son las líneas base fisiológicas en reposo del simulador.
"""

CREW = [
    {"id": "ASTRO-01", "name": "Dra. Elena Rostova", "role": "Comandante de Misión", "hr": 64, "sys": 115, "dia": 75},
    {"id": "ASTRO-02", "name": "Marcus Vance", "role": "Ingeniero de Vuelo", "hr": 78, "sys": 128, "dia": 84},
    {"id": "ASTRO-03", "name": "Dr. Kenji Sato", "role": "Oficial Científico", "hr": 72, "sys": 122, "dia": 80},
    {"id": "ASTRO-04", "name": "Dr. Samuel Miller", "role": "Especialista Médico", "hr": 84, "sys": 120, "dia": 78},
    {"id": "ASTRO-05", "name": "Dr. Diego Herrera", "role": "Ingeniero de Soporte Vital", "hr": 72, "sys": 118, "dia": 77},
]
