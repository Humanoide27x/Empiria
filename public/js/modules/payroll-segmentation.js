export const OPERARIO_DIVISION_LABEL = "OPERARIO MANIPULADOR DE ALIMENTOS";
export const MINIMUM_TEAM_DIVISION_LABEL = "EQUIPO MINIMO";
export const TEAM_AREA_ALL = "TODOS";
export const TEAM_MINIMUM_AREA_ORDER = [
  TEAM_AREA_ALL,
  "BODEGA RI",
  "BODEGA RP",
  "AUXILIAR DE RUTAS",
  "AREA DE FACTURACION",
  "AREA DE CALIDAD",
  "AREA DE TALENTO HUMANO",
  "AREA DE SEGURIDAD Y SALUD EN EL TRABAJO",
  "GESTORES DE ZONA",
  "AUXILIARES DE GESTOR DE ZONA",
  "COORDINACION OPERATIVA",
  "APOYO ADMINISTRATIVO",
  "OTROS",
];

export function normalizePayrollText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isOperarioPayrollPosition(position) {
  return normalizePayrollText(position) === normalizePayrollText(OPERARIO_DIVISION_LABEL);
}

export function classifyPayrollDivision(position) {
  return isOperarioPayrollPosition(position) ? "OPERARIO" : "EQUIPO_MINIMO";
}

export function classifyPayrollArea(position) {
  if (isOperarioPayrollPosition(position)) return OPERARIO_DIVISION_LABEL;
  const pos = normalizePayrollText(position);
  if (!pos) return "OTROS";
  if (pos.includes("BODEGA") && /\bRI\b/.test(pos)) return "BODEGA RI";
  if (pos.includes("BODEGA") && /\bRP\b/.test(pos)) return "BODEGA RP";
  if (pos.includes("AUXILIAR") && pos.includes("RUTA")) return "AUXILIAR DE RUTAS";
  if (pos.includes("FACTUR")) return "AREA DE FACTURACION";
  if (pos.includes("CALIDAD")) return "AREA DE CALIDAD";
  if (pos.includes("TALENTO HUMANO") || pos.includes("RECURSOS HUMANOS")) return "AREA DE TALENTO HUMANO";
  if (pos.includes("SEGURIDAD Y SALUD") || pos.includes("SALUD EN EL TRABAJO") || /\bSST\b/.test(pos)) {
    return "AREA DE SEGURIDAD Y SALUD EN EL TRABAJO";
  }
  if (pos.includes("AUXILIAR") && pos.includes("GESTOR") && pos.includes("ZONA")) return "AUXILIARES DE GESTOR DE ZONA";
  if (pos.includes("GESTOR") && pos.includes("ZONA")) return "GESTORES DE ZONA";
  if (pos.includes("COORDINACION OPERATIVA") || pos.includes("COORDINADOR OPERATIVO") || pos.includes("COORD OPERAT")) {
    return "COORDINACION OPERATIVA";
  }
  if (pos.includes("ADMINISTRAT")) return "APOYO ADMINISTRATIVO";
  return "OTROS";
}

export function buildTeamAreaBuckets(positions = []) {
  const buckets = new Map(TEAM_MINIMUM_AREA_ORDER.slice(1).map((area) => [area, {
    area,
    employees: 0,
    positions: [],
    groupIds: [],
  }]));
  for (const position of positions) {
    if (classifyPayrollDivision(position.position) !== "EQUIPO_MINIMO") continue;
    const area = classifyPayrollArea(position.position);
    const bucket = buckets.get(area) || buckets.get("OTROS");
    bucket.positions.push(position);
    bucket.employees += Number(position.employees || 0);
    for (const municipality of position.municipalities || []) {
      if (municipality?.id) bucket.groupIds.push(Number(municipality.id));
    }
  }
  return TEAM_MINIMUM_AREA_ORDER.slice(1).map((area) => {
    const bucket = buckets.get(area);
    return {
      area,
      employees: bucket?.employees || 0,
      positions: bucket?.positions || [],
      groupIds: Array.from(new Set(bucket?.groupIds || [])),
    };
  });
}

export function resolvePayrollScopeGroupIds({
  divisionKey,
  positions = [],
  municipalityId = "ALL",
  areaKey = TEAM_AREA_ALL,
} = {}) {
  if (divisionKey === "OPERARIO") {
    const operarioGroups = positions
      .filter((position) => classifyPayrollDivision(position.position) === "OPERARIO")
      .flatMap((position) => position.municipalities || []);
    if (municipalityId === "ALL") {
      return Array.from(new Set(operarioGroups.map((group) => Number(group.id)).filter(Boolean)));
    }
    return operarioGroups
      .filter((group) => String(group.id) === String(municipalityId))
      .map((group) => Number(group.id));
  }
  const buckets = buildTeamAreaBuckets(positions);
  const selected = areaKey === TEAM_AREA_ALL
    ? buckets
    : buckets.filter((bucket) => bucket.area === areaKey);
  return Array.from(new Set(selected.flatMap((bucket) => bucket.groupIds).filter(Boolean)));
}

export function dedupePayrollItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item?.employee_id || item?.employeeId || item?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function summarizePayrollItems(items = []) {
  const totals = items.reduce((acc, item) => {
    acc.employees += 1;
    acc.total_devengado += Number(item.total_devengado || 0);
    acc.total_deducciones += Number(item.total_deducciones || 0);
    acc.neto += Number(item.neto_pagar || 0);
    acc.base_salary += Number(item.base_salary || 0);
    acc.reviewed += item.reviewed ? 1 : 0;
    return acc;
  }, { employees: 0, total_devengado: 0, total_deducciones: 0, neto: 0, base_salary: 0, reviewed: 0 });
  return {
    ...totals,
    average_salary: totals.employees ? Math.round(totals.base_salary / totals.employees) : 0,
    pending: Math.max(0, totals.employees - totals.reviewed),
  };
}
