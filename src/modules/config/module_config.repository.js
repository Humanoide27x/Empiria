"use strict";

const pool = require("../../db/pool");

// ── Widget catalog ────────────────────────────────────────────────────────────

const WIDGET_CATALOG = [
  { id: "personal_activo",    label: "Personal Activo",        description: "KPI activos + conteo TC/MT",              icon: "👥" },
  { id: "cobertura_mapa",     label: "Mapa de Cobertura",      description: "Tabla de cobertura por municipio PAE",     icon: "🗺️" },
  { id: "cobertura_tc_mt",    label: "TC / MT",                description: "Tarjetas de Tiempo Completo y Medio",      icon: "⏱" },
  { id: "tc20_requerido",     label: "20% TC Requerido",       description: "Regla del 20% de TC por contrato",         icon: "📐" },
  { id: "gender_split",       label: "Distribución Género",    description: "Cards de hombres y mujeres activos",       icon: "👫" },
  { id: "distribucion_edad",  label: "Distribución Edad",      description: "Gráfica donut por rangos de edad",         icon: "🎂" },
  { id: "personal_por_cargo", label: "Personal por Cargo",     description: "Tabla activos y retirados por cargo",      icon: "📋" },
  { id: "alertas",            label: "Alertas",                description: "Panel de alertas del sistema",             icon: "🚨" },
];

const DEFAULT_WIDGETS = WIDGET_CATALOG.map((w, i) => ({
  id:       w.id,
  visible:  true,
  posicion: i + 1,
}));

// ── Field catalog per module ──────────────────────────────────────────────────

const MODULO_FIELDS_CATALOG = {
  personal: [
    { campo: "nombre",           etiqueta: "Nombre completo",       visible: true,  requerido: true,  base: true  },
    { campo: "documento",        etiqueta: "Tipo/No. Documento",    visible: true,  requerido: true,  base: true  },
    { campo: "cargo",            etiqueta: "Cargo",                 visible: true,  requerido: true,  base: true  },
    { campo: "fecha_ingreso",    etiqueta: "Fecha de ingreso",      visible: true,  requerido: true,  base: true  },
    { campo: "estado",           etiqueta: "Estado",                visible: true,  requerido: true,  base: true  },
    { campo: "municipio",        etiqueta: "Municipio",             visible: false, requerido: false, base: false },
    { campo: "institucion",      etiqueta: "Institución",           visible: false, requerido: false, base: false },
    { campo: "sede",             etiqueta: "Sede",                  visible: false, requerido: false, base: false },
    { campo: "modalidad",        etiqueta: "Modalidad",             visible: false, requerido: false, base: false },
    { campo: "tipo_tiempo",      etiqueta: "Tipo (TC/MT)",          visible: false, requerido: false, base: false },
    { campo: "tipo_vinculacion", etiqueta: "Tipo de vinculación",   visible: false, requerido: false, base: false },
    { campo: "eps",              etiqueta: "EPS",                   visible: false, requerido: false, base: false },
    { campo: "arl",              etiqueta: "ARL",                   visible: false, requerido: false, base: false },
    { campo: "pension",          etiqueta: "Fondo de pensión",      visible: false, requerido: false, base: false },
    { campo: "banco",            etiqueta: "Banco",                 visible: false, requerido: false, base: false },
    { campo: "numero_cuenta",    etiqueta: "Número de cuenta",      visible: false, requerido: false, base: false },
    { campo: "genero",           etiqueta: "Género",                visible: false, requerido: false, base: false },
    { campo: "fecha_nacimiento", etiqueta: "Fecha de nacimiento",   visible: false, requerido: false, base: false },
    { campo: "telefono",         etiqueta: "Teléfono",              visible: false, requerido: false, base: false },
    { campo: "email",            etiqueta: "Email",                 visible: false, requerido: false, base: false },
    { campo: "talla_camisa",     etiqueta: "Talla camisa",          visible: false, requerido: false, base: false },
    { campo: "talla_pantalon",   etiqueta: "Talla pantalón",        visible: false, requerido: false, base: false },
    { campo: "talla_zapatos",    etiqueta: "Talla zapatos",         visible: false, requerido: false, base: false },
  ],
  nomina: [
    { campo: "empleado",            etiqueta: "Empleado",           visible: true,  requerido: true,  base: true  },
    { campo: "cargo",               etiqueta: "Cargo",              visible: true,  requerido: true,  base: true  },
    { campo: "municipio",           etiqueta: "Municipio",          visible: true,  requerido: false, base: false },
    { campo: "dias_trabajados",     etiqueta: "Días trabajados",    visible: true,  requerido: true,  base: true  },
    { campo: "salario_base",        etiqueta: "Salario base",       visible: true,  requerido: true,  base: true  },
    { campo: "auxilio_transporte",  etiqueta: "Aux. transporte",    visible: true,  requerido: false, base: false },
    { campo: "total_devengado",     etiqueta: "Total devengado",    visible: true,  requerido: true,  base: true  },
    { campo: "deducciones",         etiqueta: "Deducciones",        visible: true,  requerido: false, base: false },
    { campo: "neto_pagar",          etiqueta: "Neto a pagar",       visible: true,  requerido: true,  base: true  },
  ],
  cobertura_pae: [
    { campo: "municipio",          etiqueta: "Municipio",           visible: true,  requerido: true,  base: true  },
    { campo: "institucion",        etiqueta: "Institución",         visible: true,  requerido: true,  base: true  },
    { campo: "sede",               etiqueta: "Sede",                visible: false, requerido: false, base: false },
    { campo: "modalidad",          etiqueta: "Modalidad",           visible: true,  requerido: true,  base: true  },
    { campo: "cupos",              etiqueta: "Cupos",               visible: true,  requerido: true,  base: true  },
    { campo: "personal_requerido", etiqueta: "Personal requerido",  visible: true,  requerido: true,  base: true  },
    { campo: "personal_actual",    etiqueta: "Personal actual",     visible: true,  requerido: true,  base: true  },
    { campo: "estado_cobertura",   etiqueta: "Estado",              visible: true,  requerido: true,  base: true  },
    { campo: "diferencia",         etiqueta: "Diferencia",          visible: false, requerido: false, base: false },
    { campo: "riesgo",             etiqueta: "Nivel de riesgo",     visible: false, requerido: false, base: false },
  ],
};

// ── Merge saved config with catalog defaults ───────────────────────────────────

function mergeWidgets(saved) {
  const savedMap = new Map((saved || []).map(w => [w.id, w]));
  return WIDGET_CATALOG.map((cat, i) => {
    const s = savedMap.get(cat.id);
    return {
      id:       cat.id,
      label:    cat.label,
      icon:     cat.icon,
      visible:  s ? s.visible : true,
      posicion: s ? s.posicion : i + 1,
    };
  }).sort((a, b) => a.posicion - b.posicion);
}

function mergeFields(slug, saved) {
  const catalog = MODULO_FIELDS_CATALOG[slug];
  if (!catalog) return [];
  const savedMap = new Map((saved || []).map(f => [f.campo, f]));
  return catalog.map(def => {
    const s = savedMap.get(def.campo);
    return {
      campo:     def.campo,
      etiqueta:  s?.etiqueta  ?? def.etiqueta,
      visible:   def.base ? true : (s?.visible   ?? def.visible),
      requerido: def.base ? true : (s?.requerido ?? def.requerido),
      base:      def.base,
    };
  });
}

// ── DB operations ──────────────────────────────────────────────────────────────

async function getDashboardConfig(contractId) {
  if (!contractId) return mergeWidgets([]);
  const { rows } = await pool.query(
    "SELECT widgets FROM dashboard_config WHERE contract_id = $1 LIMIT 1",
    [Number(contractId)]
  );
  return mergeWidgets(rows[0]?.widgets || []);
}

async function upsertDashboardConfig(contractId, widgets) {
  const { rows } = await pool.query(
    `INSERT INTO dashboard_config (contract_id, widgets, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (contract_id) DO UPDATE
       SET widgets = EXCLUDED.widgets, updated_at = NOW()
     RETURNING *`,
    [Number(contractId), JSON.stringify(widgets)]
  );
  return rows[0];
}

async function getModuleFieldsConfig(contractId, slug) {
  if (!contractId) return mergeFields(slug, []);
  const { rows } = await pool.query(
    "SELECT campos FROM modulo_campos_config WHERE contract_id = $1 AND modulo_slug = $2 LIMIT 1",
    [Number(contractId), slug]
  );
  return mergeFields(slug, rows[0]?.campos || []);
}

async function upsertModuleFieldsConfig(contractId, slug, campos) {
  const { rows } = await pool.query(
    `INSERT INTO modulo_campos_config (contract_id, modulo_slug, campos, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (contract_id, modulo_slug) DO UPDATE
       SET campos = EXCLUDED.campos, updated_at = NOW()
     RETURNING *`,
    [Number(contractId), slug, JSON.stringify(campos)]
  );
  return rows[0];
}

module.exports = {
  WIDGET_CATALOG,
  MODULO_FIELDS_CATALOG,
  getDashboardConfig,
  upsertDashboardConfig,
  getModuleFieldsConfig,
  upsertModuleFieldsConfig,
};
