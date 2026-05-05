// ============================================
// SISTEMA DE TOASTS
// ============================================
(function () {
  const container = document.createElement("div");
  container.id = "toast-container";
  document.body.appendChild(container);

  window.showToast = function (message, type = "info", title = "", duration = 3800) {
    const icons = { success: "\u2714", error: "\u2718", warning: "\u26a0", info: "\u2139" };
    const titles = { success: "Listo", error: "Error", warning: "Atenci\u00f3n", info: "Informaci\u00f3n" };

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <div class="toast-body">
        <div class="toast-title">${title || titles[type] || ""}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ""}
      </div>
      <button class="toast-close" onclick="this.closest('.toast').remove()">&#x2715;</button>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));

    const timer = setTimeout(() => {
      toast.classList.add("hide");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duration);

    toast.querySelector(".toast-close").addEventListener("click", () => clearTimeout(timer));
  };

  window.showSuccess = (msg, title) => showToast(msg, "success", title);
  window.showError   = (msg, title) => showToast(msg, "error",   title);
  window.showWarning = (msg, title) => showToast(msg, "warning", title);
  window.showInfo    = (msg, title) => showToast(msg, "info",    title);
})();

const state = {
  token: localStorage.getItem("empiria_token") || "",
  currentUser: null,
  access: null,
  availableModules: [],
  availableActions: [],
  availableRoles: [],
  companies: [],
  contracts: [],
  users: [],
  activeModule: null,
  expandedModule: null,
  activeSubmodule: null,
  requiresMfa: false,
  tempUsername: "",
  tempPassword: "",

  personnelCreateTab: "identificacion",
  personnelDraft: {},
  personnelViewMode: "table", // "table" | "create" | "edit"
  personnelEditingId: null,
  educationalCatalog: {}, // catálogo cacheado: municipio → institución → sede → modalidades
  personnelPage: 1,
  personnelPageSize: 50,
  novedadDraft: {},
  novedadFilters: {},
  desprendibleDraft: {},
  certDraft: {},

  personnelFilters: {
    search: "",
    status: "",
    hvStatus: "",
    municipality: "",
    gestorZona: "",
  },

  coverageSelectedUploadId: null,
  coverageActiveTab: "cobertura", // "cobertura" | "novedades"

  coverageFilters: {
    coverageSearch: "",
    coverageFilterMunicipality: "",
    coverageFilterModality: "",
    coverageFilterStatus: "",
    coverageFilterChange: "",
  },
};

const elements = {
  loginWrap: document.getElementById("loginWrap"),
  loginForm: document.getElementById("loginForm"),
  loginMessage: document.getElementById("loginMessage"),
  dashboard: document.getElementById("dashboard"),
  welcomeName: document.getElementById("welcomeName"),
  welcomeRole: document.getElementById("welcomeRole"),
  companyValue: document.getElementById("companyValue"),
  contractValue: document.getElementById("contractValue"),
  municipalityValue: document.getElementById("municipalityValue"),
  logoutButton: document.getElementById("logoutButton"),
  accessPanel: document.getElementById("accessPanel"),
  accessForm: document.getElementById("accessForm"),
  moduleSelect: document.getElementById("moduleSelect"),
  actionSelect: document.getElementById("actionSelect"),
  companyInput: document.getElementById("companyInput"),
  contractInput: document.getElementById("contractInput"),
  municipalityInput: document.getElementById("municipalityInput"),
  accessResult: document.getElementById("accessResult"),
  adminPanel: document.getElementById("adminPanel"),
  refreshUsersButton: document.getElementById("refreshUsersButton"),
  createUserForm: document.getElementById("createUserForm"),
  createName: document.getElementById("createName"),
  createUsername: document.getElementById("createUsername"),
  createPassword: document.getElementById("createPassword"),
  createRole: document.getElementById("createRole"),
  createCompanyId: document.getElementById("createCompanyId"),
  createContractId: document.getElementById("createContractId"),
  createMunicipalities: document.getElementById("createMunicipalities"),
  adminCreateMessage: document.getElementById("adminCreateMessage"),
  adminUsersList: document.getElementById("adminUsersList"),
  adminCount: document.getElementById("adminCount"),
  moduleNav: document.getElementById("moduleNav"),
  workspace: document.getElementById("workspace"),
  mfaFieldWrap: document.getElementById("mfaFieldWrap"),
  mfaCode: document.getElementById("mfaCode"),
  topUser: document.getElementById("topUser"),
  topCompany: document.getElementById("topCompany"),
  topContract: document.getElementById("topContract"),
  topMunicipality: document.getElementById("topMunicipality"),
  bootScreen: document.getElementById("bootScreen"),
};

const moduleViews = {
  dashboard: {
    title: "Dashboard",
    route: "/dashboard-summary",
    submodules: [{ key: "resumen_general", title: "Resumen general" }],
  },
  
  gestion_personal: {
    title: "Gestión del Personal",
    route: "/personnel",
    submodules: [],
  },
  
  cobertura_calculadora: {
    title: "Verificación de Cobertura",
    route: "/coverage",
    submodules: [],
  },

  nomina_novedades: {
    title: "Nómina y Novedades",
    route: "/payroll-changes",
    routeMethod: "POST",
    submodules: [
      { key: "registrar_novedad", title: "Registrar novedad" },
      { key: "consultar_novedades", title: "Consultar novedades" },
      { key: "desprendibles", title: "Desprendibles" },
      { key: "certificaciones", title: "Certificaciones" },
    ],
  },
  capacitaciones_asistencia: {
    title: "Capacitaciones y Asistencia",
    route: "/trainings",
    submodules: [
      { key: "programar_capacitacion", title: "Programar capacitación" },
      { key: "registrar_asistencia", title: "Registrar asistencia" },
      { key: "evidencias", title: "Evidencias" },
      { key: "historial_capacitaciones", title: "Historial" },
    ],
  },
  informes_reportes: {
    title: "Informes y Reportes",
    route: "/reports",
    submodules: [
      { key: "reportes_personal", title: "Reportes de personal" },
      { key: "reportes_cobertura", title: "Reportes de cobertura" },
      { key: "reportes_nomina", title: "Reportes de nómina" },
      { key: "exportaciones", title: "Exportaciones" },
    ],
  },
  solicitudes_empleados: {
    title: "Solicitudes de Empleados",
    route: null,
    submodules: [
      { key: "solicitar_certificacion", title: "Solicitar certificación laboral" },
      { key: "solicitar_desprendible", title: "Solicitar desprendible de pago" },
      { key: "estado_solicitudes", title: "Estado de solicitudes" },
    ],
  },
  administracion_configuraciones: {
    title: "Administración y Configuraciones",
    route: "/users",
    submodules: [
      { key: "gestion_usuarios", title: "Gestión de usuarios" },
      { key: "roles_permisos", title: "Roles y permisos" },
      { key: "probar_acceso", title: "Probar acceso" },
      { key: "auditoria", title: "Auditoría" },
      { key: "bloqueos", title: "Bloqueos" },
    ],
  },
};

const COLOMBIA_DEPARTMENTS = [
  "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar",
  "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó",
  "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira",
  "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío",
  "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima",
  "Valle del Cauca", "Vaupés", "Vichada",
];

const META_MUNICIPALITIES = [
  { id: 1, name: "Acacías" },
  { id: 2, name: "Barranca de Upía" },
  { id: 3, name: "Cabuyaro" },
  { id: 4, name: "Castilla la Nueva" },
  { id: 5, name: "Cubarral" },
  { id: 6, name: "Cumaral" },
  { id: 7, name: "El Calvario" },
  { id: 8, name: "El Castillo" },
  { id: 9, name: "El Dorado" },
  { id: 10, name: "Fuente de Oro" },
  { id: 11, name: "Granada" },
  { id: 12, name: "Guamal" },
  { id: 13, name: "La Macarena" },
  { id: 14, name: "La Uribe" },
  { id: 15, name: "Lejanías" },
  { id: 16, name: "Mapiripán" },
  { id: 17, name: "Mesetas" },
  { id: 18, name: "Puerto Concordia" },
  { id: 19, name: "Puerto Gaitán" },
  { id: 20, name: "Puerto Lleras" },
  { id: 21, name: "Puerto López" },
  { id: 22, name: "Puerto Rico" },
  { id: 23, name: "Restrepo" },
  { id: 24, name: "San Carlos de Guaroa" },
  { id: 25, name: "San Juan de Arama" },
  { id: 26, name: "San Juanito" },
  { id: 27, name: "San Martín" },
  { id: 28, name: "Villavicencio" },
  { id: 29, name: "Vista Hermosa" }
];

function getMunicipalityName(value) {
  if (!value) return "-";

  const found = META_MUNICIPALITIES.find((municipality) => {
    return String(municipality.id) === String(value);
  });

  return found ? found.name : "-";
}

const LICITACION_CARGOS = [
  "OPERARIO DE BODEGA",
  "AUXILIARES Y TRANSPORTADORES",
  "OPERARIO MANIPULADOR DE ALIMENTOS",
  "COORDINADOR DE SUMINISTRO",
  "SUPERVISOR DE CALIDAD",
  "AUXILIAR ADMINISTRATIVO",
];

const CARGOS_REALES = [
  "AREA DE FACTURACION",
  "AREA DE TALENTO HUMANO",
  "AREA DE CALIDAD",
  "OPERARIO DE BODEGA RI",
  "OPERARIO DE BODEGA RP",
  "AUXILIARES DE RUTA RI",
  "AUXILIARES DE RUTA RP",
  "GESTOR DE ZONA",
  "AUXILIAR DE GESTOR DE ZONA",
  "OPERARIO MANIPULADOR DE ALIMENTOS",
];

const ESTADOS_PERSONAL = [
  "ACTIVO",
  "INACTIVO",
  "EN PROCESO A",
  "EN PROCESO B",
  "SUSPENDIDO",
];

const DOC_TYPE_LABELS = {
  CC: "CC",
  CE: "CE",
  PPT: "PPT",
  PA: "PA",
  NIT: "NIT",
};

const MUNICIPALITIES_BY_DEPARTMENT = {
  "Amazonas": ["Leticia", "Puerto Nariño"],
  "Antioquia": [
    "Abejorral","Abriaquí","Alejandría","Amagá","Amalfi","Andes","Angelópolis","Angostura","Anorí","Santa Fe de Antioquia",
    "Anzá","Apartadó","Arboletes","Argelia","Armenia","Barbosa","Belmira","Bello","Betania","Betulia","Ciudad Bolívar",
    "Briceño","Buriticá","Cáceres","Caicedo","Caldas","Campamento","Cañasgordas","Caracolí","Caramanta","Carepa",
    "El Carmen de Viboral","Carolina","Caucasia","Chigorodó","Cisneros","Cocorná","Concepción","Concordia","Copacabana",
    "Dabeiba","Donmatías","Ebéjico","El Bagre","Entrerríos","Envigado","Fredonia","Frontino","Giraldo","Girardota",
    "Gómez Plata","Granada","Guadalupe","Guarne","Guatapé","Heliconia","Hispania","Itagüí","Ituango","Jardín","Jericó",
    "La Ceja","La Estrella","La Pintada","La Unión","Liborina","Maceo","Marinilla","Medellín","Montebello","Murindó",
    "Mutatá","Nariño","Necoclí","Nechí","Olaya","Peñol","Peque","Pueblorrico","Puerto Berrío","Puerto Nare","Puerto Triunfo",
    "Remedios","Retiro","Rionegro","Sabanalarga","Sabaneta","Salgar","San Andrés de Cuerquia","San Carlos","San Francisco",
    "San Jerónimo","San José de la Montaña","San Juan de Urabá","San Luis","San Pedro de los Milagros","San Pedro de Urabá",
    "San Rafael","San Roque","San Vicente Ferrer","Santa Bárbara","Santuario","Segovia","Sonsón","Sopetrán","Támesis",
    "Tarazá","Tarso","Titiribí","Toledo","Turbo","Uramita","Urrao","Valdivia","Valparaíso","Vegachí","Venecia","Vigía del Fuerte",
    "Yalí","Yarumal","Yolombó","Yondó","Zaragoza"
  ],
  "Arauca": ["Arauca","Arauquita","Cravo Norte","Fortul","Puerto Rondón","Saravena","Tame"],
  "Atlántico": [
    "Barranquilla","Baranoa","Campo de la Cruz","Candelaria","Galapa","Juan de Acosta","Luruaco","Malambo","Manatí",
    "Palmar de Varela","Piojó","Polonuevo","Ponedera","Puerto Colombia","Repelón","Sabanagrande","Sabanalarga",
    "Santa Lucía","Santo Tomás","Soledad","Suan","Tubará","Usiacurí"
  ],
  "Bogotá D.C.": ["Bogotá D.C."],
  "Bolívar": [
    "Achí","Altos del Rosario","Arenal","Arjona","Arroyohondo","Barranco de Loba","Calamar","Cantagallo","Cartagena de Indias",
    "Cicuco","Clemencia","Córdoba","El Guamo","El Carmen de Bolívar","El Peñón","Hatillo de Loba","Magangué","Mahates",
    "Margarita","María la Baja","Montecristo","Mompós","Morales","Norosí","Pinillos","Regidor","Río Viejo","San Cristóbal",
    "San Estanislao","San Fernando","San Jacinto","San Jacinto del Cauca","San Juan Nepomuceno","San Martín de Loba",
    "Santa Catalina","Santa Rosa","Santa Rosa del Sur","Simití","Soplaviento","Talaigua Nuevo","Tiquisio","Turbaco","Turbaná",
    "Villanueva","Zambrano"
  ],
  "Boyacá": [
    "Tunja","Almeida","Aquitania","Arcabuco","Belén","Berbeo","Betéitiva","Boavita","Boyacá","Briceño","Buenavista","Busbanzá",
    "Caldas","Campohermoso","Cerinza","Chinavita","Chiquinquirá","Chíquiza","Chiscas","Chita","Chitaraque","Chivatá","Ciénega",
    "Cómbita","Coper","Corrales","Covarachía","Cubará","Cucaita","Cuítiva","Chitaraque","Duitama","El Cocuy","El Espino","Firavitoba",
    "Floresta","Gachantivá","Gámeza","Garagoa","Guacamayas","Guateque","Guayatá","Güicán","Iza","Jenesano","Jericó","Labranzagrande",
    "La Capilla","La Victoria","La Uvita","Villa de Leyva","Macanal","Maripí","Miraflores","Mongua","Monguí","Moniquirá","Motavita",
    "Muzo","Nobsa","Nuevo Colón","Oicatá","Otanche","Pachavita","Páez","Paipa","Pajarito","Panqueba","Pauna","Paya","Paz de Río",
    "Pesca","Pisba","Puerto Boyacá","Quípama","Ramiriquí","Ráquira","Rondón","Saboyá","Sáchica","Samacá","San Eduardo","San José de Pare",
    "San Luis de Gaceno","San Mateo","San Miguel de Sema","San Pablo de Borbur","Santa María","Santa Rosa de Viterbo","Santa Sofía",
    "Santana","Sativanorte","Sativasur","Siachoque","Soatá","Socha","Socotá","Sogamoso","Somondoco","Sora","Sotaquirá","Soracá",
    "Susacón","Sutamarchán","Sutatenza","Tasco","Tenza","Tibaná","Tibasosa","Tinjacá","Tipacoque","Toca","Togüí","Tópaga","Tota",
    "Tununguá","Turmequé","Tuta","Tutazá","Úmbita","Ventaquemada","Viracachá","Zetaquira"
  ],
  "Caldas": [
    "Manizales","Aguadas","Anserma","Aranzazu","Belalcázar","Chinchiná","Filadelfia","La Dorada","La Merced","Manzanares","Marmato",
    "Marquetalia","Marulanda","Neira","Norcasia","Pácora","Palestina","Pensilvania","Riosucio","Risaralda","Salamina","Samaná",
    "San José","Supía","Victoria","Villamaría","Viterbo"
  ],
  "Caquetá": [
    "Florencia","Albania","Belén de los Andaquíes","Cartagena del Chairá","Curillo","El Doncello","El Paujil","La Montañita","Milán",
    "Morelia","Puerto Rico","San José del Fragua","San Vicente del Caguán","Solano","Solita","Valparaíso"
  ],
  "Casanare": [
    "Yopal","Aguazul","Chámeza","Hato Corozal","La Salina","Maní","Monterrey","Nunchía","Orocué","Paz de Ariporo","Pore",
    "Recetor","Sabanalarga","Sácama","San Luis de Palenque","Támara","Tauramena","Trinidad","Villanueva"
  ],
  "Cauca": [
    "Popayán","Almaguer","Argelia","Balboa","Bolívar","Buenos Aires","Cajibío","Caldono","Caloto","Corinto","El Tambo","Florencia",
    "Guachené","Guapi","Inzá","Jambaló","La Sierra","La Vega","López de Micay","Mercaderes","Miranda","Morales","Padilla","Páez",
    "Patía","Piamonte","Piendamó","Puerto Tejada","Puracé","Rosas","San Sebastián","Santa Rosa","Santander de Quilichao","Silvia",
    "Sotará","Suárez","Sucre","Timbío","Timbiquí","Toribío","Totoró","Villa Rica"
  ],
  "Cesar": [
    "Valledupar","Aguachica","Agustín Codazzi","Astrea","Becerril","Bosconia","Chimichagua","Chiriguaná","Curumaní","El Copey",
    "El Paso","Gamarra","González","La Gloria","La Jagua de Ibirico","Manaure Balcón del Cesar","Pailitas","Pelaya","Pueblo Bello",
    "Río de Oro","San Alberto","San Diego","San Martín","Tamalameque"
  ],
  "Chocó": [
    "Quibdó","Acandí","Alto Baudó","Atrato","Bagadó","Bahía Solano","Bajo Baudó","Belén de Bajirá","Bojayá","Cantón de San Pablo",
    "Carmen del Darién","Cértegui","Condoto","El Carmen de Atrato","El Litoral del San Juan","Istmina","Juradó","Lloró","Medio Atrato",
    "Medio Baudó","Medio San Juan","Nóvita","Nuquí","Río Iró","Río Quito","Riosucio","San José del Palmar","Sipí","Tadó","Unguía","Unión Panamericana"
  ],
  "Córdoba": [
    "Montería","Ayapel","Buenavista","Canalete","Cereté","Chimá","Chinú","Ciénaga de Oro","Cotorra","La Apartada","Lorica","Los Córdobas",
    "Momil","Montelíbano","Moñitos","Planeta Rica","Pueblo Nuevo","Puerto Escondido","Puerto Libertador","Purísima","Sahagún",
    "San Andrés de Sotavento","San Antero","San Bernardo del Viento","San Carlos","San José de Uré","San Pelayo","Tierralta",
    "Tuchín","Valencia"
  ],
  "Cundinamarca": [
    "Agua de Dios","Albán","Anapoima","Anolaima","Apulo","Arbeláez","Beltrán","Bituima","Bojacá","Cabrera","Cachipay","Cajicá",
    "Caparrapí","Cáqueza","Carmen de Carupa","Chaguaní","Chía","Chipaque","Choachí","Chocontá","Cogua","Cota","Cucunubá",
    "El Colegio","El Peñón","El Rosal","Facatativá","Fómeque","Fosca","Funza","Fúquene","Fusagasugá","Gachalá","Gachancipá",
    "Gachetá","Gama","Girardot","Granada","Guachetá","Guaduas","Guasca","Guataquí","Guatavita","Guayabal de Síquima","Guayabetal",
    "Gutiérrez","Jerusalén","Junín","La Calera","La Mesa","La Palma","La Peña","La Vega","Lenguazaque","Machetá","Madrid","Manta",
    "Medina","Mosquera","Nariño","Nemocón","Nilo","Nimaima","Nocaima","Pacho","Paime","Pandi","Paratebueno","Pasca","Puerto Salgar",
    "Pulí","Quebradanegra","Quetame","Quipile","Ricaurte","San Antonio del Tequendama","San Bernardo","San Cayetano","San Francisco",
    "San Juan de Rioseco","Sasaima","Sesquilé","Sibaté","Silvania","Simijaca","Soacha","Sopó","Subachoque","Suesca","Supatá","Susa",
    "Sutatausa","Tabio","Tausa","Tena","Tenjo","Tibacuy","Tibirita","Tocaima","Tocancipá","Topaipí","Ubalá","Ubaque","Villa de San Diego de Ubaté",
    "Une","Útica","Venecia","Vergara","Vianí","Villagómez","Villapinzón","Villeta","Viotá","Yacopí","Zipacón","Zipaquirá"
  ],
  "Guainía": ["Inírida"],
  "Guaviare": ["San José del Guaviare","Calamar","El Retorno","Miraflores"],
  "Huila": [
    "Neiva","Acevedo","Agrado","Aipe","Algeciras","Altamira","Baraya","Campoalegre","Colombia","Elías","Garzón","Gigante","Guadalupe",
    "Hobo","Íquira","Isnos","La Argentina","La Plata","Nátaga","Oporapa","Paicol","Palermo","Palestina","Pital","Pitalito","Rivera",
    "Saladoblanco","San Agustín","Santa María","Suaza","Tarqui","Tello","Teruel","Tesalia","Timaná","Villavieja","Yaguará"
  ],
  "La Guajira": [
    "Riohacha","Albania","Barrancas","Dibulla","Distracción","El Molino","Fonseca","Hatonuevo","La Jagua del Pilar","Maicao",
    "Manaure","San Juan del Cesar","Uribia","Urumita","Villanueva"
  ],
  "Magdalena": [
    "Santa Marta","Algarrobo","Aracataca","Ariguaní","Cerro de San Antonio","Chivolo","Ciénaga","Concordia","El Banco","El Piñón",
    "El Retén","Fundación","Guamal","Nueva Granada","Pedraza","Pijiño del Carmen","Pivijay","Plato","Puebloviejo","Remolino","Sabanas de San Ángel",
    "Salamina","San Sebastián de Buenavista","San Zenón","Santa Ana","Santa Bárbara de Pinto","Sitionuevo","Tenerife","Zapayán","Zona Bananera"
  ],
  "Meta": META_MUNICIPALITIES,
  "Nariño": [
    "Pasto","Albán","Aldana","Ancuyá","Arboleda","Barbacoas","Belén","Buesaco","Colón","Consacá","Contadero","Córdoba","Cuaspud",
    "Cumbal","Cumbitara","Chachagüí","El Charco","El Peñol","El Rosario","El Tablón de Gómez","El Tambo","Francisco Pizarro","Funes",
    "Guachucal","Guaitarilla","Gualmatán","Iles","Imués","Ipiales","La Cruz","La Florida","La Llanada","La Tola","La Unión","Leiva",
    "Linares","Los Andes","Magüí","Mallama","Mosquera","Nariño","Olaya Herrera","Ospina","Policarpa","Potosí","Providencia","Puerres",
    "Pupiales","Ricaurte","Roberto Payán","Samaniego","Sandoná","San Bernardo","San Lorenzo","San Pablo","San Pedro de Cartago","Santa Bárbara",
    "Santacruz","Sapuyes","Taminango","Tangua","Tumaco","Túquerres","Yacuanquer"
  ],
  "Norte de Santander": [
    "Cúcuta","Abrego","Arboledas","Bochalema","Bucarasica","Cácota","Cachirá","Chinácota","Chitagá","Convención","Cucutilla","Durania",
    "El Carmen","El Tarra","El Zulia","Gramalote","Hacarí","Herrán","Labateca","La Esperanza","La Playa","Los Patios","Lourdes","Mutiscua",
    "Ocaña","Pamplona","Pamplonita","Puerto Santander","Ragonvalia","Salazar","San Calixto","San Cayetano","Santiago","Sardinata",
    "Silos","Teorama","Tibú","Toledo","Villa Caro","Villa del Rosario"
  ],
  "Putumayo": [
    "Mocoa","Colón","Orito","Puerto Asís","Puerto Caicedo","Puerto Guzmán","Puerto Leguízamo","Sibundoy","San Francisco",
    "San Miguel","Santiago","Valle del Guamuez","Villagarzón"
  ],
  "Quindío": ["Armenia","Buenavista","Calarcá","Circasia","Córdoba","Filandia","Génova","La Tebaida","Montenegro","Pijao","Quimbaya","Salento"],
  "Risaralda": [
    "Pereira","Apía","Balboa","Belén de Umbría","Dosquebradas","Guática","La Celia","La Virginia","Marsella","Mistrató","Pueblo Rico",
    "Quinchía","Santa Rosa de Cabal","Santuario"
  ],
  "San Andrés y Providencia": ["San Andrés","Providencia y Santa Catalina"],
  "Santander": [
    "Bucaramanga","Aguada","Albania","Aratoca","Barbosa","Barichara","Barrancabermeja","Betulia","Bolívar","Cabrera","California","Capitanejo",
    "Carcasí","Cepitá","Cerrito","Charalá","Charta","Chipatá","Cimitarra","Concepción","Confines","Contratación","Coromoro","Curití",
    "El Carmen de Chucurí","El Guacamayo","El Peñón","El Playón","Encino","Enciso","Florián","Floridablanca","Galán","Gámbita","Girón",
    "Guaca","Guadalupe","Guapotá","Guavatá","Güepsa","Hato","Jesús María","Jordán","La Belleza","Landázuri","La Paz","Lebrija","Los Santos",
    "Macaravita","Málaga","Matanza","Mogotes","Molagavita","Ocamonte","Oiba","Onzaga","Palmar","Palmas del Socorro","Páramo","Piedecuesta",
    "Pinchote","Puente Nacional","Puerto Parra","Puerto Wilches","Rionegro","Sabana de Torres","San Andrés","San Benito","San Gil","San Joaquín",
    "San José de Miranda","San Miguel","San Vicente de Chucurí","Santa Bárbara","Santa Helena del Opón","Simacota","Socorro","Suaita","Sucre",
    "Suratá","Tona","Valle de San José","Vélez","Vetas","Villanueva","Zapatoca"
  ],
  "Sucre": [
    "Sincelejo","Buenavista","Caimito","Colosó","Corozal","Coveñas","Chalán","El Roble","Galeras","Guaranda","La Unión","Los Palmitos",
    "Majagual","Morroa","Ovejas","Palmito","Sampués","San Benito Abad","San Juan de Betulia","San Marcos","San Onofre","San Pedro","Sincé",
    "Sucre","Tolú","Toluviejo"
  ],
  "Tolima": [
    "Ibagué","Alpujarra","Alvarado","Ambalema","Anzoátegui","Armero","Ataco","Cajamarca","Carmen de Apicalá","Casabianca","Chaparral",
    "Coello","Coyaima","Cunday","Dolores","Espinal","Falán","Flandes","Fresno","Guamo","Herveo","Honda","Icononzo","Lérida","Líbano","Mariquita",
    "Melgar","Murillo","Natagaima","Ortega","Palocabildo","Piedras","Planadas","Prado","Purificación","Rioblanco","Roncesvalles","Rovira","Saldaña",
    "San Antonio","San Luis","Santa Isabel","Suárez","Valle de San Juan","Venadillo","Villahermosa","Villarrica"
  ],
  "Valle del Cauca": [
    "Cali","Alcalá","Andalucía","Ansermanuevo","Argelia","Bolívar","Buenaventura","Buga","Bugalagrande","Caicedonia","Calima","Candelaria",
    "Cartago","Dagua","El Águila","El Cairo","El Cerrito","El Dovio","Florida","Ginebra","Guacarí","Jamundí","La Cumbre","La Unión","La Victoria",
    "Obando","Palmira","Pradera","Restrepo","Riofrío","Roldanillo","San Pedro","Sevilla","Toro","Trujillo","Tuluá","Ulloa","Versalles","Vijes","Yotoco","Yumbo","Zarzal"
  ],
  "Vaupés": ["Mitú","Carurú","Pacoa","Taraira","Papunahua","Yavaraté"],
  "Vichada": ["Puerto Carreño","La Primavera","Santa Rosalía","Cumaribo"],
};

async function apiFetch(path, options = {}) {
  const token = state.token || localStorage.getItem("empiria_token") || "";
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, message: "Respuesta inválida del servidor" };
  }

  if (!response.ok) {
    throw new Error(payload.message || "Ocurrió un error");
  }

  return payload;
}

function prettyLabel(text) {
  return String(text || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function renderOptions(items, currentValue = "", placeholder = "Selecciona") {
  return `
    <option value="">${placeholder}</option>
    ${items
      .map((item) => {
        const value =
          item && typeof item === "object"
            ? item.id ?? item.value ?? item.name ?? ""
            : item;

        const label =
          item && typeof item === "object"
            ? item.name ?? item.label ?? item.value ?? ""
            : item;

        return `<option value="${escapeAttr(value)}" ${
          String(currentValue) === String(value) ||
          String(currentValue) === String(label)
            ? "selected"
            : ""
        }>${label}</option>`;
      })
      .join("")}
  `;
}

function iconSvg(pathMarkup) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${pathMarkup}
    </svg>
  `;
}

function getModuleMeta(moduleKey) {
  const moduleMap = {
    dashboard: {
      label: "Dashboard",
      icon: iconSvg(`
        <line x1="5" y1="20" x2="19" y2="20"></line>
        <rect x="6" y="11" width="2.8" height="7" rx="1"></rect>
        <rect x="10.6" y="8" width="2.8" height="10" rx="1"></rect>
        <rect x="15.2" y="5" width="2.8" height="13" rx="1"></rect>
      `),
    },
    gestion_personal: {
      label: "Gestión del Personal",
      icon: iconSvg(`
        <circle cx="9" cy="8" r="2.5"></circle>
        <path d="M4.8 17.2c.7-2.1 2.4-3.2 4.2-3.2s3.5 1.1 4.2 3.2"></path>
        <circle cx="16.5" cy="9.2" r="2"></circle>
        <path d="M14.7 16.8c.4-1.3 1.4-2.1 2.8-2.1 1.3 0 2.4.8 2.9 2.1"></path>
      `),
    },
    cobertura_calculadora: {
      label: "Verificación de Cobertura",
      icon: iconSvg(`
        <path d="M5.5 18.5h13"></path>
        <path d="M7.5 16V11"></path>
        <path d="M12 16V7"></path>
        <path d="M16.5 16V9"></path>
      `),
    },
    nomina_novedades: {
      label: "Nómina y Novedades",
      icon: iconSvg(`
        <rect x="5.5" y="6" width="13" height="12" rx="2"></rect>
        <path d="M9 10.2c.4-.8 1.2-1.2 2.1-1.2 1.1 0 1.9.5 1.9 1.4 0 2-3.3 1.3-3.3 3.1 0 .9.8 1.5 2.1 1.5 1 0 1.9-.4 2.5-1.1"></path>
      `),
    },
    capacitaciones_asistencia: {
      label: "Capacitaciones y Asistencia",
      icon: iconSvg(`
        <path d="M4.5 8.5L12 5l7.5 3.5L12 12z"></path>
        <path d="M7 10.5V14.5c0 .9 2.2 2 5 2s5-1.1 5-2v-4"></path>
      `),
    },
    informes_reportes: {
      label: "Informes y Reportes",
      icon: iconSvg(`
        <path d="M7.5 4.5h7l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5z"></path>
        <path d="M14.5 4.5V8h3"></path>
        <polyline points="9,15 11,13 13,14 15.5,11.5"></polyline>
      `),
    },
    solicitudes_empleados: {
      label: "Solicitudes de Empleados",
      icon: iconSvg(`
        <rect x="4.5" y="6.5" width="15" height="11" rx="2"></rect>
        <path d="M6 8l6 4 6-4"></path>
      `),
    },
    administracion_configuraciones: {
      label: "Administración y Configuraciones",
      icon: iconSvg(`
        <circle cx="12" cy="12" r="2.4"></circle>
        <path d="M12 5.5v1.3"></path>
        <path d="M12 17.2v1.3"></path>
        <path d="M18.5 12h-1.3"></path>
        <path d="M6.8 12H5.5"></path>
        <path d="M16.6 7.4l-.9.9"></path>
        <path d="M8.3 15.7l-.9.9"></path>
        <path d="M16.6 16.6l-.9-.9"></path>
        <path d="M8.3 8.3l-.9-.9"></path>
      `),
    },
  };

  return moduleMap[moduleKey] || {
    label: prettyLabel(moduleKey),
    icon: iconSvg(`<circle cx="12" cy="12" r="3"></circle>`),
  };
}

function showLoginMessage(message, isError = true) {
  if (!elements.loginMessage) return;
  elements.loginMessage.textContent = message || "";
  elements.loginMessage.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

function showAdminCreateMessage(message, isError = true) {
  if (!elements.adminCreateMessage) return;
  elements.adminCreateMessage.textContent = message || "";
  elements.adminCreateMessage.style.color = isError ? "#9d2f2f" : "#0d6b5b";
}

function fillSelect(select, values) {
  if (!select) return;
  select.innerHTML = values
    .map((value) => `<option value="${value}">${prettyLabel(value)}</option>`)
    .join("");
}

function fillOptionSelect(select, items, { valueKey, labelBuilder, includeEmpty }) {
  if (!select) return;

  const emptyOption = includeEmpty ? '<option value="">Sin asignar</option>' : "";

  select.innerHTML =
    emptyOption +
    items
      .map((item) => `<option value="${item[valueKey]}">${labelBuilder(item)}</option>`)
      .join("");
}

function toMunicipalityArray(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCompany(companyId) {
  if (companyId === null || companyId === undefined || companyId === "") {
    return "Sin asignar";
  }

  const found = state.companies.find((item) => item.id === Number(companyId));
  return found ? `${found.name} (${found.id})` : String(companyId);
}

function formatContract(contractId) {
  if (contractId === null || contractId === undefined || contractId === "") {
    return "Sin asignar";
  }

  const found = state.contracts.find((item) => item.id === Number(contractId));
  return found ? `${found.name} (${found.id})` : String(contractId);
}

function getCompanyOptionsHtml(currentValue = "") {
  return `
    <option value="">Selecciona empresa</option>
    ${state.companies
      .map(
        (company) => `
          <option value="${company.id}" ${
            String(currentValue) === String(company.id) ? "selected" : ""
          }>
            ${company.name}
          </option>
        `
      )
      .join("")}
  `;
}

function getContractOptionsHtml(companyId, currentValue = "") {
  const selectedCompanyId = Number(companyId || 0);
  const contracts = state.contracts.filter(
    (contract) => !selectedCompanyId || Number(contract.companyId) === selectedCompanyId
  );

  return `
    <option value="">Selecciona contrato</option>
    ${contracts
      .map(
        (contract) => `
          <option value="${contract.id}" ${
            String(currentValue) === String(contract.id) ? "selected" : ""
          }>
            ${contract.name}
          </option>
        `
      )
      .join("")}
  `;
}

function getDepartmentMunicipalities(departmentName) {
  return MUNICIPALITIES_BY_DEPARTMENT[departmentName] || [];
}

function isInstitutionalTabEnabled(cargoReal) {
  return [
    "OPERARIO MANIPULADOR DE ALIMENTOS",
    "GESTOR DE ZONA",
    "AUXILIAR DE GESTOR DE ZONA",
  ].includes(String(cargoReal || "").toUpperCase());
}

function syncPersonnelDraftField(target) {
  if (!target?.name) return;

  if (target.type === "checkbox") {
    state.personnelDraft[target.name] = target.checked ? "true" : "";
    return;
  }

  if (target.multiple) {
    const values = Array.from(target.selectedOptions).map((option) => option.value);
    state.personnelDraft[target.name] = values.join("|");
    return;
  }

  state.personnelDraft[target.name] = target.value;
}

function enforceInputRestrictions(form) {
  if (!form) return;

  form.querySelectorAll("[data-only-letters]").forEach((field) => {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, "");
      syncPersonnelDraftField(field);
    });
  });

  form.querySelectorAll("[data-only-numbers]").forEach((field) => {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/\D/g, "");
      syncPersonnelDraftField(field);
    });
  });
}

function syncEmployeeHeaderFromDraft() {
  const employeeHeaderName = document.getElementById("employeeHeaderName");
  const employeeHeaderDocument = document.getElementById("employeeHeaderDocument");

  const fullNameParts = [
    state.personnelDraft.firstName || "",
    state.personnelDraft.secondName || "",
    state.personnelDraft.firstLastName || "",
    state.personnelDraft.secondLastName || "",
  ].filter(Boolean);

  const fullName = fullNameParts.length
    ? fullNameParts.join(" ").toUpperCase()
    : "NOMBRE COMPLETO DE LA PERSONA";

  if (employeeHeaderName) {
    employeeHeaderName.textContent = fullName;
  }

  const docType = state.personnelDraft.documentType || "";
  const docNumber = state.personnelDraft.documentNumber || "";
  const docLabel = DOC_TYPE_LABELS[docType] || docType || "Tipo de documento";

  if (employeeHeaderDocument) {
    employeeHeaderDocument.textContent =
      docType || docNumber
        ? `${docLabel} ${docNumber}`.trim()
        : "Tipo de documento y número de documento";
  }
}

function autoSetResidenceCertificateDate() {
  const hasExpiration = state.personnelDraft.residenceCertificateHasExpiration === "true";
  if (hasExpiration) return;

  const expeditionYear = Number(state.personnelDraft.expeditionYear || 0);
  const expeditionMonth = Number(state.personnelDraft.expeditionMonth || 0);
  const expeditionDay = Number(state.personnelDraft.expeditionDay || 0);

  if (!expeditionYear || !expeditionMonth || !expeditionDay) return;

  const baseDate = new Date(expeditionYear, expeditionMonth - 1, expeditionDay);
  if (Number.isNaN(baseDate.getTime())) return;

  baseDate.setMonth(baseDate.getMonth() + 6);

  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd = String(baseDate.getDate()).padStart(2, "0");

  state.personnelDraft.residenceCertificateExpiration = `${yyyy}-${mm}-${dd}`;
}

function ensureMfaField() {
  if (!elements.mfaFieldWrap || !elements.mfaCode) return;
  elements.mfaFieldWrap.classList.add("hidden");
  elements.mfaCode.value = "";
  elements.mfaCode.removeAttribute("required");
}

function showMfaField(show = true) {
  if (!elements.mfaFieldWrap || !elements.mfaCode) return;

  if (show) {
    elements.mfaFieldWrap.classList.remove("hidden");
    elements.mfaCode.setAttribute("required", "required");
    setTimeout(() => elements.mfaCode.focus(), 0);
  } else {
    elements.mfaFieldWrap.classList.add("hidden");
    elements.mfaCode.removeAttribute("required");
    elements.mfaCode.value = "";
  }
}

function resetMfaState() {
  state.requiresMfa = false;
  state.tempUsername = "";
  state.tempPassword = "";
  showMfaField(false);
}

function renderModuleNav(modules = []) {
  if (!elements.moduleNav) return;

  const hiddenModules = new Set([
    "hoja_vida_documentos",
    "contratos_vinculacion",
  ]);

  const visibleModules = Array.isArray(modules)
    ? modules.filter((item) => {
        const moduleKey = item.module;
        return moduleKey && !hiddenModules.has(moduleKey) && moduleViews[moduleKey];
      })
    : [];

  if (!visibleModules.length) {
    elements.moduleNav.innerHTML = `
      <div class="nav-empty">
        No hay módulos disponibles para este usuario.
      </div>
    `;
    return;
  }

  elements.moduleNav.innerHTML = visibleModules
    .map((item) => {
      const moduleKey = item.module;
      const meta = getModuleMeta(moduleKey);
      const isActive = state.activeModule === moduleKey;
      const isExpanded = state.expandedModule === moduleKey;
      const view = moduleViews[moduleKey];

      const submodules =
        moduleKey === "gestion_personal"
          ? []
          : view?.submodules || [];

      return `
        <div class="module-group">
          <button
            type="button"
            class="module-nav-item ${isActive ? "active" : ""}"
            data-module="${moduleKey}"
            aria-expanded="${isExpanded ? "true" : "false"}"
          >
            <span class="module-nav-inline">
              <span class="module-nav-icon">${meta.icon}</span>
              <span class="module-nav-title">${meta.label}</span>
            </span>

            ${
              submodules.length
                ? `<span class="module-nav-caret ${isExpanded ? "open" : ""}">⌄</span>`
                : ""
            }
          </button>

          ${
            isExpanded && submodules.length
              ? `
                <div class="submodule-list">
                  ${submodules
                    .map(
                      (submodule) => `
                        <button
                          type="button"
                          class="submodule-nav-item ${
                            state.activeSubmodule === submodule.key ? "active" : ""
                          }"
                          data-module="${moduleKey}"
                          data-submodule="${submodule.key}"
                        >
                          <span class="submodule-dot"></span>
                          <span class="submodule-label">${submodule.title}</span>
                        </button>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  const moduleButtons = elements.moduleNav.querySelectorAll(
    ".module-nav-item[data-module]"
  );

  moduleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = button.dataset.module;
      const hasSubmodules =
        moduleKey !== "gestion_personal" &&
        Boolean(moduleViews[moduleKey]?.submodules?.length);

      const isSameExpanded = state.expandedModule === moduleKey;

      if (isSameExpanded && hasSubmodules) {
        state.expandedModule = null;

        if (state.activeModule === moduleKey) {
          state.activeModule = null;
          state.activeSubmodule = null;
          renderModuleNav(visibleModules);
          renderEmptyWorkspace();
          syncAdminPanelsVisibility();
          return;
        }
      } else {
        state.expandedModule = moduleKey;
        state.activeModule = moduleKey;

        if (moduleKey === "gestion_personal") {
          state.activeSubmodule = null;
          state.personnelViewMode = "table";
          state.personnelEditingId = null;
          state.personnelDocumentsEmployee = null;
        } else {
          state.activeSubmodule = null;
        }
      }

      renderModuleNav(visibleModules);
      await openModule(moduleKey);
    });
  });

  const submoduleButtons = elements.moduleNav.querySelectorAll(
    ".submodule-nav-item[data-submodule]"
  );

  submoduleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = button.dataset.module;
      const submoduleKey = button.dataset.submodule;

      state.expandedModule = moduleKey;
      state.activeModule = moduleKey;
      state.activeSubmodule = submoduleKey;

      renderModuleNav(visibleModules);
      await openModule(moduleKey);
    });
  });
}

function renderEmptyWorkspace() {
  if (!elements.workspace) return;

  elements.workspace.innerHTML = `
    <div class="workspace-empty">
      <div>
        <h3>Selecciona un módulo del menú izquierdo</h3>
        <p class="subtitle">Al abrir un módulo verás su contenido aquí.</p>
      </div>
    </div>
  `;
}

async function loadDashboardModule() {
  const payload = await apiFetch("/dashboard-summary");
  const stats = payload.summary;

  const total     = stats.totalPersonnel    || 0;
  const activos   = stats.activePersonnel   || 0;
  const novedad   = stats.noveltyPersonnel  || 0;
  const inactivos = Math.max(0, total - activos - novedad);
  const municipios = stats.visibleMunicipalities || 0;
  const contratos  = stats.visibleContracts || 0;

  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

  const recent = Array.isArray(payload.recentPersonnel) ? payload.recentPersonnel : [];

  const initials = (name) => {
    const parts = String(name || "").trim().split(" ").filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : String(name || "?")[0].toUpperCase();
  };

  const statusBadge = (status) => {
    const s = String(status || "").toLowerCase();
    if (s === "activo")  return '<span class="dashboard-status-badge dsb-activo">Activo</span>';
    if (s === "novedad") return '<span class="dashboard-status-badge dsb-novedad">Novedad</span>';
    return '<span class="dashboard-status-badge dsb-inactivo">Inactivo</span>';
  };

  const recentRows = recent.map((item) => {
    const name = item.fullName || item.nombre_completo || "Sin nombre";
    const pos  = item.position || item.cargo_real || "";
    const mun  = item.municipality || item.municipio || "";
    return `
      <div class="dashboard-recent-row" onclick="(async()=>{ state.personnelViewMode='edit'; state.personnelEditingId=${JSON.stringify(item.id||"")}; await openModule('gestion_personal'); })()">
        <div class="dashboard-avatar">${initials(name)}</div>
        <div>
          <div class="dashboard-recent-name">${escapeHtml(name)}</div>
          <div class="dashboard-recent-sub">${escapeHtml(pos)}${mun ? ' &mdash; ' + escapeHtml(mun) : ''}</div>
        </div>
        ${statusBadge(item.status)}
      </div>
    `;
  }).join("");

  return `
    <div class="dashboard-stats-v2">
      <div class="stat-card-v2 blue">
        <div class="stat-label">Total personal</div>
        <div class="stat-value">${total}</div>
        <div class="stat-sub">${municipios} municipio${municipios !== 1 ? 's' : ''} &mdash; ${contratos} contrato${contratos !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card-v2 green">
        <div class="stat-label">Activos</div>
        <div class="stat-value">${activos}</div>
        <div class="stat-sub">${pct(activos)}% del total</div>
      </div>
      <div class="stat-card-v2 amber">
        <div class="stat-label">Con novedad</div>
        <div class="stat-value">${novedad}</div>
        <div class="stat-sub">${pct(novedad)}% del total</div>
      </div>
      <div class="stat-card-v2 slate">
        <div class="stat-label">Inactivos</div>
        <div class="stat-value">${inactivos}</div>
        <div class="stat-sub">${pct(inactivos)}% del total</div>
      </div>
    </div>

    <div class="dashboard-chart-wrap">
      <div class="dashboard-chart-title">Distribuci\u00f3n del personal</div>
      <div class="dashboard-bar-chart">
        <div class="db-bar-row">
          <div class="db-bar-label">Activos</div>
          <div class="db-bar-track">
            <div class="db-bar-fill activo" style="width:${pct(activos)}%">${pct(activos) > 10 ? pct(activos) + '%' : ''}</div>
          </div>
          <div class="db-bar-count">${activos}</div>
        </div>
        <div class="db-bar-row">
          <div class="db-bar-label">Con novedad</div>
          <div class="db-bar-track">
            <div class="db-bar-fill novedad" style="width:${pct(novedad)}%">${pct(novedad) > 10 ? pct(novedad) + '%' : ''}</div>
          </div>
          <div class="db-bar-count">${novedad}</div>
        </div>
        <div class="db-bar-row">
          <div class="db-bar-label">Inactivos</div>
          <div class="db-bar-track">
            <div class="db-bar-fill inactivo" style="width:${pct(inactivos)}%">${pct(inactivos) > 10 ? pct(inactivos) + '%' : ''}</div>
          </div>
          <div class="db-bar-count">${inactivos}</div>
        </div>
      </div>
    </div>

    <div class="dashboard-recent">
      <div class="dashboard-recent-header">Personal reciente visible</div>
      ${recent.length
        ? recentRows
        : '<div style="padding:20px;color:#6b7280;font-size:14px;">No hay personal visible para este usuario.</div>'}
    </div>
  `;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getPersonnelFullName(item) {
  if (item.fullName) return item.fullName;

  return [
    item.primer_nombre,
    item.segundo_nombre,
    item.primer_apellido,
    item.segundo_apellido,
    item.firstName,
    item.secondName,
    item.firstLastName,
    item.secondLastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || "Sin nombre";
}

function getRequiredDocumentsForEmployee(employee) {
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const isPresented =
    employee.presentacion_en_licitacion === true ||
    employee.presentacion_en_licitacion === "true" ||
    employee.presented_in_offer === true ||
    employee.presented_in_offer === "true" ||
    employee.presentedInOffer === true ||
    employee.presentedInOffer === "true";

  const offerPosition = normalize(
    employee.cargo_presentado_en_licitacion ||
      employee.offered_position ||
      employee.offerPosition ||
      employee.offer_position
  );

  const realPosition = normalize(
    employee.cargo_real ||
      employee.real_position ||
      employee.position ||
      employee.cargo
  );

  const position = isPresented ? offerPosition : realPosition;

  const doc = (name, options = {}) => ({
    name,
    required: options.required !== false,
    issueDateRequired: !!options.issueDateRequired,
    expirationDateRequired: !!options.expirationDateRequired,
    requiresPdf: options.requiresPdf !== false,
    requiresValidation: options.requiresValidation !== false,
    group: options.group || "GENERAL",
  });

  const BASE = [
    doc("CEDULA", { group: "IDENTIFICACION" }),
    doc("HOJA DE VIDA", { group: "IDENTIFICACION" }),
    doc("EXPERIENCIA LABORAL", { group: "SOPORTE" }),
    doc("AUTORIZACION DE DATOS PERSONALES", { group: "AUTORIZACIONES" }),
    doc("AUTORIZACION DE CONSULTA DE INHABILIDADES", {
      group: "AUTORIZACIONES",
    }),
  ];

  const ANTECEDENTES = [
    doc("CONTRALORIA", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
    doc("PROCURADURIA", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
    doc("ANTECEDENTES JUDICIALES", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
    doc("ANTECEDENTES DE MEDIDAS CORRECTIVAS", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
    doc("REDAM", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
    doc("CONSULTA DE INHABILIDADES", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ANTECEDENTES",
    }),
  ];

  const ALIMENTOS = [
    doc("CURSO MANIPULACION DE ALIMENTOS", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ALIMENTOS",
    }),
    doc("EXAMENES MANIPULACION DE ALIMENTOS", {
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "ALIMENTOS",
    }),
  ];

  const AFILIACIONES = [
    doc("CONTRATO", { group: "CONTRATACION" }),
    doc("AFILIACION ARL", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION EPS", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION AFP", { group: "SEGURIDAD SOCIAL" }),
    doc("AFILIACION CAJA DE COMPENSACION COFREM", {
      group: "SEGURIDAD SOCIAL",
    }),
  ];

  const FORMATOS = [
    doc("FORMATO DE INDUCCION", { group: "FORMATOS" }),
    doc("FORMATO DE DOTACION", { group: "FORMATOS" }),
  ];

  const OPTIONAL_TERRITORIAL = [
    doc("RESIDENCIA EXPEDIDA POR ALCALDIA", {
      required: false,
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "TERRITORIAL",
    }),
    doc("SISBEN", {
      required: false,
      issueDateRequired: true,
      expirationDateRequired: true,
      group: "TERRITORIAL",
    }),
  ];

  const studiesByPosition = () => {
    if (
      position === "COORDINADOR DE SUMINISTRO" ||
      position === "SUPERVISOR DE CALIDAD" ||
      position === "AREA DE CALIDAD"
    ) {
      return [
        doc("ESTUDIOS PROFESIONAL", { group: "ESTUDIOS" }),
        doc("TARJETA PROFESIONAL", { group: "ESTUDIOS" }),
        doc("ANTECEDENTES DE LA PROFESION", {
          issueDateRequired: true,
          expirationDateRequired: true,
          group: "ESTUDIOS",
        }),
      ];
    }

    if (position === "COORDINADOR DE ZONA") {
      return [doc("ESTUDIOS TECNICO", { group: "ESTUDIOS" })];
    }

    return [doc("ESTUDIOS BACHILLER", { group: "ESTUDIOS" })];
  };

  const docs = [
    ...BASE,
    ...studiesByPosition(),
    ...OPTIONAL_TERRITORIAL,
    ...ANTECEDENTES,
    ...ALIMENTOS,
    ...AFILIACIONES,
    ...FORMATOS,
  ];

  const uniqueDocs = [];
  const seen = new Set();

  docs.forEach((item) => {
    const key = normalize(item.name);
    if (seen.has(key)) return;

    seen.add(key);
    uniqueDocs.push(item);
  });

  return uniqueDocs;
}

function getPersonnelWorkStatus(item) {
  return (
    item.estado ||
    item.status ||
    item.estado_laboral ||
    "Sin estado"
  );
}

function getPersonnelRole(item) {
  return (
    item.cargo_real ||
    item.position ||
    item.cargo ||
    "Sin cargo"
  );
}

function getPersonnelMunicipality(item = {}) {
  const value =
    item.municipalityId ||
    item.municipality_id ||
    item.municipio_id ||
    item.municipality ||
    item.municipio ||
    "";

  if (!value) return "-";

  const found = META_MUNICIPALITIES.find((municipality) => {
    return (
      String(municipality.id) === String(value) ||
      String(municipality.name).toUpperCase() === String(value).toUpperCase()
    );
  });

  return found ? found.name : String(value);
}

function getPersonnelDocument(item) {
  return (
    item.numero_documento ||
    item.documentNumber ||
    "-"
  );
}

function getPersonnelDocumentChecklist(item) {
  const docs = item.documents || item.documentos || {};

  const hasDoc = (keys) =>
    keys.some((key) => {
      const value = docs[key];
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    });

  return {
    cedula: hasDoc(["cedula", "cc", "documento_identidad"]),
    hojaVida: hasDoc(["hoja_vida", "hv", "curriculum"]),
    eps: hasDoc(["eps", "certificado_eps", "afiliacion_eps"]),
    pension: hasDoc(["pension", "afp", "certificado_pension"]),
    examenes: hasDoc(["examen_medico", "examenes", "manipulacion_alimentos"]),
  };
}

function getPersonnelHvStatus(employee, allDocuments = []) {
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const employeeDocs = allDocuments.filter(
    (doc) => String(doc.employeeId) === String(employee.id)
  );

  const requiredDocs = getRequiredDocumentsForEmployee(employee).filter(
    (doc) => doc.required
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let hasMissing = false;
  let hasRejected = false;
  let hasExpired = false;
  let hasPending = false;
  let hasInvalidDates = false;
  let hasSoonToExpire = false;

  for (const requiredDoc of requiredDocs) {
    const uploaded = employeeDocs
      .filter((doc) => normalize(doc.documentType) === normalize(requiredDoc.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    if (!uploaded || !uploaded.fileUrl) {
      hasMissing = true;
      continue;
    }

    const validationStatus = normalize(
      uploaded.validationStatus || uploaded.status
    );

    if (validationStatus === "RECHAZADO") {
      hasRejected = true;
    }

    if (validationStatus !== "VALIDADO") {
      hasPending = true;
    }

    if (requiredDoc.issueDateRequired && !uploaded.issueDate) {
      hasInvalidDates = true;
    }

    if (requiredDoc.expirationDateRequired && !uploaded.expirationDate) {
      hasInvalidDates = true;
    }

    if (requiredDoc.expirationDateRequired && uploaded.expirationDate) {
      const expiration = new Date(uploaded.expirationDate);
      expiration.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        hasExpired = true;
      }

      if (diffDays >= 0 && diffDays <= 30) {
        hasSoonToExpire = true;
      }
    }
  }

  if (hasExpired || hasRejected) {
    return {
      label: "No apto documental",
      className: "danger",
    };
  }

  if (hasMissing) {
    return {
      label: "Incompleta",
      className: "danger",
    };
  }

  if (hasPending || hasInvalidDates || hasSoonToExpire) {
    return {
      label: "En revisión",
      className: "warning",
    };
  }

  return {
    label: "Completa",
    className: "success",
  };
}

function calculateDocumentAlerts(rows = [], allDocuments = []) {
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const alerts = {
    vencidos: 0,
    proximosVencer: 0,
    revision: 0,
    rechazados: 0,
    faltantes: 0,
    fechasInvalidas: 0,
  };

  rows.forEach((employee) => {
    const employeeDocs = allDocuments.filter(
      (doc) => String(doc.employeeId) === String(employee.id)
    );

    const requiredDocs = getRequiredDocumentsForEmployee(employee).filter(
      (doc) => doc.required
    );

    requiredDocs.forEach((requiredDoc) => {
      const uploaded = employeeDocs
        .filter((doc) => normalize(doc.documentType) === normalize(requiredDoc.name))
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

      if (!uploaded || !uploaded.fileUrl) {
        alerts.faltantes += 1;
        return;
      }

      const validationStatus = normalize(
        uploaded.validationStatus || uploaded.status
      );

      if (validationStatus === "RECHAZADO") {
        alerts.rechazados += 1;
        return;
      }

      if (requiredDoc.issueDateRequired && !uploaded.issueDate) {
        alerts.fechasInvalidas += 1;
      }

      if (requiredDoc.expirationDateRequired && !uploaded.expirationDate) {
        alerts.fechasInvalidas += 1;
        return;
      }

      if (requiredDoc.expirationDateRequired && uploaded.expirationDate) {
        const exp = new Date(uploaded.expirationDate);
        exp.setHours(0, 0, 0, 0);

        const diff = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

        if (diff < 0) {
          alerts.vencidos += 1;
          return;
        }

        if (diff <= 30) {
          alerts.proximosVencer += 1;
        }
      }

      if (validationStatus !== "VALIDADO") {
        alerts.revision += 1;
      }
    });
  });

  return alerts;
}

function calculatePersonnelDashboard(rows = [], allDocuments = []) {
  const summary = {
    total: rows.length,
    completa: 0,
    revision: 0,
    incompleta: 0,
    noApto: 0,
  };

  rows.forEach((employee) => {
    const hvStatus = getPersonnelHvStatus(employee, allDocuments);

    if (hvStatus.label === "Completa") summary.completa += 1;

    if (hvStatus.label === "En revisión") summary.revision += 1;

    if (hvStatus.label === "Incompleta") summary.incompleta += 1;

    if (hvStatus.label === "No apto documental") summary.noApto += 1;
  });

  return summary;
}

function getPersonnelFilterValue(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function filterPersonnelRows(rows, allDocuments = []) {
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const searchValue = normalize(getPersonnelFilterValue("personnelSearch"));
  const statusValue = normalize(getPersonnelFilterValue("personnelFilterStatus"));
  const hvStatusValue = normalize(getPersonnelFilterValue("personnelFilterHvStatus"));
  const municipalityValue = normalize(getPersonnelFilterValue("personnelFilterMunicipality"));

  return rows.filter((item) => {
    if (searchValue) {
      const fullText = normalize(`
        ${getPersonnelFullName(item)}
        ${getPersonnelDocument(item)}
        ${getPersonnelRole(item)}
        ${getPersonnelMunicipality(item)}
      `);

      if (!fullText.includes(searchValue)) return false;
    }

    if (statusValue) {
      const itemStatus = normalize(getPersonnelWorkStatus(item));
      if (itemStatus !== statusValue) return false;
    }

    if (hvStatusValue) {
      const hvStatus = getPersonnelHvStatus(item, allDocuments);
      if (normalize(hvStatus.label) !== hvStatusValue) return false;
    }

    if (municipalityValue) {
      const itemMunicipality = normalize(getPersonnelMunicipality(item));
      if (itemMunicipality !== municipalityValue) return false;
    }

    return true;
  });
}

function getVisibleMunicipalityOptions(rows) {
  return Array.from(
    new Set(
      rows
        .map((item) => getPersonnelMunicipality(item))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));
}

async function loadPersonnelModule(moduleConfig, submoduleKey) {
  let payload;

  try {
    payload = await apiFetch("/personnel");
    // Cachear el catálogo educativo en state para que no se pierda entre re-renders
    if (payload.educationalCatalog && Object.keys(payload.educationalCatalog).length > 0) {
      state.educationalCatalog = payload.educationalCatalog;
    }
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en Gestión del Personal</h3>
        <p>${error.message}</p>
      </article>
    `;
  }

  if (!state.personnelDraft) state.personnelDraft = {};
  if (!state.personnelCreateTab) state.personnelCreateTab = "identificacion";

  const draft = state.personnelDraft;
  const activeTab = state.personnelCreateTab;
  const currentCargoReal = String(draft.cargo_real || draft.real_position || draft.position || "").toUpperCase();
  const institutionalEnabled = isInstitutionalTabEnabled(currentCargoReal);

  const draftValue = (name, fallback = "") => {
    if (draft[name] !== undefined && draft[name] !== null) return draft[name];
    return fallback;
  };

  const firstDraftValue = (...names) => {
    for (const name of names) {
      if (draft[name] !== undefined && draft[name] !== null && String(draft[name]).trim() !== "") {
        return draft[name];
      }
    }
    return "";
  };

  const selected = (name, value) =>
    String(draftValue(name, "")) === String(value) ? "selected" : "";

  const expeditionDepartment = draftValue("expeditionDepartment", "");
  const birthDepartment = draftValue("birthDepartment", "");
  const vinculationCompanyId = draftValue("companyId", state.currentUser?.companyId ?? "");
  const residenceMunicipality = draftValue("residenceMunicipality", "");

  const normalizeCatalogText = (text) =>
    String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const findCatalogKey = (object, value) => {
    const normalizedValue = normalizeCatalogText(value);
    if (!normalizedValue) return "";

    const keys = Object.keys(object || {});

    return (
      keys.find((key) => normalizeCatalogText(key) === normalizedValue) ||
      keys.find((key) => normalizeCatalogText(key).includes(normalizedValue)) ||
      keys.find((key) => normalizedValue.includes(normalizeCatalogText(key))) ||
      ""
    );
  };

  // Usar catálogo cacheado en state si el payload no trae uno válido
  const educationalCatalog =
    (payload.educationalCatalog && Object.keys(payload.educationalCatalog).length > 0)
      ? payload.educationalCatalog
      : (state.educationalCatalog || {});

  const institutionalMunicipalityRaw = firstDraftValue(
    "educationalMunicipality",
    "educational_municipality",
    "municipio_educativo",
    "municipio_institucional",
    "municipalityName",
    "municipality",
    "municipio"
  );

  // El select de municipio guarda el ID numérico (ej: "1") pero el catálogo
  // educativo usa el NOMBRE (ej: "Acacías"). Convertir id -> nombre antes de buscar.
  const municipalityNameResolved = (() => {
    const found = META_MUNICIPALITIES.find(
      (m) =>
        String(m.id) === String(institutionalMunicipalityRaw) ||
        String(m.name).toUpperCase() === String(institutionalMunicipalityRaw).toUpperCase()
    );
    return found ? found.name : institutionalMunicipalityRaw;
  })();

  const municipalityKey = findCatalogKey(educationalCatalog, municipalityNameResolved);
  const institutionalMunicipality = municipalityKey || municipalityNameResolved;
  const municipalityCatalog = municipalityKey ? educationalCatalog[municipalityKey] : {};
  const institutionNames = Object.keys(municipalityCatalog);

  const selectedInstitutionRaw = firstDraftValue("institution", "institucion_educativa");
  const institutionKey = findCatalogKey(municipalityCatalog, selectedInstitutionRaw);
  const selectedInstitution = institutionKey || selectedInstitutionRaw;
  const sedeCatalog = institutionKey ? municipalityCatalog[institutionKey] : {};
  const sedeNames = Object.keys(sedeCatalog);

  const selectedSedeRaw = firstDraftValue("site", "sede_educativa");
  const sedeKey = findCatalogKey(sedeCatalog, selectedSedeRaw);
  const selectedSede = sedeKey || selectedSedeRaw;
  const modalidadCatalog = sedeKey ? sedeCatalog[sedeKey] : [];

  const selectedModalityRaw = firstDraftValue("educationalModality", "modalidad");
  const selectedModality =
    modalidadCatalog.find(
      (m) => normalizeCatalogText(m) === normalizeCatalogText(selectedModalityRaw)
    ) || selectedModalityRaw;

  const expeditionMunicipalities = getDepartmentMunicipalities(expeditionDepartment);
  const birthMunicipalities = getDepartmentMunicipalities(birthDepartment);

  const managerRole = ["GESTOR DE ZONA", "AUXILIAR DE GESTOR DE ZONA"].includes(currentCargoReal);
  const isEditMode = state.personnelViewMode === "edit";

  const tabButtons = `
    <div class="employee-steps">
      <button type="button" class="employee-step-tab ${activeTab === "identificacion" ? "active" : ""}" data-step-tab="identificacion">Identificación</button>
      <button type="button" class="employee-step-tab ${activeTab === "vinculacion" ? "active" : ""}" data-step-tab="vinculacion">Vinculación</button>
      <button type="button" class="employee-step-tab ${activeTab === "licitacion" ? "active" : ""}" data-step-tab="licitacion">Licitación-Autorización</button>
      <button type="button" class="employee-step-tab ${activeTab === "datos_personales" ? "active" : ""}" data-step-tab="datos_personales">Datos Personales</button>
      <button type="button" class="employee-step-tab ${activeTab === "institucional" ? "active" : ""} ${institutionalEnabled ? "" : "disabled"}" data-step-tab="institucional" ${institutionalEnabled ? "" : "disabled"}>Institucional</button>
      <button type="button" class="employee-step-tab ${activeTab === "contratacion" ? "active" : ""}" data-step-tab="contratacion">Contratación</button>
      <button type="button" class="employee-step-tab ${activeTab === "seguimiento" ? "active" : ""}" data-step-tab="seguimiento">Seguimiento</button>
      <button type="button" class="employee-step-tab ${activeTab === "estudios" ? "active" : ""}" data-step-tab="estudios">Estudios</button>
      <button type="button" class="employee-step-tab ${activeTab === "observaciones" ? "active" : ""}" data-step-tab="observaciones">Observaciones</button>
    </div>
  `;

  let activeSectionHtml = "";

  if (activeTab === "identificacion") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Sección A - Identificación</h4>
            <p class="section-helper-text">Datos de identificación personal del empleado</p>
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Primer Nombre *</span>
            <input name="firstName" data-only-letters type="text" value="${escapeAttr(draftValue("firstName"))}" required />
          </label>

          <label>
            <span>Segundo Nombre</span>
            <input name="secondName" data-only-letters type="text" value="${escapeAttr(draftValue("secondName"))}" />
          </label>

          <label>
            <span>Primer Apellido *</span>
            <input name="firstLastName" data-only-letters type="text" value="${escapeAttr(draftValue("firstLastName"))}" required />
          </label>

          <label>
            <span>Segundo Apellido</span>
            <input name="secondLastName" data-only-letters type="text" value="${escapeAttr(draftValue("secondLastName"))}" />
          </label>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Tipo de Documento *</span>
            <select name="documentType" required>
              ${renderOptions(["CC", "PA", "PPT", "CE", "NIT"], draftValue("documentType"), "Selecciona")}
            </select>
          </label>

          <label>
            <span>Número de Documento *</span>
            <input name="documentNumber" data-only-numbers type="text" value="${escapeAttr(draftValue("documentNumber"))}" required />
          </label>
        </div>

        <div class="subsection-title">Fecha de Expedición del Documento *</div>

        <div class="form-grid form-grid-3">
          <label>
            <span>Día</span>
            <input name="expeditionDay" data-only-numbers type="text" maxlength="2" value="${escapeAttr(draftValue("expeditionDay"))}" required />
          </label>

          <label>
            <span>Mes</span>
            <input name="expeditionMonth" data-only-numbers type="text" maxlength="2" value="${escapeAttr(draftValue("expeditionMonth"))}" required />
          </label>

          <label>
            <span>Año</span>
            <input name="expeditionYear" data-only-numbers type="text" maxlength="4" value="${escapeAttr(draftValue("expeditionYear"))}" required />
          </label>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Departamento de Expedición *</span>
            <select name="expeditionDepartment" required>
              ${renderOptions(COLOMBIA_DEPARTMENTS, expeditionDepartment, "Selecciona departamento")}
            </select>
          </label>

          <label>
            <span>Municipio de Expedición *</span>
            <select name="expeditionMunicipality" required>
              ${renderOptions(expeditionMunicipalities, draftValue("expeditionMunicipality"), expeditionDepartment ? "Selecciona municipio" : "Selecciona primero departamento")}
            </select>
          </label>
        </div>

        <div class="subsection-title">Fecha de Nacimiento *</div>

        <div class="form-grid form-grid-3">
          <label>
            <span>Día</span>
            <input name="birthDay" data-only-numbers type="text" maxlength="2" value="${escapeAttr(draftValue("birthDay"))}" required />
          </label>

          <label>
            <span>Mes</span>
            <input name="birthMonth" data-only-numbers type="text" maxlength="2" value="${escapeAttr(draftValue("birthMonth"))}" required />
          </label>

          <label>
            <span>Año</span>
            <input name="birthYear" data-only-numbers type="text" maxlength="4" value="${escapeAttr(draftValue("birthYear"))}" required />
          </label>
        </div>

        <div class="form-grid form-grid-3">
          <label>
            <span>País de Nacimiento *</span>
            <input name="birthCountry" data-only-letters type="text" value="${escapeAttr(draftValue("birthCountry", "Colombia"))}" required />
          </label>

          <label>
            <span>Departamento de Nacimiento *</span>
            <select name="birthDepartment" required>
              ${renderOptions(COLOMBIA_DEPARTMENTS, birthDepartment, "Selecciona departamento")}
            </select>
          </label>

          <label>
            <span>Municipio de Nacimiento *</span>
            <select name="birthMunicipality" required>
              ${renderOptions(birthMunicipalities, draftValue("birthMunicipality"), birthDepartment ? "Selecciona municipio" : "Selecciona primero departamento")}
            </select>
          </label>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Grupo Sanguíneo *</span>
            <select name="bloodType" required>
              ${renderOptions(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"], draftValue("bloodType"), "Selecciona")}
            </select>
          </label>

          <label>
            <span>Sexo *</span>
            <select name="biologicalSex" required>
              ${renderOptions(["F", "M"], draftValue("biologicalSex"), "Selecciona")}
            </select>
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "vinculacion") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Vinculación</h4>
            <p class="section-helper-text">Empresa, contrato y municipio de vinculación</p>
          </div>
        </div>

        <div class="form-grid form-grid-3">
          <label>
            <span>Empresa *</span>
            <select name="companyId" required>
              ${getCompanyOptionsHtml(vinculationCompanyId)}
            </select>
          </label>

          <label>
            <span>Contrato *</span>
            <select name="contractId" required>
              ${getContractOptionsHtml(vinculationCompanyId, draftValue("contractId"))}
            </select>
          </label>

          <label>
            <span>Municipio *</span>
            <select name="municipalityId" required>
              ${renderOptions(META_MUNICIPALITIES, draftValue("municipalityId"), "Selecciona municipio")}
            </select>
          </label>
        </div>

        <div class="form-grid form-grid-1">
          <label>
            <span>Gestor de Zona</span>
            <input
              name="gestorZona"
              type="text"
              placeholder="Nombre del gestor de zona responsable"
              value="${escapeAttr(draftValue("gestorZona"))}"
            />
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "licitacion") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Licitación-Autorización</h4>
            <p class="section-helper-text">Información de licitación y fase del proceso</p>
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>¿Presentado en Licitación? *</span>
            <select name="presentedInOffer" id="presentedInOffer" required>
              <option value="">Selecciona</option>
              <option value="true" ${selected("presentedInOffer", "true")}>Sí</option>
              <option value="false" ${selected("presentedInOffer", "false")}>No</option>
            </select>
          </label>

          <label id="offerPositionWrap" class="${String(draftValue("presentedInOffer")) === "true" ? "" : "hidden"}">
            <span>Cargo presentado en licitación</span>
            <select name="offerPosition">
              ${renderOptions(LICITACION_CARGOS, draftValue("offerPosition"), "Selecciona")}
            </select>
          </label>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Cargo Real *</span>
            <select name="cargo_real" required>
              ${renderOptions(CARGOS_REALES, draftValue("cargo_real"), "Selecciona")}
            </select>
          </label>

          <label>
            <span>Estado *</span>
            <select name="status" required>
              ${renderOptions(ESTADOS_PERSONAL, draftValue("status"), "Selecciona")}
            </select>
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "datos_personales") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Datos Personales</h4>
            <p class="section-helper-text">Información de contacto y residencia</p>
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Celular *</span>
            <input name="phone" data-only-numbers type="text" value="${escapeAttr(draftValue("phone"))}" required />
          </label>

          <label>
            <span>Correo Electrónico *</span>
            <input name="email" type="email" value="${escapeAttr(draftValue("email"))}" required />
          </label>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>Estado Civil</span>
            <select name="civilStatus">
              ${renderOptions(["soltero", "casado", "union_libre", "separado", "divorciado", "viudo"], draftValue("civilStatus"), "Selecciona")}
            </select>
          </label>

          <label>
            <span>Barrio de Residencia</span>
            <input name="neighborhood" type="text" value="${escapeAttr(draftValue("neighborhood"))}" />
          </label>
        </div>

        <div class="form-grid form-grid-1">
          <label>
            <span>Dirección de Residencia *</span>
            <input name="address" type="text" value="${escapeAttr(draftValue("address"))}" required />
          </label>
        </div>

        <div class="form-grid form-grid-3">
          <label>
            <span>Departamento *</span>
            <input name="residenceDepartment" type="text" value="Meta" readonly />
          </label>

          <label>
            <span>Municipio *</span>
            <select name="residenceMunicipality" required>
              ${renderOptions(META_MUNICIPALITIES, residenceMunicipality, "Selecciona municipio")}
            </select>
          </label>

          <label>
            <span>Zona de Residencia</span>
            <select name="residenceZone">
              ${renderOptions(["urbano", "rural"], draftValue("residenceZone"), "Selecciona")}
            </select>
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "institucional") {
    if (!institutionalEnabled) {
      activeSectionHtml = `
        <section class="personnel-section">
          <div class="section-title-wrap">
            <div>
              <h4>Institucional</h4>
              <p class="section-helper-text">Esta pestaña solo se habilita para cargos permitidos</p>
            </div>
          </div>

          <div class="personnel-note-box">
            Esta pestaña solo se habilita si el cargo real es:
            <strong>OPERARIO MANIPULADOR DE ALIMENTOS</strong>,
            <strong>GESTOR DE ZONA</strong> o
            <strong>AUXILIAR DE GESTOR DE ZONA</strong>.
          </div>
        </section>
      `;
    } else if (managerRole) {
      activeSectionHtml = `
        <section class="personnel-section">
          <div class="section-title-wrap">
            <div>
              <h4>Institucional</h4>
              <p class="section-helper-text">Municipios a cargo del gestor</p>
            </div>
          </div>

          <label>
            <span>Municipios a Cargo</span>
            <select name="municipiosACargo" multiple size="8">
              ${META_MUNICIPALITIES.map(
                (m) => `
                  <option value="${m}" ${
                    String(draftValue("municipiosACargo", "")).split("|").includes(m)
                      ? "selected"
                      : ""
                  }>${m}</option>
                `
              ).join("")}
            </select>
          </label>
        </section>
      `;
    } else {
      activeSectionHtml = `
        <section class="personnel-section">
          <div class="section-title-wrap">
            <div>
              <h4>Institucional</h4>
              <p class="section-helper-text">Asignación institucional del operario</p>
            </div>
          </div>

          <div class="form-grid form-grid-2">
            <label>
              <span>Municipio *</span>
              <select name="educationalMunicipality" required>
                ${renderOptions(META_MUNICIPALITIES, institutionalMunicipality, "Selecciona municipio")}
              </select>
            </label>

            <label>
              <span>Institución Educativa *</span>
              <select name="institution" required>
                ${renderOptions(institutionNames, selectedInstitution, institutionalMunicipality ? "Selecciona institución" : "Selecciona primero municipio")}
              </select>
            </label>

            <label>
              <span>Sede Educativa *</span>
              <select name="site" required>
                ${renderOptions(sedeNames, selectedSede, selectedInstitution ? "Selecciona sede" : "Selecciona primero institución")}
              </select>
            </label>

            <label>
              <span>Modalidad *</span>
              <select name="educationalModality" required>
                ${renderOptions(modalidadCatalog, selectedModality, selectedSede ? "Selecciona modalidad" : "Selecciona primero sede")}
              </select>
            </label>
          </div>
        </section>
      `;
    }
  }

  if (activeTab === "contratacion") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Contratación</h4>
            <p class="section-helper-text">Datos de contratación y seguridad social</p>
          </div>
        </div>

        <div class="form-grid form-grid-4">
          <label>
            <span>Tipo de Contrato *</span>
            <select name="contractType" required>
              ${renderOptions(["obra_labor", "termino_fijo", "prestacion_servicios"], draftValue("contractType"), "Selecciona")}
            </select>
          </label>

          <label>
            <span>Tipo de tiempo *</span>
            <select name="workTimeType" required>
              <option value="">Selecciona</option>
              <option value="TC" ${draftValue("workTimeType") === "TC" ? "selected" : ""}>Tiempo completo</option>
              <option value="MT" ${draftValue("workTimeType") === "MT" ? "selected" : ""}>Medio tiempo</option>
            </select>
          </label>

          <label>
            <span>Fecha real de ingreso *</span>
            <input name="startDate" type="date" value="${escapeAttr(draftValue("startDate"))}" required />
          </label>

          <label>
            <span>Fecha inicio por cobertura *</span>
            <input name="coverageStartDate" type="date" value="${escapeAttr(draftValue("coverageStartDate"))}" required />
          </label>
        </div>

        <div class="subsection-title">Seguridad Social</div>

        <div class="form-grid form-grid-2">
          <label>
            <span>EPS *</span>
            <select name="eps" required>
              ${renderOptions(["ALIANSALUD EPS", "ASMET SALUD EPS", "CAJACOPI EPS", "CAPITAL SALUD EPS", "COMPENSAR EPS", "COOSALUD EPS", "EMSSANAR EPS", "FAMISANAR EPS", "MUTUAL SER EPS", "NUEVA EPS", "SALUD TOTAL EPS", "SANITAS EPS", "SAVIA SALUD EPS", "SURA EPS"], draftValue("eps"), "Selecciona EPS")}
            </select>
          </label>

          <label>
            <span>Fondo de Pensiones *</span>
            <select name="pensionFund" required>
              ${renderOptions(["COLPENSIONES", "PORVENIR", "PROTECCIÓN", "SKANDIA", "COLFONDOS"], draftValue("pensionFund"), "Selecciona fondo")}
            </select>
          </label>

          <label>
            <span>Caja de Compensación *</span>
            <input name="compensationBox" type="text" value="COFREM" readonly required />
          </label>

          <label>
            <span>ARL *</span>
            <input name="arl" type="text" value="SURA" readonly required />
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "seguimiento") {
    const hasSisben = String(draftValue("sisben", "")) === "true";
    const hasResidenceCertificate = String(draftValue("hasResidenceCertificate", "")) === "true";

    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Seguimiento</h4>
            <p class="section-helper-text">Seguimiento documental específico</p>
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <label class="checkbox-line">
            <input type="checkbox" name="sisben" value="true" ${hasSisben ? "checked" : ""} />
            <span>Tiene SISBEN</span>
          </label>

          <label class="checkbox-line">
            <input type="checkbox" name="hasResidenceCertificate" value="true" ${hasResidenceCertificate ? "checked" : ""} />
            <span>Tiene certificado de residencia</span>
          </label>
        </div>
      </section>
    `;
  }

  if (activeTab === "estudios") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Estudios</h4>
            <p class="section-helper-text">Formación académica, curso y exámenes de manipulación de alimentos</p>
          </div>
        </div>

        <p class="soft">Sección de estudios activa.</p>
      </section>
    `;
  }

  if (activeTab === "observaciones") {
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Observaciones</h4>
            <p class="section-helper-text">Historial de observaciones del empleado</p>
          </div>
        </div>

        <div class="form-grid form-grid-1">
          <label>
            <span>Nueva observación</span>
            <textarea id="newObservationText" rows="4" placeholder="Escribe aquí la observación..."></textarea>
          </label>
        </div>
      </section>
    `;
  }

  setTimeout(() => {
    const form = document.getElementById("personnelForm");
    const backBtn = document.getElementById("backToPersonnelTable");
    if (!form) return;

    if (backBtn) {
      backBtn.addEventListener("click", async () => {
        state.personnelViewMode = "table";
        state.personnelEditingId = null;
        state.personnelCreateTab = "identificacion";
        await openModule("gestion_personal");
      });
    }

    document.querySelectorAll("[data-step-tab]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        state.personnelCreateTab = button.dataset.stepTab;
        await openModule("gestion_personal");
      });
    });

    form.querySelectorAll("input, select, textarea").forEach((field) => {
      field.addEventListener("input", (event) => {
        syncPersonnelDraftField(event.target);
        syncEmployeeHeaderFromDraft();
      });

      field.addEventListener("change", async (event) => {
        syncPersonnelDraftField(event.target);

        const reactiveFields = [
          "expeditionDepartment",
          "birthDepartment",
          "companyId",
          "educationalMunicipality",
          "institution",
          "site",
          "cargo_real",
          "sisben",
          "hasResidenceCertificate",
        ];

        if (reactiveFields.includes(event.target.name)) {
          if (event.target.name === "companyId") state.personnelDraft.contractId = "";
          if (event.target.name === "expeditionDepartment") state.personnelDraft.expeditionMunicipality = "";
          if (event.target.name === "birthDepartment") state.personnelDraft.birthMunicipality = "";

          if (event.target.name === "educationalMunicipality") {
            state.personnelDraft.institution = "";
            state.personnelDraft.site = "";
            state.personnelDraft.educationalModality = "";
          }

          if (event.target.name === "institution") {
            state.personnelDraft.site = "";
            state.personnelDraft.educationalModality = "";
          }

          if (event.target.name === "site") {
            state.personnelDraft.educationalModality = "";
          }

          if (event.target.name === "cargo_real" && !isInstitutionalTabEnabled(event.target.value)) {
            state.personnelDraft.educationalMunicipality = "";
            state.personnelDraft.institution = "";
            state.personnelDraft.site = "";
            state.personnelDraft.educationalModality = "";
            state.personnelDraft.municipiosACargo = "";

            if (state.personnelCreateTab === "institucional") {
              state.personnelCreateTab = "licitacion";
            }
          }

          await openModule("gestion_personal");
          return;
        }

        syncEmployeeHeaderFromDraft();
      });
    });

    enforceInputRestrictions(form);
    attachPersonnelFormValidation(form);
    syncEmployeeHeaderFromDraft();

    form.addEventListener("submit", handleCreatePersonnel);
  }, 0);

  return `
    <div class="personnel-grid">
      <article class="info-card personnel-form-card employee-form-shell">
        <div class="personnel-master-header personnel-form-topbar">
          <div>
            <h3>${isEditMode ? "Editar empleado" : "Nuevo empleado"}</h3>
            <p class="soft">${isEditMode ? "Actualiza la información del empleado seleccionado." : "Diligencia la información básica del nuevo empleado."}</p>
          </div>

          <div class="personnel-master-actions">
            <button type="button" id="backToPersonnelTable" class="btn btn-secondary">
              Volver al listado
            </button>
          </div>
        </div>

        <div class="employee-header-card">
          <h2 id="employeeHeaderName">NOMBRE COMPLETO DE LA PERSONA</h2>
          <p id="employeeHeaderDocument">Tipo de documento y número de documento</p>
        </div>

        ${tabButtons}

        <form id="personnelForm" class="personnel-form-v2" novalidate>
          ${activeSectionHtml}

          <div class="personnel-form-actions">
            <button type="submit" class="primary-soft-btn">
              ${isEditMode ? "Guardar cambios" : "Crear empleado"}
            </button>
          </div>
        </form>
      </article>
    </div>
  `;
}

function validatePersonnelForm(form) {
  let isValid = true;

  form.querySelectorAll("[required]").forEach((field) => {
    field.classList.remove("input-error");

    const value = String(field.value || "").trim();

    if (!value) {
      field.classList.add("input-error");
      isValid = false;
    }
  });

  return isValid;
}

function attachPersonnelFormValidation(form) {
  if (!form) return;

  form.querySelectorAll("[required]").forEach((field) => {
    const clearError = () => {
      if (String(field.value || "").trim()) {
        field.classList.remove("input-error");
      }
    };

    field.addEventListener("input", clearError);
    field.addEventListener("change", clearError);
  });
}

async function renderPersonnelTableModule() {
  let payload;

  try {
    payload = await apiFetch("/personnel");
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en Gestión del Personal</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }

  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.personnel)
    ? payload.personnel
    : [];

  let documentsPayload = { data: [] };

  try {
    documentsPayload = await apiFetch("/documents");
  } catch (error) {
    documentsPayload = { data: [] };
  }

  const allDocuments = Array.isArray(documentsPayload.data)
    ? documentsPayload.data
    : [];

  if (!state.personnelFilters) {
    state.personnelFilters = {
      search: "",
      status: "",
      hvStatus: "",
      municipality: "",
      gestorZona: "",
    };
  }

  const searchValue = state.personnelFilters.search || "";
  const statusValue = state.personnelFilters.status || "";
  const hvStatusValue = state.personnelFilters.hvStatus || "";
  const municipalityValue = state.personnelFilters.municipality || "";
  const gestorZonaValue = state.personnelFilters.gestorZona || "";

  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const filteredRows = rows.filter((item) => {
    const hvStatus = getPersonnelHvStatus(item, allDocuments);
    const workStatus = getPersonnelWorkStatus(item);
    const municipality = getPersonnelMunicipality(item);

    const searchableText = normalize(`
      ${getPersonnelFullName(item)}
      ${getPersonnelDocument(item)}
      ${getPersonnelRole(item)}
      ${workStatus}
      ${municipality}
      ${item.email || ""}
      ${item.phone || ""}
    `);

    if (searchValue && !searchableText.includes(normalize(searchValue))) {
      return false;
    }

    if (statusValue && normalize(workStatus) !== normalize(statusValue)) {
      return false;
    }

    if (hvStatusValue && normalize(hvStatus.label) !== normalize(hvStatusValue)) {
      return false;
    }

    if (municipalityValue) {
      // Buscar tanto en municipio de residencia como en municipio institucional
      const institutionalMunicipality = normalize(
        item.educationalMunicipality ||
        item.educational_municipality ||
        item.municipio_institucional ||
        ""
      );
      const matchesMunicipality =
        normalize(municipality) === normalize(municipalityValue) ||
        institutionalMunicipality === normalize(municipalityValue);
      if (!matchesMunicipality) return false;
    }

    if (gestorZonaValue) {
      const itemGestor = normalize(item.gestorZona || item.gestor_zona || "");
      if (itemGestor !== normalize(gestorZonaValue)) return false;
    }

    return true;
  });

  const municipalityOptions = META_MUNICIPALITIES.map(m => m.name);
  const gestorZonaOptions = Array.from(
    new Set(rows.map(r => (r.gestorZona || r.gestor_zona || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));
  const dashboardSummary = calculatePersonnelDashboard(filteredRows, allDocuments);
  const documentAlerts = calculateDocumentAlerts(filteredRows, allDocuments);


  const hydratePersonnelDraft = (found) => {
    const isPresentedInOffer =
      found.presentacion_en_licitacion === true ||
      found.presentacion_en_licitacion === "true" ||
      found.presented_in_offer === true ||
      found.presented_in_offer === "true" ||
      found.presentedInOffer === true ||
      found.presentedInOffer === "true";

    return {
      firstName: found.primer_nombre || found.firstName || "",
      secondName: found.segundo_nombre || found.secondName || "",
      firstLastName: found.primer_apellido || found.firstLastName || "",
      secondLastName: found.segundo_apellido || found.secondLastName || "",
      documentType: found.tipo_documento || found.documentType || "",
      documentNumber: found.numero_documento || found.documentNumber || "",

      expeditionDay: found.fecha_expedicion_dia || found.expeditionDay || "",
      expeditionMonth: found.fecha_expedicion_mes || found.expeditionMonth || "",
      expeditionYear: found.fecha_expedicion_anio || found.expeditionYear || "",
      expeditionDepartment:
        found.departamento_expedicion || found.expeditionDepartment || "",
      expeditionMunicipality:
        found.municipio_expedicion || found.expeditionMunicipality || "",

      birthDay: found.fecha_nacimiento_dia || found.birthDay || "",
      birthMonth: found.fecha_nacimiento_mes || found.birthMonth || "",
      birthYear: found.fecha_nacimiento_anio || found.birthYear || "",
      birthCountry: found.pais_nacimiento || found.birthCountry || "Colombia",
      birthDepartment: found.departamento_nacimiento || found.birthDepartment || "",
      birthMunicipality: found.municipio_nacimiento || found.birthMunicipality || "",

      bloodType: found.grupo_sanguineo || found.bloodType || "",
      biologicalSex: found.sexo_biologico || found.biologicalSex || "",

      companyId: found.company_id || found.companyId || found.empresa || "",
      contractId: found.contract_id || found.contractId || found.contrato || "",
      municipalityId:
        found.municipalityId ||
        found.municipality_id ||
        found.municipio_id ||
        found.municipio ||
        "",

      presentedInOffer: isPresentedInOffer ? "true" : "false",
      offerPosition: isPresentedInOffer
        ? found.cargo_presentado_en_licitacion ||
          found.offered_position ||
          found.offerPosition ||
          ""
        : "",

      cargo_real: found.cargo_real || found.real_position || found.position || "",
      status: found.estado || found.status || "",

      phone: found.celular || found.phone || "",
      email: found.correo_electronico || found.email || "",
      address: found.direccion_residencia || found.address || "",
      neighborhood: found.barrio_residencia || found.neighborhood || "",
      residenceMunicipality:
        found.municipio_residencia || found.residenceMunicipality || "",
      civilStatus: found.estado_civil || found.civilStatus || "",
      residenceZone: found.zona_residencia || found.residenceZone || "",

      educationalMunicipality:
        found.educationalMunicipality ||
        found.educational_municipality ||
        found.municipio_educativo ||
        found.municipio_institucional ||
        "",

      institution: found.institution || found.institucion_educativa || "",
      site: found.site || found.sede_educativa || "",
      educationalModality: found.educationalModality || found.modalidad || "",

      contractType: found.tipo_contrato || found.contractType || "",

      workTimeType:
        found.workTimeType ||
        found.work_time_type ||
        found.tipo_tiempo ||
        "",

      startDate: found.fecha_inicio_real || found.startDate || "",
      coverageStartDate:
        found.coverageStartDate ||
        found.coverage_start_date ||
        found.fecha_inicio_cobertura ||
        "",

      eps: found.eps || "",
      pensionFund:
        found.fondo_pensiones ||
        found.pensionFund ||
        found.pension_fund ||
        found.fondo_pension ||
        "",

      compensationBox:
        found.caja_compensacion ||
        found.compensationBox ||
        found.compensation_box ||
        "COFREM",

      arl: found.arl || "SURA",

      sisben: found.sisben_tiene || found.sisben || "",
      sisbenCategory: found.sisben_categoria || found.sisbenCategory || "",
      sisbenIssueDate: found.sisbenIssueDate || found.sisben_issue_date || "",
      sisbenExpirationDate:
        found.sisbenExpirationDate || found.sisben_expiration_date || "",

      hasResidenceCertificate:
        found.hasResidenceCertificate || found.has_residence_certificate || "",

      residenceCertificateIssueDate:
        found.residenceCertificateIssueDate ||
        found.residence_certificate_issue_date ||
        "",

      residenceCertificateExpiration:
        found.residenceCertificateExpiration ||
        found.residence_certificate_expiration ||
        "",

      foodHandlingCourseIssueDate:
        found.foodHandlingCourseIssueDate ||
        found.food_handling_course_issue_date ||
        "",

      foodHandlingCourseExpirationDate:
        found.foodHandlingCourseExpirationDate ||
        found.food_handling_course_expiration_date ||
        "",

      foodHandlingExamIssueDate:
        found.foodHandlingExamIssueDate ||
        found.food_handling_exam_issue_date ||
        "",

      foodHandlingExamExpirationDate:
        found.foodHandlingExamExpirationDate ||
        found.food_handling_exam_expiration_date ||
        "",

      studies: Array.isArray(found.studies) ? found.studies : [],
      observations: Array.isArray(found.observations) ? found.observations : [],
      internalNotes: found.observaciones_internas || found.internalNotes || "",

      gestorZona: found.gestorZona || found.gestor_zona || "",
    };
  };

  setTimeout(() => {
    const searchInput = document.getElementById("personnelSearch");
    const statusInput = document.getElementById("personnelFilterStatus");
    const hvStatusInput = document.getElementById("personnelFilterHvStatus");
    const municipalityInput = document.getElementById("personnelFilterMunicipality");
    const clearFiltersBtn = document.getElementById("clearPersonnelFilters");
    const newBtn = document.getElementById("btnNewEmployee");
    const exportBtn = document.getElementById("btnExportPersonnel");

    // Debounce: el buscador espera 400ms antes de re-renderizar
    let personnelSearchTimer = null;

    const gestorZonaInput = document.getElementById("personnelFilterGestorZona");

    const applyPersonnelFilters = async () => {
      state.personnelFilters = {
        search:       document.getElementById("personnelSearch")?.value || "",
        status:       document.getElementById("personnelFilterStatus")?.value || "",
        hvStatus:     document.getElementById("personnelFilterHvStatus")?.value || "",
        municipality: document.getElementById("personnelFilterMunicipality")?.value || "",
        gestorZona:   document.getElementById("personnelFilterGestorZona")?.value || "",
      };
      state.personnelPage = 1;
      await openModule("gestion_personal");
    };

    // Selects: re-render inmediato
    [statusInput, hvStatusInput, municipalityInput, gestorZonaInput].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", applyPersonnelFilters);
    });

    // Buscador: debounce 400ms para no parpadear en cada tecla
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(personnelSearchTimer);
        personnelSearchTimer = setTimeout(applyPersonnelFilters, 400);
      });
    }

    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener("click", async () => {
        state.personnelFilters = {
          search: "",
          status: "",
          hvStatus: "",
          municipality: "",
          gestorZona: "",
        };

        await openModule("gestion_personal");
      });
    }

    if (newBtn) {
      newBtn.addEventListener("click", async () => {
        state.personnelDraft = {};
        state.personnelCreateTab = "identificacion";
        state.personnelViewMode = "create";
        state.personnelEditingId = null;
        state.personnelDocumentsEmployee = null;
        await openModule("gestion_personal");
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        showInfo("Esta función estará disponible próximamente.", "Exportación");
      });
    }

    document.querySelectorAll("[data-edit-personnel-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.editPersonnelId;
        const found = rows.find((item) => String(item.id) === String(id));
        if (!found) return;

        state.personnelDraft = hydratePersonnelDraft(found);
        state.personnelCreateTab = "identificacion";
        state.personnelViewMode = "edit";
        state.personnelEditingId = found.id || null;
        state.personnelDocumentsEmployee = null;

        await openModule("gestion_personal");
      });
    });

    document.querySelectorAll("[data-documents-personnel-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.documentsPersonnelId;
        const found = rows.find((item) => String(item.id) === String(id));
        if (!found) return;

        state.personnelDraft = hydratePersonnelDraft(found);
        state.personnelViewMode = "documents";
        state.personnelEditingId = found.id || null;
        state.personnelDocumentsEmployee = found;

        await openModule("gestion_personal");
      });
    });
  }, 0);

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">

        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo operativo</span>
            <h2>Gestión del Personal</h2>
            <p>Controla el personal activo, su estado laboral y el cumplimiento documental.</p>
          </div>

          <div class="personnel-premium-actions">
            <button type="button" id="btnNewEmployee" class="btn btn-primary">+ Nuevo empleado</button>
            <button type="button" id="btnExportPersonnel" class="btn btn-secondary">Exportar</button>
          </div>
        </section>

        <section class="personnel-premium-summary">
          <div class="premium-metric main">
            <span>Total personal</span>
            <strong>${dashboardSummary.total || 0}</strong>
            <small>${filteredRows.length} visibles de ${rows.length} registrados</small>
          </div>

          <div class="premium-metric success">
            <span>HV completas</span>
            <strong>${dashboardSummary.completa || 0}</strong>
          </div>

          <div class="premium-metric warning">
            <span>En revisión</span>
            <strong>${dashboardSummary.revision || 0}</strong>
          </div>

          <div class="premium-metric neutral">
            <span>Incompletas</span>
            <strong>${dashboardSummary.incompleta || 0}</strong>
          </div>

          <div class="premium-metric danger">
            <span>No aptos</span>
            <strong>${dashboardSummary.noApto || 0}</strong>
          </div>
        </section>

        <section class="personnel-premium-alerts compact-alerts">
          <div>
            <span>Docs vencidos</span>
            <strong>${documentAlerts.vencidos || 0}</strong>
          </div>

          <div>
            <span>Por vencer</span>
            <strong>${documentAlerts.proximosVencer || 0}</strong>
          </div>

          <div>
            <span>En revisión</span>
            <strong>${documentAlerts.revision || 0}</strong>
          </div>

          <div>
            <span>Rechazados</span>
            <strong>${documentAlerts.rechazados || 0}</strong>
          </div>
        </section>

        <section class="personnel-premium-filters">
          <input
            id="personnelSearch"
            type="text"
            class="personnel-toolbar-search"
            placeholder="Buscar por nombre, documento o cargo"
            value="${escapeAttr(searchValue)}"
          />

          <select id="personnelFilterStatus">
            <option value="">Estado laboral</option>
            ${ESTADOS_PERSONAL
              .map(
                (item) => `
                  <option value="${escapeAttr(item)}" ${
                    String(statusValue) === String(item) ? "selected" : ""
                  }>
                    ${escapeHtml(item)}
                  </option>
                `
              )
              .join("")}
          </select>

          <select id="personnelFilterHvStatus">
            <option value="">Hoja de vida</option>
            <option value="Completa" ${hvStatusValue === "Completa" ? "selected" : ""}>Completa</option>
            <option value="Incompleta" ${hvStatusValue === "Incompleta" ? "selected" : ""}>Incompleta</option>
            <option value="En revisión" ${hvStatusValue === "En revisión" ? "selected" : ""}>En revisión</option>
            <option value="No apto documental" ${hvStatusValue === "No apto documental" ? "selected" : ""}>No apto documental</option>
          </select>

          <select id="personnelFilterMunicipality">
            <option value="">Municipio</option>
            ${municipalityOptions
              .map(
                (value) => `
                  <option value="${escapeAttr(value)}" ${
                    String(municipalityValue) === String(value) ? "selected" : ""
                  }>
                    ${escapeHtml(value)}
                  </option>
                `
              )
              .join("")}
          </select>

          <select id="personnelFilterGestorZona">
            <option value="">Gestor de Zona</option>
            ${gestorZonaOptions
              .map(
                (value) => `
                  <option value="${escapeAttr(value)}" ${
                    String(gestorZonaValue) === String(value) ? "selected" : ""
                  }>
                    ${escapeHtml(value)}
                  </option>
                `
              )
              .join("")}
          </select>

          <button type="button" id="clearPersonnelFilters" class="btn btn-secondary">
            Limpiar
          </button>
        </section>

        <section class="personnel-premium-table-card">
          <div class="personnel-table-top">
            <span>${filteredRows.length} resultado${filteredRows.length !== 1 ? 's' : ''} de ${rows.length} registrados</span>
          </div>

          <div class="personnel-table-wrap premium-table-wrap">
            <table class="personnel-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Nombre completo</th>
                  <th>Cargo</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>HV</th>
                  <th>Municipio</th>
                  <th>Gestor de Zona</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                ${
                  filteredRows.length
                    ? filteredRows
                        .map((item) => {
                          const hvStatus = getPersonnelHvStatus(item, allDocuments);

                          const isOffer =
                            item.presentacion_en_licitacion === true ||
                            item.presentacion_en_licitacion === "true" ||
                            item.presented_in_offer === true ||
                            item.presented_in_offer === "true" ||
                            item.presentedInOffer === true ||
                            item.presentedInOffer === "true";

                          const roleLabel = getPersonnelRole(item);
                          const roleClass = isOffer ? "role-offer" : "role-extra";
                          const typeLabel = isOffer ? "Oferta" : "Extra";
                          const rowClass =
                            hvStatus.label === "No apto documental"
                              ? "personnel-row-blocked"
                              : "";

                          return `
                            <tr class="${rowClass}">
                              <td>${escapeHtml(getPersonnelDocument(item))}</td>

                              <td class="personnel-name-cell">
                                ${escapeHtml(getPersonnelFullName(item))}
                              </td>

                              <td>
                                <span class="role-chip ${roleClass}">
                                  ${escapeHtml(roleLabel)}
                                </span>
                              </td>

                              <td>
                                <span class="role-chip ${roleClass}">
                                  ${escapeHtml(typeLabel)}
                                </span>
                              </td>

                              <td>${escapeHtml(getPersonnelWorkStatus(item))}</td>

                              <td>
                                <span class="status-chip ${hvStatus.className}">
                                  ${escapeHtml(hvStatus.label)}
                                </span>
                              </td>

                              <td>${escapeHtml(getPersonnelMunicipality(item))}</td>

                              <td class="gestor-zona-cell">${escapeHtml(item.gestorZona || item.gestor_zona || "—")}</td>

                              <td>
                                <div class="personnel-row-actions">
                                  <button
                                    type="button"
                                    class="btn btn-secondary btn-row"
                                    data-edit-personnel-id="${escapeAttr(item.id)}"
                                  >
                                    Editar
                                  </button>

                                  <button
                                    type="button"
                                    class="btn btn-secondary btn-row"
                                    data-documents-personnel-id="${escapeAttr(item.id)}"
                                  >
                                    Documentos
                                  </button>
                                </div>
                              </td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `
                      <tr>
                        <td colspan="9">
                          <div class="personnel-table-empty">
                            No hay registros que coincidan con los filtros.
                          </div>
                        </td>
                      </tr>
                    `
                }
              </tbody>
            </table>
          </div>

        </section>
      </article>
    </div>
  `;
}

async function loadEmployeeDocumentsModule() {
  const employee = state.personnelDocumentsEmployee;

  if (!employee) {
    return `
      <article class="info-card">
        <h3>Error</h3>
        <p>No se encontró el empleado.</p>
      </article>
    `;
  }

  let documents = [];

  try {
    const res = await apiFetch(`/documents?employeeId=${employee.id}`);
    documents = Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error cargando documentos</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }

  const requiredDocuments = getRequiredDocumentsForEmployee(employee);

  const normalize = (v) =>
    String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const findUploadedDocument = (requiredDoc) =>
    documents
      .filter((doc) => normalize(doc.documentType) === normalize(requiredDoc.name))
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

  const getStatus = (requiredDoc) => {
    const found = findUploadedDocument(requiredDoc);

    if (!found || !found.fileUrl) {
      return {
        label: requiredDoc.required ? "Faltante" : "Opcional",
        className: requiredDoc.required ? "danger" : "neutral",
        icon: requiredDoc.required ? "✕" : "—",
        isOk: !requiredDoc.required,
      };
    }

    const validationStatus = normalize(found.validationStatus || found.status);

    if (validationStatus === "RECHAZADO") {
      return {
        label: "Rechazado",
        className: "danger",
        icon: "✕",
        isOk: false,
      };
    }

    if (requiredDoc.issueDateRequired && !found.issueDate) {
      return {
        label: "Falta expedición",
        className: "warning",
        icon: "!",
        isOk: false,
      };
    }

    if (requiredDoc.expirationDateRequired && !found.expirationDate) {
      return {
        label: "Falta vencimiento",
        className: "warning",
        icon: "!",
        isOk: false,
      };
    }

    if (requiredDoc.expirationDateRequired && found.expirationDate) {
      const exp = new Date(found.expirationDate);
      exp.setHours(0, 0, 0, 0);

      const diff = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

      if (diff < 0) {
        return {
          label: "Vencido",
          className: "danger",
          icon: "!",
          isOk: false,
        };
      }

      if (diff <= 30) {
        return {
          label: "Por vencer",
          className: "warning",
          icon: "!",
          isOk: false,
        };
      }
    }

    if (validationStatus !== "VALIDADO") {
      return {
        label: "En revisión",
        className: "warning",
        icon: "!",
        isOk: false,
      };
    }

    return {
      label: "Validado",
      className: "success",
      icon: "✓",
      isOk: true,
    };
  };

  const documentRows = requiredDocuments.map((doc) => {
    const found = findUploadedDocument(doc);
    const status = getStatus(doc);
    const validationStatus = normalize(found?.validationStatus || found?.status);

    const canValidate =
      found?.fileUrl &&
      validationStatus !== "VALIDADO" &&
      validationStatus !== "RECHAZADO";

    return {
      doc,
      found,
      status,
      canValidate,
    };
  });

  const requiredRows = documentRows.filter((item) => item.doc.required);
  const totalRequired = requiredRows.length;
  const completedRequired = requiredRows.filter((item) => item.status.isOk).length;
  const missingRequired = requiredRows.filter((item) => item.status.label === "Faltante").length;
  const warningRequired = requiredRows.filter((item) => item.status.className === "warning").length;
  const rejectedOrExpired = requiredRows.filter(
    (item) =>
      item.status.label === "Rechazado" ||
      item.status.label === "Vencido"
  ).length;

  const compliancePercent = totalRequired
    ? Math.round((completedRequired / totalRequired) * 100)
    : 100;

  const generalStatus =
    rejectedOrExpired > 0
      ? { label: "No apto documental", className: "danger" }
      : missingRequired > 0
      ? { label: "Incompleto", className: "danger" }
      : warningRequired > 0
      ? { label: "Requiere revisión", className: "warning" }
      : { label: "Completo", className: "success" };

  const rows = documentRows.map(({ doc, found, status, canValidate }) => {
    return `
      <div class="document-check-row">
        <div class="document-check-main">
          <span class="document-check-icon ${status.className}">
            ${escapeHtml(status.icon)}
          </span>

          <div>
            <strong>${escapeHtml(doc.name)}</strong>
            <small>
              ${escapeHtml(doc.group || "GENERAL")}
              ${!doc.required ? " · Opcional" : " · Obligatorio"}
            </small>

            ${
              found?.validationStatus === "RECHAZADO" && found?.rejectionReason
                ? `<p class="document-rejection">Motivo: ${escapeHtml(found.rejectionReason)}</p>`
                : ""
            }

            ${
              found?.validatedBy
                ? `<p class="document-reviewed">Revisado por: ${escapeHtml(found.validatedBy)}</p>`
                : ""
            }
          </div>
        </div>

        <div class="document-check-dates">
          <span>Expedición: <strong>${doc.issueDateRequired ? escapeHtml(found?.issueDate || "Pendiente") : "No aplica"}</strong></span>
          <span>Vencimiento: <strong>${doc.expirationDateRequired ? escapeHtml(found?.expirationDate || "Pendiente") : "No aplica"}</strong></span>
        </div>

        <div class="document-check-status">
          <span class="status-chip ${status.className}">
            ${escapeHtml(status.label)}
          </span>
        </div>

        <div class="document-check-actions">
          ${
            found?.fileUrl
              ? `<a href="${escapeAttr(found.fileUrl)}" target="_blank" class="btn btn-secondary btn-row">Ver PDF</a>`
              : ""
          }

          ${
            canValidate
              ? `
                <button
                  type="button"
                  class="btn btn-primary btn-row"
                  data-validate-document-id="${escapeAttr(found.id)}"
                >
                  Validar
                </button>

                <button
                  type="button"
                  class="btn btn-danger btn-row"
                  data-reject-document-id="${escapeAttr(found.id)}"
                >
                  Rechazar
                </button>
              `
              : ""
          }
        </div>
      </div>
    `;
  });

  setTimeout(() => {
    const backBtn = document.getElementById("backToPersonnel");
    const saveBtn = document.getElementById("saveDoc");
    const docTypeInput = document.getElementById("docType");
    const issueDateInput = document.getElementById("docIssueDate");
    const expirationDateInput = document.getElementById("docExpirationDate");
    const fileInput = document.getElementById("docFile");

    const syncDateVisibility = () => {
      const selectedRule = requiredDocuments.find(
        (doc) => normalize(doc.name) === normalize(docTypeInput?.value)
      );

      if (!issueDateInput || !expirationDateInput) return;

      if (!selectedRule) {
        issueDateInput.classList.add("hidden");
        expirationDateInput.classList.add("hidden");
        issueDateInput.value = "";
        expirationDateInput.value = "";
        return;
      }

      if (selectedRule.issueDateRequired) {
        issueDateInput.classList.remove("hidden");
      } else {
        issueDateInput.classList.add("hidden");
        issueDateInput.value = "";
      }

      if (selectedRule.expirationDateRequired) {
        expirationDateInput.classList.remove("hidden");
      } else {
        expirationDateInput.classList.add("hidden");
        expirationDateInput.value = "";
      }
    };

    const fileToBase64 = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
      });

    if (docTypeInput) {
      docTypeInput.addEventListener("change", syncDateVisibility);
      syncDateVisibility();
    }

    if (backBtn) {
      backBtn.onclick = async () => {
        state.personnelViewMode = "table";
        state.personnelDocumentsEmployee = null;
        await openModule("gestion_personal");
      };
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const type = docTypeInput?.value || "";
        const issue = issueDateInput?.value || "";
        const exp = expirationDateInput?.value || "";

        const selectedRule = requiredDocuments.find(
          (doc) => normalize(doc.name) === normalize(type)
        );

        if (!type) {
          showWarning("Debes seleccionar un documento."); return;
          return;
        }

        if (selectedRule?.issueDateRequired && !issue) {
          showWarning("Este documento requiere fecha de expedición."); return;
          return;
        }

        if (selectedRule?.expirationDateRequired && !exp) {
          showWarning("Este documento requiere fecha de vencimiento."); return;
          return;
        }

        if (!fileInput || !fileInput.files || !fileInput.files.length) {
          showWarning("Debes subir el documento en PDF."); return;
          return;
        }

        const file = fileInput.files[0];

        if (file.type !== "application/pdf") {
          showWarning("Solo se permiten archivos PDF."); return;
          return;
        }

        try {
          const fileBase64 = await fileToBase64(file);

          await apiFetch("/documents", {
            method: "POST",
            body: JSON.stringify({
              employeeId: employee.id,
              documentType: type,
              issueDate: selectedRule?.issueDateRequired ? issue : "",
              expirationDate: selectedRule?.expirationDateRequired ? exp : "",
              fileBase64,
              fileName: file.name,
              validationStatus: "PENDIENTE_VALIDACION",
              uploadedBy: state.currentUser?.name || "Usuario",
            }),
          });

          await openModule("gestion_personal");
        } catch {
          showError("No fue posible guardar el documento.")
        }
      };
    }

    document.querySelectorAll("[data-validate-document-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.validateDocumentId;

        if (!confirm("¿Confirmas que este documento fue revisado y es válido?")) {
          return;
        }

        try {
          await apiFetch("/documents/validate", {
            method: "PUT",
            body: JSON.stringify({
              id,
              userName: state.currentUser?.name || "Usuario",
            }),
          });

          await openModule("gestion_personal");
        } catch {
          showError("No fue posible validar el documento.")
        }
      });
    });

    document.querySelectorAll("[data-reject-document-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.rejectDocumentId;
        const reason = prompt("Escribe el motivo del rechazo:");

        if (reason === null) return;

        if (!reason.trim()) {
          showWarning("Debes escribir un motivo de rechazo."); return;
          return;
        }

        try {
          await apiFetch("/documents/reject", {
            method: "PUT",
            body: JSON.stringify({
              id,
              reason: reason.trim(),
              userName: state.currentUser?.name || "Usuario",
            }),
          });

          await openModule("gestion_personal");
        } catch {
          showError("No fue posible rechazar el documento.")
        }
      });
    });
  }, 0);

  return `
    <div class="documents-audit-module">
      <article class="documents-audit-card">
        <section class="documents-audit-hero">
          <div>
            <span class="personnel-premium-eyebrow">Auditoría documental</span>
            <h2>Documentos del empleado</h2>
            <p>${escapeHtml(getPersonnelFullName(employee))}</p>
          </div>

          <button id="backToPersonnel" class="btn btn-secondary">
            Volver
          </button>
        </section>

        <section class="documents-audit-summary">
          <div class="documents-audit-score">
            <span>Cumplimiento</span>
            <strong>${compliancePercent}%</strong>
            <small>${completedRequired} de ${totalRequired} obligatorios validados</small>
          </div>

          <div class="documents-audit-status ${generalStatus.className}">
            <span>Estado documental</span>
            <strong>${escapeHtml(generalStatus.label)}</strong>
            <small>Según vencimientos, faltantes y validaciones.</small>
          </div>

          <div class="documents-audit-mini">
            <span>Faltantes</span>
            <strong>${missingRequired}</strong>
          </div>

          <div class="documents-audit-mini">
            <span>Alertas</span>
            <strong>${warningRequired + rejectedOrExpired}</strong>
          </div>
        </section>

        <section class="documents-upload-card">
          <div>
            <h3>Cargar documento</h3>
            <p>Selecciona el tipo documental. Empiria solicitará fechas cuando sean obligatorias.</p>
          </div>

          <div class="documents-upload-form">
            <select id="docType">
              <option value="">Selecciona documento</option>
              ${requiredDocuments
                .map(
                  (d) => `
                    <option value="${escapeAttr(d.name)}">
                      ${escapeHtml(d.name)}${d.required ? "" : " (Opcional)"}
                    </option>
                  `
                )
                .join("")}
            </select>

            <input id="docIssueDate" type="date" class="hidden" />
            <input id="docExpirationDate" type="date" class="hidden" />
            <input id="docFile" type="file" accept="application/pdf" />

            <button id="saveDoc" class="btn btn-primary">
              Guardar documento
            </button>
          </div>
        </section>

        <section class="documents-checklist-card">
          <div class="documents-checklist-head">
            <div>
              <h3>Checklist documental</h3>
              <p>Validación automática por cargo, fechas y estado de revisión.</p>
            </div>

            <span>${requiredDocuments.length} documentos</span>
          </div>

          <div class="documents-checklist">
            ${rows.join("")}
          </div>
        </section>
      </article>
    </div>
  `;
}

async function handleCreatePersonnel(event) {
  event.preventDefault();

  // ===============================
  // VALIDACIONES FINALES EMPIRIA
  // ===============================

  const d = state.personnelDraft;

  // 🔹 Nombre y documento
  if (!d.firstName || !d.firstLastName) {
    showWarning("El nombre del empleado es obligatorio."); return;
    return;
  }

  if (!d.documentNumber) {
    showWarning("El número de documento es obligatorio."); return;
    return;
  }

  // 🔹 Licitación
  if (d.presentedInOffer === "true" && !d.offerPosition) {
    showWarning("Debe seleccionar el cargo presentado en la oferta."); return;
    return;
  }

  // 🔹 Cargo real obligatorio
  if (!d.cargo_real) {
    showWarning("Debe seleccionar el cargo real."); return;
    return;
  }

  // 🔹 Institucional (solo manipulador)
  if (String(d.cargo_real).toUpperCase() === "OPERARIO MANIPULADOR DE ALIMENTOS") {
    if (!d.educationalMunicipality || !d.institution || !d.site || !d.educationalModality) {
      showWarning("Debe completar todos los campos del tab Institucional."); return;
      return;
    }
  }

  // 🔹 Contratación
  if (!d.contractType || !d.startDate || !d.coverageStartDate) {
    showWarning("Debe completar la información de contratación."); return;
    return;
  }

  // 🔹 Seguridad social
  if (!d.eps || !d.pensionFund) {
    showWarning("Debe seleccionar EPS y fondo de pensiones."); return;
    return;
  }

  // 🔹 SISBEN
  if (d.sisben === "true") {
    if (!d.sisbenIssueDate || !d.sisbenExpirationDate) {
      showWarning("Debe completar las fechas del SISBEN."); return;
      return;
    }
  }

  // 🔹 Certificado de residencia
  if (d.hasResidenceCertificate === "true") {
    if (!d.residenceCertificateIssueDate || !d.residenceCertificateExpiration) {
      showWarning("Debe completar las fechas del certificado de residencia."); return;
      return;
    }
  }

  // 🔹 Estudios vacíos
  if (Array.isArray(d.studies)) {
    const invalidStudy = d.studies.some(
      (s) =>
        !s.educationLevel &&
        !s.degree &&
        !s.institution &&
        !s.date
    );

    if (invalidStudy) {
      showWarning("Hay estudios vacíos. Complételos o elimínelos."); return;
      return;
    }
  }

  // 🔹 Observaciones vacías
  if (Array.isArray(d.observations)) {
    const invalidObs = d.observations.some((o) => !o.text || !o.text.trim());

    if (invalidObs) {
      showWarning("Hay observaciones vacías."); return;
      return;
    }
  }
  
  const form = event.currentTarget;

  if (!validatePersonnelForm(form)) {
    showWarning("Faltan campos obligatorios por diligenciar."); return;
    return;
  }

  if (
    !String(state.personnelDraft.firstName || "").trim() ||
    !String(state.personnelDraft.firstLastName || "").trim()
  ) {
    const firstNameField = form.querySelector('[name="firstName"]');
    const firstLastNameField = form.querySelector('[name="firstLastName"]');

    if (firstNameField && !String(firstNameField.value || "").trim()) {
      firstNameField.classList.add("input-error");
    }

    if (firstLastNameField && !String(firstLastNameField.value || "").trim()) {
      firstLastNameField.classList.add("input-error");
    }

    showWarning("El nombre y el apellido son obligatorios."); return;
    return;
  }

    const payload = {
      // 🔹 IDENTIFICACIÓN
      firstName: state.personnelDraft.firstName || "",
      secondName: state.personnelDraft.secondName || "",
      firstLastName: state.personnelDraft.firstLastName || "",
      secondLastName: state.personnelDraft.secondLastName || "",

      documentType: state.personnelDraft.documentType || "",
      documentNumber: state.personnelDraft.documentNumber || "",

      expeditionDay: state.personnelDraft.expeditionDay || "",
      expeditionMonth: state.personnelDraft.expeditionMonth || "",
      expeditionYear: state.personnelDraft.expeditionYear || "",
      expeditionDepartment: state.personnelDraft.expeditionDepartment || "",
      expeditionMunicipality: state.personnelDraft.expeditionMunicipality || "",

      birthDay: state.personnelDraft.birthDay || "",
      birthMonth: state.personnelDraft.birthMonth || "",
      birthYear: state.personnelDraft.birthYear || "",
      birthCountry: state.personnelDraft.birthCountry || "",
      birthDepartment: state.personnelDraft.birthDepartment || "",
      birthMunicipality: state.personnelDraft.birthMunicipality || "",

      bloodType: state.personnelDraft.bloodType || "",
      biologicalSex: state.personnelDraft.biologicalSex || "",

      // 🔹 VINCULACIÓN
      companyId: state.personnelDraft.companyId || "",
      contractId: state.personnelDraft.contractId || "",
      municipalityId:
        document.querySelector('#personnelForm [name="municipalityId"]')?.value ||
        state.personnelDraft.municipalityId ||
        "",

      // 🔹 LICITACIÓN
      presentedInOffer: state.personnelDraft.presentedInOffer || "",
      offerPosition: state.personnelDraft.offerPosition || "",
      cargo_real: state.personnelDraft.cargo_real || "",
      status: state.personnelDraft.status || "",

      // 🔹 DATOS PERSONALES
      phone: state.personnelDraft.phone || "",
      email: state.personnelDraft.email || "",
      civilStatus: state.personnelDraft.civilStatus || "",
      neighborhood: state.personnelDraft.neighborhood || "",
      address: state.personnelDraft.address || "",
      residenceMunicipality: state.personnelDraft.residenceMunicipality || "",
      residenceZone: state.personnelDraft.residenceZone || "",

      // 🔹 INSTITUCIONAL
      educationalMunicipality: state.personnelDraft.educationalMunicipality || "",
      institution: state.personnelDraft.institution || "",
      site: state.personnelDraft.site || "",
      educationalModality: state.personnelDraft.educationalModality || "",

      // 🔹 CONTRATACIÓN
      contractType: state.personnelDraft.contractType || "",

      workTimeType:
        document.querySelector('#personnelForm [name="workTimeType"]')?.value ||
        state.personnelDraft.workTimeType ||
        "",

      startDate: state.personnelDraft.startDate || "",
      coverageStartDate: state.personnelDraft.coverageStartDate || "",

      eps: state.personnelDraft.eps || "",
      pensionFund: state.personnelDraft.pensionFund || "",
      compensationBox: state.personnelDraft.compensationBox || "",
      arl: state.personnelDraft.arl || "",

      // 🔥 MANIPULACIÓN DE ALIMENTOS
      foodHandlingCourseIssueDate:
        state.personnelDraft.foodHandlingCourseIssueDate || "",

      foodHandlingCourseExpirationDate:
        state.personnelDraft.foodHandlingCourseExpirationDate || "",

      foodHandlingExamIssueDate:
        state.personnelDraft.foodHandlingExamIssueDate || "",

      foodHandlingExamExpirationDate:
        state.personnelDraft.foodHandlingExamExpirationDate || "",

      // 🔹 SEGUIMIENTO
      sisben: state.personnelDraft.sisben || "",
      sisbenCategory: state.personnelDraft.sisbenCategory || "",
      sisbenIssueDate: state.personnelDraft.sisbenIssueDate || "",
      sisbenExpirationDate: state.personnelDraft.sisbenExpirationDate || "",

      hasResidenceCertificate:
        state.personnelDraft.hasResidenceCertificate || "",

      residenceCertificateIssueDate:
        state.personnelDraft.residenceCertificateIssueDate || "",

      residenceCertificateExpiration:
        state.personnelDraft.residenceCertificateExpiration || "",

      // 🔥 ESTUDIOS DINÁMICOS
      studies: state.personnelDraft.studies || [],

      // 🔹 OBSERVACIONES
      observations: state.personnelDraft.observations || [],
      internalNotes: state.personnelDraft.internalNotes || "",

      // 🔹 GESTIÓN
      gestorZona: state.personnelDraft.gestorZona || "",
    };

  if (state.personnelViewMode === "edit" && state.personnelEditingId) {
    payload.id = state.personnelEditingId;
  }

  try {
    const method = state.personnelViewMode === "edit" ? "PUT" : "POST";

    await apiFetch("/personnel", {
      method,
      body: JSON.stringify(payload),
    });

    if (state.personnelViewMode === "edit") {
      showSuccess("Los datos del empleado han sido actualizados.", "Empleado actualizado");
    } else {
      showSuccess("El empleado fue registrado en el sistema.", "Empleado creado");
    }

    state.personnelDraft = {};
    state.personnelCreateTab = "identificacion";
    state.personnelViewMode = "table";
    state.personnelEditingId = null;

    state.activeModule = "gestion_personal";
    state.expandedModule = "gestion_personal";
    state.activeSubmodule = null;

    await openModule("gestion_personal");
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

async function renderSubmoduleContent(moduleKey, submoduleKey, moduleConfig) {
  // ─────────────────────────────
  // GESTIÓN PERSONAL
  // ─────────────────────────────
  if (moduleKey === "gestion_personal") {
    if (!state.personnelViewMode) {
      state.personnelViewMode = "table";
    }

    if (state.personnelViewMode === "table") {
      return await renderPersonnelTableModule();
    }

    if (state.personnelViewMode === "documents") {
      return await loadEmployeeDocumentsModule();
    }

    if (
      state.personnelViewMode === "create" ||
      state.personnelViewMode === "edit"
    ) {
      return await loadPersonnelModule(
        moduleConfig,
        state.personnelViewMode === "edit"
          ? "editar_empleado"
          : "crear_empleado"
      );
    }

    return await renderPersonnelTableModule();
  }

  // ─────────────────────────────
  // DASHBOARD
  // ─────────────────────────────
  if (moduleKey === "dashboard") {
    return await loadDashboardModule();
  }

  // ─────────────────────────────
  // COBERTURA (SIN SUBMÓDULOS)
  // ─────────────────────────────
  if (moduleKey === "cobertura_calculadora") {
    return await loadCoverageModule();
  }

  // ─────────────────────────────
  // SI NO HAY SUBMÓDULO (PERO NO ES COBERTURA)
  // ─────────────────────────────
  if (!submoduleKey) {
    return `
      <article class="info-card">
        <p>Selecciona una acción del menú izquierdo.</p>
      </article>
    `;
  }

  // ─────────────────────────────
  // REDIRECCIONES (MODULOS ELIMINADOS)
  // ─────────────────────────────
  if (
    moduleKey === "hoja_vida_documentos" ||
    moduleKey === "contratos_vinculacion"
  ) {
    state.activeModule = "gestion_personal";
    state.personnelViewMode = "table";
    return await renderPersonnelTableModule();
  }

  // ─────────────────────────────
  // NOMINA
  // ─────────────────────────────
  if (moduleKey === "nomina_novedades") {
    if (submoduleKey === "registrar_novedad") {
      const html = await loadRegistrarNovedadModule();
      wireRegistrarNovedadEvents();
      return html;
    }
    if (submoduleKey === "consultar_novedades") {
      const html = await loadConsultarNovedadesModule();
      wireConsultarNovedadesEvents();
      return html;
    }
    if (submoduleKey === "desprendibles") {
      const html = await loadDesprendiblesModule();
      wireDesprendiblesEvents();
      return html;
    }
    if (submoduleKey === "certificaciones") {
      const html = await loadCertificacionesModule();
      wireCertificacionesEvents();
      return html;
    }
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este submódulo estará disponible próximamente.</p>
      </article>
    `;
  }



// ============================================================
// NOMINA Y NOVEDADES - Registrar novedad
// ============================================================
async function loadRegistrarNovedadModule() {
  // Cargar lista de empleados activos para el selector
  let personnelRows = [];
  try {
    const pp = await apiFetch("/personnel");
    personnelRows = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
  } catch (e) { personnelRows = []; }

  const activeEmployees = personnelRows.filter(e => {
    const s = String(e.status || e.estado || "").toUpperCase();
    return s === "ACTIVO" || s === "ACTIVE";
  });

  const d = state.novedadDraft || {};

  // Municipios disponibles con empleados activos
  const novMunicipalities = [...new Set(
    activeEmployees
      .map(e => e.educationalMunicipality || e.educational_municipality ||
                e.municipio_institucional || e.municipality || e.municipio || "")
      .filter(Boolean)
  )].sort();

  const selectedMunicipality = d.selectedMunicipality || "";
  const filteredByMunicipality = selectedMunicipality
    ? activeEmployees.filter(e => {
        const m = e.educationalMunicipality || e.educational_municipality ||
                  e.municipio_institucional || e.municipality || e.municipio || "";
        return String(m).toUpperCase() === selectedMunicipality.toUpperCase();
      })
    : [];

  return `
    <div class="payroll-module-wrap">
      <div class="payroll-header">
        <div>
          <span class="payroll-eyebrow">Nómina y Novedades</span>
          <h2>Registrar novedad</h2>
          <p>Registra incapacidades, vacaciones, licencias y otras novedades del personal.</p>
        </div>
      </div>

      <div class="payroll-form-card">
        <div class="payroll-form-grid">

          <div class="payroll-field">
            <label class="payroll-label">Municipio <span class="req">*</span></label>
            <select id="novMunicipality" class="payroll-select">
              <option value="">Selecciona municipio</option>
              ${novMunicipalities.map(m =>
                `<option value="${escapeAttr(m)}" ${selectedMunicipality === m ? "selected" : ""}>${escapeHtml(m)}</option>`
              ).join("")}
            </select>
          </div>

          <div class="payroll-field">
            <label class="payroll-label">Empleado <span class="req">*</span></label>
            <select id="novEmployeeId" class="payroll-select" ${!selectedMunicipality ? "disabled" : ""}>
              <option value="">${selectedMunicipality ? "Selecciona empleado" : "Primero selecciona municipio"}</option>
              ${filteredByMunicipality.map(e => {
                const name = e.fullName || e.full_name || e.nombre_completo || "";
                const doc  = e.documentNumber || e.numero_documento || "";
                const id   = e.id || "";
                return `<option value="${escapeAttr(id)}" ${String(d.employeeId) === String(id) ? "selected" : ""}>${escapeHtml(name)} - ${escapeHtml(doc)}</option>`;
              }).join("")}
            </select>
          </div>

          <div class="payroll-field">
            <label class="payroll-label">Tipo de novedad <span class="req">*</span></label>
            <select id="novType" class="payroll-select">
              <option value="">Selecciona tipo</option>
              <option value="INCAPACIDAD"          ${d.noveltyType==="INCAPACIDAD"          ?"selected":""}>Incapacidad</option>
              <option value="VACACIONES"            ${d.noveltyType==="VACACIONES"            ?"selected":""}>Vacaciones</option>
              <option value="LICENCIA_REMUNERADA"   ${d.noveltyType==="LICENCIA_REMUNERADA"   ?"selected":""}>Licencia remunerada</option>
              <option value="LICENCIA_NO_REMUNERADA"${d.noveltyType==="LICENCIA_NO_REMUNERADA"?"selected":""}>Licencia no remunerada</option>
              <option value="SUSPENSION"            ${d.noveltyType==="SUSPENSION"            ?"selected":""}>Suspensión</option>
              <option value="AUSENCIA"              ${d.noveltyType==="AUSENCIA"              ?"selected":""}>Ausencia injustificada</option>
              <option value="CAMBIO_CARGO"          ${d.noveltyType==="CAMBIO_CARGO"          ?"selected":""}>Cambio de cargo</option>
              <option value="CAMBIO_SALARIO"        ${d.noveltyType==="CAMBIO_SALARIO"        ?"selected":""}>Cambio de salario</option>
              <option value="OTRO"                  ${d.noveltyType==="OTRO"                  ?"selected":""}>Otro</option>
            </select>
          </div>

          <div class="payroll-field">
            <label class="payroll-label">Días</label>
            <input id="novDays" type="number" min="1" class="payroll-input" placeholder="Ej: 3" value="${escapeAttr(d.days || "")}" />
          </div>

          <div class="payroll-field">
            <label class="payroll-label">Fecha inicio <span class="req">*</span></label>
            <input id="novStartDate" type="date" class="payroll-input" value="${escapeAttr(d.startDate || "")}" />
          </div>

          <div class="payroll-field">
            <label class="payroll-label">Fecha fin</label>
            <input id="novEndDate" type="date" class="payroll-input" value="${escapeAttr(d.endDate || "")}" />
          </div>

          <div class="payroll-field full-width">
            <label class="payroll-label">Observaciones</label>
            <textarea id="novObservations" class="payroll-textarea" rows="3" placeholder="Descripción o motivo de la novedad...">${escapeHtml(d.observations || "")}</textarea>
          </div>

        </div>

        <div class="payroll-form-actions">
          <button type="button" id="btnCancelNovedad" class="btn btn-secondary">Cancelar</button>
          <button type="button" id="btnGuardarNovedad" class="btn btn-primary">Guardar novedad</button>
        </div>
      </div>
    </div>
  `;
}

// Wire events after render for Registrar Novedad
function wireRegistrarNovedadEvents() {
  setTimeout(() => {
    // Municipio: al cambiar re-renderiza con empleados filtrados
    const novMunEl = document.getElementById("novMunicipality");
    if (novMunEl) {
      novMunEl.addEventListener("change", async () => {
        if (!state.novedadDraft) state.novedadDraft = {};
        state.novedadDraft.selectedMunicipality = novMunEl.value;
        state.novedadDraft.employeeId = "";
        await openModule("nomina_novedades");
      });
    }

    // Sync draft on change
    ["novEmployeeId","novType","novDays","novStartDate","novEndDate","novObservations"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        if (!state.novedadDraft) state.novedadDraft = {};
        state.novedadDraft.employeeId    = document.getElementById("novEmployeeId")?.value || "";
        state.novedadDraft.noveltyType   = document.getElementById("novType")?.value || "";
        state.novedadDraft.days          = document.getElementById("novDays")?.value || "";
        state.novedadDraft.startDate     = document.getElementById("novStartDate")?.value || "";
        state.novedadDraft.endDate       = document.getElementById("novEndDate")?.value || "";
        state.novedadDraft.observations  = document.getElementById("novObservations")?.value || "";
      });
      el.addEventListener("change", () => el.dispatchEvent(new Event("input")));
    });

    const btnGuardar = document.getElementById("btnGuardarNovedad");
    if (btnGuardar) {
      btnGuardar.addEventListener("click", async () => {
        const employeeId = document.getElementById("novEmployeeId")?.value;
        const noveltyType = document.getElementById("novType")?.value;
        const startDate = document.getElementById("novStartDate")?.value;
        if (!employeeId) { showWarning("Selecciona un empleado."); return; }
        if (!noveltyType) { showWarning("Selecciona el tipo de novedad."); return; }
        if (!startDate)   { showWarning("La fecha de inicio es obligatoria."); return; }
        btnGuardar.disabled = true;
        btnGuardar.textContent = "Guardando...";
        try {
          await apiFetch("/payroll/novelties", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId,
              noveltyType,
              startDate,
              endDate:      document.getElementById("novEndDate")?.value || null,
              days:         document.getElementById("novDays")?.value    || null,
              observations: document.getElementById("novObservations")?.value || "",
            })
          });
          state.novedadDraft = {};
          showSuccess("La novedad fue registrada correctamente.", "Novedad guardada");
          state.activeSubmodule = "consultar_novedades";
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "No fue posible guardar la novedad.");
          btnGuardar.disabled = false;
          btnGuardar.textContent = "Guardar novedad";
        }
      });
    }

    const btnCancel = document.getElementById("btnCancelNovedad");
    if (btnCancel) {
      btnCancel.addEventListener("click", async () => {
        state.novedadDraft = {};
        state.activeSubmodule = "consultar_novedades";
        await openModule("nomina_novedades");
      });
    }
  }, 0);
}

// ============================================================
// NOMINA Y NOVEDADES - Consultar novedades
// ============================================================
async function loadConsultarNovedadesModule() {
  let novedades = [];
  try {
    const res = await apiFetch("/payroll/novelties");
    novedades = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    return `<article class="info-card"><h3>Error</h3><p>${escapeHtml(e.message)}</p></article>`;
  }

  const f = state.novedadFilters || {};

  const normalize = (v) => String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();

  const filtered = novedades.filter(n => {
    if (f.type   && n.noveltyType !== f.type)                          return false;
    if (f.status && n.status      !== f.status)                        return false;
    if (f.search && !normalize(`${n.employeeName} ${n.documentNumber}`).includes(normalize(f.search))) return false;
    return true;
  });

  const statusBadge = (s) => {
    const map = {
      PENDIENTE: ["badge-pendiente", "Pendiente"],
      APROBADA:  ["badge-aprobada",  "Aprobada"],
      RECHAZADA: ["badge-rechazada", "Rechazada"],
      ANULADA:   ["badge-anulada",   "Anulada"],
    };
    const [cls, label] = map[s] || ["badge-pendiente", s];
    return `<span class="novelty-badge ${cls}">${label}</span>`;
  };

  const typeLabel = (t) => ({
    INCAPACIDAD:"Incapacidad", VACACIONES:"Vacaciones",
    LICENCIA_REMUNERADA:"Lic. remunerada", LICENCIA_NO_REMUNERADA:"Lic. no remunerada",
    SUSPENSION:"Suspensión", AUSENCIA:"Ausencia", CAMBIO_CARGO:"Cambio cargo",
    CAMBIO_SALARIO:"Cambio salario", OTRO:"Otro",
  }[t] || t);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CO") : "-";

  return `
    <div class="payroll-module-wrap">
      <div class="payroll-header">
        <div>
          <span class="payroll-eyebrow">Nómina y Novedades</span>
          <h2>Consultar novedades</h2>
          <p>${filtered.length} de ${novedades.length} novedades registradas</p>
        </div>
        <button type="button" id="btnIrRegistrar" class="btn btn-primary">+ Registrar novedad</button>
      </div>

      <div class="payroll-filters">
        <input id="novSearchFilter" type="text" class="payroll-input" placeholder="Buscar empleado o documento..."
          value="${escapeAttr(f.search||"")}" style="max-width:260px" />
        <select id="novTypeFilter" class="payroll-select" style="max-width:200px">
          <option value="">Todos los tipos</option>
          <option value="INCAPACIDAD"           ${f.type==="INCAPACIDAD"           ?"selected":""}>Incapacidad</option>
          <option value="VACACIONES"            ${f.type==="VACACIONES"            ?"selected":""}>Vacaciones</option>
          <option value="LICENCIA_REMUNERADA"   ${f.type==="LICENCIA_REMUNERADA"   ?"selected":""}>Licencia remunerada</option>
          <option value="LICENCIA_NO_REMUNERADA"${f.type==="LICENCIA_NO_REMUNERADA"?"selected":""}>Licencia no remunerada</option>
          <option value="SUSPENSION"            ${f.type==="SUSPENSION"            ?"selected":""}>Suspensión</option>
          <option value="AUSENCIA"              ${f.type==="AUSENCIA"              ?"selected":""}>Ausencia</option>
          <option value="CAMBIO_CARGO"          ${f.type==="CAMBIO_CARGO"          ?"selected":""}>Cambio cargo</option>
          <option value="CAMBIO_SALARIO"        ${f.type==="CAMBIO_SALARIO"        ?"selected":""}>Cambio salario</option>
          <option value="OTRO"                  ${f.type==="OTRO"                  ?"selected":""}>Otro</option>
        </select>
        <select id="novStatusFilter" class="payroll-select" style="max-width:160px">
          <option value="">Todos los estados</option>
          <option value="PENDIENTE" ${f.status==="PENDIENTE"?"selected":""}>Pendiente</option>
          <option value="APROBADA"  ${f.status==="APROBADA" ?"selected":""}>Aprobada</option>
          <option value="RECHAZADA" ${f.status==="RECHAZADA"?"selected":""}>Rechazada</option>
          <option value="ANULADA"   ${f.status==="ANULADA"  ?"selected":""}>Anulada</option>
        </select>
        <button type="button" id="btnClearNovFilters" class="btn btn-secondary">Limpiar</button>
      </div>

      <div class="payroll-table-wrap">
        <table class="payroll-table">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Documento</th>
              <th>Tipo</th>
              <th>Fecha inicio</th>
              <th>Fecha fin</th>
              <th>Días</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map(n => `
              <tr>
                <td class="payroll-name-cell">${escapeHtml(n.employeeName)}</td>
                <td>${escapeHtml(n.documentNumber)}</td>
                <td><span class="novelty-type-chip">${typeLabel(n.noveltyType)}</span></td>
                <td>${fmtDate(n.startDate)}</td>
                <td>${fmtDate(n.endDate)}</td>
                <td>${n.days || "-"}</td>
                <td>${statusBadge(n.status)}</td>
                <td>
                  <div class="payroll-actions-cell">
                    ${n.status === "PENDIENTE" ? `
                      <button class="btn-aprobar" data-nov-id="${n.id}">Aprobar</button>
                      <button class="btn-rechazar" data-nov-id="${n.id}">Rechazar</button>
                    ` : ""}
                    ${n.status !== "ANULADA" && n.status !== "APROBADA" ? `
                      <button class="btn-anular" data-nov-id="${n.id}">Anular</button>
                    ` : ""}
                  </div>
                </td>
              </tr>
            `).join("") : `
              <tr><td colspan="8" class="payroll-empty">No hay novedades que coincidan con los filtros.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Wire events after render for Consultar Novedades
function wireConsultarNovedadesEvents() {
  setTimeout(() => {
    // Filtros
    const applyFilters = async () => {
      state.novedadFilters = {
        search: document.getElementById("novSearchFilter")?.value || "",
        type:   document.getElementById("novTypeFilter")?.value   || "",
        status: document.getElementById("novStatusFilter")?.value || "",
      };
      await openModule("nomina_novedades");
    };

    ["novSearchFilter","novTypeFilter","novStatusFilter"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", applyFilters);
    });

    const btnClear = document.getElementById("btnClearNovFilters");
    if (btnClear) {
      btnClear.addEventListener("click", async () => {
        state.novedadFilters = {};
        await openModule("nomina_novedades");
      });
    }

    const btnIrRegistrar = document.getElementById("btnIrRegistrar");
    if (btnIrRegistrar) {
      btnIrRegistrar.addEventListener("click", async () => {
        state.novedadDraft = {};
        state.activeSubmodule = "registrar_novedad";
        await openModule("nomina_novedades");
      });
    }

    // Aprobar
    document.querySelectorAll(".btn-aprobar").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.novId;
        try {
          await apiFetch(`/payroll/novelties/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "APROBADA" })
          });
          showSuccess("La novedad fue aprobada.", "Aprobada");
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "No fue posible aprobar la novedad.");
        }
      });
    });

    // Rechazar
    document.querySelectorAll(".btn-rechazar").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.novId;
        const notes = prompt("Motivo del rechazo (opcional):");
        try {
          await apiFetch(`/payroll/novelties/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "RECHAZADA", reviewNotes: notes || "" })
          });
          showWarning("La novedad fue rechazada.", "Rechazada");
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "No fue posible rechazar la novedad.");
        }
      });
    });

    // Anular
    document.querySelectorAll(".btn-anular").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.novId;
        if (!confirm("\xc2\xbfSeguro que deseas anular esta novedad?")) return;
        try {
          await apiFetch(`/payroll/novelties/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ANULADA" })
          });
          showInfo("La novedad fue anulada.", "Anulada");
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "No fue posible anular la novedad.");
        }
      });
    });
  }, 0);
}

// ============================================================
// NOMINA Y NOVEDADES - Desprendibles de pago
// ============================================================
async function loadDesprendiblesModule() {
  let personnel = [];
  let novedades = [];
  try {
    const pp = await apiFetch("/personnel");
    personnel = Array.isArray(pp.data) ? pp.data : [];
    const nn = await apiFetch("/payroll/novelties");
    novedades = Array.isArray(nn.data) ? nn.data : [];
  } catch (e) {
    return `<article class="info-card"><h3>Error</h3><p>${escapeHtml(e.message)}</p></article>`;
  }

  const d = state.desprendibleDraft || {};
  const activeEmployees = personnel.filter(e => {
    const s = String(e.status || e.estado || "").toUpperCase();
    return s === "ACTIVO" || s === "ACTIVE";
  });

  const months = [
    { v: "01", l: "Enero" }, { v: "02", l: "Febrero" }, { v: "03", l: "Marzo" },
    { v: "04", l: "Abril" }, { v: "05", l: "Mayo" },    { v: "06", l: "Junio" },
    { v: "07", l: "Julio" }, { v: "08", l: "Agosto" },  { v: "09", l: "Septiembre" },
    { v: "10", l: "Octubre" },{ v: "11", l: "Noviembre"},{ v: "12", l: "Diciembre" },
  ];
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear].map(String);

  let preview = "";
  if (d.employeeId && d.month && d.year) {
    const emp = personnel.find(e => String(e.id) === String(d.employeeId));
    if (emp) {
      const periodStart = `${d.year}-${d.month}-01`;
      const periodEnd = new Date(Number(d.year), Number(d.month), 0).toISOString().slice(0, 10);
      const empNovedades = novedades.filter(n =>
        String(n.employeeId) === String(d.employeeId) &&
        n.startDate && n.startDate.slice(0, 7) === `${d.year}-${d.month}`
      );
      const monthLabel = months.find(m => m.v === d.month)?.l || d.month;
      const empName = emp.fullName || emp.full_name || "";
      const empDoc = emp.documentNumber || emp.document_number || "";
      const empPos = emp.realPosition || emp.real_position || emp.offeredPosition || emp.offered_position || "Operario Manipulador";
      const empMun = emp.educationalMunicipality || emp.educational_municipality || emp.municipio || "";

      const typeLabel = (t) => ({
        INCAPACIDAD: "Incapacidad", VACACIONES: "Vacaciones",
        LICENCIA_REMUNERADA: "Licencia remunerada", LICENCIA_NO_REMUNERADA: "Licencia no remunerada",
        SUSPENSION: "Suspensión", AUSENCIA: "Ausencia injustificada",
        CAMBIO_CARGO: "Cambio de cargo", CAMBIO_SALARIO: "Cambio de salario", OTRO: "Otro",
      }[t] || t);

      const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CO") : "-";

      preview = `
        <div class="desp-preview" id="desprendiblePrint">
          <div class="desp-header-print">
            <div class="desp-empresa">EMPIRIA — Gestión de Personal</div>
            <div class="desp-titulo">Desprendible de Novedades de Nómina</div>
            <div class="desp-periodo">Período: ${monthLabel} ${d.year}</div>
          </div>
          <div class="desp-info-grid">
            <div><span class="desp-label">Empleado:</span> ${escapeHtml(empName)}</div>
            <div><span class="desp-label">Documento:</span> ${escapeHtml(empDoc)}</div>
            <div><span class="desp-label">Cargo:</span> ${escapeHtml(empPos)}</div>
            <div><span class="desp-label">Municipio:</span> ${escapeHtml(empMun)}</div>
            <div><span class="desp-label">Período:</span> ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}</div>
          </div>
          ${empNovedades.length ? `
            <table class="desp-table">
              <thead>
                <tr><th>Tipo de novedad</th><th>Fecha inicio</th><th>Fecha fin</th><th>Días</th><th>Estado</th><th>Observaciones</th></tr>
              </thead>
              <tbody>
                ${empNovedades.map(n => `
                  <tr>
                    <td>${typeLabel(n.noveltyType)}</td>
                    <td>${fmtDate(n.startDate)}</td>
                    <td>${fmtDate(n.endDate)}</td>
                    <td>${n.days || "-"}</td>
                    <td>${n.status}</td>
                    <td>${escapeHtml(n.observations || "-")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<p class="desp-empty">No hay novedades registradas en este período.</p>`}
          <div class="desp-firma-grid">
            <div class="desp-firma-box"><div class="desp-firma-line"></div><p>Firma empleado</p></div>
            <div class="desp-firma-box"><div class="desp-firma-line"></div><p>Firma Talento Humano</p></div>
          </div>
          <div class="desp-generado">Generado el ${new Date().toLocaleDateString("es-CO")} — EMPIRIA</div>
        </div>
        <div class="desp-actions">
          <button id="btnImprimirDesp" class="btn btn-primary">Imprimir / Exportar PDF</button>
        </div>
      `;
    }
  }

  return `
    <div class="payroll-module-wrap">
      <div class="payroll-header">
        <div>
          <span class="payroll-eyebrow">Nómina y Novedades</span>
          <h2>Desprendibles de pago</h2>
          <p>Genera el desprendible de novedades de nómina por empleado y período.</p>
        </div>
      </div>
      <div class="payroll-form-card">
        <div class="payroll-form-grid">
          <div class="payroll-field">
            <label class="payroll-label">Empleado <span class="req">*</span></label>
            <select id="despEmpId" class="payroll-select">
              <option value="">Selecciona empleado</option>
              ${activeEmployees.map(e => {
                const name = e.fullName || e.full_name || "";
                const doc = e.documentNumber || e.document_number || "";
                return `<option value="${escapeAttr(e.id)}" ${String(d.employeeId) === String(e.id) ? "selected" : ""}>${escapeHtml(name)} — ${escapeHtml(doc)}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="payroll-field">
            <label class="payroll-label">Mes <span class="req">*</span></label>
            <select id="despMonth" class="payroll-select">
              <option value="">Selecciona mes</option>
              ${months.map(m => `<option value="${m.v}" ${d.month === m.v ? "selected" : ""}>${m.l}</option>`).join("")}
            </select>
          </div>
          <div class="payroll-field">
            <label class="payroll-label">Año <span class="req">*</span></label>
            <select id="despYear" class="payroll-select">
              <option value="">Selecciona año</option>
              ${years.map(y => `<option value="${y}" ${d.year === y ? "selected" : ""}>${y}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="payroll-form-actions">
          <button id="btnGenerarDesp" class="btn btn-primary">Generar desprendible</button>
        </div>
      </div>
      ${preview}
    </div>
  `;
}

function wireDesprendiblesEvents() {
  setTimeout(() => {
    const btnGenerar = document.getElementById("btnGenerarDesp");
    if (btnGenerar) {
      btnGenerar.addEventListener("click", async () => {
        const empId = document.getElementById("despEmpId")?.value;
        const month = document.getElementById("despMonth")?.value;
        const year = document.getElementById("despYear")?.value;
        if (!empId) { showWarning("Selecciona un empleado."); return; }
        if (!month) { showWarning("Selecciona el mes."); return; }
        if (!year) { showWarning("Selecciona el año."); return; }
        if (!state.desprendibleDraft) state.desprendibleDraft = {};
        state.desprendibleDraft = { employeeId: empId, month, year };
        await openModule("nomina_novedades");
      });
    }

    const btnImprimir = document.getElementById("btnImprimirDesp");
    if (btnImprimir) {
      btnImprimir.addEventListener("click", () => {
        window.print();
      });
    }

    ["despEmpId", "despMonth", "despYear"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        if (!state.desprendibleDraft) state.desprendibleDraft = {};
        state.desprendibleDraft.employeeId = document.getElementById("despEmpId")?.value || "";
        state.desprendibleDraft.month = document.getElementById("despMonth")?.value || "";
        state.desprendibleDraft.year = document.getElementById("despYear")?.value || "";
      });
    });
  }, 0);
}

// ============================================================
// NOMINA Y NOVEDADES - Certificaciones laborales
// ============================================================
async function loadCertificacionesModule() {
  let personnel = [];
  try {
    const pp = await apiFetch("/personnel");
    personnel = Array.isArray(pp.data) ? pp.data : [];
  } catch (e) {
    return `<article class="info-card"><h3>Error</h3><p>${escapeHtml(e.message)}</p></article>`;
  }

  const d = state.certDraft || {};

  let preview = "";
  if (d.employeeId) {
    const emp = personnel.find(e => String(e.id) === String(d.employeeId));
    if (emp) {
      const empName = emp.fullName || emp.full_name || "";
      const empDoc = emp.documentNumber || emp.document_number || "";
      const empPos = emp.realPosition || emp.real_position || emp.offeredPosition || emp.offered_position || "Operario Manipulador de Alimentos";
      const empMun = emp.educationalMunicipality || emp.educational_municipality || emp.municipio || "";
      const empInst = emp.institution || emp.institucion || "";
      const empSite = emp.site || emp.sede || "";
      const empStatus = (emp.status || emp.estado || "").toUpperCase();
      const isActive = empStatus === "ACTIVO" || empStatus === "ACTIVE";
      const empCompany = emp.company || emp.empresa || emp.companyName || "";
      const today = new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

      preview = `
        <div class="cert-preview" id="certPrint">
          <div class="cert-membrete">
            <div class="cert-empresa-nombre">EMPIRIA — Gestión de Personal</div>
            <div class="cert-titulo">CERTIFICACIÓN LABORAL</div>
          </div>
          <div class="cert-ciudad">Bogotá D.C., ${today}</div>
          <div class="cert-cuerpo">
            <p>A quien corresponda,</p>
            <p>
              La empresa <strong>${escapeHtml(empCompany || "EMPIRIA")}</strong> certifica que el(la) señor(a)
              <strong>${escapeHtml(empName)}</strong>, identificado(a) con cédula de ciudadanía
              N.° <strong>${escapeHtml(empDoc)}</strong>, ${isActive
                ? `<strong>se encuentra vinculado(a)</strong> laboralmente en calidad de <strong>${escapeHtml(empPos)}</strong>`
                : `<strong>estuvo vinculado(a)</strong> laboralmente en calidad de <strong>${escapeHtml(empPos)}</strong>`
              }${empMun ? `, prestando sus servicios en el municipio de <strong>${escapeHtml(empMun)}</strong>` : ""}${empInst ? `, en la institución <strong>${escapeHtml(empInst)}</strong>` : ""}${empSite ? `, sede <strong>${escapeHtml(empSite)}</strong>` : ""}.
            </p>
            <p>
              Estado actual del vínculo laboral: <strong>${isActive ? "ACTIVO" : "INACTIVO"}</strong>.
            </p>
            <p>La presente certificación se expide a solicitud del interesado para los fines que estime convenientes.</p>
          </div>
          <div class="cert-firma-grid">
            <div class="cert-firma-box">
              <div class="cert-firma-line"></div>
              <p><strong>Firma autorizada</strong></p>
              <p>Talento Humano</p>
              <p>EMPIRIA</p>
            </div>
          </div>
          <div class="cert-generado">Documento generado el ${today} — EMPIRIA Sistema de Gestión</div>
        </div>
        <div class="desp-actions">
          <button id="btnImprimirCert" class="btn btn-primary">Imprimir / Exportar PDF</button>
        </div>
      `;
    }
  }

  return `
    <div class="payroll-module-wrap">
      <div class="payroll-header">
        <div>
          <span class="payroll-eyebrow">Nómina y Novedades</span>
          <h2>Certificaciones laborales</h2>
          <p>Genera certificaciones laborales para los empleados.</p>
        </div>
      </div>
      <div class="payroll-form-card">
        <div class="payroll-form-grid">
          <div class="payroll-field full-width">
            <label class="payroll-label">Empleado <span class="req">*</span></label>
            <select id="certEmpId" class="payroll-select">
              <option value="">Selecciona empleado</option>
              ${personnel.map(e => {
                const name = e.fullName || e.full_name || "";
                const doc = e.documentNumber || e.document_number || "";
                const st = (e.status || e.estado || "").toUpperCase();
                const active = st === "ACTIVO" || st === "ACTIVE";
                return `<option value="${escapeAttr(e.id)}" ${String(d.employeeId) === String(e.id) ? "selected" : ""}>${escapeHtml(name)} — ${escapeHtml(doc)} ${active ? "" : "(Inactivo)"}</option>`;
              }).join("")}
            </select>
          </div>
        </div>
        <div class="payroll-form-actions">
          <button id="btnGenerarCert" class="btn btn-primary">Generar certificación</button>
        </div>
      </div>
      ${preview}
    </div>
  `;
}

function wireCertificacionesEvents() {
  setTimeout(() => {
    const btnGenerar = document.getElementById("btnGenerarCert");
    if (btnGenerar) {
      btnGenerar.addEventListener("click", async () => {
        const empId = document.getElementById("certEmpId")?.value;
        if (!empId) { showWarning("Selecciona un empleado."); return; }
        state.certDraft = { employeeId: empId };
        await openModule("nomina_novedades");
      });
    }

    const btnImprimir = document.getElementById("btnImprimirCert");
    if (btnImprimir) {
      btnImprimir.addEventListener("click", () => {
        window.print();
      });
    }

    const certEmpEl = document.getElementById("certEmpId");
    if (certEmpEl) {
      certEmpEl.addEventListener("change", () => {
        if (!state.certDraft) state.certDraft = {};
        state.certDraft.employeeId = certEmpEl.value;
      });
    }
  }, 0);
}

  // ─────────────────────────────
  // CAPACITACIONES
  // ─────────────────────────────
  if (moduleKey === "capacitaciones_asistencia") {
    if (submoduleKey === "programar_capacitacion") {
      return await loadTrainingsModule();
    }

    if (submoduleKey === "registrar_asistencia") {
      return await loadTrainingAttendanceModule();
    }

    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio quedará enfocado en la gestión de capacitación y trazabilidad.</p>
      </article>
    `;
  }

  // ─────────────────────────────
  // REPORTES
  // ─────────────────────────────
  if (moduleKey === "informes_reportes") {
    return await loadReportsModule();
  }

  // ─────────────────────────────
  // SOLICITUDES
  // ─────────────────────────────
  if (moduleKey === "solicitudes_empleados") {
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Este espacio quedará dedicado a la atención de solicitudes del empleado.</p>
      </article>
    `;
  }

  // ─────────────────────────────
  // ADMIN
  // ─────────────────────────────
  if (moduleKey === "administracion_configuraciones") {
    if (submoduleKey === "gestion_usuarios") {
      return `
        <article class="info-card">
          <h3>Gestión de usuarios</h3>
          <p>Usa los paneles administrativos para crear, editar y administrar usuarios del sistema.</p>
        </article>
      `;
    }

    if (submoduleKey === "roles_permisos") {
      return `
        <article class="info-card">
          <h3>Roles y permisos</h3>
          <p>Este espacio quedará dedicado a la configuración fina de accesos por rol y módulo.</p>
        </article>
      `;
    }

    if (submoduleKey === "probar_acceso") {
      return `
        <article class="info-card">
          <h3>Probar acceso</h3>
          <p>Usa el panel de validación de acceso para simular permisos y verificar restricciones.</p>
        </article>
      `;
    }

    if (submoduleKey === "auditoria") {
      return `
        <article class="info-card">
          <h3>Auditoría</h3>
          <p>Este espacio quedará reservado para la trazabilidad de acciones sensibles del sistema.</p>
        </article>
      `;
    }

    if (submoduleKey === "bloqueos") {
      return `
        <article class="info-card">
          <h3>Bloqueos</h3>
          <p>Este espacio quedará dedicado a revisar bloqueos, intentos fallidos y desbloqueos manuales.</p>
        </article>
      `;
    }
  }

  // ─────────────────────────────
  // DEFAULT
  // ─────────────────────────────
  return `
    <article class="info-card">
      <h3>${prettyLabel(submoduleKey)}</h3>
      <p>Espacio disponible para desarrollo.</p>
    </article>
  `;
}

async function loadCoverageModule() {
  let historyPayload;

  try {
    historyPayload = await apiFetch("/coverage/history");
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en cobertura</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }

  const history = Array.isArray(historyPayload.data) ? historyPayload.data : [];
  let personnelPayload = { data: [] };

  try {
    personnelPayload = await apiFetch("/personnel");
  } catch {
    personnelPayload = { data: [] };
  }

  const personnelRows = Array.isArray(personnelPayload.data)
    ? personnelPayload.data
    : [];

  let novedadesData = [];
  try {
    const novPayload = await apiFetch("/novedades");
    novedadesData = Array.isArray(novPayload.data) ? novPayload.data : [];
  } catch { novedadesData = []; }

  const selectedUploadId =
    state.coverageSelectedUploadId || (history[0]?.id ? String(history[0].id) : "");

  let selectedRows = [];

  if (selectedUploadId) {
    try {
      const rowsPayload = await apiFetch(`/coverage/upload/${selectedUploadId}`);
      selectedRows = Array.isArray(rowsPayload.data) ? rowsPayload.data : [];
    } catch {
      selectedRows = [];
    }
  }

  const selectedUpload = history.find(
    (item) => String(item.id) === String(selectedUploadId)
  );

  const formatNumber = (value) =>
    new Intl.NumberFormat("es-CO").format(Number(value || 0));

  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

  const getCoveragePersonnelForRow = (row) => {
    return personnelRows.filter((employee) => {
      const isActive = normalize(employee.status || employee.estado) === "ACTIVO";

      const isManipulator = normalize(
        employee.cargo_real || employee.real_position || employee.position
      ).includes("OPERARIO MANIPULADOR DE ALIMENTOS");

      // Municipio: comparar tanto residencia como municipio institucional
      const empMunicipality = normalize(
        employee.educationalMunicipality ||
        employee.educational_municipality ||
        employee.municipio_institucional ||
        getPersonnelMunicipality(employee)
      );
      const sameMunicipality = empMunicipality === normalize(row.municipality);

      // Institucion: multiples aliases de campo
      const empInstitution = normalize(
        employee.institution ||
        employee.institucion_educativa ||
        employee.educational_institution ||
        employee.institutionName ||
        ""
      );
      const sameInstitution = empInstitution === normalize(row.institution);

      // Sede: multiples aliases
      const empSite = normalize(
        employee.site ||
        employee.sede_educativa ||
        employee.educational_site ||
        employee.siteName ||
        ""
      );
      const sameSite = empSite === normalize(row.site);

      // Modalidad: multiples aliases
      const empModality = normalize(
        employee.educationalModality ||
        employee.modalidad ||
        employee.modality ||
        employee.modalidad_educativa ||
        ""
      );
      const sameModality = empModality === normalize(row.modality);

      return (
        isActive &&
        isManipulator &&
        sameMunicipality &&
        sameInstitution &&
        sameSite &&
        sameModality
      );
    });
  };

  const getEmployeeWorkTimeType = (employee = {}) => {
    const value = normalize(`
      ${employee.workTimeType || ""}
      ${employee.work_time_type || ""}
      ${employee.tipo_tiempo || ""}
      ${employee.jornada || ""}
      ${employee.tipo_jornada || ""}
      ${employee.contractTime || ""}
      ${employee.contractType || ""}
      ${employee.tipo_contrato || ""}
    `);

    if (
      value.includes("MT") ||
      value.includes("MEDIO") ||
      value.includes("MEDIA JORNADA") ||
      value.includes("MEDIO TIEMPO")
    ) {
      return "MT";
    }

    return "TC";
  };

  const getCoverageRisk = (tcDifference, mtDifference) => {
    if (tcDifference < 0 || mtDifference < 0) {
      const totalMissing =
        Math.abs(Math.min(tcDifference, 0)) +
        Math.abs(Math.min(mtDifference, 0));

      return totalMissing >= 2 ? "ALTO" : "MEDIO";
    }

    if (tcDifference > 2 || mtDifference > 2) return "MEDIO";

    return "BAJO";
  };

  const getLiveCoverageCounts = (row) => {
    const linkedPersonnel = getCoveragePersonnelForRow(row);

    const contractedTc = linkedPersonnel.filter(
      (employee) => getEmployeeWorkTimeType(employee) === "TC"
    ).length;

    const contractedMt = linkedPersonnel.filter(
      (employee) => getEmployeeWorkTimeType(employee) === "MT"
    ).length;

    const requiredTc = Number(row.required_tc || 0);
    const requiredMt = Number(row.required_mt || 0);

    const tcDifference = contractedTc - requiredTc;
    const mtDifference = contractedMt - requiredMt;

    let coverageStatus = "EXACTO";

    if (tcDifference < 0 || mtDifference < 0) {
      coverageStatus = "FALTANTE";
    } else if (tcDifference > 0 || mtDifference > 0) {
      coverageStatus = "SOBRANTE";
    }

    return {
      contractedTc,
      contractedMt,
      tcDifference,
      mtDifference,
      coverageStatus,
      coverageRisk: getCoverageRisk(tcDifference, mtDifference),
    };
  };

  const coverageFilters = state.coverageFilters || {};

  const coverageSearch = coverageFilters.coverageSearch || "";
  const coverageMunicipality = coverageFilters.coverageFilterMunicipality || "";
  const coverageModality = coverageFilters.coverageFilterModality || "";
  const coverageChange = coverageFilters.coverageFilterChange || "";
  const coverageStatus = coverageFilters.coverageFilterStatus || "";

  const rowsWithRequirement = selectedRows.filter((row) => {
    const requiredTc = Number(row.required_tc || 0);
    const requiredMt = Number(row.required_mt || 0);
    return requiredTc > 0 || requiredMt > 0;
  });

  const rowsWithLiveCoverage = rowsWithRequirement.map((row) => ({
    ...row,
    liveCoverage: getLiveCoverageCounts(row),
  }));

  const totalCupos = rowsWithRequirement.reduce(
    (sum, row) => sum + Number(row.cupos || 0),
    0
  );

  const totalRequiredTc = rowsWithRequirement.reduce(
    (sum, row) => sum + Number(row.required_tc || 0),
    0
  );

  const totalRequiredMt = rowsWithRequirement.reduce(
    (sum, row) => sum + Number(row.required_mt || 0),
    0
  );

  const totalContractedTc = rowsWithLiveCoverage.reduce(
    (sum, row) => sum + row.liveCoverage.contractedTc,
    0
  );

  const totalContractedMt = rowsWithLiveCoverage.reduce(
    (sum, row) => sum + row.liveCoverage.contractedMt,
    0
  );

  const missingCount = rowsWithLiveCoverage.filter(
    (row) => row.liveCoverage.coverageStatus === "FALTANTE"
  ).length;

  const exactCount = rowsWithLiveCoverage.filter(
    (row) => row.liveCoverage.coverageStatus === "EXACTO"
  ).length;

  const extraCount = rowsWithLiveCoverage.filter(
    (row) => row.liveCoverage.coverageStatus === "SOBRANTE"
  ).length;

  const highRiskCount = rowsWithLiveCoverage.filter(
    (row) => row.liveCoverage.coverageRisk === "ALTO"
  ).length;

  const updatedCount = rowsWithRequirement.filter(
    (row) => row.update_origin === "ACTUALIZADO"
  ).length;

  const inheritedCount = rowsWithRequirement.filter(
    (row) => row.update_origin === "HEREDADO"
  ).length;

  const municipalityOptions = Array.from(
    new Set(rowsWithRequirement.map((row) => row.municipality).filter(Boolean))
  ).sort();

  const modalityOptions = Array.from(
    new Set(rowsWithRequirement.map((row) => row.modality).filter(Boolean))
  ).sort();

  const filteredRows = rowsWithLiveCoverage.filter((row) => {
    const live = row.liveCoverage;

    const fullText = normalize(`
      ${row.unique_code}
      ${row.municipality}
      ${row.institution}
      ${row.site}
      ${row.modality}
      ${row.update_origin}
      ${live.coverageStatus}
      ${live.coverageRisk}
    `);

    if (coverageSearch && !fullText.includes(normalize(coverageSearch))) return false;
    if (coverageMunicipality && normalize(row.municipality) !== normalize(coverageMunicipality)) return false;
    if (coverageModality && normalize(row.modality) !== normalize(coverageModality)) return false;
    if (coverageChange && normalize(row.change_status) !== normalize(coverageChange)) return false;
    if (coverageStatus && normalize(live.coverageStatus) !== normalize(coverageStatus)) return false;

    return true;
  });

  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getModalityClass = (value) => {
    const modality = normalize(value);
    if (modality.includes("RI")) return "modality-ri";
    if (modality.includes("CAARES")) return "modality-caares";
    if (modality.includes("CAA")) return "modality-caa";
    return "modality-default";
  };

  const getChangeLabel = (value, cuposDelta = null) => {
    const status = normalize(value);
    const delta = Number(cuposDelta || 0);

    if (status === "SUBIO") return delta > 0 ? `Subió +${formatNumber(delta)}` : "Subió";
    if (status === "BAJO") return delta < 0 ? `Bajó ${formatNumber(delta)}` : "Bajó";
    if (status === "SIN_CAMBIO") return "Sin cambio";

    return "Sin comparación";
  };

  const getChangeClass = (value) => {
    const status = normalize(value);

    if (status === "SUBIO") return "change-up";
    if (status === "BAJO") return "change-down";
    if (status === "SIN_CAMBIO") return "change-same";

    return "change-none";
  };

  const getCoverageStatusClass = (value) => {
    const status = normalize(value);

    if (status === "EXACTO") return "coverage-exacto";
    if (status === "FALTANTE") return "coverage-faltante";
    if (status === "SOBRANTE") return "coverage-sobrante";

    return "coverage-none";
  };

  const getCoverageRiskClass = (value) => {
    const risk = normalize(value);

    if (risk === "ALTO") return "risk-alto";
    if (risk === "MEDIO") return "risk-medio";

    return "risk-bajo";
  };

  const getCoverageStatusLabel = (value) => {
    const status = normalize(value);

    if (status === "FALTANTE") return "FALTANTE";
    if (status === "SOBRANTE") return "SOBRANTE";
    if (status === "EXACTO") return "EXACTO";

    return "SIN ESTADO";
  };

  const getSelectedPeriodLabel = () => {
    if (!selectedUpload) return "Sin archivo seleccionado";
    return `Semana ${selectedUpload.week_number || "-"} · ${
      selectedUpload.period_month || "Sin mes"
    }`;
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
    });

  setTimeout(() => {
    const uploadBtn = document.getElementById("btnUploadCoverageExcel");
    const fileInput = document.getElementById("coverageExcelFile");
    const periodInput = document.getElementById("coveragePeriodMonth");
    const weekInput = document.getElementById("coverageWeekNumber");
    const clearBtn = document.getElementById("clearCoverageFilters");
    const exportBtn = document.getElementById("btnExportCoverageExcel");
    const onlyMissingBtn = document.getElementById("btnOnlyMissingCoverage");

    let coverageSearchTimer = null;

    const applyCoverageFilters = async () => {
      state.coverageFilters = {
        coverageSearch:             document.getElementById("coverageSearch")?.value || "",
        coverageFilterMunicipality: document.getElementById("coverageFilterMunicipality")?.value || "",
        coverageFilterModality:     document.getElementById("coverageFilterModality")?.value || "",
        coverageFilterStatus:       document.getElementById("coverageFilterStatus")?.value || "",
        coverageFilterChange:       document.getElementById("coverageFilterChange")?.value || "",
      };
      await openModule("cobertura_calculadora");
    };

    const coverageSearchEl = document.getElementById("coverageSearch");
    if (coverageSearchEl) {
      coverageSearchEl.addEventListener("input", () => {
        clearTimeout(coverageSearchTimer);
        coverageSearchTimer = setTimeout(applyCoverageFilters, 400);
      });
    }

    [
      document.getElementById("coverageFilterMunicipality"),
      document.getElementById("coverageFilterModality"),
      document.getElementById("coverageFilterStatus"),
      document.getElementById("coverageFilterChange"),
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", applyCoverageFilters);
    });

    if (onlyMissingBtn) {
      onlyMissingBtn.addEventListener("click", async () => {
        const currentStatus = state.coverageFilters?.coverageFilterStatus || "";

        state.coverageFilters = {
          ...(state.coverageFilters || {}),
          coverageFilterStatus:
            normalize(currentStatus) === "FALTANTE" ? "" : "FALTANTE",
        };

        await openModule("cobertura_calculadora");
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        state.coverageFilters = {
          coverageSearch: "",
          coverageFilterMunicipality: "",
          coverageFilterModality: "",
          coverageFilterStatus: "",
          coverageFilterChange: "",
        };

        await openModule("cobertura_calculadora");
      });
    }

    document.querySelectorAll("[data-coverage-upload-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.coverageSelectedUploadId = button.dataset.coverageUploadId;
        await openModule("cobertura_calculadora");
      });
    });

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const table = document.querySelector(".coverage-table");

        if (!table) {
          showWarning("No hay datos para exportar.")
          return;
        }

        const html = `
          <html>
            <head>
              <meta charset="UTF-8" />
            </head>
            <body>
              ${table.outerHTML}
            </body>
          </html>
        `;

        const blob = new Blob([html], {
          type: "application/vnd.ms-excel;charset=utf-8;",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `verificacion_cobertura_${new Date()
          .toISOString()
          .slice(0, 10)}.xls`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
      });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener("click", async () => {
        if (!fileInput || !fileInput.files || !fileInput.files.length) {
          showWarning("Selecciona un archivo Excel.")
          return;
        }

        const file = fileInput.files[0];
        const lowerName = file.name.toLowerCase();

        if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
          showWarning("Solo se permiten archivos Excel (.xlsx o .xls).")
          return;
        }

        const periodMonth = periodInput?.value || "";
        const weekNumber = weekInput?.value || "";

        if (!periodMonth) {
          showWarning("Selecciona el mes de cobertura.")
          return;
        }

        if (!weekNumber) {
          showWarning("Selecciona la semana o corte.")
          return;
        }

        try {
          uploadBtn.disabled = true;
          uploadBtn.textContent = "Procesando...";

          const fileBase64 = await fileToBase64(file);

          const result = await apiFetch("/coverage/upload", {
            method: "POST",
            body: JSON.stringify({
              fileBase64,
              fileName: file.name,
              periodMonth,
              weekNumber,
            }),
          });

          state.coverageSelectedUploadId = result?.data?.upload?.id
            ? String(result.data.upload.id)
            : null;

          state.coverageFilters = {
            coverageSearch: "",
            coverageFilterMunicipality: "",
            coverageFilterModality: "",
            coverageFilterStatus: "",
            coverageFilterChange: "",
          };

          await openModule("cobertura_calculadora");
        } catch (error) {
          showError(error.message || "No fue posible procesar el archivo.");
        } finally {
          uploadBtn.disabled = false;
          uploadBtn.textContent = "Subir y procesar";
        }
      });
    }

    // Tab switching
    document.querySelectorAll("[data-coverage-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.coverageActiveTab = btn.dataset.coverageTab;
        await openModule("cobertura_calculadora");
      });
    });

    // Add novedad — show form
    document.querySelectorAll(".btn-add-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.toggle("hidden");
        const detailWrap = document.getElementById(`novedad-detail-${empId}`);
        if (detailWrap) detailWrap.classList.add("hidden");
      });
    });

    // Cancel novedad
    document.querySelectorAll(".btn-cancel-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.cancelEmpId;
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.add("hidden");
      });
    });

    // Ver novedades toggle
    document.querySelectorAll(".btn-ver-novedades").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        const detailWrap = document.getElementById(`novedad-detail-${empId}`);
        if (detailWrap) detailWrap.classList.toggle("hidden");
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.add("hidden");
      });
    });

    // Submit novedad form
    document.querySelectorAll(".novedad-inline-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const empId = form.dataset.formEmpId;
        const row = form.closest(".novedad-emp-row");
        const type = form.querySelector("[name='type']")?.value || "";
        const date = form.querySelector("[name='date']")?.value || "";
        const description = form.querySelector("[name='description']")?.value || "";
        const fileInput = form.querySelector("[name='documentFile']");

        if (!type) { showWarning("Selecciona el tipo de novedad."); return; }

        let documentBase64 = null;
        let documentName = null;
        if (fileInput && fileInput.files && fileInput.files.length) {
          documentBase64 = await fileToBase64(fileInput.files[0]);
          documentName = fileInput.files[0].name;
        }

        const empName = row?.querySelector(".novedad-emp-name")?.textContent?.trim() || "";
        const munId = form.closest("[data-emp-id]")?.dataset?.empId
          ? document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadMunId || ""
          : "";
        const munName = document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadMunName || "";
        const cargo = document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadCargo || "";

        try {
          const submitBtn = form.querySelector("[type='submit']");
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Guardando..."; }

          await apiFetch("/novedades", {
            method: "POST",
            body: JSON.stringify({
              employeeId: empId,
              employeeName: empName,
              municipalityId: munId,
              municipalityName: munName,
              cargo,
              type,
              date,
              description,
              documentBase64,
              documentName,
            }),
          });

          await openModule("cobertura_calculadora");
        } catch (err) {
          showError(err.message || "Error al registrar la novedad.");
        }
      });
    });

    // Approve novedad
    document.querySelectorAll(".novedad-approve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novId = btn.dataset.novId;
        try {
          await apiFetch(`/novedades/${novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "APROBADO", reviewNote: "" }),
          });
          await openModule("cobertura_calculadora");
        } catch (err) {
          showError(err.message || "Error al aprobar.");
        }
      });
    });

    // Reject novedad
    document.querySelectorAll(".novedad-reject-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novId = btn.dataset.novId;
        const note = prompt("Motivo del rechazo (opcional):") || "";
        try {
          await apiFetch(`/novedades/${novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "RECHAZADO", reviewNote: note }),
          });
          await openModule("cobertura_calculadora");
        } catch (err) {
          showError(err.message || "Error al rechazar.");
        }
      });
    });
  }, 0);

  const coverageTab = state.coverageActiveTab || "cobertura";

  return `
    <div class="coverage-pro-module">
      <article class="coverage-pro-card">
        <section class="coverage-pro-header coverage-pro-header-v2">
          <div class="coverage-pro-header-copy">
            <span class="coverage-pro-eyebrow-badge">Cobertura PAE</span>
            <h2>Verificación de Cobertura</h2>
            <p>Sube archivos Excel por corte, conserva historial y compara cobertura requerida vs. personal contratado.</p>
          </div>

          <div class="coverage-pro-current coverage-pro-current-v2">
            <span>Archivo activo</span>
            <strong>${escapeHtml(getSelectedPeriodLabel())}</strong>
          </div>
        </section>

        <nav class="coverage-tab-nav">
          <button class="coverage-tab-btn ${coverageTab === 'cobertura' ? 'active' : ''}" data-coverage-tab="cobertura">
            Verificación de Cobertura
          </button>
          <button class="coverage-tab-btn ${coverageTab === 'novedades' ? 'active' : ''}" data-coverage-tab="novedades">
            Novedades del Personal
          </button>
        </nav>

        ${coverageTab === 'cobertura' ? `
        <section class="coverage-pro-upload">
          <div class="coverage-upload-copy">
            <h3>Subir archivo de cobertura</h3>
            <p>Columnas requeridas: Consecutivo Único, Municipio, Institución Educativa, Sede Educativa, Modalidad y Cupos Total.</p>
          </div>

          <div class="coverage-pro-upload-form">
            <input id="coveragePeriodMonth" type="month" />
            <select id="coverageWeekNumber">
              <option value="">Semana / corte</option>
              <option value="1">Semana 1</option>
              <option value="2">Semana 2</option>
              <option value="3">Semana 3</option>
              <option value="4">Semana 4</option>
              <option value="5">Semana 5</option>
            </select>
            <input id="coverageExcelFile" type="file" accept=".xlsx,.xls" />
            <button type="button" id="btnUploadCoverageExcel" class="btn btn-primary">
              Subir y procesar
            </button>
          </div>
        </section>

        <section class="coverage-pro-metrics">
          <div class="coverage-pro-metric main">
            <span>Total cupos</span>
            <strong>${formatNumber(totalCupos)}</strong>
          </div>

          <div class="coverage-pro-metric cov-danger">
            <span><i class="cov-dot cov-dot-danger"></i>Faltantes</span>
            <strong>${formatNumber(missingCount)}</strong>
          </div>

          <div class="coverage-pro-metric cov-warning">
            <span><i class="cov-dot cov-dot-warning"></i>Exactas</span>
            <strong>${formatNumber(exactCount)}</strong>
          </div>

          <div class="coverage-pro-metric cov-success">
            <span><i class="cov-dot cov-dot-success"></i>Sobrantes</span>
            <strong>${formatNumber(extraCount)}</strong>
          </div>

          <div class="coverage-pro-metric cov-alert">
            <span><i class="cov-dot cov-dot-alert"></i>Riesgo alto</span>
            <strong>${formatNumber(highRiskCount)}</strong>
          </div>

          <div class="coverage-pro-metric cov-neutral cov-metric-sm">
            <span>TC requerido</span>
            <strong>${formatNumber(totalRequiredTc)}</strong>
          </div>

          <div class="coverage-pro-metric cov-neutral cov-metric-sm">
            <span>MT requerido</span>
            <strong>${formatNumber(totalRequiredMt)}</strong>
          </div>

          <div class="coverage-pro-metric cov-blue cov-metric-sm">
            <span>TC contratado</span>
            <strong>${formatNumber(totalContractedTc)}</strong>
          </div>

          <div class="coverage-pro-metric cov-blue cov-metric-sm">
            <span>MT contratado</span>
            <strong>${formatNumber(totalContractedMt)}</strong>
          </div>
        </section>

        <section class="coverage-pro-detail coverage-pro-detail-full">
          <section class="coverage-history-horizontal">
            <div class="coverage-history-horizontal-head">
              <h3>Historial de archivos</h3>
              <span>${history.length}</span>
            </div>

            <div class="coverage-history-scroll">
              ${
                history.length
                  ? history
                      .map(
                        (item) => `
                          <button
                            type="button"
                            class="coverage-history-chip ${
                              String(item.id) === String(selectedUploadId) ? "active" : ""
                            }"
                            data-coverage-upload-id="${escapeAttr(item.id)}"
                          >
                            <strong>${escapeHtml(item.period_month || "Sin mes")}</strong>
                            <span>Semana ${escapeHtml(item.week_number || "-")}</span>
                            <small>${escapeHtml(formatDate(item.created_at))}</small>
                          </button>
                        `
                      )
                      .join("")
                  : `<p class="soft">Aún no hay archivos cargados.</p>`
              }
            </div>
          </section>

          <div class="coverage-pro-table-head">
            <div>
              <h3>Detalle procesado</h3>
              <p>${
                selectedUpload
                  ? escapeHtml(selectedUpload.original_file_name)
                  : "Selecciona o sube un archivo para ver el detalle."
              }</p>
              <small class="soft">
                ${formatNumber(updatedCount)} actualizadas · ${formatNumber(inheritedCount)} sin cambio
              </small>
            </div>

            <div class="coverage-table-actions">
              <span>${formatNumber(filteredRows.length)} registros</span>
              <button type="button" id="btnOnlyMissingCoverage" class="btn btn-secondary btn-row ${
                normalize(coverageStatus) === "FALTANTE" ? "active" : ""
              }">
                Solo faltantes
              </button>
              <button type="button" id="btnExportCoverageExcel" class="btn btn-secondary btn-row">
                Descargar Excel
              </button>
            </div>
          </div>

          <div class="coverage-filter-bar">
            <input
              id="coverageSearch"
              type="text"
              placeholder="Buscar municipio, institución, sede o consecutivo"
              value="${escapeAttr(coverageSearch)}"
            />

            <select id="coverageFilterMunicipality">
              <option value="">Municipio</option>
              ${municipalityOptions
                .map(
                  (value) => `
                    <option value="${escapeAttr(value)}" ${
                      normalize(coverageMunicipality) === normalize(value) ? "selected" : ""
                    }>
                      ${escapeHtml(value)}
                    </option>
                  `
                )
                .join("")}
            </select>

            <select id="coverageFilterModality">
              <option value="">Modalidad</option>
              ${modalityOptions
                .map(
                  (value) => `
                    <option value="${escapeAttr(value)}" ${
                      normalize(coverageModality) === normalize(value) ? "selected" : ""
                    }>
                      ${escapeHtml(value)}
                    </option>
                  `
                )
                .join("")}
            </select>

            <select id="coverageFilterStatus">
              <option value="">Estado cobertura</option>
              <option value="FALTANTE" ${normalize(coverageStatus) === "FALTANTE" ? "selected" : ""}>Solo faltantes</option>
              <option value="EXACTO" ${normalize(coverageStatus) === "EXACTO" ? "selected" : ""}>Exacto</option>
              <option value="SOBRANTE" ${normalize(coverageStatus) === "SOBRANTE" ? "selected" : ""}>Sobrante</option>
            </select>

            <select id="coverageFilterChange">
              <option value="">Cambio vs anterior</option>
              <option value="SUBIO" ${normalize(coverageChange) === "SUBIO" ? "selected" : ""}>Subió</option>
              <option value="BAJO" ${normalize(coverageChange) === "BAJO" ? "selected" : ""}>Bajó</option>
              <option value="SIN_CAMBIO" ${normalize(coverageChange) === "SIN_CAMBIO" ? "selected" : ""}>Sin cambio</option>
              <option value="SIN_COMPARACION" ${normalize(coverageChange) === "SIN_COMPARACION" ? "selected" : ""}>Sin comparación</option>
            </select>

            <button type="button" id="clearCoverageFilters" class="btn btn-secondary">
              Limpiar
            </button>
          </div>

          <div class="coverage-table-wrap">
            <table class="coverage-table">
              <thead>
                <tr>
                  <th>Municipio</th>
                  <th>Institución</th>
                  <th>Sede</th>
                  <th>Mod.</th>
                  <th>Cupos</th>
                  <th>TC Req.</th>
                  <th>MT Req.</th>
                  <th>TC Cont.</th>
                  <th>MT Cont.</th>
                  <th>Dif. TC</th>
                  <th>Dif. MT</th>
                  <th>Cobertura</th>
                  <th>Δ Cupos</th>
                  <th>Cambio</th>
                </tr>
              </thead>

              <tbody>
                ${
                  filteredRows.length
                    ? filteredRows
                        .map((row) => {
                          const modality = String(row.modality || "").toUpperCase().trim();
                          const live = row.liveCoverage;

                          const cuposDelta =
                            row.cupos_delta === null || row.cupos_delta === undefined
                              ? null
                              : Number(row.cupos_delta);

                          const rowCoverageClass = getCoverageStatusClass(live.coverageStatus);
                          const rowRiskClass = getCoverageRiskClass(live.coverageRisk);

                          return `
                            <tr class="${
                              row.update_origin === "HEREDADO"
                                ? "coverage-row-inherited"
                                : "coverage-row-updated"
                            } ${rowCoverageClass} ${rowRiskClass}">
                              <td>${escapeHtml(row.municipality)}</td>
                              <td class="td-strong">${escapeHtml(row.institution)}</td>
                              <td>${escapeHtml(row.site)}</td>

                              <td>
                                <span class="modality-chip ${getModalityClass(modality)}">
                                  ${escapeHtml(modality || "N/A")}
                                </span>
                              </td>

                              <td class="num">${formatNumber(row.cupos)}</td>
                              <td class="num">${formatNumber(row.required_tc)}</td>
                              <td class="num">${formatNumber(row.required_mt)}</td>
                              <td class="num">${formatNumber(live.contractedTc)}</td>
                              <td class="num">${formatNumber(live.contractedMt)}</td>
                              <td class="num">${formatNumber(live.tcDifference)}</td>
                              <td class="num">${formatNumber(live.mtDifference)}</td>

                              <td>
                                <span class="coverage-badge ${rowCoverageClass}">
                                  ${escapeHtml(getCoverageStatusLabel(live.coverageStatus))}
                                </span>
                              </td>

                              <td class="num">
                                ${cuposDelta === null ? "-" : formatNumber(cuposDelta)}
                              </td>

                              <td>
                                <span class="change ${getChangeClass(row.change_status)}">
                                  ${escapeHtml(getChangeLabel(row.change_status, cuposDelta))}
                                </span>
                              </td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `
                      <tr>
                        <td colspan="14" class="empty">
                          No hay registros que requieran personal para mostrar.
                        </td>
                      </tr>
                    `
                }
              </tbody>
            </table>
          </div>
        </section>
        ` : `
        <section class="novedades-section">
          <div class="novedades-toolbar">
            <h3>Personal — estado de novedades</h3>
            <span class="novedades-count-badge">${personnelRows.length} personas</span>
          </div>

          <div class="novedades-list">
            ${personnelRows.map(emp => {
              const empId = String(emp.id || "");
              const empNovedades = novedadesData.filter(n => String(n.employeeId) === empId);
              const hasNovedades = empNovedades.length > 0;
              const latestStatus = hasNovedades ? empNovedades[0].status : null;

              const statusColors = { PENDIENTE: "cov-warning", APROBADO: "cov-success", RECHAZADO: "cov-danger" };

              return `
                <div class="novedad-emp-row" data-emp-id="${escapeAttr(empId)}">
                  <div class="novedad-emp-info">
                    <span class="novedad-emp-name">${escapeHtml(getPersonnelFullName(emp))}</span>
                    <span class="novedad-emp-meta">${escapeHtml(getPersonnelMunicipality(emp))} · ${escapeHtml(getPersonnelRole(emp))}</span>
                  </div>

                  <div class="novedad-emp-status">
                    ${!hasNovedades
                      ? `<span class="novedad-badge novedad-badge-none">Sin novedad</span>`
                      : `<span class="novedad-badge ${statusColors[latestStatus] || ''}">${escapeHtml(latestStatus || "—")}</span>
                         <span class="novedad-count-label">${empNovedades.length} novedad${empNovedades.length !== 1 ? 'es' : ''}</span>`
                    }
                  </div>

                  <div class="novedad-emp-actions">
                    <button type="button" class="btn btn-secondary btn-row btn-add-novedad"
                      data-novedad-emp-id="${escapeAttr(empId)}"
                      data-novedad-emp-name="${escapeAttr(getPersonnelFullName(emp))}"
                      data-novedad-mun-id="${escapeAttr(String(emp.municipalityId || emp.municipality_id || ''))}"
                      data-novedad-mun-name="${escapeAttr(getPersonnelMunicipality(emp))}"
                      data-novedad-cargo="${escapeAttr(getPersonnelRole(emp))}">
                      + Novedad
                    </button>
                    ${hasNovedades
                      ? `<button type="button" class="btn btn-secondary btn-row btn-ver-novedades"
                           data-novedad-emp-id="${escapeAttr(empId)}">
                           Ver (${empNovedades.length})
                         </button>`
                      : ""}
                  </div>
                </div>

                <div class="novedad-form-wrap hidden" id="novedad-form-${escapeAttr(empId)}">
                  <form class="novedad-inline-form" data-form-emp-id="${escapeAttr(empId)}">
                    <div class="novedad-form-grid">
                      <label>
                        <span>Tipo</span>
                        <select name="type" required>
                          <option value="">Selecciona</option>
                          <option value="Ausencia">Ausencia</option>
                          <option value="Incapacidad">Incapacidad</option>
                          <option value="Licencia">Licencia</option>
                          <option value="Permiso">Permiso</option>
                          <option value="Reemplazo">Reemplazo</option>
                          <option value="Otro">Otro</option>
                        </select>
                      </label>
                      <label>
                        <span>Fecha</span>
                        <input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required />
                      </label>
                      <label class="novedad-form-full">
                        <span>Descripción</span>
                        <textarea name="description" rows="2" placeholder="Describe la novedad..."></textarea>
                      </label>
                      <label class="novedad-form-full">
                        <span>Documento soporte (PDF)</span>
                        <input name="documentFile" type="file" accept=".pdf" />
                      </label>
                    </div>
                    <div class="novedad-form-actions">
                      <button type="submit" class="btn btn-primary btn-row">Registrar</button>
                      <button type="button" class="btn btn-secondary btn-row btn-cancel-novedad" data-cancel-emp-id="${escapeAttr(empId)}">Cancelar</button>
                    </div>
                  </form>
                </div>

                <div class="novedad-detail-wrap hidden" id="novedad-detail-${escapeAttr(empId)}">
                  ${empNovedades.map(nov => `
                    <div class="novedad-detail-card ${(statusColors[nov.status] || 'cov-neutral')}">
                      <div class="novedad-detail-head">
                        <div>
                          <strong>${escapeHtml(nov.type || "Otro")}</strong>
                          <span class="novedad-detail-date">${escapeHtml(nov.date || "")}</span>
                        </div>
                        <span class="novedad-status-chip ${(statusColors[nov.status] || '')}">
                          ${escapeHtml(nov.status || "PENDIENTE")}
                        </span>
                      </div>
                      ${nov.description ? `<p class="novedad-detail-desc">${escapeHtml(nov.description)}</p>` : ""}
                      <div class="novedad-detail-meta">
                        <span>Registrado por: <strong>${escapeHtml(nov.registeredByName || nov.registeredBy || "—")}</strong></span>
                        ${nov.documentBase64
                          ? `<a href="${escapeAttr(nov.documentBase64)}" target="_blank" class="novedad-doc-link">Ver documento</a>`
                          : `<span class="novedad-no-doc">Sin documento</span>`}
                      </div>
                      ${nov.reviewNote ? `<p class="novedad-review-note">Nota revisión: ${escapeHtml(nov.reviewNote)}</p>` : ""}
                      ${nov.status === "PENDIENTE" ? `
                        <div class="novedad-review-actions">
                          <button type="button" class="btn btn-row novedad-approve-btn"
                            data-nov-id="${escapeAttr(String(nov.id))}">✓ Aprobar</button>
                          <button type="button" class="btn btn-row novedad-reject-btn"
                            data-nov-id="${escapeAttr(String(nov.id))}">✕ Rechazar</button>
                        </div>
                      ` : ""}
                    </div>
                  `).join("")}
                </div>
              `;
            }).join("")}
          </div>
        </section>
        `}
      </article>
    </div>
  `;
}

async function openModule(moduleKey) {
  state.activeModule = moduleKey;
  state.expandedModule = moduleKey;

  if (!state.access) {
    renderEmptyWorkspace();
    return;
  }

  const moduleConfig = state.access.modules.find((item) => item.module === moduleKey);
  if (!moduleConfig) {
    renderEmptyWorkspace();
    return;
  }

  const view = moduleViews[moduleKey] || {
    title: prettyLabel(moduleKey),
    submodules: [],
  };

  if (
    moduleKey !== "gestion_personal" &&
    !state.activeSubmodule &&
    view.submodules?.length
  ) {
    state.activeSubmodule = view.submodules[0].key;
  }

  syncAdminPanelsVisibility();
  renderModuleNav(state.access.modules);

  const activeSubmodule = view.submodules?.find(
    (item) => item.key === state.activeSubmodule
  );

  const hideWorkspaceHeader =
    moduleKey === "gestion_personal" ||
    moduleKey === "cobertura_calculadora";
    
  if (elements.workspace) {
    elements.workspace.innerHTML = hideWorkspaceHeader
      ? `
        <section class="submodule-content">
          <article class="info-card">
            <p>Cargando módulo...</p>
          </article>
        </section>
      `
      : `
        <h2 class="workspace-title">${view.title}</h2>
        ${activeSubmodule ? `<p class="subtitle workspace-subtitle">${activeSubmodule.title}</p>` : ""}
        <section class="submodule-content">
          <article class="info-card">
            <p>Cargando módulo...</p>
          </article>
        </section>
      `;
  }

  try {
    const submoduleContentHtml = await renderSubmoduleContent(
      moduleKey,
      state.activeSubmodule,
      moduleConfig
    );

    if (elements.workspace) {
      elements.workspace.innerHTML = hideWorkspaceHeader
        ? `
          <section class="submodule-content">
            ${submoduleContentHtml}
          </section>
        `
        : `
          <h2 class="workspace-title">${view.title}</h2>
          ${activeSubmodule ? `<p class="subtitle workspace-subtitle">${activeSubmodule.title}</p>` : ""}
          <section class="submodule-content">
            ${submoduleContentHtml}
          </section>
        `;
    }
  } catch (error) {
    if (elements.workspace) {
      elements.workspace.innerHTML = hideWorkspaceHeader
        ? `
          <section class="submodule-content">
            <article class="info-card">
              <h3>No fue posible cargar este módulo</h3>
              <p>${error.message}</p>
            </article>
          </section>
        `
        : `
          <h2 class="workspace-title">${view.title}</h2>
          ${activeSubmodule ? `<p class="subtitle workspace-subtitle">${activeSubmodule.title}</p>` : ""}
          <section class="submodule-content">
            <article class="info-card">
              <h3>No fue posible cargar este módulo</h3>
              <p>${error.message}</p>
            </article>
          </section>
        `;
    }
  }
}

function renderAdminUsers() {
  if (!elements.adminUsersList || !elements.adminCount) return;

  elements.adminCount.textContent = `${state.users.length} usuarios`;
  elements.adminUsersList.innerHTML = state.users
    .map(
      (user) => `
        <article class="admin-user-card">
          <div class="admin-user-head">
            <div>
              <strong>${user.name}</strong>
              <p class="soft tiny">Usuario: ${user.username} | Rol: ${prettyLabel(user.role)}</p>
            </div>
            <span class="pill">ID ${user.id}</span>
          </div>

          <form class="admin-user-form" data-user-id="${user.id}">
            <label>
              Nombre completo
              <input name="name" type="text" value="${user.name}" required />
            </label>

            <label>
              Usuario
              <input name="username" type="text" value="${user.username}" required />
            </label>

            <label>
              Rol
              <select name="role">
                ${state.availableRoles
                  .map(
                    (role) =>
                      `<option value="${role}" ${role === user.role ? "selected" : ""}>${prettyLabel(role)}</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Empresa
              <select name="companyId">
                <option value="">Sin asignar</option>
                ${state.companies
                  .map(
                    (company) =>
                      `<option value="${company.id}" ${company.id === user.companyId ? "selected" : ""}>${company.name} (${company.id})</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Contrato
              <select name="contractId">
                <option value="">Sin asignar</option>
                ${state.contracts
                  .map(
                    (contract) =>
                      `<option value="${contract.id}" ${contract.id === user.contractId ? "selected" : ""}>${contract.name} (${contract.id})</option>`
                  )
                  .join("")}
              </select>
            </label>

            <label>
              Nueva clave
              <input name="password" type="password" placeholder="Solo si la quieres cambiar" />
            </label>

            <label class="wide">
              Municipios asignados
              <input
                name="assignedMunicipalities"
                type="text"
                value="${(user.assignedMunicipalities || []).join(", ")}"
                placeholder="Ejemplo: Bogotá, Soacha"
              />
            </label>

            <div class="admin-actions wide">
              <button type="submit" class="btn btn-primary">Guardar cambios</button>
            </div>
          </form>
        </article>
      `
    )
    .join("");

  elements.adminUsersList
    .querySelectorAll(".admin-user-form")
    .forEach((form) => form.addEventListener("submit", handleUpdateUser));
}

async function loadAdminData() {
  const [rolesPayload, usersPayload] = await Promise.all([
    apiFetch("/roles"),
    apiFetch("/users"),
  ]);

  state.availableRoles = rolesPayload.roles;
  state.users = usersPayload.users;

  fillSelect(elements.createRole, state.availableRoles);
  renderAdminUsers();
}

async function loadReferenceData() {
  const [companiesPayload, contractsPayload] = await Promise.all([
    apiFetch("/companies"),
    apiFetch("/contracts"),
  ]);

  state.companies = (companiesPayload.companies || []).filter(
    (company) => company.active === true || company.active === "true" || company.active === "t"
  );

  state.contracts = contractsPayload.contracts || [];

  fillOptionSelect(elements.createCompanyId, state.companies, {
    valueKey: "id",
    labelBuilder: (company) => `${company.name} (${company.id})`,
    includeEmpty: true,
  });

  fillOptionSelect(elements.createContractId, state.contracts, {
    valueKey: "id",
    labelBuilder: (contract) => `${contract.name} (${contract.id})`,
    includeEmpty: true,
  });
}

async function renderDashboard(user, access) {
  state.currentUser = user;
  state.access = access;
  await loadReferenceData();

  elements.loginWrap?.classList.add("hidden");
  elements.dashboard?.classList.remove("hidden");

  if (elements.welcomeName) elements.welcomeName.textContent = user.name || "Usuario";
  if (elements.welcomeRole) elements.welcomeRole.textContent = prettyLabel(user.role);

  if (elements.companyValue) {
    elements.companyValue.textContent = formatCompany(user.companyId);
  }

  if (elements.contractValue) {
    elements.contractValue.textContent = formatContract(user.contractId);
  }

  if (elements.municipalityValue) {
    elements.municipalityValue.textContent =
      user.assignedMunicipalities && user.assignedMunicipalities.length
        ? user.assignedMunicipalities.join(", ")
        : "Sin restricción";
  }

  if (elements.topUser) {
    elements.topUser.textContent = user.name || "Usuario";
    elements.topUser.title = `${user.name || "Usuario"} · ${prettyLabel(user.role)}`;
  }

  if (elements.topCompany) {
    elements.topCompany.textContent = formatCompany(user.companyId);
  }

  if (elements.topContract) {
    elements.topContract.textContent = formatContract(user.contractId);
  }

  if (elements.topMunicipality) {
    const municipalitiesText =
      user.assignedMunicipalities && user.assignedMunicipalities.length
        ? user.assignedMunicipalities.join(", ")
        : "Sin restricción";

    elements.topMunicipality.textContent = municipalitiesText;
    elements.topMunicipality.title = municipalitiesText;
  }

  state.activeModule = null;
  state.expandedModule = null;
  state.activeSubmodule = null;

  renderModuleNav(access.modules || []);

  fillSelect(
    elements.moduleSelect,
    (access.modules || []).map((item) => item.module)
  );

  const isAdministrator = user.role === "administrador";

  if (isAdministrator) {
    await loadAdminData();
  }

  renderEmptyWorkspace();
  syncAdminPanelsVisibility();
}

function resetDashboard() {
  state.currentUser = null;
  state.access = null;
  state.activeModule = null;
  state.expandedModule = null;
  state.activeSubmodule = null;
  state.token = "";
  state.users = [];
  state.personnelCreateTab = "identificacion";
  state.personnelDraft = {};

  localStorage.removeItem("empiria_token");
  localStorage.removeItem("empiria_user");
  localStorage.removeItem("empiria_access");

  resetMfaState();

  elements.dashboard?.classList.add("hidden");
  elements.loginWrap?.classList.remove("hidden");
  elements.accessResult?.classList.add("hidden");

  toggleAdminPanel(false);
  toggleAccessPanel(false);

  if (elements.adminUsersList) elements.adminUsersList.innerHTML = "";
  if (elements.adminCount) elements.adminCount.textContent = "0 usuarios";
  if (elements.moduleNav) elements.moduleNav.innerHTML = "";

  renderEmptyWorkspace();

  if (elements.topUser) elements.topUser.textContent = "Usuario";
  if (elements.topCompany) elements.topCompany.textContent = "-";
  if (elements.topContract) elements.topContract.textContent = "-";
  if (elements.topMunicipality) elements.topMunicipality.textContent = "Sin restricción";

  showAdminCreateMessage("", false);
  showLoginMessage("", false);
}

async function loadModulesCatalog() {
  const payload = await apiFetch("/modules");
  state.availableModules = payload.modules || [];
  state.availableActions = payload.actions || [];
  fillSelect(elements.actionSelect, state.availableActions);
}

async function tryRestoreSession() {
  if (!state.token) {
    elements.bootScreen?.classList.add("hidden");
    elements.loginWrap?.classList.remove("hidden");
    elements.dashboard?.classList.add("hidden");
    return;
  }

  try {
    const payload = await apiFetch("/me");
    await renderDashboard(payload.user, payload.access);
  } catch (error) {
    console.error("Error restaurando sesión:", error);
    resetDashboard();
  } finally {
    elements.bootScreen?.classList.add("hidden");
  }
}

async function handleCreateUser(event) {
  event.preventDefault();

  const formData = new FormData(elements.createUserForm);
  const payload = {
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
    role: formData.get("role"),
    companyId: formData.get("companyId") ? Number(formData.get("companyId")) : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };

  try {
    await apiFetch("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    elements.createUserForm.reset();
    showAdminCreateMessage("Usuario creado correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}

async function handleUpdateUser(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const userId = Number(form.dataset.userId);
  const formData = new FormData(form);

  const payload = {
    name: formData.get("name"),
    username: formData.get("username"),
    role: formData.get("role"),
    companyId: formData.get("companyId") ? Number(formData.get("companyId")) : null,
    contractId: formData.get("contractId") ? Number(formData.get("contractId")) : null,
    assignedMunicipalities: toMunicipalityArray(formData.get("assignedMunicipalities")),
  };

  if (formData.get("password")) {
    payload.password = formData.get("password");
  }

  try {
    await apiFetch(`/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    showAdminCreateMessage("Cambios guardados correctamente", false);
    await loadAdminData();
  } catch (error) {
    showAdminCreateMessage(error.message, true);
  }
}

async function loadResumeModule() {
  const currentUrl = new URL(window.location.href);
  const site = currentUrl.searchParams.get("resumeSite") || "";
  const institution = currentUrl.searchParams.get("resumeInstitution") || "";
  const modality = currentUrl.searchParams.get("resumeModality") || "";
  const query = new URLSearchParams();

  if (site) query.set("site", site);
  if (institution) query.set("institution", institution);
  if (modality) query.set("modality", modality);

  let payload;

  try {
    payload = await apiFetch(
      query.toString() ? `/resume-view?${query.toString()}` : "/resume-view"
    );
  } catch (error) {
    return `
      <article class="info-card">
        <h3>Error en Hoja de Vida</h3>
        <p>${error.message}</p>
      </article>
    `;
  }

  setTimeout(() => {
    const form = document.getElementById("resumeFilterForm");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const next = new URLSearchParams();

      if (formData.get("site")) next.set("resumeSite", formData.get("site"));
      if (formData.get("institution")) next.set("resumeInstitution", formData.get("institution"));
      if (formData.get("modality")) next.set("resumeModality", formData.get("modality"));

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("resumeSite");
      cleanUrl.searchParams.delete("resumeInstitution");
      cleanUrl.searchParams.delete("resumeModality");
      next.forEach((value, key) => cleanUrl.searchParams.set(key, value));
      window.history.replaceState({}, "", cleanUrl);

      state.expandedModule = "hoja_vida_documentos";
      state.activeModule = "hoja_vida_documentos";
      state.activeSubmodule = "ver_hoja_vida";
      renderModuleNav(state.access?.modules || []);
      await openModule("hoja_vida_documentos");
    });
  }, 0);

  return `
    <article class="info-card">
      <h3>Filtros de hoja de vida</h3>
      <form id="resumeFilterForm" class="resume-filter-form">
        <label>
          Sede
          <select name="site">
            <option value="">Todas</option>
            ${(payload.availableFilters?.sites || [])
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters?.site ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>
          Institución
          <select name="institution">
            <option value="">Todas</option>
            ${(payload.availableFilters?.institutions || [])
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters?.institution ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>
          Modalidad
          <select name="modality">
            <option value="">Todas</option>
            ${(payload.availableFilters?.modalities || [])
              .map(
                (value) =>
                  `<option value="${value}" ${value === payload.filters?.modality ? "selected" : ""}>${value}</option>`
              )
              .join("")}
          </select>
        </label>
        <div class="admin-actions wide">
          <button type="submit">Aplicar filtros</button>
        </div>
      </form>
    </article>

    <div class="resume-list">
      ${
        payload.records?.length
          ? payload.records
              .map(
                (record) => `
                  <article class="info-card">
                    <h3>${record.fullName}</h3>
                    <p>${record.position}</p>
                    <p>${record.site} | ${record.institution} | ${record.modality}</p>
                    <p>${record.municipality}</p>
                    <div class="resume-docs">
                      ${Object.entries(record.documents || {})
                        .map(
                          ([key, value]) => `
                            <div class="personnel-item">
                              <strong>${prettyLabel(key)}</strong>
                              <p>${value}</p>
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  </article>
                `
              )
              .join("")
          : '<article class="info-card"><p>No hay hojas de vida visibles con los filtros actuales.</p></article>'
      }
    </div>
  `;
}

async function handleCreateTraining(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch("/trainings", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        date: formData.get("date"),
        municipality: formData.get("municipality"),
        site: formData.get("site"),
        institution: formData.get("institution"),
        modality: formData.get("modality"),
        companyId: formData.get("companyId")
          ? Number(formData.get("companyId"))
          : state.currentUser?.companyId,
        contractId: formData.get("contractId")
          ? Number(formData.get("contractId"))
          : state.currentUser?.contractId,
        status: formData.get("status"),
      }),
    });

    state.expandedModule = "capacitaciones_asistencia";
    state.activeModule = "capacitaciones_asistencia";
    state.activeSubmodule = "programar_capacitacion";
    renderModuleNav(state.access?.modules || []);
    await openModule("capacitaciones_asistencia");
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

async function loadTrainingsModule() {
  const payload = await apiFetch("/trainings");

  setTimeout(() => {
    const form = document.getElementById("trainingForm");
    if (form) {
      form.addEventListener("submit", handleCreateTraining);
    }
  }, 0);

  const formHtml = payload.canCreate
    ? `
      <article class="info-card">
        <h3>Crear capacitación</h3>
        <form id="trainingForm" class="training-form">
          <label>
            Título
            <input name="title" type="text" required />
          </label>
          <label>
            Fecha
            <input name="date" type="date" required />
          </label>
          <label>
            Municipio
            <input name="municipality" type="text" required />
          </label>
          <label>
            Sede
            <input name="site" type="text" />
          </label>
          <label>
            Institución
            <input name="institution" type="text" />
          </label>
          <label>
            Modalidad
            <input name="modality" type="text" />
          </label>
          <label>
            Empresa
            <input name="companyId" type="number" value="${state.currentUser?.companyId ?? ""}" ${state.currentUser?.companyId ? "readonly" : ""} />
          </label>
          <label>
            Contrato
            <input name="contractId" type="number" value="${state.currentUser?.contractId ?? ""}" ${state.currentUser?.contractId ? "readonly" : ""} />
          </label>
          <label class="wide">
            Estado
            <select name="status">
              <option value="programada">Programada</option>
              <option value="en_curso">En curso</option>
              <option value="cerrada">Cerrada</option>
            </select>
          </label>
          <div class="admin-actions wide">
            <button type="submit">Guardar capacitación</button>
          </div>
        </form>
      </article>
    `
    : `
      <article class="info-card">
        <h3>Capacitaciones</h3>
        <p>Este usuario puede consultar la información, pero no crear nuevas capacitaciones.</p>
      </article>
    `;

  const listHtml = `
    <article class="info-card">
      <h3>Capacitaciones visibles</h3>
      <div class="training-list">
        ${
          payload.trainings.length
            ? payload.trainings
                .map(
                  (training) => `
                    <div class="personnel-item">
                      <strong>${training.title}</strong>
                      <p>Fecha: ${training.date}</p>
                      <p>${training.municipality} | ${training.site || "Sin sede"} | ${training.institution || "Sin institución"}</p>
                      <p>${training.modality || "Sin modalidad"} | ${training.status}</p>
                    </div>
                  `
                )
                .join("")
            : "<p>No hay capacitaciones visibles para este usuario.</p>"
        }
      </div>
    </article>
  `;

  return `<div class="training-grid">${formHtml}${listHtml}</div>`;
}

async function loadTrainingAttendanceModule() {
  const payload = await apiFetch("/training-attendance");

  setTimeout(() => {
    document.querySelectorAll(".attendance-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);

        try {
          await apiFetch("/training-attendance", {
            method: "POST",
            body: JSON.stringify({
              trainingId: Number(formData.get("trainingId")),
              personnelId: Number(formData.get("personnelId")),
              status: formData.get("status"),
            }),
          });

          state.expandedModule = "capacitaciones_asistencia";
          state.activeModule = "capacitaciones_asistencia";
          state.activeSubmodule = "registrar_asistencia";
          renderModuleNav(state.access?.modules || []);
          await openModule("capacitaciones_asistencia");
        } catch (error) {
          showError(error.message || "Error al guardar asistencia.");
        }
      });
    });
  }, 0);

  return `
    <div class="attendance-list">
      ${
        payload.trainings.length
          ? payload.trainings
              .map(
                (training) => `
                  <article class="info-card">
                    <h3>${training.title}</h3>
                    <p>${training.date} | ${training.municipality} | ${training.site || "Sin sede"}</p>
                    <div class="attendance-list">
                      ${
                        training.attendance.length
                          ? training.attendance
                              .map(
                                (item) => `
                                  <div class="personnel-item">
                                    <strong>${item.personnel ? item.personnel.fullName : "Personal no encontrado"}</strong>
                                    <p>Estado actual: ${prettyLabel(item.status)}</p>
                                    <p>Marcado por: ${prettyLabel(item.markedByRole)}</p>
                                  </div>
                                `
                              )
                              .join("")
                          : "<p>No hay asistencias registradas todavía.</p>"
                      }
                    </div>
                    <form class="attendance-form">
                      <input type="hidden" name="trainingId" value="${training.id}" />
                      <label>
                        Persona
                        <select name="personnelId" required>
                          ${payload.personnel
                            .map(
                              (person) =>
                                `<option value="${person.id}">${person.fullName} - ${person.municipality}</option>`
                            )
                            .join("")}
                        </select>
                      </label>
                      <label>
                        Estado
                        <select name="status" required>
                          <option value="asistio">Asistió</option>
                          <option value="no_asistio">No asistió</option>
                          <option value="pendiente">Pendiente</option>
                        </select>
                      </label>
                      <div class="admin-actions wide">
                        <button type="submit">Guardar asistencia</button>
                                                                  </div>
                    </form>
                  </article>
                `
              )
              .join("")
          : '<article class="info-card"><p>No hay capacitaciones visibles para marcar asistencia.</p></article>'
      }
    </div>
  `;
}

async function handleCreateReport(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  try {
    await apiFetch("/reports", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        template: formData.get("template"),
        companyId: formData.get("companyId")
          ? Number(formData.get("companyId"))
          : state.currentUser?.companyId,
        contractId: formData.get("contractId")
          ? Number(formData.get("contractId"))
          : state.currentUser?.contractId,
      }),
    });

    state.expandedModule = "informes_reportes";
    state.activeModule = "informes_reportes";
    state.activeSubmodule = "reportes_personal";
    renderModuleNav(state.access?.modules || []);
    await openModule("informes_reportes");
  } catch (error) {
    showError(error.message || "Ocurrió un error inesperado.");
  }
}

async function loadReportsModule() {
  const payload = await apiFetch("/reports");

  setTimeout(() => {
    const form = document.getElementById("reportForm");
    if (form) {
      form.addEventListener("submit", handleCreateReport);
    }
  }, 0);

  const formHtml = `
    <article class="info-card">
      <h3>Crear informe</h3>
      <form id="reportForm" class="report-form">
        <label>
          Título
          <input name="title" type="text" required />
        </label>
        <label>
          Plantilla
          <select name="template" required>
            ${payload.templates
              .map((template) => `<option value="${template.id}">${template.title}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          Empresa
          <input name="companyId" type="number" value="${payload.defaults.companyId ?? ""}" ${payload.defaults.companyId ? "readonly" : ""} />
        </label>
        <label>
          Contrato
          <input name="contractId" type="number" value="${payload.defaults.contractId ?? ""}" ${payload.defaults.contractId ? "readonly" : ""} />
        </label>
        <div class="admin-actions wide">
          <button type="submit">Generar informe</button>
        </div>
      </form>
      <div>
        ${payload.templates
          .map(
            (template) =>
              `<div class="personnel-item"><strong>${template.title}</strong><p>${template.description}</p></div>`
          )
          .join("")}
      </div>
    </article>
  `;

  const listHtml = `
    <article class="info-card">
      <h3>Informes guardados</h3>
      <div class="report-list">
        ${
          payload.reports.length
            ? payload.reports
                .slice()
                .reverse()
                .map(
                  (report) => `
                    <article class="personnel-item">
                      <strong>${report.title}</strong>
                      <p>Tipo: ${prettyLabel(report.template)}</p>
                      <p>Creado por: ${prettyLabel(report.createdByRole)}</p>
                      <p>Fecha: ${new Date(report.createdAt).toLocaleString("es-CO")}</p>
                      <div class="report-metrics">
                        ${Object.entries(report.content.metrics || {})
                          .map(
                            ([key, value]) => `
                              <div class="info-card">
                                <h3>${prettyLabel(key)}</h3>
                                <p>${value}</p>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                      <p>${report.content.summary || ""}</p>
                      ${
                        report.content.notes?.length
                          ? `<p>${report.content.notes.join(" | ")}</p>`
                          : ""
                      }
                      ${
                        report.content.people?.length
                          ? `<div>${report.content.people
                              .map(
                                (person) =>
                                  `<span class="pill">${person.fullName} - ${prettyLabel(person.status)}</span>`
                              )
                              .join("")}</div>`
                          : ""
                      }
                    </article>
                  `
                )
                .join("")
            : "<p>No hay informes guardados para este usuario.</p>"
        }
      </div>
    </article>
  `;

  return `<div class="report-grid">${formHtml}${listHtml}</div>`;
}

function toggleAdminPanel(isVisible) {
  if (!elements.adminPanel) return;
  elements.adminPanel.classList.toggle("hidden", !isVisible);
}

function toggleAccessPanel(isVisible) {
  if (!elements.accessPanel) return;
  elements.accessPanel.classList.toggle("hidden", !isVisible);
}

function syncAdminPanelsVisibility() {
  const isAdministrator = state.currentUser?.role === "administrador";
  const isAdminModuleActive = state.activeModule === "administracion_configuraciones";

  toggleAdminPanel(Boolean(isAdministrator && isAdminModuleActive));
  toggleAccessPanel(Boolean(isAdministrator && isAdminModuleActive));
}

if (elements.loginForm) {
  ensureMfaField();

  elements.loginForm.onsubmit = async (event) => {
    event.preventDefault();

    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    let username = usernameInput ? String(usernameInput.value || "").trim() : "";
    let password = passwordInput ? String(passwordInput.value || "") : "";

    if (state.requiresMfa) {
      username = state.tempUsername;
      password = state.tempPassword;
    }

    const mfaCode = elements.mfaCode
      ? String(elements.mfaCode.value || "").trim()
      : "";

    try {
      const response = await fetch("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          mfaCode: state.requiresMfa ? mfaCode : undefined,
        }),
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = { ok: false, message: "Respuesta inválida del servidor" };
      }

      if (payload.requiresMfa) {
        state.requiresMfa = true;
        state.tempUsername = username;
        state.tempPassword = password;

        showMfaField(true);
        showLoginMessage(payload.message || "Debes ingresar el código MFA", true);
        return;
      }

      if (!response.ok || !payload.ok) {
        showLoginMessage(payload.message || "No fue posible iniciar sesión", true);
        return;
      }

      state.token = payload.token || "";
      localStorage.setItem("empiria_token", state.token);
      localStorage.setItem("empiria_user", JSON.stringify(payload.user || {}));
      localStorage.setItem("empiria_access", JSON.stringify(payload.access || {}));

      resetMfaState();
      showLoginMessage("Inicio de sesión correcto", false);
      await renderDashboard(payload.user, payload.access);
    } catch (error) {
      showLoginMessage(error.message, true);
    }
  };
}

if (elements.logoutButton) {
  elements.logoutButton.addEventListener("click", async () => {
    try {
      await apiFetch("/logout", { method: "POST" });
    } catch {
      // cierre local
    }

    resetDashboard();
  });
}

if (elements.accessForm) {
  elements.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.currentUser || state.currentUser.role !== "administrador") {
      elements.accessResult.classList.remove("hidden");
      elements.accessResult.classList.add("denied");
      elements.accessResult.innerHTML = `
        <strong>Acceso restringido</strong>
        <p>Solo el administrador puede usar esta validación.</p>
      `;
      return;
    }

    const resource = {
      companyId: elements.companyInput.value ? Number(elements.companyInput.value) : null,
      contractId: elements.contractInput.value ? Number(elements.contractInput.value) : null,
      municipality: elements.municipalityInput.value || null,
    };

    try {
      const payload = await apiFetch("/access-check", {
        method: "POST",
        body: JSON.stringify({
          module: elements.moduleSelect.value,
          action: elements.actionSelect.value,
          resource,
        }),
      });

      elements.accessResult.classList.remove("hidden", "denied");
      elements.accessResult.innerHTML = `
        <strong>${payload.result.allowed ? "Acceso permitido" : "Acceso negado"}</strong>
        <p>${payload.result.reason}</p>
      `;

      if (!payload.result.allowed) {
        elements.accessResult.classList.add("denied");
      }
    } catch (error) {
      elements.accessResult.classList.remove("hidden");
      elements.accessResult.classList.add("denied");
      elements.accessResult.innerHTML = `
        <strong>No se pudo validar</strong>
        <p>${error.message}</p>
      `;
    }
  });
}

if (elements.createUserForm) {
  elements.createUserForm.addEventListener("submit", handleCreateUser);
}

if (elements.refreshUsersButton) {
  elements.refreshUsersButton.addEventListener("click", async () => {
    try {
      await loadAdminData();
      showAdminCreateMessage("Lista actualizada", false);
    } catch (error) {
      showAdminCreateMessage(error.message, true);
    }
  });
}

Promise.all([loadModulesCatalog(), tryRestoreSession()]).catch(() => {
  showLoginMessage("No fue posible cargar la pantalla", true);
});