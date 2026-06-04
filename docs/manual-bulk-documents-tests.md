# Pruebas manuales: carga masiva de documentos

Fecha base de validacion: `2026-06-02`

## Preparacion

1. Ingresar con un usuario autenticado de la empresa objetivo.
2. Abrir `Gestion personal -> Documentos del empleado`.
3. Entrar al modal `Carga masiva de documentos`.

## Casos a validar

### 1. Archivos correctamente nombrados

- Subir varios archivos como:
  - `CC_ANGELICA_ZULENY_CARBONELL.pdf`
  - `HV_JUAN_CARLOS_PEREZ.pdf`
- Esperado:
  - Tipo documental detectado automaticamente.
  - Trabajador detectado automaticamente si la coincidencia es unica.
  - Estado `Listo para cargar`.

### 2. Nombres con tildes

- Subir un archivo como:
  - `CC_MARIA_JOSE_GOMEZ_PEÑA.pdf`
- Esperado:
  - La normalizacion quite tildes y caracteres especiales.
  - La coincidencia funcione contra el nombre del trabajador guardado.

### 3. Nombre incompleto

- Subir un archivo como:
  - `CC_JUAN_PEREZ.pdf`
- Esperado:
  - Estado `Requiere revision` si hay varias coincidencias o si la coincidencia no es exacta.
  - El selector manual permita escoger al trabajador correcto.

### 4. Homonimos

- Subir un archivo con un nombre que exista en mas de un empleado.
- Esperado:
  - No se asocie automaticamente.
  - El estado quede en `Requiere revision`.

### 5. Tipo documental desconocido

- Subir un archivo como:
  - `XYZ_PEDRO_RAMIREZ.pdf`
- Esperado:
  - Estado `Tipo no reconocido`.
  - El selector manual permita escoger un tipo documental valido.

### 6. Archivo ZIP

- Subir un ZIP con mezcla de PDF, JPG y PNG validos.
- Esperado:
  - El backend descomprima y liste cada archivo interno por separado.
  - Los archivos no validos dentro del ZIP aparezcan con estado `Error`.

### 7. Documento ya existente

- Subir un archivo de un trabajador que ya tenga el mismo tipo documental.
- Esperado:
  - La fila muestre `Documento existente`.
  - Permita seleccionar:
    - `Conservar ambos`
    - `Reemplazar logico`
    - `Marcar nueva version`

### 8. Confirmacion de carga

- Confirmar el lote despues de revisar las filas.
- Esperado:
  - Se procese solo lo no omitido.
  - Se muestre resumen final con:
    - total recibidos
    - asociados correctamente
    - pendientes por revision
    - no encontrados
    - con error
    - omitidos
  - El enlace `Descargar reporte CSV` quede habilitado.

### 9. Compatibilidad con carga individual

- Desde el mismo modulo, cargar un PDF usando el formulario individual existente.
- Esperado:
  - La carga individual siga guardando sin errores.
  - El documento siga apareciendo en el checklist del empleado.

### 10. Validacion y rechazo posteriores

- Abrir un documento proveniente de carga masiva.
- Validarlo y rechazarlo desde la misma pantalla.
- Esperado:
  - Ambas acciones sigan funcionando.
  - El estado cambie en el checklist.
