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
    institution: "",
    site: "",
    modality: "",
  },

  gestorFormOpen: false,
  nominaPeriod: "",
  nominaCalculated: false,

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
    submodules: [],
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
    title: "Nómina",
    route: "/payroll-changes",
    routeMethod: "POST",
    submodules: [
      { key: "calcular_nomina",    title: "Calcular Nómina" },
      { key: "registrar_novedad",  title: "Registrar novedad" },
      { key: "consultar_novedades", title: "Consultar novedades" },
      { key: "novedades_personal", title: "Novedades del Personal" },
      { key: "desprendibles",      title: "Desprendibles" },
      { key: "certificaciones",    title: "Certificaciones" },
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
function printHtml(element, title) {
  if (!element) { showWarning("No se encontró el contenido para imprimir."); return; }
  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { showWarning("El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo."); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title || "EMPIRIA"}</title>
  <link rel="stylesheet" href="/styles.css"/>
  <style>
    body { margin: 0; padding: 24px; background: #fff; }
    @media print { @page { margin: 1.5cm; } body { padding: 0; } }
  </style>
</head>
<body>
  ${element.outerHTML}
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  <\/script>
</body>
</html>`);
  win.document.close();
}

function exportToExcel(headers, dataRows, filename) {
  const th = headers.map(h => `<th style="background:#0f172a;color:#fff;font-weight:bold;padding:6px 10px;white-space:nowrap">${String(h).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</th>`).join("");
  const tr = dataRows.map(row =>
    `<tr>${row.map(c => `<td style="padding:5px 8px;border:1px solid #e2e8f0;white-space:nowrap">${String(c ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</td>`).join("")}</tr>`
  ).join("");
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='UTF-8'/></head><body><table border='1'><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".xls";
  a.click();
  URL.revokeObjectURL(url);
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
      label: "Nómina",
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

// \u2500\u2500 Dashboard real-time state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
let _dbCharts = {};
let _dbRefreshTimer = null;
let _dbMunicipality = "";

function _clearDashboardTimers() {
  if (_dbRefreshTimer) { clearInterval(_dbRefreshTimer); _dbRefreshTimer = null; }
  for (const c of Object.values(_dbCharts)) { try { c.destroy(); } catch {} }
  _dbCharts = {};
  _dbMunicipality = "";
}

function loadChartJs() {
  return new Promise((resolve) => {
    if (window.Chart) { resolve(); return; }
    if (!document.getElementById("chartjs-script")) {
      const s = document.createElement("script");
      s.id = "chartjs-script";
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    } else { resolve(); }
  });
}

const NOVELTY_LABELS = {
  INCAPACIDAD: "Incapacidad", VACACIONES: "Vacaciones",
  LICENCIA_REMUNERADA: "Lic. Remunerada", LICENCIA_NO_REMUNERADA: "Lic. No Remunerada",
  SUSPENSION: "Suspensi\u00f3n", AUSENCIA: "Ausencia", CAMBIO_CARGO: "Cambio Cargo",
  CAMBIO_SALARIO: "Cambio Salario", RETIRO: "Retiro", OTRO: "Otro",
};

function fmtPct(n) { return n === null || n === undefined ? "\u2014" : Math.min(n, 999) + "%"; }
function coverageColor(pct) {
  if (pct === null) return "#94a3b8";
  return pct >= 90 ? "#16a34a" : pct >= 70 ? "#d97706" : "#dc2626";
}
function coverageClass(pct) {
  if (pct === null) return "db2-badge-gray";
  return pct >= 90 ? "db2-badge-green" : pct >= 70 ? "db2-badge-yellow" : "db2-badge-red";
}

function _renderDashboardKpis(k) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("db2-v-tc",      `${k.contractedTc||0} / ${k.requiredTc||0}`);
  set("db2-sub-tc",    k.pctTc !== null && k.pctTc !== undefined ? `${k.pctTc}% completado` : "Sin datos de cobertura");
  set("db2-v-mt",      `${k.contractedMt||0} / ${k.requiredMt||0}`);
  set("db2-sub-mt",    k.pctMt !== null && k.pctMt !== undefined ? `${k.pctMt}% completado` : "Sin datos de cobertura");
  set("db2-v-pct20",   k.tcPct20 || 0);
  set("db2-sub-pct20", `20% de ${k.requiredTc||0} TC requeridos`);
  set("db2-v-cupos",   (k.totalCupos||0).toLocaleString("es-CO"));
  set("db2-sub-cupos", `${k.municipalities||0} municipios`);
  set("db2-v-female",   k.femaleCount || 0);
  set("db2-sub-female", `TC: ${k.femaleTc||0} · MT: ${k.femaleMt||0}`);
  set("db2-v-male",     k.maleCount || 0);
  set("db2-sub-male",   `TC: ${k.maleTc||0} · MT: ${k.maleMt||0}`);
  set("db2-v-active",   k.activePersonnel || 0);
  set("db2-sub-active", `${k.totalPersonnel||0} total — ${k.inactivePersonnel||0} inactivos`);
  set("db2-v-retiros",   k.retirosThisYear || 0);
  set("db2-sub-retiros", `${k.retirosPct||0}% del total · ${new Date().getFullYear()}`);
  set("db2-v-obra",  k.ctObraLabor   || 0);
  set("db2-v-fijo",  k.ctTerminoFijo || 0);
  set("db2-v-sedes",      k.totalSedes || 0);
  set("db2-sub-sedes",    `${k.municipalities||0} municipios`);
  set("db2-v-sedes-mt",   k.sedesConManipuladora || 0);
  set("db2-sub-sedes-mt", `${k.sedesSinManipuladora||0} sin manipuladora`);
  const tcProg = document.getElementById("db2-prog-tc");
  const mtProg = document.getElementById("db2-prog-mt");
  if (tcProg) { tcProg.style.width = Math.min(k.pctTc??0, 100) + "%"; tcProg.style.background = coverageColor(k.pctTc); }
  if (mtProg) { mtProg.style.width = Math.min(k.pctMt??0, 100) + "%"; mtProg.style.background = coverageColor(k.pctMt); }
  const gv = document.getElementById("db2-gender-center-val");
  const sv = document.getElementById("db2-status-center-val");
  if (gv) gv.textContent = (k.femaleCount||0) + (k.maleCount||0);
  if (sv) sv.textContent = k.totalPersonnel || 0;
  // Donut legend values (update alongside chart refresh)
  set('db2-v-female2',  k.femaleCount || 0);
  set('db2-v-male2',    k.maleCount   || 0);
  set('db2-v-active2',  k.activePersonnel   || 0);
  set('db2-v-inactive2',k.inactivePersonnel || 0);
  set('db2-v-novelty2', k.noveltyPersonnel  || 0);
}

function _renderMunFilter(municipalities, current) {
  const container = document.getElementById("db2-mun-filter");
  if (!container) return;
  const all = ["", ...municipalities];
  container.innerHTML = `<span class="db2-mun-filter-label">Filtrar:</span>` + all.map(m => {
    const active = m === current ? " db2-mun-chip-active" : "";
    return `<button class="db2-mun-chip${active}" data-mun="${escapeHtml(m)}">${m || "Todos los municipios"}</button>`;
  }).join("");
  container.querySelectorAll(".db2-mun-chip").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mun = btn.dataset.mun;
      if (mun === _dbMunicipality) return;
      _dbMunicipality = mun;
      await _refreshDashboard();
    });
  });
}

function _renderPyramidChart(ageGenderByBracket, brackets, Chart) {
  const canvas = document.getElementById("db2-chart-age");
  if (!canvas || !Chart) return;
  if (_dbCharts.age) { try { _dbCharts.age.destroy(); } catch {} }
  const femaleData = brackets.map(b => -(ageGenderByBracket[b]?.female || 0));
  const maleData   = brackets.map(b =>  (ageGenderByBracket[b]?.male   || 0));
  const maxVal = Math.max(...femaleData.map(Math.abs), ...maleData, 1);
  _dbCharts.age = new Chart(canvas, {
    type: "bar",
    data: {
      labels: brackets,
      datasets: [
        { label: "Mujeres", data: femaleData, backgroundColor: "#ec489966", borderColor: "#ec4899", borderWidth: 1.5, borderRadius: 3 },
        { label: "Hombres", data: maleData,   backgroundColor: "#6366f166", borderColor: "#6366f1", borderWidth: 1.5, borderRadius: 3 },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      scales: {
        x: {
          min: -(maxVal + Math.ceil(maxVal * 0.15)),
          max:   maxVal + Math.ceil(maxVal * 0.15),
          ticks: { callback: v => Math.abs(v), font: { size: 11 }, color: "#64748b" },
          grid: { color: "#f1f5f9" },
        },
        y: { ticks: { font: { size: 12 }, color: "#374151" }, grid: { display: false } },
      },
      plugins: {
        legend: { display: true, position: "top", labels: { font: { size: 12 }, padding: 16, usePointStyle: true, pointStyle: "circle" } },
        tooltip: { callbacks: { label: ctx => `  ${ctx.dataset.label}: ${Math.abs(ctx.parsed.x)} personas` } },
      },
    },
  });
}

function _renderGenderChart(kpis, Chart) {
  const canvas = document.getElementById("db2-chart-gender");
  if (!canvas || !Chart) return;
  if (_dbCharts.gender) { try { _dbCharts.gender.destroy(); } catch {} }
  const female = kpis.femaleCount || 0;
  const male   = kpis.maleCount   || 0;
  if (!female && !male) return;
  _dbCharts.gender = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Mujeres", "Hombres"],
      datasets: [{ data: [female, male], backgroundColor: ["#ec4899", "#6366f1"], borderColor: "#fff", borderWidth: 3, hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "66%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `  ${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

function _renderStatusChart(kpis, Chart) {
  const canvas = document.getElementById("db2-chart-status");
  if (!canvas || !Chart) return;
  if (_dbCharts.status) { try { _dbCharts.status.destroy(); } catch {} }
  const active  = kpis.activePersonnel   || 0;
  const inactive= kpis.inactivePersonnel || 0;
  const novelty = kpis.noveltyPersonnel  || 0;
  _dbCharts.status = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Activos", "Inactivos", "Novedad"],
      datasets: [{ data: [active, inactive, novelty], backgroundColor: ["#22c55e", "#ef4444", "#f59e0b"], borderColor: "#fff", borderWidth: 3, hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "66%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `  ${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

async function _initDashboardCharts(payload) {
  await loadChartJs();
  const Chart = window.Chart;
  if (!Chart) return;
  for (const c of Object.values(_dbCharts)) { try { c.destroy(); } catch {} }
  _dbCharts = {};
  const kpis = payload.kpis || {};
  if (payload.ageGenderByBracket && payload.ageBrackets) {
    _renderPyramidChart(payload.ageGenderByBracket, payload.ageBrackets, Chart);
  }
  _renderGenderChart(kpis, Chart);
  _renderStatusChart(kpis, Chart);
}

async function _refreshDashboard() {
  const url = _dbMunicipality
    ? `/dashboard-summary?municipality=${encodeURIComponent(_dbMunicipality)}`
    : "/dashboard-summary";
  const fresh = await apiFetch(url);
  const k = fresh.kpis || {};
  _renderDashboardKpis(k);
  _renderMunFilter(fresh.municipalitiesList || [], _dbMunicipality);
  await loadChartJs();
  const Chart = window.Chart;
  if (Chart) {
    if (fresh.ageGenderByBracket && fresh.ageBrackets) _renderPyramidChart(fresh.ageGenderByBracket, fresh.ageBrackets, Chart);
    _renderGenderChart(k, Chart);
    _renderStatusChart(k, Chart);
  }
  const tsEl = document.getElementById("db2-last-update");
  if (tsEl) tsEl.textContent = new Date().toLocaleTimeString("es-CO");
}

async function loadDashboardModule() {

  _clearDashboardTimers();

  const payload = await apiFetch("/dashboard-summary");
  const kpis = payload.kpis || {};

  const html = `
<div class="personnel-premium-module">
<article class="personnel-premium-card">
<div class="db2-wrap">

  <section class="personnel-premium-hero">
    <div>
      <span class="personnel-premium-eyebrow">Módulo operativo</span>
      <h2>Dashboard</h2>
      <p>Estado operativo, personal, cobertura y nómina en tiempo real.</p>
    </div>
    <div class="personnel-premium-actions">
      <button id="db2-btn-refresh" class="btn btn-secondary">Actualizar datos</button>
    </div>
  </section>

  <div id="db2-mun-filter" class="db2-mun-filter"></div>

  <div class="db2-kpi-row db2-kpi-row-4">
    <div class="db2-kpi-card db2-kpi-accent-green">
      <div class="db2-kpi-label">Personal TC Contratado / Requerido</div>
      <div class="db2-kpi-value" id="db2-v-tc">${kpis.contractedTc||0} / ${kpis.requiredTc||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-tc">${kpis.pctTc !== null && kpis.pctTc !== undefined ? kpis.pctTc+'% completado' : 'Sin datos de cobertura'}</div>
      <div class="db2-kpi-prog"><div class="db2-kpi-prog-bar" id="db2-prog-tc" style="width:${Math.min(kpis.pctTc??0,100)}%;background:${coverageColor(kpis.pctTc)}"></div></div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-teal">
      <div class="db2-kpi-label">Personal MT Contratado / Requerido</div>
      <div class="db2-kpi-value" id="db2-v-mt">${kpis.contractedMt||0} / ${kpis.requiredMt||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-mt">${kpis.pctMt !== null && kpis.pctMt !== undefined ? kpis.pctMt+'% completado' : 'Sin datos de cobertura'}</div>
      <div class="db2-kpi-prog"><div class="db2-kpi-prog-bar" id="db2-prog-mt" style="width:${Math.min(kpis.pctMt??0,100)}%;background:${coverageColor(kpis.pctMt)}"></div></div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-blue">
      <div class="db2-kpi-label">20% TC Requerido</div>
      <div class="db2-kpi-value" id="db2-v-pct20">${kpis.tcPct20||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-pct20">20% de ${kpis.requiredTc||0} TC requeridos</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-blue">
      <div class="db2-kpi-label">Raciones activas</div>
      <div class="db2-kpi-value" id="db2-v-cupos">${(kpis.totalCupos||0).toLocaleString()}</div>
      <div class="db2-kpi-sub" id="db2-sub-cupos">${kpis.municipalities||0} municipios</div>
    </div>
  </div>

  <div class="db2-kpi-row">
    <div class="db2-kpi-card db2-kpi-accent-pink">
      <div class="db2-kpi-label">Mujeres contratadas</div>
      <div class="db2-kpi-value" id="db2-v-female">${kpis.femaleCount||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-female">TC: ${kpis.femaleTc||0} · MT: ${kpis.femaleMt||0}</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-indigo">
      <div class="db2-kpi-label">Hombres contratados</div>
      <div class="db2-kpi-value" id="db2-v-male">${kpis.maleCount||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-male">TC: ${kpis.maleTc||0} · MT: ${kpis.maleMt||0}</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-green">
      <div class="db2-kpi-label">Personal activo</div>
      <div class="db2-kpi-value" id="db2-v-active">${kpis.activePersonnel||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-active">${kpis.totalPersonnel||0} total — ${kpis.inactivePersonnel||0} inactivos</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-red">
      <div class="db2-kpi-label">Retiros / Renuncias</div>
      <div class="db2-kpi-value" id="db2-v-retiros">${kpis.retirosThisYear||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-retiros">${kpis.retirosPct||0}% del total · ${new Date().getFullYear()}</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-amber">
      <div class="db2-kpi-label">Contratos Obra / Labor</div>
      <div class="db2-kpi-value" id="db2-v-obra">${kpis.ctObraLabor||0}</div>
      <div class="db2-kpi-sub">vigentes</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-amber">
      <div class="db2-kpi-label">Contratos Término Fijo</div>
      <div class="db2-kpi-value" id="db2-v-fijo">${kpis.ctTerminoFijo||0}</div>
      <div class="db2-kpi-sub">vigentes</div>
    </div>
  </div>

  <div class="db2-kpi-row db2-kpi-row-2">
    <div class="db2-kpi-card db2-kpi-accent-teal">
      <div class="db2-kpi-label">Sedes PAE totales</div>
      <div class="db2-kpi-value" id="db2-v-sedes">${kpis.totalSedes||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-sedes">${kpis.municipalities||0} municipios</div>
    </div>
    <div class="db2-kpi-card db2-kpi-accent-indigo">
      <div class="db2-kpi-label">Sedes con manipuladora</div>
      <div class="db2-kpi-value" id="db2-v-sedes-mt">${kpis.sedesConManipuladora||0}</div>
      <div class="db2-kpi-sub" id="db2-sub-sedes-mt">${kpis.sedesSinManipuladora||0} sin manipuladora</div>
    </div>
  </div>

  <div class="db2-charts-3col">
    <div class="db2-chart-card">
      <div class="db2-card-header">Género del personal</div>
      <div class="db2-donut-wrap">
        <canvas id="db2-chart-gender"></canvas>
        <div class="db2-donut-center">
          <div class="db2-donut-center-val" id="db2-gender-center-val">${(kpis.femaleCount||0)+(kpis.maleCount||0)}</div>
          <div class="db2-donut-center-lbl">total</div>
        </div>
      </div>
      <div class="db2-donut-legend">
        <div class="db2-donut-legend-item">
          <span class="db2-donut-legend-dot" style="background:#ec4899"></span>
          <span>Mujeres</span>
          <span class="db2-donut-legend-val" id="db2-v-female2">${kpis.femaleCount||0}</span>
        </div>
        <div class="db2-donut-legend-item">
          <span class="db2-donut-legend-dot" style="background:#6366f1"></span>
          <span>Hombres</span>
          <span class="db2-donut-legend-val" id="db2-v-male2">${kpis.maleCount||0}</span>
        </div>
      </div>
    </div>

    <div class="db2-chart-card">
      <div class="db2-card-header">Estado del personal</div>
      <div class="db2-donut-wrap">
        <canvas id="db2-chart-status"></canvas>
        <div class="db2-donut-center">
          <div class="db2-donut-center-val" id="db2-status-center-val">${kpis.totalPersonnel||0}</div>
          <div class="db2-donut-center-lbl">total</div>
        </div>
      </div>
      <div class="db2-donut-legend">
        <div class="db2-donut-legend-item">
          <span class="db2-donut-legend-dot" style="background:#22c55e"></span>
          <span>Activos</span>
          <span class="db2-donut-legend-val" id="db2-v-active2">${kpis.activePersonnel||0}</span>
        </div>
        <div class="db2-donut-legend-item">
          <span class="db2-donut-legend-dot" style="background:#ef4444"></span>
          <span>Inactivos</span>
          <span class="db2-donut-legend-val" id="db2-v-inactive2">${kpis.inactivePersonnel||0}</span>
        </div>
        <div class="db2-donut-legend-item">
          <span class="db2-donut-legend-dot" style="background:#f59e0b"></span>
          <span>Novedad</span>
          <span class="db2-donut-legend-val" id="db2-v-novelty2">${kpis.noveltyPersonnel||0}</span>
        </div>
      </div>
    </div>

    <div class="db2-chart-card">
      <div class="db2-card-header">Distribución de edades — pirámide poblacional</div>
      <div class="db2-chart-area" style="height:290px;padding:12px 8px 12px 12px">
        <canvas id="db2-chart-age"></canvas>
      </div>
    </div>
  </div>

  <div class="db2-refresh-note">
    Última actualización: <span id="db2-last-update">${new Date().toLocaleTimeString("es-CO")}</span>
    &nbsp;&bull;&nbsp; Actualización automática cada 60 s
  </div>

</div>
</article>
</div>`;

  setTimeout(async () => {
    _renderDashboardKpis(kpis);
    _renderMunFilter(payload.municipalitiesList || [], _dbMunicipality);
    await _initDashboardCharts(payload);

    const refreshBtn = document.getElementById("db2-btn-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Actualizando…";
        try {
          await _refreshDashboard();
          showSuccess("Dashboard actualizado");
        } catch { showError("No se pudo actualizar"); }
        finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = "Actualizar datos";
        }
      });
    }

    _dbRefreshTimer = setInterval(async () => {
      try { await _refreshDashboard(); } catch { /* silent */ }
    }, 60000);
  }, 80);

  return html;
}

// \u2500\u2500 Map coordinates for Meta municipalities (centroid lat/lng) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const MAP_MUN_COORDS = [
  { name: "Villavicencio",        lat: 4.1420,  lng: -73.6266 },
  { name: "Acac\u00edas",              lat: 3.9891,  lng: -73.7575 },
  { name: "Barranca de Up\u00eda",     lat: 4.5731,  lng: -72.9628 },
  { name: "Cabuyaro",             lat: 4.2917,  lng: -72.7853 },
  { name: "Castilla la Nueva",    lat: 3.8806,  lng: -73.6658 },
  { name: "Cubarral",             lat: 3.8447,  lng: -73.9481 },
  { name: "Cumaral",              lat: 4.2703,  lng: -73.4931 },
  { name: "El Calvario",          lat: 4.3706,  lng: -73.7033 },
  { name: "El Castillo",          lat: 3.5461,  lng: -73.9458 },
  { name: "El Dorado",            lat: 3.6642,  lng: -73.3714 },
  { name: "Fuente de Oro",        lat: 3.4614,  lng: -73.6261 },
  { name: "Granada",              lat: 3.5367,  lng: -73.7192 },
  { name: "Guamal",               lat: 3.8900,  lng: -73.7694 },
  { name: "La Macarena",          lat: 2.1803,  lng: -73.7836 },
  { name: "La Uribe",             lat: 3.2269,  lng: -74.3517 },
  { name: "Lejan\u00edas",             lat: 3.5217,  lng: -74.0211 },
  { name: "Mapirip\u00e1n",            lat: 2.8942,  lng: -72.1450 },
  { name: "Mesetas",              lat: 3.3783,  lng: -74.0433 },
  { name: "Puerto Concordia",     lat: 2.6136,  lng: -72.7617 },
  { name: "Puerto Gait\u00e1n",        lat: 4.3133,  lng: -72.0806 },
  { name: "Puerto Lleras",        lat: 3.2686,  lng: -73.3803 },
  { name: "Puerto L\u00f3pez",         lat: 4.0853,  lng: -72.9542 },
  { name: "Puerto Rico",          lat: 3.1833,  lng: -73.5706 },
  { name: "Restrepo",             lat: 4.2578,  lng: -73.5703 },
  { name: "San Carlos de Guaroa", lat: 3.7100,  lng: -73.2325 },
  { name: "San Juan de Arama",    lat: 3.3936,  lng: -73.8856 },
  { name: "San Juanito",          lat: 4.4508,  lng: -73.6608 },
  { name: "San Mart\u00edn",           lat: 3.6961,  lng: -73.6986 },
  { name: "Vista Hermosa",        lat: 3.1214,  lng: -74.0328 },
];

function normalizeMunName(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) { resolve(); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    } else {
      resolve();
    }
  });
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

  const allPersonnel = Array.isArray(payload.data) ? payload.data : [];
  const gestorNames = allPersonnel
    .filter(p => String(p.cargo_real || "").toUpperCase() === "GESTOR DE ZONA")
    .map(p => getPersonnelFullName(p))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));

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
      <button type="button" class="employee-step-tab ${activeTab === "experiencia" ? "active" : ""}" data-step-tab="experiencia">Experiencia Laboral</button>
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
            <select name="gestorZona">
              <option value="">— Sin asignar —</option>
              ${gestorNames.map(g => `<option value="${escapeAttr(g)}" ${draftValue("gestorZona") === g ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}
              ${draftValue("gestorZona") && !gestorNames.includes(draftValue("gestorZona"))
                ? `<option value="${escapeAttr(draftValue("gestorZona"))}" selected>${escapeHtml(draftValue("gestorZona"))}</option>`
                : ""}
            </select>
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
                <option value="">Selecciona municipio</option>
                ${META_MUNICIPALITIES.map(m => `<option value="${escapeAttr(m.name)}" ${normalizeCatalogText(municipalityNameResolved) === normalizeCatalogText(m.name) ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
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

          <label>
            <span>Fecha de retiro</span>
            <input name="terminationDate" type="date" value="${escapeAttr(draftValue("terminationDate"))}" />
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
    const hasResidenceCert = String(draftValue("hasResidenceCertificate", "")) === "true";

    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Seguimiento</h4>
            <p class="section-helper-text">Seguimiento documental específico</p>
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <label>
            <span>¿Tiene SISBEN?</span>
            <select name="sisben">
              <option value="">Selecciona</option>
              <option value="true" ${hasSisben ? "selected" : ""}>Sí</option>
              <option value="false" ${!hasSisben && draftValue("sisben") !== "" ? "selected" : ""}>No</option>
            </select>
          </label>

          <label>
            <span>¿Tiene certificado de residencia?</span>
            <select name="hasResidenceCertificate">
              <option value="">Selecciona</option>
              <option value="true" ${hasResidenceCert ? "selected" : ""}>Sí</option>
              <option value="false" ${!hasResidenceCert && draftValue("hasResidenceCertificate") !== "" ? "selected" : ""}>No</option>
            </select>
          </label>
        </div>

        ${hasSisben ? `
        <div class="subsection-title">Datos del SISBEN</div>
        <div class="form-grid form-grid-2">
          <label>
            <span>Fecha de expedición SISBEN</span>
            <input name="sisbenIssueDate" type="date" value="${escapeAttr(draftValue("sisbenIssueDate"))}" />
          </label>
          <label>
            <span>Fecha de vencimiento SISBEN</span>
            <input name="sisbenExpirationDate" type="date" value="${escapeAttr(draftValue("sisbenExpirationDate"))}" />
          </label>
        </div>
        ` : ""}

        ${hasResidenceCert ? `
        <div class="subsection-title">Datos del certificado de residencia</div>
        <div class="form-grid form-grid-2">
          <label>
            <span>Fecha de expedición</span>
            <input name="residenceCertificateIssueDate" type="date" value="${escapeAttr(draftValue("residenceCertificateIssueDate"))}" />
          </label>
          <label>
            <span>Fecha de vencimiento</span>
            <input name="residenceCertificateExpiration" type="date" value="${escapeAttr(draftValue("residenceCertificateExpiration"))}" />
          </label>
        </div>
        ` : ""}
      </section>
    `;
  }

  if (activeTab === "estudios") {
    const estudios = Array.isArray(draftValue("studies", [])) ? draftValue("studies", []) : [];
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Estudios</h4>
            <p class="section-helper-text">Formación académica, curso y exámenes de manipulación de alimentos</p>
          </div>
        </div>

        <div class="estudios-add-form">
          <h5>Agregar estudio</h5>
          <div class="form-grid form-grid-2">
            <label>
              <span>Nivel educativo</span>
              <select id="newStudyLevel">
                <option value="">Selecciona</option>
                <option value="Primaria">Primaria</option>
                <option value="Bachillerato">Bachillerato</option>
                <option value="Técnico">Técnico</option>
                <option value="Tecnólogo">Tecnólogo</option>
                <option value="Profesional">Profesional</option>
                <option value="Especialización">Especialización</option>
                <option value="Maestría">Maestría</option>
                <option value="Doctorado">Doctorado</option>
                <option value="Otro">Otro</option>
              </select>
            </label>
            <label>
              <span>Año de grado</span>
              <input id="newStudyYear" type="number" min="1950" max="2099" placeholder="Ej: 2020" />
            </label>
            <label>
              <span>Institución educativa</span>
              <input id="newStudyInstitution" type="text" placeholder="Nombre de la institución" />
            </label>
            <label>
              <span>Título obtenido</span>
              <input id="newStudyDegree" type="text" placeholder="Nombre del título" />
            </label>
          </div>
          <div style="margin-top:12px">
            <button type="button" id="btnAddEstudio" class="btn btn-primary btn-row">+ Agregar estudio</button>
          </div>
        </div>

        ${estudios.length ? `
        <div class="estudios-list">
          ${estudios.map((s, i) => `
            <div class="estudio-item">
              <div class="estudio-item-info">
                <strong>${escapeHtml(s.degree || "Sin título")}</strong>
                <span>${escapeHtml(s.educationLevel || "")}${s.institution ? " · " + escapeHtml(s.institution) : ""}${s.year ? " · " + escapeHtml(String(s.year)) : ""}</span>
              </div>
              <button type="button" class="btn-remove-estudio" data-study-index="${i}">Eliminar</button>
            </div>
          `).join("")}
        </div>
        ` : `<p class="obs-empty">No hay estudios registrados aún.</p>`}

        <div class="food-handling-section">
          <h5>Curso de manipulación de alimentos</h5>
          <div class="form-grid form-grid-2">
            <label>
              <span>Fecha de expedición</span>
              <input name="foodHandlingCourseIssueDate" type="date" value="${escapeAttr(draftValue("foodHandlingCourseIssueDate"))}" />
            </label>
            <label>
              <span>Fecha de vencimiento</span>
              <input name="foodHandlingCourseExpirationDate" type="date" value="${escapeAttr(draftValue("foodHandlingCourseExpirationDate"))}" />
            </label>
          </div>
        </div>

        <div class="food-handling-section" style="margin-top:14px; background:#fff7ed; border-color:#fed7aa;">
          <h5 style="color:#c2410c">Exámenes de manipulación de alimentos</h5>
          <div class="form-grid form-grid-2">
            <label>
              <span>Fecha de expedición</span>
              <input name="foodHandlingExamIssueDate" type="date" value="${escapeAttr(draftValue("foodHandlingExamIssueDate"))}" />
            </label>
            <label>
              <span>Fecha de vencimiento</span>
              <input name="foodHandlingExamExpirationDate" type="date" value="${escapeAttr(draftValue("foodHandlingExamExpirationDate"))}" />
            </label>
          </div>
        </div>
      </section>
    `;
  }

  if (activeTab === "experiencia") {
    const experiencias = Array.isArray(state.personnelDraft.workExperience) ? state.personnelDraft.workExperience : [];
    activeSectionHtml = `
      <section class="personnel-section">
        <div class="section-title-wrap">
          <div>
            <h4>Experiencia Laboral</h4>
            <p class="section-helper-text">Historial de empleos anteriores del empleado</p>
          </div>
        </div>

        <div class="form-grid form-grid-2" style="background:var(--panel-2);padding:1rem;border-radius:10px;margin-bottom:1rem">
          <label>
            <span>Empresa / Empleador</span>
            <input id="expEmpresa" type="text" placeholder="Nombre de la empresa" />
          </label>
          <label>
            <span>Cargo desempeñado</span>
            <input id="expCargo" type="text" placeholder="Cargo o posición" />
          </label>
          <label>
            <span>Fecha de inicio</span>
            <input id="expFechaInicio" type="date" />
          </label>
          <label>
            <span>Fecha de fin</span>
            <input id="expFechaFin" type="date" placeholder="Dejar vacío si es actual" />
          </label>
          <label>
            <span>Días trabajados</span>
            <input id="expDias" type="text" readonly placeholder="Se calcula automáticamente" style="background:var(--panel-2);cursor:default;color:var(--text-soft)" />
          </label>
          <label class="full">
            <span>Funciones principales</span>
            <textarea id="expFunciones" rows="3" placeholder="Describe brevemente las funciones realizadas..."></textarea>
          </label>
          <label>
            <span>Motivo de retiro</span>
            <input id="expMotivoRetiro" type="text" placeholder="Opcional" />
          </label>
        </div>
        <div style="margin-bottom:1.2rem">
          <button type="button" id="btnAddExperiencia" class="btn btn-primary btn-row">+ Agregar experiencia</button>
        </div>

        ${experiencias.length ? `
        <div class="estudios-list">
          ${experiencias.map((exp, i) => `
            <div class="estudio-item">
              <div class="estudio-item-info">
                <strong>${escapeHtml(exp.empresa || "Empresa sin nombre")}</strong>
                <span>${escapeHtml(exp.cargo || "")}${exp.fechaInicio ? " · " + escapeHtml(exp.fechaInicio) : ""}${exp.fechaFin ? " → " + escapeHtml(exp.fechaFin) : " (actual)"}${exp.dias != null ? " · " + exp.dias + " días" : ""}</span>
                ${exp.funciones ? `<span style="opacity:.7;font-size:12px">${escapeHtml(exp.funciones)}</span>` : ""}
              </div>
              <button type="button" class="btn-remove-experiencia" data-exp-index="${i}">Eliminar</button>
            </div>
          `).join("")}
        </div>
        ` : `<p class="obs-empty">No hay experiencia laboral registrada aún.</p>`}
      </section>
    `;
  }

  if (activeTab === "observaciones") {
    const observations = Array.isArray(draftValue("observations", [])) ? draftValue("observations", []) : [];
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
          <label>
            <span>Adjuntar archivo (PDF o imagen) — opcional</span>
            <input id="obsAttachmentInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="margin-top:4px" />
            <span style="font-size:11px;color:var(--text-faint)">El archivo se guarda en el historial laboral y no aparece en la hoja de vida.</span>
          </label>
        </div>
        <div style="margin-top:10px">
          <button type="button" id="btnAddObservacion" class="btn btn-primary btn-row">Guardar observación</button>
          <span id="obsUploadStatus" style="margin-left:.8rem;font-size:13px;color:var(--text-faint)"></span>
        </div>

        <div class="obs-history">
          ${observations.length
            ? observations.slice().reverse().map(o => `
              <div class="obs-item">
                <div class="obs-item-meta">${escapeHtml(o.date ? new Date(o.date).toLocaleString("es-CO") : "—")} · ${escapeHtml(o.user || "—")}</div>
                <div class="obs-item-text">${escapeHtml(o.text || "")}</div>
                ${o.attachmentUrl ? `<div class="obs-item-attachment"><a href="${escapeAttr(o.attachmentUrl)}" target="_blank" rel="noopener">📎 ${escapeHtml(o.attachmentName || "Archivo adjunto")}</a></div>` : ""}
              </div>
            `).join("")
            : `<p class="obs-empty">No hay observaciones registradas.</p>`
          }
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
          "presentedInOffer",
        ];

        if (reactiveFields.includes(event.target.name)) {
          if (event.target.name === "companyId") state.personnelDraft.contractId = "";
          if (event.target.name === "expeditionDepartment") state.personnelDraft.expeditionMunicipality = "";
          if (event.target.name === "birthDepartment") state.personnelDraft.birthMunicipality = "";
          if (event.target.name === "presentedInOffer" && event.target.value !== "true") {
            state.personnelDraft.offerPosition = "";
          }

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

    // ESTUDIOS — agregar
    const btnAddEstudio = document.getElementById("btnAddEstudio");
    if (btnAddEstudio) {
      btnAddEstudio.addEventListener("click", () => {
        const level = document.getElementById("newStudyLevel")?.value || "";
        const year = document.getElementById("newStudyYear")?.value || "";
        const institution = document.getElementById("newStudyInstitution")?.value || "";
        const degree = document.getElementById("newStudyDegree")?.value || "";
        if (!degree && !institution) { showWarning("Ingresa al menos el título o la institución."); return; }
        if (!Array.isArray(state.personnelDraft.studies)) state.personnelDraft.studies = [];
        state.personnelDraft.studies.push({ educationLevel: level, year, institution, degree });
        state.personnelCreateTab = "estudios";
        openModule("gestion_personal");
      });
    }

    // ESTUDIOS — eliminar
    document.querySelectorAll(".btn-remove-estudio").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.studyIndex, 10);
        if (!Array.isArray(state.personnelDraft.studies)) return;
        state.personnelDraft.studies.splice(idx, 1);
        state.personnelCreateTab = "estudios";
        openModule("gestion_personal");
      });
    });

    // EXPERIENCIA LABORAL — calculadora de días
    const calcExpDias = () => {
      const inicio = document.getElementById("expFechaInicio")?.value;
      const fin = document.getElementById("expFechaFin")?.value;
      const diasEl = document.getElementById("expDias");
      if (!diasEl) return;
      if (inicio && fin && fin >= inicio) {
        const ms = new Date(fin) - new Date(inicio);
        const d = Math.round(ms / 86400000);
        diasEl.value = d + (d === 1 ? " día" : " días");
      } else {
        diasEl.value = "";
      }
    };
    document.getElementById("expFechaInicio")?.addEventListener("change", calcExpDias);
    document.getElementById("expFechaFin")?.addEventListener("change", calcExpDias);

    // EXPERIENCIA LABORAL — agregar
    const btnAddExp = document.getElementById("btnAddExperiencia");
    if (btnAddExp) {
      btnAddExp.addEventListener("click", () => {
        const empresa = (document.getElementById("expEmpresa")?.value || "").trim();
        const cargo = (document.getElementById("expCargo")?.value || "").trim();
        const fechaInicio = document.getElementById("expFechaInicio")?.value || "";
        const fechaFin = document.getElementById("expFechaFin")?.value || "";
        const funciones = (document.getElementById("expFunciones")?.value || "").trim();
        const motivoRetiro = (document.getElementById("expMotivoRetiro")?.value || "").trim();
        const dias = (fechaInicio && fechaFin && fechaFin >= fechaInicio)
          ? Math.round((new Date(fechaFin) - new Date(fechaInicio)) / 86400000)
          : null;
        if (!empresa && !cargo) { showWarning("Ingresa al menos empresa o cargo."); return; }
        if (!Array.isArray(state.personnelDraft.workExperience)) state.personnelDraft.workExperience = [];
        state.personnelDraft.workExperience.push({ empresa, cargo, fechaInicio, fechaFin, dias, funciones, motivoRetiro });
        state.personnelCreateTab = "experiencia";
        openModule("gestion_personal");
      });
    }

    // EXPERIENCIA LABORAL — eliminar
    document.querySelectorAll(".btn-remove-experiencia").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.expIndex, 10);
        if (!Array.isArray(state.personnelDraft.workExperience)) return;
        state.personnelDraft.workExperience.splice(idx, 1);
        state.personnelCreateTab = "experiencia";
        openModule("gestion_personal");
      });
    });

    // OBSERVACIONES — guardar (con adjunto opcional)
    const btnAddObs = document.getElementById("btnAddObservacion");
    if (btnAddObs) {
      btnAddObs.addEventListener("click", async () => {
        const txt = (document.getElementById("newObservationText")?.value || "").trim();
        if (!txt) { showWarning("Escribe la observación antes de guardar."); return; }

        const fileInput = document.getElementById("obsAttachmentInput");
        const statusEl = document.getElementById("obsUploadStatus");
        let attachmentUrl = "";
        let attachmentName = "";

        if (fileInput?.files?.length > 0) {
          const file = fileInput.files[0];
          attachmentName = file.name;
          if (statusEl) statusEl.textContent = "Subiendo archivo...";
          try {
            const formData = new FormData();
            formData.append("file", file);
            const empId = state.personnelEditingId || state.personnelDraft.id || "";
            formData.append("employeeId", empId);
            const uploadRes = await fetch("/documents/upload", {
              method: "POST",
              headers: { Authorization: `Bearer ${state.token}` },
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.ok && uploadData.url) {
              attachmentUrl = uploadData.url;
            }
          } catch (e) {
            if (statusEl) statusEl.textContent = "No se pudo subir el archivo.";
          }
        }

        if (!Array.isArray(state.personnelDraft.observations)) state.personnelDraft.observations = [];
        state.personnelDraft.observations.push({
          text: txt,
          date: new Date().toISOString(),
          user: state.currentUser?.name || "Usuario",
          ...(attachmentUrl ? { attachmentUrl, attachmentName } : {}),
        });
        state.personnelCreateTab = "observaciones";
        openModule("gestion_personal");
      });
    }
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
  const institutionFilterValue = state.personnelFilters.institution || "";
  const siteFilterValue = state.personnelFilters.site || "";
  const modalityFilterValue = state.personnelFilters.modality || "";
  const sortValue = state.personnelFilters.sort || "";

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

    if (institutionFilterValue) {
      const itemInstitution = normalize(item.institution || item.institucion_educativa || item.educational_institution || item.institutionName || "");
      if (itemInstitution !== normalize(institutionFilterValue)) return false;
    }

    if (siteFilterValue) {
      const itemSite = normalize(item.site || item.sede_educativa || item.educational_site || item.siteName || "");
      if (itemSite !== normalize(siteFilterValue)) return false;
    }

    if (modalityFilterValue) {
      const itemModality = normalize(item.educationalModality || item.modalidad || item.modality || item.modalidad_educativa || "");
      if (itemModality !== normalize(modalityFilterValue)) return false;
    }

    return true;
  });

  // Ordenar según selección del usuario
  if (sortValue) {
    filteredRows.sort((a, b) => {
      const nameA = getPersonnelFullName(a);
      const nameB = getPersonnelFullName(b);
      if (sortValue === "nombre_az") return nameA.localeCompare(nameB, "es");
      if (sortValue === "nombre_za") return nameB.localeCompare(nameA, "es");
      if (sortValue === "cargo_az") return getPersonnelRole(a).localeCompare(getPersonnelRole(b), "es");
      if (sortValue === "estado") return getPersonnelWorkStatus(a).localeCompare(getPersonnelWorkStatus(b), "es");
      if (sortValue === "municipio") return getPersonnelMunicipality(a).localeCompare(getPersonnelMunicipality(b), "es");
      if (sortValue === "fecha_desc") {
        const dA = a.startDate || a.start_date || a.fecha_inicio || "";
        const dB = b.startDate || b.start_date || b.fecha_inicio || "";
        return dB.localeCompare(dA);
      }
      if (sortValue === "fecha_asc") {
        const dA = a.startDate || a.start_date || a.fecha_inicio || "";
        const dB = b.startDate || b.start_date || b.fecha_inicio || "";
        return dA.localeCompare(dB);
      }
      return 0;
    });
  }

  const municipalityOptions = META_MUNICIPALITIES.map(m => m.name);
  const gestorZonaOptions = Array.from(
    new Set(rows.map(r => (r.gestorZona || r.gestor_zona || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));

  const institutionFilterOptions = Array.from(
    new Set(rows.map(r => (r.institution || r.institucion_educativa || r.educational_institution || r.institutionName || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));

  const siteFilterOptions = Array.from(
    new Set(rows.map(r => (r.site || r.sede_educativa || r.educational_site || r.siteName || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));

  const modalityFilterOptions = Array.from(
    new Set(rows.map(r => (r.educationalModality || r.modalidad || r.modality || r.modalidad_educativa || "").trim()).filter(Boolean))
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
      terminationDate: found.terminationDate || found.fecha_retiro || "",

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
      workExperience: Array.isArray(found.workExperience) ? found.workExperience : [],
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
        institution:  document.getElementById("personnelFilterInstitution")?.value || "",
        site:         document.getElementById("personnelFilterSite")?.value || "",
        modality:     document.getElementById("personnelFilterModality")?.value || "",
        sort:         document.getElementById("personnelSort")?.value || "",
      };
      state.personnelPage = 1;
      await openModule("gestion_personal");
    };

    const institutionInput = document.getElementById("personnelFilterInstitution");
    const siteInput = document.getElementById("personnelFilterSite");
    const modalityInput = document.getElementById("personnelFilterModality");

    const sortInput = document.getElementById("personnelSort");

    // Selects: re-render inmediato
    [statusInput, hvStatusInput, municipalityInput, gestorZonaInput, institutionInput, siteInput, modalityInput, sortInput].forEach((el) => {
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
          institution: "",
          site: "",
          modality: "",
          sort: "",
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
        openExportPersonnelModal(filteredRows);
      });
    }

    const importBtn = document.getElementById("btnImportPersonnel");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
        openImportPersonnelModal();
      });
    }

    document.querySelectorAll("[data-cv-personnel-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.cvPersonnelId;
        const found = rows.find((item) => String(item.id) === String(id));
        if (!found) return;
        state.personnelDraft = hydratePersonnelDraft(found);
        state.personnelViewMode = "cv";
        state.personnelEditingId = found.id || null;
        await openModule("gestion_personal");
      });
    });

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
            <button type="button" id="btnImportPersonnel" class="btn btn-secondary">Importar Excel</button>
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

          <select id="personnelFilterInstitution">
            <option value="">Institución</option>
            ${institutionFilterOptions
              .map(v => `<option value="${escapeAttr(v)}" ${institutionFilterValue === v ? "selected" : ""}>${escapeHtml(v)}</option>`)
              .join("")}
          </select>

          <select id="personnelFilterSite">
            <option value="">Sede</option>
            ${siteFilterOptions
              .map(v => `<option value="${escapeAttr(v)}" ${siteFilterValue === v ? "selected" : ""}>${escapeHtml(v)}</option>`)
              .join("")}
          </select>

          <select id="personnelFilterModality">
            <option value="">Modalidad</option>
            ${modalityFilterOptions
              .map(v => `<option value="${escapeAttr(v)}" ${modalityFilterValue === v ? "selected" : ""}>${escapeHtml(v)}</option>`)
              .join("")}
          </select>

          <select id="personnelSort">
            <option value="">Ordenar por...</option>
            <option value="nombre_az" ${sortValue === "nombre_az" ? "selected" : ""}>Nombre A-Z</option>
            <option value="nombre_za" ${sortValue === "nombre_za" ? "selected" : ""}>Nombre Z-A</option>
            <option value="cargo_az" ${sortValue === "cargo_az" ? "selected" : ""}>Cargo A-Z</option>
            <option value="estado" ${sortValue === "estado" ? "selected" : ""}>Estado</option>
            <option value="municipio" ${sortValue === "municipio" ? "selected" : ""}>Municipio</option>
            <option value="fecha_desc" ${sortValue === "fecha_desc" ? "selected" : ""}>Ingreso (reciente)</option>
            <option value="fecha_asc" ${sortValue === "fecha_asc" ? "selected" : ""}>Ingreso (antiguo)</option>
          </select>

          <button type="button" id="clearPersonnelFilters" class="btn btn-secondary btn-icon-only" title="Limpiar filtros">✕</button>
        </section>

        <section class="personnel-premium-table-card">
          <div class="personnel-table-top">

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

                              <td class="cargo-cell">
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
                                  <button type="button" class="personnel-icon-btn btn-icon-view" title="Ver hoja de vida" data-cv-personnel-id="${escapeAttr(item.id)}">
                                    <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  </button>
                                  <button type="button" class="personnel-icon-btn btn-icon-edit" title="Editar empleado" data-edit-personnel-id="${escapeAttr(item.id)}">
                                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" class="personnel-icon-btn btn-icon-docs" title="Documentos" data-documents-personnel-id="${escapeAttr(item.id)}">
                                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
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
      button.addEventListener("click", () => {
        const id = button.dataset.rejectDocumentId;
        const overlay = document.createElement("div");
        overlay.className = "empiria-modal-overlay";
        overlay.innerHTML = `
          <div class="empiria-modal">
            <h3>Rechazar documento</h3>
            <p>Escribe el motivo del rechazo. Esta razón quedará visible en el expediente del empleado.</p>
            <textarea id="rejectReasonInput" placeholder="Motivo del rechazo..."></textarea>
            <div class="empiria-modal-actions">
              <button type="button" id="btnCancelReject" class="btn btn-secondary">Cancelar</button>
              <button type="button" id="btnConfirmReject" class="btn btn-primary">Rechazar</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById("rejectReasonInput")?.focus();

        document.getElementById("btnCancelReject")?.addEventListener("click", () => overlay.remove());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById("btnConfirmReject")?.addEventListener("click", async () => {
          const reason = (document.getElementById("rejectReasonInput")?.value || "").trim();
          if (!reason) { showWarning("Debes escribir un motivo de rechazo."); return; }
          overlay.remove();
          try {
            await apiFetch("/documents/reject", {
              method: "PUT",
              body: JSON.stringify({ id, reason, userName: state.currentUser?.name || "Usuario" }),
            });
            await openModule("gestion_personal");
          } catch {
            showError("No fue posible rechazar el documento.");
          }
        });
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

  const d = state.personnelDraft;

  // Mínimos obligatorios independientemente de la pestaña activa
  if (!String(d.firstName || "").trim() || !String(d.firstLastName || "").trim()) {
    showWarning("El nombre y apellido del empleado son obligatorios (pestaña Identificación)."); return;
  }
  if (!String(d.documentNumber || "").trim()) {
    showWarning("El número de documento es obligatorio (pestaña Identificación)."); return;
  }

  // Validaciones condicionales (solo cuando el campo correspondiente está activo)
  if (d.presentedInOffer === "true" && !d.offerPosition) {
    showWarning("Selecciona el cargo presentado en la oferta (pestaña Licitación)."); return;
  }
  if (d.sisben === "true" && (!d.sisbenIssueDate || !d.sisbenExpirationDate)) {
    showWarning("Completa las fechas del SISBEN (pestaña Seguimiento)."); return;
  }
  if (d.hasResidenceCertificate === "true" && (!d.residenceCertificateIssueDate || !d.residenceCertificateExpiration)) {
    showWarning("Completa las fechas del certificado de residencia (pestaña Seguimiento)."); return;
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
      terminationDate: state.personnelDraft.terminationDate || "",

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
      workExperience: state.personnelDraft.workExperience || [],

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

    if (state.personnelViewMode === "cv") {
      return renderPersonnelCvModule();
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
    const userRole = state.currentUser?.role || "";
    const isGestor = userRole === "gestores_auxiliares";

    // Gestores de zona: mostrar solo la interfaz móvil de novedades
    if (isGestor) {
      const html = await loadGestorNovedadesModule();
      wireGestorNovedadesEvents();
      return html;
    }

    if (submoduleKey === "calcular_nomina") {
      const html = await loadCalcularNominaModule();
      wireCalcularNominaEvents();
      return html;
    }
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
    if (submoduleKey === "novedades_personal") {
      const html = await loadNovedadesPersonalModule();
      wireNovedadesPersonalEvents();
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
    // Default: load calcular nomina for TH/admin, gestor interface for gestores
    const html = await loadCalcularNominaModule();
    wireCalcularNominaEvents();
    return html;
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
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Registrar Novedad</h2>
          <p>Registra incapacidades, vacaciones, licencias y otras novedades del personal.</p>
        </div>
      </section>

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
              <option value="RETIRO"                ${d.noveltyType==="RETIRO"                ?"selected":""}>Retiro del empleado</option>
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
    CAMBIO_SALARIO:"Cambio salario", RETIRO:"Retiro", OTRO:"Otro",
  }[t] || t);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CO") : "-";

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Consultar Novedades</h2>
          <p>${filtered.length} de ${novedades.length} novedades registradas</p>
        </div>
        <button type="button" id="btnIrRegistrar" class="btn btn-primary">+ Registrar novedad</button>
      </section>

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
          <option value="RETIRO"                ${f.type==="RETIRO"                ?"selected":""}>Retiro</option>
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
                <td class="payroll-name-cell">
                  <div style="font-weight:600">${escapeHtml(n.employeeName)}</div>
                  <div style="font-size:10px;color:#9ca3af">${escapeHtml(n.createdByName || "")}</div>
                </td>
                <td>${escapeHtml(n.documentNumber)}</td>
                <td><span class="novelty-type-chip">${typeLabel(n.noveltyType)}</span></td>
                <td>${fmtDate(n.startDate)}</td>
                <td>${fmtDate(n.endDate)}</td>
                <td>${n.days || "-"}</td>
                <td>
                  ${statusBadge(n.status)}
                  ${n.reviewNotes ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${escapeHtml(n.reviewNotes)}</div>` : ""}
                </td>
                <td>
                  <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
                    ${n.supportDocumentUrl ? `<a href="${escapeAttr(n.supportDocumentUrl)}" target="_blank" class="nov-action-btn" style="background:#dbeafe;color:#1e40af;text-decoration:none">📎 Doc</a>` : ""}
                    ${n.status === "PENDIENTE" ? `
                      <button class="nov-action-btn nov-btn-approve btn-aprobar" data-nov-id="${n.id}">✓ Aprobar</button>
                      <button class="nov-action-btn nov-btn-reject btn-rechazar" data-nov-id="${n.id}">✗ Rechazar</button>
                    ` : ""}
                    ${n.status !== "ANULADA" ? `
                      <button class="nov-action-btn nov-btn-annul btn-anular" data-nov-id="${n.id}">Anular</button>
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
        CAMBIO_CARGO: "Cambio de cargo", CAMBIO_SALARIO: "Cambio de salario", RETIRO: "Retiro", OTRO: "Otro",
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
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Desprendibles de Pago</h2>
          <p>Genera el desprendible de novedades de nómina por empleado y período.</p>
        </div>
      </section>
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
        printHtml(document.getElementById("desprendiblePrint"), "Desprendible de Nómina");
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
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Certificaciones Laborales</h2>
          <p>Genera certificaciones laborales para los empleados.</p>
        </div>
      </section>
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
        printHtml(document.getElementById("certPrint"), "Certificación Laboral");
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

// ============================================================
// NÓMINA — Interfaz Gestor de Zona (vista móvil)
// ============================================================
async function loadGestorNovedadesModule() {
  let novedades = [];
  try {
    const res = await apiFetch("/payroll/novelties");
    novedades = Array.isArray(res.data) ? res.data : [];
  } catch { novedades = []; }

  const userId = state.currentUser?.id;
  const myNovedades = novedades.filter(n =>
    String(n.createdByUserId) === String(userId) ||
    String(n.createdByName || "").toUpperCase() === String(state.currentUser?.name || state.currentUser?.username || "").toUpperCase()
  );

  const now = new Date();
  const periodStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const monthLabel = now.toLocaleDateString("es-CO", { month: "long", year: "numeric" });

  const statusBadge = (s) => {
    const map = {
      PENDIENTE: ["gsb-pending",  "Pendiente"],
      APROBADA:  ["gsb-approved", "Aprobada"],
      RECHAZADA: ["gsb-rejected", "Rechazada"],
      ANULADA:   ["gsb-annulled", "Anulada"],
    };
    const [cls, lbl] = map[s] || ["gsb-pending", s];
    return `<span class="gestor-status ${cls}">${lbl}</span>`;
  };

  const typeLabel = (t) => ({
    INCAPACIDAD:"Incapacidad", VACACIONES:"Vacaciones",
    LICENCIA_REMUNERADA:"Lic. remunerada", LICENCIA_NO_REMUNERADA:"Lic. no remunerada",
    SUSPENSION:"Suspensión", AUSENCIA:"Ausencia", CAMBIO_CARGO:"Cambio de cargo",
    CAMBIO_SALARIO:"Cambio de salario", RETIRO:"Retiro", OTRO:"Otro",
  }[t] || t);

  const pending  = myNovedades.filter(n => n.status === "PENDIENTE").length;
  const approved = myNovedades.filter(n => n.status === "APROBADA").length;
  const rejected = myNovedades.filter(n => n.status === "RECHAZADA").length;

  const showForm = state.gestorFormOpen || false;

  const formHtml = showForm ? `
    <div class="gestor-form-sheet" id="gestorFormSheet">
      <p class="gestor-form-title">Nueva novedad</p>
      <div class="gestor-form-grid">
        <label class="gestor-label">
          Empleado <span style="color:#ef4444">*</span>
          <input id="gNovEmpSearch" type="text" class="gestor-input" placeholder="Buscar por nombre o documento..." autocomplete="off" />
          <select id="gNovEmpId" class="gestor-select" style="margin-top:4px">
            <option value="">— Selecciona empleado —</option>
          </select>
        </label>
        <label class="gestor-label">
          Tipo de novedad <span style="color:#ef4444">*</span>
          <select id="gNovType" class="gestor-select">
            <option value="">Selecciona tipo</option>
            <option value="INCAPACIDAD">Incapacidad</option>
            <option value="VACACIONES">Vacaciones</option>
            <option value="LICENCIA_REMUNERADA">Licencia remunerada</option>
            <option value="LICENCIA_NO_REMUNERADA">Licencia no remunerada</option>
            <option value="SUSPENSION">Suspensión</option>
            <option value="AUSENCIA">Ausencia injustificada</option>
            <option value="CAMBIO_CARGO">Cambio de cargo</option>
            <option value="RETIRO">Retiro</option>
            <option value="OTRO">Otro</option>
          </select>
        </label>
        <label class="gestor-label">
          Fecha inicio <span style="color:#ef4444">*</span>
          <input id="gNovStart" type="date" class="gestor-input" />
        </label>
        <label class="gestor-label">
          Fecha fin
          <input id="gNovEnd" type="date" class="gestor-input" />
        </label>
        <label class="gestor-label">
          Días
          <input id="gNovDays" type="number" min="1" class="gestor-input" placeholder="Ej: 3" />
        </label>
        <label class="gestor-label">
          Documento soporte (PDF/imagen)
          <input id="gNovDoc" type="file" accept=".pdf,.jpg,.jpeg,.png" class="gestor-input" style="padding:6px" />
        </label>
        <label class="gestor-label" style="grid-column:1/-1">
          Observaciones
          <textarea id="gNovObs" class="gestor-textarea" rows="3" placeholder="Describe el motivo de la novedad..."></textarea>
        </label>
      </div>
      <div class="gestor-btn-row" style="margin-top:14px">
        <button id="gNovCancelBtn" class="btn btn-secondary" style="flex:1">Cancelar</button>
        <button id="gNovSaveBtn" class="btn btn-primary" style="flex:2">Registrar novedad</button>
      </div>
    </div>
  ` : "";

  const cardsHtml = myNovedades.length === 0 ? `
    <div class="gestor-empty">
      <span class="gestor-empty-icon">📋</span>
      No tienes novedades registradas.<br>Usa el botón + para agregar una.
    </div>
  ` : myNovedades.map(n => `
    <div class="gestor-card">
      <div class="gestor-card-top">
        <div>
          <div class="gestor-card-name">${escapeHtml(n.employeeName || "—")}</div>
          <div class="gestor-card-doc">CC ${escapeHtml(n.documentNumber || "")}</div>
        </div>
        ${statusBadge(n.status)}
      </div>
      <div class="gestor-card-type">${escapeHtml(typeLabel(n.noveltyType))}</div>
      <div class="gestor-card-meta">
        ${n.startDate ? "Desde " + new Date(n.startDate).toLocaleDateString("es-CO") : ""}
        ${n.days ? " · " + n.days + " día(s)" : ""}
      </div>
      ${n.reviewNotes ? `<div class="gestor-card-obs">Resp.: ${escapeHtml(n.reviewNotes)}</div>` : ""}
      ${n.supportDocumentUrl ? `<div class="gestor-card-obs"><a href="${escapeAttr(n.supportDocumentUrl)}" target="_blank" style="color:#3b82f6;text-decoration:none">📎 Ver documento</a></div>` : ""}
    </div>
  `).join("");

  return `
    <div class="gestor-wrap">
      <div class="gestor-hero">
        <h2>Mis Novedades</h2>
        <p>Registra y consulta tus novedades de nómina</p>
        <div class="gestor-month-pill">📅 ${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</div>
      </div>
      <div class="gestor-stats-row">
        <div class="gestor-stat">
          <div class="gestor-stat-num" style="color:#f59e0b">${pending}</div>
          <div class="gestor-stat-lbl">Pendientes</div>
        </div>
        <div class="gestor-stat">
          <div class="gestor-stat-num" style="color:#16a34a">${approved}</div>
          <div class="gestor-stat-lbl">Aprobadas</div>
        </div>
        <div class="gestor-stat">
          <div class="gestor-stat-num" style="color:#dc2626">${rejected}</div>
          <div class="gestor-stat-lbl">Rechazadas</div>
        </div>
      </div>
      ${formHtml}
      <div class="gestor-list" id="gestorNovList">${cardsHtml}</div>
    </div>
    ${!showForm ? '<button class="gestor-fab" id="gestorFab" title="Nueva novedad">+</button>' : ""}
  `;
}

function wireGestorNovedadesEvents() {
  setTimeout(async () => {
    const fab = document.getElementById("gestorFab");
    if (fab) {
      fab.addEventListener("click", async () => {
        state.gestorFormOpen = true;
        await openModule("nomina_novedades");
      });
    }

    const cancelBtn = document.getElementById("gNovCancelBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", async () => {
        state.gestorFormOpen = false;
        await openModule("nomina_novedades");
      });
    }

    // Employee search
    let allPersonnel = [];
    try {
      const pp = await apiFetch("/personnel");
      allPersonnel = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
    } catch {}

    const empSearch = document.getElementById("gNovEmpSearch");
    const empSelect = document.getElementById("gNovEmpId");

    function populateEmpOptions(filter) {
      if (!empSelect) return;
      const filtered = filter
        ? allPersonnel.filter(e => {
            const n = String(e.fullName || e.full_name || "").toUpperCase();
            const d = String(e.documentNumber || e.numero_documento || "");
            const q = filter.toUpperCase();
            return n.includes(q) || d.includes(q);
          }).slice(0, 20)
        : [];
      empSelect.innerHTML = `<option value="">— Selecciona empleado —</option>` +
        filtered.map(e => {
          const name = e.fullName || e.full_name || "";
          const doc  = e.documentNumber || e.numero_documento || "";
          return `<option value="${escapeAttr(String(e.id))}">${escapeHtml(name)} — ${escapeHtml(doc)}</option>`;
        }).join("");
    }

    if (empSearch) {
      empSearch.addEventListener("input", () => populateEmpOptions(empSearch.value));
    }

    const saveBtn = document.getElementById("gNovSaveBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const employeeId = empSelect?.value;
        const noveltyType = document.getElementById("gNovType")?.value;
        const startDate   = document.getElementById("gNovStart")?.value;
        const endDate     = document.getElementById("gNovEnd")?.value;
        const days        = document.getElementById("gNovDays")?.value;
        const observations = document.getElementById("gNovObs")?.value;
        const docFile     = document.getElementById("gNovDoc")?.files?.[0];

        if (!employeeId)  { showWarning("Selecciona un empleado."); return; }
        if (!noveltyType) { showWarning("Selecciona el tipo de novedad."); return; }
        if (!startDate)   { showWarning("La fecha de inicio es obligatoria."); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = "Registrando...";

        try {
          // Convert doc to base64 if provided
          let supportDocumentUrl = "";
          if (docFile) {
            supportDocumentUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = e => resolve(e.target.result);
              reader.onerror = reject;
              reader.readAsDataURL(docFile);
            });
          }

          await apiFetch("/payroll/novelties", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId, noveltyType, startDate,
              endDate: endDate || null,
              days: days || null,
              observations: observations || "",
              supportDocumentUrl,
            }),
          });

          state.gestorFormOpen = false;
          showSuccess("Novedad registrada. Talento Humano la revisará pronto.", "Enviado");
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "No se pudo registrar la novedad.");
          saveBtn.disabled = false;
          saveBtn.textContent = "Registrar novedad";
        }
      });
    }
  }, 0);
}

// ============================================================
// NÓMINA — Calcular Nómina (para TH y Administrador)
// ============================================================
async function loadCalcularNominaModule() {
  const now = new Date();
  const defaultPeriod = state.nominaPeriod || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  let result = null;
  let calcError = "";
  if (state.nominaCalculated) {
    try {
      result = await apiFetch(`/payroll/calculate?period=${encodeURIComponent(defaultPeriod)}`);
    } catch (e) {
      calcError = e.message || "Error al calcular la nómina";
    }
  }

  const modalBadge = (cls) => {
    const map = {
      CAARES1:"modal-caares1 CAARES1", CAARES2:"modal-caares2 CAARES2",
      CAARES3:"modal-caares3 CAARES3", CAARES4:"modal-caares4 CAARES4",
      CAA1:"modal-caa1 CAA1", CAA2:"modal-caa2 CAA2", RI:"modal-ri RI",
    };
    const [cssClass, label] = (map[cls] || `modal-caa1 ${cls}`).split(" ");
    return `<span class="payroll-badge-modal ${cssClass}">${label||cls}</span>`;
  };

  const fmt = (n) => (n || 0).toLocaleString("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 });

  const alertsHtml = result?.alerts?.length ? `
    <div class="payroll-alert-list">
      ${result.alerts.map(a => `
        <div class="payroll-alert-item alert-${a.severity || "warning"}">
          <span class="payroll-alert-icon">${a.severity === "error" ? "⚠️" : a.severity === "info" ? "ℹ️" : "⚡"}</span>
          <div class="payroll-alert-body">
            <strong>${escapeHtml(a.employeeName)}</strong>
            ${escapeHtml(a.message)}
            ${a.liquidacion ? `<br><small>Liquidación estimada: ${fmt(a.liquidacion.total)}</small>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  const tableHtml = result?.payrollLines?.length ? `
    <div class="payroll-table-wrap">
      <table class="payroll-calc-table">
        <thead>
          <tr>
            <th>Empleado</th><th>Municipio</th><th>Modalidad</th><th>Tipo</th><th class="num">Días</th>
            <th class="num">Sal. Base</th><th class="num">Aux. Transp.</th><th class="num">Total Dev.</th>
            <th class="num">Ded. Salud</th><th class="num">Ded. Pens.</th><th class="num">Desc. Nov.</th>
            <th class="num">Neto Pagar</th><th>Observaciones</th>
          </tr>
        </thead>
        <tbody>
          ${result.payrollLines.map(l => `
            <tr class="${l.hasAlert ? (l.isRetiro ? "row-retiro" : "row-alert") : ""}">
              <td>
                <div style="font-weight:600;font-size:12px">${escapeHtml(l.employeeName)}</div>
                <div style="font-size:10px;color:#9ca3af">${escapeHtml(l.documentNumber)}</div>
              </td>
              <td style="font-size:11px">${escapeHtml(l.municipality || "—")}</td>
              <td>${modalBadge(l.modalityClass)}</td>
              <td style="font-size:11px">${escapeHtml(l.workTimeType)}</td>
              <td class="num">${l.workedDays}</td>
              <td class="num">${fmt(l.baseSalary)}</td>
              <td class="num">${fmt(l.transportAllowance)}</td>
              <td class="num" style="font-weight:600">${fmt(l.totalDevengado)}</td>
              <td class="num" style="color:#dc2626">${fmt(l.deduccionSalud)}</td>
              <td class="num" style="color:#dc2626">${fmt(l.deduccionPension)}</td>
              <td class="num" style="color:#dc2626">${l.novedadDescuento > 0 ? fmt(l.novedadDescuento) : "—"}</td>
              <td class="num" style="font-weight:700;color:${l.netoPagar < 0 ? "#dc2626" : "#16a34a"}">${fmt(l.netoPagar)}</td>
              <td>
                ${l.observations?.length ? `<ul class="payroll-obs-list">${l.observations.map(o => `<li>${escapeHtml(o)}</li>`).join("")}</ul>` : "—"}
                ${l.isRetiro && l.liquidacion ? `<div style="margin-top:4px;font-size:10px;color:#1d4ed8;font-weight:600">Liquidación: ${fmt(l.liquidacion.total)}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="7" style="text-align:right;padding-right:12px">TOTALES (${result.totals?.employees || 0} empleados)</td>
            <td class="num">${fmt(result.totals?.totalDevengado)}</td>
            <td class="num" colspan="2"></td>
            <td class="num"></td>
            <td class="num" style="font-size:15px;color:#16a34a">${fmt(result.totals?.netoPagar)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  ` : (state.nominaCalculated && !calcError ? `<article class="info-card"><p>No se encontraron empleados para el período seleccionado.</p></article>` : "");

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo de Nómina</span>
          <h2>Calcular Nómina</h2>
          <p>Liquidación mensual según modalidad, novedades aprobadas y ley colombiana.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="month" id="nominaPeriodInput" class="payroll-input" value="${escapeAttr(defaultPeriod)}" style="max-width:180px" />
          <button id="btnCalcularNomina" class="btn btn-primary">Calcular</button>
          ${result ? `<button class="btn btn-secondary" id="btnExportarNomina" data-period="${escapeAttr(defaultPeriod)}">⬇ Exportar CSV</button>` : ""}
        </div>
      </section>

      ${calcError ? `<div class="payroll-alert-item alert-error" style="margin-bottom:8px"><span class="payroll-alert-icon">⚠️</span><div>${escapeHtml(calcError)}</div></div>` : ""}

      ${result ? `
        <div class="payroll-total-row">
          <div class="payroll-total-card">
            <div class="payroll-total-label">Empleados</div>
            <div class="payroll-total-value">${result.totals?.employees || 0}</div>
          </div>
          <div class="payroll-total-card accent-blue">
            <div class="payroll-total-label">Total Devengado</div>
            <div class="payroll-total-value">${fmt(result.totals?.totalDevengado)}</div>
          </div>
          <div class="payroll-total-card accent-red">
            <div class="payroll-total-label">Total Deducciones</div>
            <div class="payroll-total-value">${fmt(result.totals?.totalDeducciones)}</div>
          </div>
          <div class="payroll-total-card accent-green">
            <div class="payroll-total-label">Total Neto a Pagar</div>
            <div class="payroll-total-value">${fmt(result.totals?.netoPagar)}</div>
          </div>
        </div>
        ${alertsHtml ? `<div><div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">⚠ Alertas de revisión manual</div>${alertsHtml}</div>` : ""}
      ` : ""}

      ${tableHtml}

      ${!state.nominaCalculated ? `
        <article class="info-card" style="text-align:center;padding:40px">
          <div style="font-size:48px;margin-bottom:12px">🧮</div>
          <h3>Calcular nómina del período</h3>
          <p>Selecciona el mes y presiona <strong>Calcular</strong> para generar la liquidación.</p>
        </article>
      ` : ""}
    </div>
  `;
}

function wireCalcularNominaEvents() {
  setTimeout(() => {
    const periodInput = document.getElementById("nominaPeriodInput");
    if (periodInput) {
      periodInput.addEventListener("change", () => {
        state.nominaPeriod = periodInput.value;
        state.nominaCalculated = false;
      });
    }

    const btnCalc = document.getElementById("btnCalcularNomina");
    if (btnCalc) {
      btnCalc.addEventListener("click", async () => {
        state.nominaPeriod = document.getElementById("nominaPeriodInput")?.value || state.nominaPeriod;
        state.nominaCalculated = true;
        btnCalc.disabled = true;
        btnCalc.textContent = "Calculando...";
        try {
          await openModule("nomina_novedades");
        } finally {
          const btn = document.getElementById("btnCalcularNomina");
          if (btn) { btn.disabled = false; btn.textContent = "Calcular"; }
        }
      });
    }

    const exportBtn = document.getElementById("btnExportarNomina");
    if (exportBtn) {
      exportBtn.addEventListener("click", async () => {
        const period = exportBtn.dataset.period || state.nominaPeriod || "";
        exportBtn.disabled = true;
        exportBtn.textContent = "Exportando...";
        try {
          const res = await fetch(`/payroll/export?period=${encodeURIComponent(period)}`, {
            headers: { Authorization: `Bearer ${state.token}` },
          });
          if (!res.ok) throw new Error("Error al exportar");
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement("a");
          a.href = url;
          a.download = `nomina-${period}.csv`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
          showSuccess("Archivo de nómina descargado.", "Exportado");
        } catch (err) {
          showError(err.message || "No se pudo exportar la nómina.");
        } finally {
          if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = "⬇ Exportar CSV"; }
        }
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
    if (submoduleKey === "solicitar_certificacion") {
      const html = await loadSolicitudFormModule("CERTIFICADO_LABORAL", "Certificado Laboral", "Solicita tu certificado laboral para trámites personales, bancarios o de visa.");
      wireSolicitudFormEvents();
      return html;
    }
    if (submoduleKey === "solicitar_desprendible") {
      const html = await loadSolicitudFormModule("DESPRENDIBLE_PAGO", "Desprendible de Pago", "Solicita el desprendible de pago correspondiente al período que necesitas.");
      wireSolicitudFormEvents();
      return html;
    }
    if (submoduleKey === "estado_solicitudes") {
      const html = await loadEstadoSolicitudesModule();
      wireEstadoSolicitudesEvents();
      return html;
    }
    return `
      <article class="info-card">
        <h3>${prettyLabel(submoduleKey)}</h3>
        <p>Espacio disponible para desarrollo.</p>
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

  const getChangeIcon = (value) => {
    const status = normalize(value);
    if (status === "SUBIO")     return `<span class="cov-arrow cov-arrow-up"   aria-label="Subió">▲</span>`;
    if (status === "BAJO")      return `<span class="cov-arrow cov-arrow-down" aria-label="Bajó">▼</span>`;
    if (status === "SIN_CAMBIO") return `<span class="cov-arrow cov-arrow-same" aria-label="Sin cambio">=</span>`;
    return `<span class="cov-arrow cov-arrow-none">—</span>`;
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

  }, 0);

  return `
    <div class="coverage-pro-module">
      <article class="coverage-pro-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Verificación de Cobertura</h2>
            <p>Sube archivos Excel por corte, conserva historial y compara cobertura requerida vs personal contratado.</p>
          </div>
        </section>

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
          <details class="coverage-history-accordion" ${history.length > 0 ? "open" : ""}>
            <summary class="coverage-history-accordion-head">
              <span>Historial de archivos</span>
              <span class="coverage-history-count">${history.length} archivo${history.length !== 1 ? "s" : ""}</span>
            </summary>

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
          </details>

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
                  <th>Act.</th>
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

                              <td class="change-cell">${getChangeIcon(row.change_status)}</td>
                              <td class="act-cell">${row.update_origin !== "HEREDADO" ? `<svg class="updated-check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ""}</td>
                            </tr>
                          `;
                        })
                        .join("")
                    : `
                      <tr>
                        <td colspan="15" class="empty">
                          No hay registros que requieran personal para mostrar.
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

// ============================================================
// NÓMINA — Novedades del Personal (estado de novedades por empleado)
// ============================================================
async function loadNovedadesPersonalModule() {
  let personnelRows = [];
  let novedadesData = [];
  try {
    const pp = await apiFetch("/personnel");
    personnelRows = Array.isArray(pp.data) ? pp.data : [];
  } catch { personnelRows = []; }
  try {
    const novPayload = await apiFetch("/novedades");
    novedadesData = Array.isArray(novPayload.data) ? novPayload.data : [];
  } catch { novedadesData = []; }

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Módulo Operativo</span>
          <h2>Novedades del Personal</h2>
          <p>Estado de novedades por empleado: ausencias, incapacidades, licencias y más.</p>
        </div>
      </section>
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
    </div>
  `;
}

function wireNovedadesPersonalEvents() {
  setTimeout(() => {
    document.querySelectorAll(".btn-add-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.toggle("hidden");
        const detailWrap = document.getElementById(`novedad-detail-${empId}`);
        if (detailWrap) detailWrap.classList.add("hidden");
      });
    });

    document.querySelectorAll(".btn-cancel-novedad").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.cancelEmpId;
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.add("hidden");
      });
    });

    document.querySelectorAll(".btn-ver-novedades").forEach((btn) => {
      btn.addEventListener("click", () => {
        const empId = btn.dataset.novedadEmpId;
        const detailWrap = document.getElementById(`novedad-detail-${empId}`);
        if (detailWrap) detailWrap.classList.toggle("hidden");
        const formWrap = document.getElementById(`novedad-form-${empId}`);
        if (formWrap) formWrap.classList.add("hidden");
      });
    });

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
        const munId = document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadMunId || "";
        const munName = document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadMunName || "";
        const cargo = document.querySelector(`[data-novedad-emp-id="${empId}"]`)?.dataset?.novedadCargo || "";

        try {
          const submitBtn = form.querySelector("[type='submit']");
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Guardando..."; }

          await apiFetch("/novedades", {
            method: "POST",
            body: JSON.stringify({ employeeId: empId, employeeName: empName, municipalityId: munId, municipalityName: munName, cargo, type, date, description, documentBase64, documentName }),
          });

          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al registrar la novedad.");
        }
      });
    });

    document.querySelectorAll(".novedad-approve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novId = btn.dataset.novId;
        try {
          await apiFetch(`/novedades/${novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "APROBADO", reviewNote: "" }),
          });
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al aprobar.");
        }
      });
    });

    document.querySelectorAll(".novedad-reject-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novId = btn.dataset.novId;
        const note = prompt("Motivo del rechazo (opcional):") || "";
        try {
          await apiFetch(`/novedades/${novId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: "RECHAZADO", reviewNote: note }),
          });
          await openModule("nomina_novedades");
        } catch (err) {
          showError(err.message || "Error al rechazar.");
        }
      });
    });
  }, 0);
}

// ============================================================
// HOJA DE VIDA — Vista de CV completo
// ============================================================
function resolveMunicipalityName(value) {
  if (!value) return "—";
  const found = META_MUNICIPALITIES.find(
    m => String(m.id) === String(value) || String(m.name).toUpperCase() === String(value).toUpperCase()
  );
  return found ? found.name : String(value);
}

function renderPersonnelCvModule() {
  const d = state.personnelDraft || {};
  const fullName = [d.firstName, d.secondName, d.firstLastName, d.secondLastName].filter(Boolean).join(" ").toUpperCase() || "SIN NOMBRE";
  const initials = [d.firstName, d.firstLastName].filter(Boolean).map(n => n[0]).join("").toUpperCase() || "?";
  const fmtDate = (v) => v ? new Date(v + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const val = (v) => escapeHtml(v || "—");

  setTimeout(() => {
    document.getElementById("btnBackFromCv")?.addEventListener("click", async () => {
      state.personnelViewMode = "table";
      await openModule("gestion_personal");
    });
    document.getElementById("btnPrintCv")?.addEventListener("click", () => {
      printHtml(document.getElementById("cvPrintArea"), "Hoja de Vida");
    });
  }, 0);

  const estudios = Array.isArray(d.studies) ? d.studies : [];
  const experiencias = Array.isArray(d.workExperience) ? d.workExperience : [];

  return `
    <div style="padding: 16px;">
      <div class="cv-actions" style="padding: 0 0 16px; display:flex; gap:10px;">
        <button id="btnBackFromCv" type="button" class="btn btn-secondary">← Volver al listado</button>
        <button id="btnPrintCv" type="button" class="btn btn-secondary">🖨 Imprimir / PDF</button>
      </div>
      <div class="cv-shell" id="cvPrintArea">
        <div class="cv-header">
          <div class="cv-avatar">${escapeHtml(initials)}</div>
          <div class="cv-header-info">
            <h2>${escapeHtml(fullName)}</h2>
            <p>${val(d.cargo_real)} ${d.offerPosition && d.presentedInOffer === "true" ? "· Cargo licitación: " + escapeHtml(d.offerPosition) : ""}</p>
            <p style="margin-top:4px; opacity:0.7">${val(d.documentType)} ${val(d.documentNumber)}</p>
          </div>
        </div>
        <div class="cv-body">

          <div class="cv-section">
            <div class="cv-section-title">Identificación</div>
            <div class="cv-grid">
              <div class="cv-field"><span>Tipo de documento</span><strong>${val(d.documentType)}</strong></div>
              <div class="cv-field"><span>Número de documento</span><strong>${val(d.documentNumber)}</strong></div>
              <div class="cv-field"><span>Fecha de expedición</span><strong>${val([d.expeditionDay, d.expeditionMonth, d.expeditionYear].filter(Boolean).join("/"))}</strong></div>
              <div class="cv-field"><span>Lugar de expedición</span><strong>${val(d.expeditionMunicipality)} · ${val(d.expeditionDepartment)}</strong></div>
              <div class="cv-field"><span>Fecha de nacimiento</span><strong>${val([d.birthDay, d.birthMonth, d.birthYear].filter(Boolean).join("/"))}</strong></div>
              <div class="cv-field"><span>Lugar de nacimiento</span><strong>${val(d.birthMunicipality)} · ${val(d.birthDepartment)}</strong></div>
              <div class="cv-field"><span>Grupo sanguíneo</span><strong>${val(d.bloodType)}</strong></div>
              <div class="cv-field"><span>Sexo biológico</span><strong>${val(d.biologicalSex)}</strong></div>
            </div>
          </div>

          <div class="cv-section">
            <div class="cv-section-title">Datos de Contacto</div>
            <div class="cv-grid">
              <div class="cv-field"><span>Celular</span><strong>${val(d.phone)}</strong></div>
              <div class="cv-field"><span>Correo electrónico</span><strong>${val(d.email)}</strong></div>
              <div class="cv-field"><span>Dirección</span><strong>${val(d.address)}</strong></div>
              <div class="cv-field"><span>Barrio</span><strong>${val(d.neighborhood)}</strong></div>
              <div class="cv-field"><span>Municipio de residencia</span><strong>${escapeHtml(resolveMunicipalityName(d.residenceMunicipality))}</strong></div>
              <div class="cv-field"><span>Estado civil</span><strong>${val(d.civilStatus)}</strong></div>
            </div>
          </div>

          <div class="cv-section">
            <div class="cv-section-title">Seguridad Social</div>
            <div class="cv-grid">
              <div class="cv-field"><span>EPS</span><strong>${val(d.eps)}</strong></div>
              <div class="cv-field"><span>Fondo de pensiones</span><strong>${val(d.pensionFund)}</strong></div>
            </div>
          </div>

          ${estudios.length ? `
          <div class="cv-section">
            <div class="cv-section-title">Formación Académica</div>
            ${estudios.map(s => `
              <div class="cv-study-item">
                <strong>${escapeHtml(s.degree || "Sin título")}</strong>
                <span>${escapeHtml(s.educationLevel || "")}${s.institution ? " · " + escapeHtml(s.institution) : ""}${s.year ? " · " + escapeHtml(String(s.year)) : ""}</span>
              </div>
            `).join("")}
          </div>
          ` : ""}

          ${experiencias.length ? `
          <div class="cv-section">
            <div class="cv-section-title">Experiencia Laboral</div>
            ${experiencias.map(exp => `
              <div class="cv-study-item">
                <strong>${escapeHtml(exp.empresa || "Empresa sin nombre")}</strong>
                <span>${escapeHtml(exp.cargo || "")}${exp.fechaInicio ? " · " + escapeHtml(exp.fechaInicio) : ""}${exp.fechaFin ? " → " + escapeHtml(exp.fechaFin) : exp.fechaInicio ? " (actual)" : ""}</span>
                ${exp.funciones ? `<span style="font-size:12px;opacity:.75">${escapeHtml(exp.funciones)}</span>` : ""}
              </div>
            `).join("")}
          </div>
          ` : ""}

          ${(d.foodHandlingCourseIssueDate || d.foodHandlingExamIssueDate) ? `
          <div class="cv-section">
            <div class="cv-section-title">Manipulación de Alimentos</div>
            <div class="cv-grid">
              ${d.foodHandlingCourseIssueDate ? `<div class="cv-field"><span>Curso — Expedición</span><strong>${fmtDate(d.foodHandlingCourseIssueDate)}</strong></div>` : ""}
              ${d.foodHandlingCourseExpirationDate ? `<div class="cv-field"><span>Curso — Vencimiento</span><strong>${fmtDate(d.foodHandlingCourseExpirationDate)}</strong></div>` : ""}
              ${d.foodHandlingExamIssueDate ? `<div class="cv-field"><span>Examen — Expedición</span><strong>${fmtDate(d.foodHandlingExamIssueDate)}</strong></div>` : ""}
              ${d.foodHandlingExamExpirationDate ? `<div class="cv-field"><span>Examen — Vencimiento</span><strong>${fmtDate(d.foodHandlingExamExpirationDate)}</strong></div>` : ""}
            </div>
          </div>
          ` : ""}

        </div>
      </div>
    </div>
  `;
}

async function openModule(moduleKey) {
  if (moduleKey !== "dashboard") _clearDashboardTimers();
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
    moduleKey === "cobertura_calculadora" ||
    moduleKey === "dashboard";
    
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
  _clearDashboardTimers();
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

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Capacitaciones</h2>
            <p>Gestiona las capacitaciones del equipo: programadas, en curso y cerradas.</p>
          </div>
        </section>
        <div class="training-grid">${formHtml}${listHtml}</div>
      </article>
    </div>
  `;
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
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Asistencia a Capacitaciones</h2>
            <p>Registra y consulta la asistencia del personal a las capacitaciones programadas.</p>
          </div>
        </section>
        <div class="attendance-list" style="padding:1rem">
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
      </article>
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

  return `
    <div class="personnel-master-module personnel-premium-module">
      <article class="personnel-premium-card">
        <section class="personnel-premium-hero">
          <div>
            <span class="personnel-premium-eyebrow">Módulo Operativo</span>
            <h2>Informes y Reportes</h2>
            <p>Genera y consulta informes de personal, cobertura y actividad del equipo.</p>
          </div>
        </section>
        <div class="report-grid">${formHtml}${listHtml}</div>
      </article>
    </div>
  `;
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

// ============================================================
// GESTIÓN DE PERSONAL — Exportar con selección de columnas
// ============================================================
function openExportPersonnelModal(rows) {
  const EXPORT_COLS = [
    { key: "documentNumber",      label: "Cédula" },
    { key: "fullName",            label: "Nombre completo" },
    { key: "cargo_real",          label: "Cargo" },
    { key: "status",              label: "Estado laboral" },
    { key: "municipality",        label: "Municipio" },
    { key: "institution",         label: "Institución" },
    { key: "site",                label: "Sede" },
    { key: "educationalModality", label: "Modalidad" },
    { key: "phone",               label: "Celular" },
    { key: "email",               label: "Correo" },
    { key: "eps",                 label: "EPS" },
    { key: "pensionFund",         label: "Fondo de pensiones" },
    { key: "contractType",        label: "Tipo de contrato" },
    { key: "startDate",           label: "Fecha de ingreso" },
    { key: "gestorZona",          label: "Gestor de Zona" },
  ];

  // Collect unique institutions in the current data
  const institutions = [...new Set(rows.map(r => r.institution || r.institucion_educativa || "").filter(Boolean))].sort();

  const existingModal = document.getElementById("exportPersonnelModal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "exportPersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:560px">
      <div class="modal-header">
        <h3>Exportar personal</h3>
        <button type="button" class="modal-close" id="closeExportModal">&#x2715;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:.8rem;font-size:13px;color:var(--text-faint)">Selecciona las columnas que deseas exportar:</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem .8rem;margin-bottom:1rem">
          ${EXPORT_COLS.map(c => `
            <label style="display:flex;align-items:center;gap:.4rem;font-size:13px;cursor:pointer">
              <input type="checkbox" class="export-col-check" value="${c.key}" checked style="accent-color:var(--accent)"/>
              ${escapeHtml(c.label)}
            </label>
          `).join("")}
        </div>
        ${institutions.length > 0 ? `
        <div style="border-top:1px solid var(--border);padding-top:.8rem;margin-top:.4rem">
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:.4rem">Filtrar por institución (opcional):</label>
          <select id="exportInstitutionFilter" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px">
            <option value="">Todas las instituciones</option>
            ${institutions.map(i => `<option value="${escapeAttr(i)}">${escapeHtml(i)}</option>`).join("")}
          </select>
        </div>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="doExportPersonnel">Exportar Excel</button>
        <button type="button" class="btn btn-secondary" id="closeExportModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("closeExportModal").addEventListener("click", close);
  document.getElementById("closeExportModal2").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("doExportPersonnel").addEventListener("click", () => {
    const selected = [...document.querySelectorAll(".export-col-check:checked")].map(c => c.value);
    if (!selected.length) { showWarning("Selecciona al menos una columna."); return; }

    const instFilter = document.getElementById("exportInstitutionFilter")?.value || "";
    let exportRows = rows;
    if (instFilter) {
      exportRows = rows.filter(r => {
        const inst = r.institution || r.institucion_educativa || "";
        return String(inst).toUpperCase() === instFilter.toUpperCase();
      });
    }

    const colDefs = EXPORT_COLS.filter(c => selected.includes(c.key));
    const headers = colDefs.map(c => c.label);

    const dataRows = exportRows.map(r => colDefs.map(c => {
      if (c.key === "fullName")       return getPersonnelFullName(r);
      if (c.key === "municipality")   return getPersonnelMunicipality(r);
      if (c.key === "documentNumber") return getPersonnelDocument(r);
      if (c.key === "status")         return getPersonnelWorkStatus(r);
      return r[c.key] || r[c.key.replace(/([A-Z])/g, "_$1").toLowerCase()] || "";
    }));

    exportToExcel(headers, dataRows, `personal_${new Date().toISOString().slice(0,10)}`);
    close();
    showSuccess(`${exportRows.length} registros exportados a Excel`);
  });
}

// ============================================================
// GESTIÓN DE PERSONAL — Importar desde Excel con plantilla
// ============================================================
function openImportPersonnelModal() {
  const existingModal = document.getElementById("importPersonnelModal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "importPersonnelModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card" style="max-width:520px">
      <div class="modal-header">
        <h3>Importar personal desde Excel</h3>
        <button type="button" class="modal-close" id="closeImportModal">&#x2715;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:1rem;padding:.8rem 1rem;background:var(--panel-2);border-radius:8px;font-size:13px">
          <p style="font-weight:600;margin-bottom:.4rem">Pasos para importar:</p>
          <ol style="margin-left:1.2rem;line-height:1.7">
            <li>Descarga la plantilla Excel con el botón de abajo.</li>
            <li>Completa los datos respetando los encabezados.</li>
            <li>Guarda el archivo y súbelo aquí.</li>
          </ol>
        </div>
        <button type="button" id="btnDownloadTemplate" class="btn btn-secondary" style="width:100%;margin-bottom:1rem">⬇ Descargar plantilla (.xls)</button>
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:.4rem">Subir archivo Excel:</label>
        <input type="file" id="importExcelFile" accept=".xlsx,.xls" style="width:100%;padding:.5rem;border:1px solid var(--border);border-radius:6px;font-size:13px" />
        <p id="importResult" style="margin-top:.8rem;font-size:13px"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id="doImportPersonnel">Importar</button>
        <button type="button" class="btn btn-secondary" id="closeImportModal2">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("closeImportModal").addEventListener("click", close);
  document.getElementById("closeImportModal2").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  document.getElementById("btnDownloadTemplate").addEventListener("click", () => {
    const templateHeaders = [
      "primer_nombre","segundo_nombre","primer_apellido","segundo_apellido",
      "tipo_documento","numero_documento",
      "estado","cargo_real","municipio",
      "eps","fondo_de_pensiones",
      "tipo_contrato","fecha_inicio","celular","correo"
    ];
    const exampleRow = [
      "JUAN","CARLOS","PEREZ","GARCIA",
      "CC","12345678",
      "ACTIVO","OPERARIO MANIPULADOR DE ALIMENTOS","Acacías",
      "COMPENSAR","COLPENSIONES",
      "Indefinido","2024-01-01","3101234567","juan@email.com"
    ];
    exportToExcel(templateHeaders, [exampleRow], "plantilla_importacion_personal");
  });

  document.getElementById("doImportPersonnel").addEventListener("click", async () => {
    const fileInput = document.getElementById("importExcelFile");
    const resultEl = document.getElementById("importResult");
    if (!fileInput?.files?.length) { showWarning("Selecciona un archivo Excel."); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      if (resultEl) resultEl.textContent = "Importando...";
      try {
        const res = await apiFetch("/personnel/import", {
          method: "POST",
          body: JSON.stringify({ fileBase64: base64, fileName: file.name }),
        });
        const created = res.data?.created || 0;
        const updated = res.data?.updated || 0;
        const errors = res.data?.errors || [];
        if (resultEl) resultEl.innerHTML = `<span style="color:green">✔ ${created} creados, ${updated} actualizados${errors.length ? `, ${errors.length} errores` : ""}</span>`;
        showSuccess(`Importación completada: ${created} creados, ${updated} actualizados`);
        setTimeout(() => { close(); openModule("gestion_personal"); }, 1500);
      } catch (err) {
        if (resultEl) resultEl.innerHTML = `<span style="color:red">✖ ${escapeHtml(err.message)}</span>`;
      }
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================
// SOLICITUDES — Formulario de solicitud (certificado / desprendible)
// ============================================================
async function loadSolicitudFormModule(defaultType, titulo, descripcion) {
  let personnelRows = [];
  try {
    const pp = await apiFetch("/personnel");
    personnelRows = Array.isArray(pp.data) ? pp.data : Array.isArray(pp.personnel) ? pp.personnel : [];
  } catch { personnelRows = []; }

  const activeEmployees = personnelRows.filter(e => {
    const s = String(e.status || e.estado || "").toUpperCase();
    return s === "ACTIVO" || s === "ACTIVE";
  });

  const REQUEST_TYPE_LABELS = {
    CERTIFICADO_LABORAL: "Certificado Laboral",
    CARTA_PRESENTACION: "Carta de Presentación",
    DESPRENDIBLE_PAGO: "Desprendible de Pago",
    PAZ_Y_SALVO: "Paz y Salvo",
    PERMISO: "Permiso",
    VACACIONES: "Vacaciones",
    CAMBIO_DATOS_PERSONALES: "Cambio de Datos Personales",
    SOLICITUD_DOCUMENTOS: "Solicitud de Documentos",
    QUEJA_RECLAMO: "Queja o Reclamo",
    OTRO: "Otro",
  };

  const empOptions = activeEmployees.map(e =>
    `<option value="${escapeAttr(String(e.id))}">${escapeHtml(getPersonnelFullName(e))} — ${escapeHtml(e.documentNumber || e.document_number || e.numero_documento || "")}</option>`
  ).join("");

  const typeOptions = Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) =>
    `<option value="${k}" ${k === defaultType ? "selected" : ""}>${escapeHtml(v)}</option>`
  ).join("");

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Solicitudes de Empleados</span>
          <h2>${escapeHtml(titulo)}</h2>
          <p>${escapeHtml(descripcion)}</p>
        </div>
      </section>
      <div class="payroll-form-card">
        <form id="solicitudForm" class="form-grid two-cols">
          <label class="full" for="solicEmpSelect">
            Empleado
            <select id="solicEmpSelect" required>
              <option value="">— Selecciona un empleado —</option>
              ${empOptions}
            </select>
          </label>
          <label for="solicType">
            Tipo de solicitud
            <select id="solicType" required>
              ${typeOptions}
            </select>
          </label>
          <label for="solicPriority">
            Prioridad
            <select id="solicPriority">
              <option value="NORMAL">Normal</option>
              <option value="ALTA">Alta</option>
              <option value="BAJA">Baja</option>
            </select>
          </label>
          <label class="full" for="solicDesc">
            Descripción / Motivo
            <textarea id="solicDesc" rows="4" placeholder="Describe el motivo o detalle de la solicitud..." required></textarea>
          </label>
          <div class="full" style="display:flex;gap:1rem;align-items:center">
            <button type="submit" class="btn btn-primary" id="solicSubmitBtn">Enviar solicitud</button>
            <span id="solicMsg" class="message"></span>
          </div>
        </form>
      </div>
    </div>
  `;
}

function wireSolicitudFormEvents() {
  const form = document.getElementById("solicitudForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("solicSubmitBtn");
    const msgEl = document.getElementById("solicMsg");
    const employeeId = document.getElementById("solicEmpSelect").value;
    const requestType = document.getElementById("solicType").value;
    const priority = document.getElementById("solicPriority").value;
    const description = document.getElementById("solicDesc").value.trim();

    if (!employeeId) { showError("Selecciona un empleado"); return; }
    if (!description) { showError("Escribe el motivo de la solicitud"); return; }

    btn.disabled = true;
    if (msgEl) msgEl.textContent = "";
    try {
      await apiFetch("/employee-requests", {
        method: "POST",
        body: JSON.stringify({ employeeId, requestType, priority, description }),
      });
      showSuccess("Solicitud enviada correctamente");
      form.reset();
    } catch (err) {
      showError(err.message || "No se pudo enviar la solicitud");
    } finally {
      btn.disabled = false;
    }
  });
}

// ============================================================
// SOLICITUDES — Estado de solicitudes
// ============================================================
async function loadEstadoSolicitudesModule() {
  let requests = [];
  try {
    const payload = await apiFetch("/employee-requests");
    requests = Array.isArray(payload.data) ? payload.data : [];
  } catch { requests = []; }

  const STATUS_LABELS = {
    PENDIENTE: "Pendiente",
    EN_PROCESO: "En proceso",
    RESUELTA: "Resuelta",
    RECHAZADA: "Rechazada",
    CANCELADA: "Cancelada",
  };
  const STATUS_COLORS = {
    PENDIENTE: "badge-warning",
    EN_PROCESO: "badge-info",
    RESUELTA: "badge-success",
    RECHAZADA: "badge-danger",
    CANCELADA: "badge-neutral",
  };
  const TYPE_LABELS = {
    CERTIFICADO_LABORAL: "Certificado Laboral",
    CARTA_PRESENTACION: "Carta de Presentación",
    DESPRENDIBLE_PAGO: "Desprendible de Pago",
    PAZ_Y_SALVO: "Paz y Salvo",
    PERMISO: "Permiso",
    VACACIONES: "Vacaciones",
    CAMBIO_DATOS_PERSONALES: "Cambio de Datos",
    SOLICITUD_DOCUMENTOS: "Solicitud Documentos",
    QUEJA_RECLAMO: "Queja / Reclamo",
    OTRO: "Otro",
  };

  const statusOptions = Object.entries(STATUS_LABELS).map(([k, v]) =>
    `<option value="${k}">${v}</option>`
  ).join("");

  const rows = requests.map(r => `
    <tr>
      <td>${escapeHtml(r.employeeName || "—")}</td>
      <td>${escapeHtml(r.documentNumber || "—")}</td>
      <td>${escapeHtml(TYPE_LABELS[r.requestType] || r.requestType || "—")}</td>
      <td>${escapeHtml(r.description || "—")}</td>
      <td><span class="novedad-badge ${STATUS_COLORS[r.status] || ''}">${escapeHtml(STATUS_LABELS[r.status] || r.status || "—")}</span></td>
      <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString("es-CO") : "—"}</td>
      <td>
        <button type="button" class="btn btn-secondary btn-row btn-view-solicitud"
          data-id="${r.id}"
          data-status="${escapeAttr(r.status)}"
          data-response="${escapeAttr(r.responseText || '')}"
          data-emp="${escapeAttr(r.employeeName || '')}"
          data-type="${escapeAttr(r.requestType || '')}"
          data-desc="${escapeAttr(r.description || '')}">
          Ver
        </button>
        ${["PENDIENTE","EN_PROCESO"].includes(r.status) ? `
        <select class="btn btn-secondary btn-row solicitud-status-select" data-solicitud-id="${r.id}" style="max-width:130px">
          <option value="">Cambiar estado</option>
          ${statusOptions}
        </select>` : ""}
      </td>
    </tr>
  `).join("");

  return `
    <div class="payroll-module-wrap">
      <section class="personnel-premium-hero">
        <div>
          <span class="personnel-premium-eyebrow">Solicitudes de Empleados</span>
          <h2>Estado de Solicitudes</h2>
          <p>Consulta y gestiona todas las solicitudes registradas en el sistema.</p>
        </div>
        <div class="topbar-actions" style="gap:.5rem">
          <input type="text" id="solicSearch" class="search" placeholder="Buscar empleado..." style="max-width:200px"/>
          <select id="solicStatusFilter" class="btn btn-secondary">
            <option value="">Todos los estados</option>
            ${statusOptions}
          </select>
          <button type="button" class="btn btn-secondary" id="solicRefreshBtn">Actualizar</button>
        </div>
      </section>

      ${requests.length === 0
        ? `<article class="info-card"><p>No hay solicitudes registradas aún.</p></article>`
        : `<div class="table-wrap">
            <table class="data-table" id="solicitudesTable">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="solicitudesBody">${rows}</tbody>
            </table>
          </div>`
      }

      <div id="solicitudDetailModal" class="modal-overlay hidden">
        <div class="modal-card" style="max-width:520px">
          <div class="modal-header">
            <h3 id="solicModalTitle">Detalle de solicitud</h3>
            <button type="button" class="modal-close" id="closeSolicModal">&#x2715;</button>
          </div>
          <div class="modal-body" id="solicModalBody"></div>
          <div class="modal-footer">
            <div id="solicResponseArea" class="hidden" style="width:100%">
              <label for="solicResponseText" style="font-weight:600;display:block;margin-bottom:.4rem">Respuesta / Nota</label>
              <textarea id="solicResponseText" rows="3" class="full" style="width:100%;margin-bottom:.5rem" placeholder="Escribe la respuesta o nota..."></textarea>
              <button type="button" class="btn btn-primary" id="solicSaveResponseBtn">Guardar respuesta</button>
            </div>
            <button type="button" class="btn btn-secondary" id="closeSolicModal2">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireEstadoSolicitudesEvents() {
  const TYPE_LABELS = {
    CERTIFICADO_LABORAL: "Certificado Laboral",
    CARTA_PRESENTACION: "Carta de Presentación",
    DESPRENDIBLE_PAGO: "Desprendible de Pago",
    PAZ_Y_SALVO: "Paz y Salvo",
    PERMISO: "Permiso",
    VACACIONES: "Vacaciones",
    CAMBIO_DATOS_PERSONALES: "Cambio de Datos",
    SOLICITUD_DOCUMENTOS: "Solicitud Documentos",
    QUEJA_RECLAMO: "Queja / Reclamo",
    OTRO: "Otro",
  };
  const STATUS_LABELS = {
    PENDIENTE: "Pendiente",
    EN_PROCESO: "En proceso",
    RESUELTA: "Resuelta",
    RECHAZADA: "Rechazada",
    CANCELADA: "Cancelada",
  };

  const searchEl = document.getElementById("solicSearch");
  const statusFilter = document.getElementById("solicStatusFilter");
  const tbody = document.getElementById("solicitudesBody");

  function filterRows() {
    if (!tbody) return;
    const q = (searchEl?.value || "").toLowerCase();
    const st = (statusFilter?.value || "").toUpperCase();
    Array.from(tbody.querySelectorAll("tr")).forEach(tr => {
      const text = tr.textContent.toLowerCase();
      const statusBadge = tr.querySelector(".novedad-badge");
      const rowStatus = tr.querySelector("[data-status]")?.dataset.status || "";
      const matchText = !q || text.includes(q);
      const matchStatus = !st || rowStatus === st;
      tr.style.display = matchText && matchStatus ? "" : "none";
    });
  }

  searchEl?.addEventListener("input", filterRows);
  statusFilter?.addEventListener("change", filterRows);

  document.getElementById("solicRefreshBtn")?.addEventListener("click", async () => {
    const html = await loadEstadoSolicitudesModule();
    document.getElementById("workspace").innerHTML = html;
    wireEstadoSolicitudesEvents();
  });

  const modal = document.getElementById("solicitudDetailModal");
  const modalBody = document.getElementById("solicModalBody");
  const modalTitle = document.getElementById("solicModalTitle");
  const responseArea = document.getElementById("solicResponseArea");
  let currentSolicitudId = null;

  function openModal(btn) {
    currentSolicitudId = btn.dataset.id;
    const status = btn.dataset.status;
    const emp = btn.dataset.emp;
    const type = btn.dataset.type;
    const desc = btn.dataset.desc;
    const response = btn.dataset.response;

    if (modalTitle) modalTitle.textContent = `Solicitud #${currentSolicitudId}`;
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="display:grid;gap:.5rem">
          <p><strong>Empleado:</strong> ${escapeHtml(emp)}</p>
          <p><strong>Tipo:</strong> ${escapeHtml(TYPE_LABELS[type] || type)}</p>
          <p><strong>Estado:</strong> ${escapeHtml(STATUS_LABELS[status] || status)}</p>
          <p><strong>Descripción:</strong> ${escapeHtml(desc)}</p>
          ${response ? `<p><strong>Respuesta:</strong> ${escapeHtml(response)}</p>` : ""}
        </div>
      `;
    }

    if (responseArea) {
      const editable = ["PENDIENTE", "EN_PROCESO"].includes(status);
      responseArea.classList.toggle("hidden", !editable);
      const textArea = document.getElementById("solicResponseText");
      if (textArea) textArea.value = response || "";
    }

    modal?.classList.remove("hidden");
  }

  document.querySelectorAll(".btn-view-solicitud").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn));
  });

  document.getElementById("closeSolicModal")?.addEventListener("click", () => modal?.classList.add("hidden"));
  document.getElementById("closeSolicModal2")?.addEventListener("click", () => modal?.classList.add("hidden"));
  modal?.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("solicSaveResponseBtn")?.addEventListener("click", async () => {
    if (!currentSolicitudId) return;
    const responseText = document.getElementById("solicResponseText")?.value?.trim() || "";
    try {
      await apiFetch(`/employee-requests/${currentSolicitudId}`, {
        method: "PATCH",
        body: JSON.stringify({ responseText }),
      });
      showSuccess("Respuesta guardada");
      modal?.classList.add("hidden");
      const html = await loadEstadoSolicitudesModule();
      document.getElementById("workspace").innerHTML = html;
      wireEstadoSolicitudesEvents();
    } catch (err) {
      showError(err.message || "No se pudo guardar la respuesta");
    }
  });

  document.querySelectorAll(".solicitud-status-select").forEach(select => {
    select.addEventListener("change", async () => {
      const id = select.dataset.solicitudId;
      const status = select.value;
      if (!status) return;
      try {
        await apiFetch(`/employee-requests/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        showSuccess("Estado actualizado");
        const html = await loadEstadoSolicitudesModule();
        document.getElementById("workspace").innerHTML = html;
        wireEstadoSolicitudesEvents();
      } catch (err) {
        showError(err.message || "No se pudo actualizar el estado");
        select.value = "";
      }
    });
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