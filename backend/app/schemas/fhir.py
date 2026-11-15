"""Esquemas inspirados en HL7 FHIR R4 `Observation` para los 8 indicadores clave.

Cada indicador define su código (LOINC cuando existe, sistema propio si no) y sus
componentes. `is_synthetic` es una extensión explícita (no-FHIR) más un tag en `meta`.
"""
from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
CUSTOM = "http://astro-health.example/fhir/CodeSystem/indicator"
SYNTH_TAG = "http://astro-health.example/fhir/CodeSystem/data-origin"


class Indicator(StrEnum):
    HEART_RATE = "heart_rate"
    SPO2 = "spo2"
    BLOOD_PRESSURE = "blood_pressure"
    BODY_TEMP = "body_temp"
    RESPIRATORY_RATE = "respiratory_rate"
    SLEEP_METRICS = "sleep_metrics"
    RADIATION_DOSE = "radiation_dose"
    BEHAVIORAL_HEALTH = "behavioral_health"


# ---------------------------------------------------------------- FHIR datatypes
class Coding(BaseModel):
    system: str
    code: str
    display: Optional[str] = None


class CodeableConcept(BaseModel):
    coding: list[Coding] = Field(default_factory=list)
    text: Optional[str] = None


class Quantity(BaseModel):
    value: float
    unit: str
    system: str = UCUM
    code: str


class Reference(BaseModel):
    reference: str
    display: Optional[str] = None


class Meta(BaseModel):
    tag: list[Coding] = Field(default_factory=list)


class ObservationComponent(BaseModel):
    code: CodeableConcept
    valueQuantity: Quantity


class Observation(BaseModel):
    resourceType: Literal["Observation"] = "Observation"
    id: str = Field(default_factory=lambda: str(uuid4()))
    meta: Meta = Field(default_factory=Meta)
    status: Literal["registered", "preliminary", "final", "amended"] = "final"
    category: list[CodeableConcept] = Field(default_factory=list)
    code: CodeableConcept
    subject: Reference
    effectiveDateTime: datetime
    valueQuantity: Optional[Quantity] = None
    component: list[ObservationComponent] = Field(default_factory=list)
    interpretation: list[CodeableConcept] = Field(default_factory=list)
    device: Optional[Reference] = None
    is_synthetic: bool = False  # NO estándar FHIR: marca datos simulados

    @property
    def astronaut_id(self) -> str:
        return self.subject.reference.split("/")[-1]


# ---------------------------------------------------------------- especificación
class ComponentDef(BaseModel):
    key: str
    display: str
    unit: str
    ucum: str
    loinc: Optional[str] = None


class IndicatorSpec(BaseModel):
    loinc: Optional[str]
    display: str
    category: str
    unit: str
    ucum: str
    primary: str  # clave del valor principal dentro de `values`
    primary_in_quantity: bool = True  # False => panel (presión arterial)
    components: list[ComponentDef] = Field(default_factory=list)

    @property
    def keys(self) -> list[str]:
        base = [self.primary] if self.primary_in_quantity else []
        return base + [c.key for c in self.components]


SPECS: dict[Indicator, IndicatorSpec] = {
    Indicator.HEART_RATE: IndicatorSpec(
        loinc="8867-4", display="Heart rate", category="vital-signs",
        unit="beats/minute", ucum="/min", primary="value"),
    Indicator.SPO2: IndicatorSpec(
        loinc="59408-5", display="Oxygen saturation by pulse oximetry", category="vital-signs",
        unit="%", ucum="%", primary="value"),
    Indicator.BLOOD_PRESSURE: IndicatorSpec(
        loinc="85354-9", display="Blood pressure panel", category="vital-signs",
        unit="mmHg", ucum="mm[Hg]", primary="systolic", primary_in_quantity=False,
        components=[
            ComponentDef(key="systolic", display="Systolic blood pressure", unit="mmHg", ucum="mm[Hg]", loinc="8480-6"),
            ComponentDef(key="diastolic", display="Diastolic blood pressure", unit="mmHg", ucum="mm[Hg]", loinc="8462-4"),
        ]),
    Indicator.BODY_TEMP: IndicatorSpec(
        loinc="8310-5", display="Body temperature", category="vital-signs",
        unit="°C", ucum="Cel", primary="value"),
    Indicator.RESPIRATORY_RATE: IndicatorSpec(
        loinc="9279-1", display="Respiratory rate", category="vital-signs",
        unit="breaths/minute", ucum="/min", primary="value"),
    Indicator.SLEEP_METRICS: IndicatorSpec(
        loinc="93832-4", display="Sleep duration", category="activity",
        unit="h", ucum="h", primary="hours",
        components=[
            ComponentDef(key="deep_hours", display="Deep sleep", unit="h", ucum="h"),
            ComponentDef(key="rem_hours", display="REM sleep", unit="h", ucum="h"),
            ComponentDef(key="light_hours", display="Light sleep", unit="h", ucum="h"),
            ComponentDef(key="efficiency_pct", display="Sleep efficiency", unit="%", ucum="%"),
        ]),
    Indicator.RADIATION_DOSE: IndicatorSpec(
        loinc=None, display="Cumulative radiation dose", category="exam",
        unit="mSv", ucum="mSv", primary="cumulative_msv",
        components=[ComponentDef(key="rate_usv_h", display="Dose rate", unit="µSv/h", ucum="uSv/h")]),
    Indicator.BEHAVIORAL_HEALTH: IndicatorSpec(
        loinc=None, display="Behavioral health & mood", category="survey",
        unit="{score}", ucum="{score}", primary="stress_score",
        components=[
            ComponentDef(key="reaction_time_ms", display="Psychomotor vigilance reaction time", unit="ms", ucum="ms"),
            ComponentDef(key="sentiment", display="Sentiment (-1..1)", unit="{score}", ucum="{score}"),
        ]),
}


def _concept(indicator: Indicator, spec: IndicatorSpec) -> CodeableConcept:
    codings = []
    if spec.loinc:
        codings.append(Coding(system=LOINC, code=spec.loinc, display=spec.display))
    codings.append(Coding(system=CUSTOM, code=indicator.value, display=spec.display))
    return CodeableConcept(coding=codings, text=spec.display)


def build_observation(
    astronaut_id: str,
    indicator: Indicator,
    values: dict[str, float],
    effective_at: Optional[datetime] = None,
    is_synthetic: bool = False,
    device: str = "EVA-SUIT-SENSOR-01",
) -> Observation:
    spec = SPECS[indicator]
    missing = [k for k in spec.keys if k not in values]
    if missing:
        raise ValueError(f"{indicator.value}: faltan valores {missing}")

    quantity = None
    if spec.primary_in_quantity:
        quantity = Quantity(value=values[spec.primary], unit=spec.unit, code=spec.ucum)
    comps = [
        ObservationComponent(
            code=CodeableConcept(
                coding=[Coding(system=LOINC, code=c.loinc, display=c.display)] if c.loinc
                else [Coding(system=CUSTOM, code=c.key, display=c.display)],
                text=c.display),
            valueQuantity=Quantity(value=values[c.key], unit=c.unit, code=c.ucum),
        )
        for c in spec.components
    ]
    tag = Coding(system=SYNTH_TAG, code="SYNTHETIC" if is_synthetic else "REAL")
    return Observation(
        meta=Meta(tag=[tag]),
        category=[CodeableConcept(coding=[Coding(
            system="http://terminology.hl7.org/CodeSystem/observation-category", code=spec.category)])],
        code=_concept(indicator, spec),
        subject=Reference(reference=f"Patient/{astronaut_id}"),
        effectiveDateTime=effective_at or datetime.now(timezone.utc),
        valueQuantity=quantity,
        component=comps,
        device=Reference(reference=f"Device/{device}"),
        is_synthetic=is_synthetic,
    )


def indicator_of(obs: Observation) -> Indicator:
    for c in obs.code.coding:
        if c.system == CUSTOM:
            return Indicator(c.code)
    for c in obs.code.coding:
        if c.system == LOINC:
            for ind, spec in SPECS.items():
                if spec.loinc == c.code:
                    return ind
    raise ValueError("Observation.code no corresponde a ninguno de los 8 indicadores")


def values_from_observation(obs: Observation) -> dict[str, float]:
    ind = indicator_of(obs)
    spec = SPECS[ind]
    values: dict[str, float] = {}
    if obs.valueQuantity is not None:
        values[spec.primary] = obs.valueQuantity.value
    by_code = {c.loinc or c.key: c.key for c in spec.components}
    for comp in obs.component:
        for cd in comp.code.coding:
            if cd.code in by_code:
                values[by_code[cd.code]] = comp.valueQuantity.value
    if spec.primary not in values:
        raise ValueError(f"{ind.value}: falta el valor principal '{spec.primary}'")
    return values


def to_bundle(observations: list[dict]) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": o} for o in observations],
    }
