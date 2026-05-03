const fs = require("fs");
const path = require("path");
const filePath = path.join(__dirname, "personnel.json");
function readPersonnel(){ if(!fs.existsSync(filePath)) return []; const data=fs.readFileSync(filePath,"utf-8"); return data?JSON.parse(data):[]; }
function writePersonnel(data){ fs.writeFileSync(filePath, JSON.stringify(data,null,2)); }
function firstNonEmpty(...values){ for(const value of values){ if(value!==undefined && value!==null && String(value).trim()!=="") return value;} return ""; }
function asBoolean(value){ return value===true || String(value||"").trim().toLowerCase()==="true" || String(value||"").trim().toUpperCase()==="SI"; }
function isInstitutionalPosition(value){ return String(value||"").trim().toUpperCase()==="OPERARIO MANIPULADOR DE ALIMENTOS"; }
function buildFullName(data={}){ return firstNonEmpty(data.fullName,data.full_name,data.nombre,[data.primer_nombre||data.firstName,data.segundo_nombre||data.secondName,data.primer_apellido||data.firstLastName,data.segundo_apellido||data.secondLastName].filter(Boolean).join(" ")).trim(); }
function normalizePersonnelPayload(payload = {}) {
  const presentedInOffer = asBoolean(
    firstNonEmpty(
      payload.presented_in_offer,
      payload.presentedInOffer,
      payload.presentacion_en_licitacion
    )
  );

  const realPosition = firstNonEmpty(
    payload.cargo_real,
    payload.real_position,
    payload.position,
    payload.cargo
  ).trim();

  const offeredPosition = presentedInOffer
    ? firstNonEmpty(
        payload.offered_position,
        payload.offer_position,
        payload.cargo_presentado_en_licitacion,
        payload.offerPosition
      ).trim()
    : "";

  const needsInstitution = isInstitutionalPosition(realPosition);

  const educationalMunicipality = needsInstitution
    ? firstNonEmpty(
        payload.educationalMunicipality,
        payload.educational_municipality,
        payload.municipio_educativo,
        payload.municipio_institucional
      )
    : "";

  const institution = needsInstitution
    ? firstNonEmpty(payload.institution, payload.institucion_educativa)
    : "";

  const site = needsInstitution
    ? firstNonEmpty(payload.site, payload.sede_educativa)
    : "";

  const educationalModality = needsInstitution
    ? firstNonEmpty(payload.educationalModality, payload.modalidad)
    : "";

  return {
    ...payload,

    fullName: buildFullName(payload),
    name: buildFullName(payload),

    firstName: firstNonEmpty(payload.firstName, payload.primer_nombre),
    secondName: firstNonEmpty(payload.secondName, payload.segundo_nombre),
    firstLastName: firstNonEmpty(payload.firstLastName, payload.primer_apellido),
    secondLastName: firstNonEmpty(payload.secondLastName, payload.segundo_apellido),

    documentType: firstNonEmpty(payload.documentType, payload.tipo_documento),
    documentNumber: firstNonEmpty(payload.documentNumber, payload.numero_documento),

    companyId: Number(firstNonEmpty(payload.companyId, payload.company_id, payload.empresa)) || "",
    contractId: Number(firstNonEmpty(payload.contractId, payload.contract_id, payload.contrato)) || "",
    municipalityId: firstNonEmpty(payload.municipalityId, payload.municipality_id, payload.municipio),

    presented_in_offer: presentedInOffer,
    presentedInOffer,
    presentacion_en_licitacion: presentedInOffer,

    offered_position: offeredPosition,
    offer_position: offeredPosition,
    offerPosition: offeredPosition,
    cargo_presentado_en_licitacion: offeredPosition,

    cargo_real: realPosition,
    real_position: realPosition,
    position: realPosition,

    educationalMunicipality,
    educational_municipality: educationalMunicipality,
    municipio_educativo: educationalMunicipality,
    municipio_institucional: educationalMunicipality,

    institution,
    site,
    educationalModality,

    institucion_educativa: institution,
    sede_educativa: site,
    modalidad: educationalModality,


    coverageStartDate: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),
    coverage_start_date: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),
    fecha_inicio_cobertura: firstNonEmpty(
      payload.coverageStartDate,
      payload.coverage_start_date,
      payload.fecha_inicio_cobertura
    ),

    eps: firstNonEmpty(payload.eps),

    pensionFund: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),
    pension_fund: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),
    fondo_pension: firstNonEmpty(
      payload.pensionFund,
      payload.pension_fund,
      payload.fondo_pension
    ),

    compensationBox: "COFREM",
    compensation_box: "COFREM",
    caja_compensacion: "COFREM",

    arl: "SURA",

    updatedAt: new Date().toISOString(),
  };
}

function validatePersonnelBusinessRules(record={}){ if(!record.fullName) throw new Error("El nombre completo del empleado es obligatorio"); if(!record.documentNumber && !record.numero_documento) throw new Error("El número de documento es obligatorio"); if(record.presented_in_offer && !record.offered_position) throw new Error("Debe seleccionar el cargo presentado en la oferta"); }
function getPersonnel(){ return readPersonnel(); }
function getVisibleResumeRecords(user){ const personnel=readPersonnel(); if(user.role==="administrador") return personnel; return personnel.filter((p)=>{ const sameCompany=!user.companyId || !p.companyId || p.companyId===user.companyId; const sameContract=!user.contractId || !p.contractId || p.contractId===user.contractId; return sameCompany && sameContract; }); }
function createPersonnel(newPerson){ const personnel=readPersonnel(); const record=normalizePersonnelPayload({id:Date.now(),...newPerson,createdAt:new Date().toISOString()}); validatePersonnelBusinessRules(record); personnel.push(record); writePersonnel(personnel); return record; }
function updatePersonnel(id,updatedData){ const personnel=readPersonnel(); const index=personnel.findIndex((p)=>p.id==id); if(index===-1) return null; const record=normalizePersonnelPayload({...personnel[index],...updatedData}); validatePersonnelBusinessRules(record); personnel[index]=record; writePersonnel(personnel); return record; }
module.exports={ getPersonnel, getVisibleResumeRecords, createPersonnel, updatePersonnel };
