"use strict";

import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { escapeHtml, escapeAttr } from '../utils.js';
import { showError, showSuccess, showWarning } from '../toast.js';

export async function loadSstModule() {
  return `
    <div class="sst-module">
      <div class="personnel-premium-card" style="max-width:860px;margin:0 auto">
        <div class="personnel-premium-header">
          <div>
            <span class="personnel-premium-eyebrow">Gestión</span>
            <h2>Seguridad y Salud en el Trabajo</h2>
            <p class="personnel-premium-subtitle">Registro, seguimiento y control de actividades SST del programa PAE.</p>
          </div>
        </div>

        <div class="sst-sections" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;padding:24px">
          <div class="sst-card" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">🦺</div>
            <h4 style="margin:0 0 6px;color:#15803d;font-size:15px">Incidentes y Accidentes</h4>
            <p style="margin:0;font-size:13px;color:#166534">Registra y hace seguimiento de incidentes laborales, accidentes de trabajo y enfermedades profesionales.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstIncidentes">Ver registros</button>
          </div>

          <div class="sst-card" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">⚠️</div>
            <h4 style="margin:0 0 6px;color:#1d4ed8;font-size:15px">Identificación de Riesgos</h4>
            <p style="margin:0;font-size:13px;color:#1e40af">Gestiona la matriz de riesgos y peligros identificados en los sitios de trabajo del programa.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstRiesgos">Ver matriz</button>
          </div>

          <div class="sst-card" style="background:#fefce8;border:1px solid #fef08a;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">📋</div>
            <h4 style="margin:0 0 6px;color:#854d0e;font-size:15px">Capacitaciones SST</h4>
            <p style="margin:0;font-size:13px;color:#713f12">Registra las capacitaciones en seguridad y salud realizadas al personal del PAE.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstCapacitaciones">Ver capacitaciones</button>
          </div>

          <div class="sst-card" style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">🩺</div>
            <h4 style="margin:0 0 6px;color:#7e22ce;font-size:15px">Exámenes Médicos</h4>
            <p style="margin:0;font-size:13px;color:#6b21a8">Controla el estado de exámenes médicos de ingreso, periódicos y de egreso del personal.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstExamenes">Ver exámenes</button>
          </div>

          <div class="sst-card" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">🔒</div>
            <h4 style="margin:0 0 6px;color:#c2410c;font-size:15px">Elementos de Protección</h4>
            <p style="margin:0;font-size:13px;color:#9a3412">Gestiona la entrega y control de elementos de protección personal (EPP) al personal.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstEpp">Ver EPP</button>
          </div>

          <div class="sst-card" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px">
            <div style="font-size:28px;margin-bottom:8px">📊</div>
            <h4 style="margin:0 0 6px;color:#0369a1;font-size:15px">Indicadores SST</h4>
            <p style="margin:0;font-size:13px;color:#075985">Consulta los indicadores de gestión SST: frecuencia, severidad, ausentismo y más.</p>
            <button type="button" class="btn btn-primary btn-row" style="margin-top:12px" id="btnSstIndicadores">Ver indicadores</button>
          </div>
        </div>

        <div style="padding:0 24px 24px">
          <div class="personnel-note-box" style="background:#f8fafc;border-color:#e2e8f0">
            <strong>Módulo en desarrollo</strong> — Las funcionalidades de este módulo están siendo implementadas.
            Los registros actuales se pueden gestionar desde el expediente de cada empleado en Gestión de Personal.
          </div>
        </div>
      </div>
    </div>
  `;
}
