// ═══ EXCEL (.xlsx) SIN LIBRERÍAS ═══
// Un .xlsx es un zip con unos XML adentro. Acá se arma una sola hoja con los
// estilos justos para imprimir (títulos, encabezados, bordes, plata) y se
// guarda sin comprimir, que Excel lo abre igual.
//
// hoja = {
//   nombre: 'Cobros',
//   anchos: [16, 20, ...],                  // ancho de cada columna (en caracteres)
//   filas: [[celda, celda, ...], ...],      // celda: null | texto | número | { v, e } (e = estilo)
//   combinar: ['A1:G1', ...],
//   horizontal: true,                        // hoja apaisada
// }
// Estilos (e): titulo, sub, encabezado, grupo, celda, plata, total, totalPlata, ajustar

const XLSX_ESTILOS = { normal: 0, titulo: 1, sub: 2, encabezado: 3, grupo: 4, celda: 5, plata: 6, total: 7, totalPlata: 8, ajustar: 9 };

function xlsxEscapar(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function xlsxColumna(i) {   // 0 → A, 26 → AA
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

function xlsxHojaXml(hoja) {
  const filas = hoja.filas.map((fila, r) => {
    const celdas = fila.map((c, col) => {
      if (c === null || c === undefined) return '';
      const obj = typeof c === 'object' ? c : { v: c };
      const ref = xlsxColumna(col) + (r + 1);
      const s = XLSX_ESTILOS[obj.e] || 0;
      if (obj.v === null || obj.v === undefined || obj.v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
      if (typeof obj.v === 'number' && isFinite(obj.v)) return `<c r="${ref}" s="${s}"><v>${obj.v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xlsxEscapar(obj.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');
  const cols = (hoja.anchos || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const combinar = (hoja.combinar || []).length
    ? `<mergeCells count="${hoja.combinar.length}">${hoja.combinar.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${filas}</sheetData>`
    + combinar
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + `<pageSetup paperSize="9" orientation="${hoja.horizontal ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
    + '</worksheet>';
}

const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/></numFmts>'
  + '<fonts count="5">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="15"/><name val="Calibri"/></font>'
  + '<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="12"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="5">'
  + '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>'
  + '<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="10">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'                                                     // normal
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                       // titulo
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                       // sub
  + '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'        // encabezado
  + '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'        // grupo
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' // celda
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' // plata
  + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' // total
  + '<xf numFmtId="164" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' // totalPlata
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' // ajustar
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// ── ZIP sin comprimir ──
const _crcTabla = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function _crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _crcTabla[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipSinComprimir(archivos) {   // [{ nombre, texto }]
  const enc = new TextEncoder();
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const partes = [], central = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre), datos = enc.encode(a.texto), crc = _crc32(datos);
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x0800, true);
    cab.setUint16(8, 0, true); cab.setUint16(10, hora, true); cab.setUint16(12, fecha, true);
    cab.setUint32(14, crc, true); cab.setUint32(18, datos.length, true); cab.setUint32(22, datos.length, true);
    cab.setUint16(26, nombre.length, true); cab.setUint16(28, 0, true);
    partes.push(cab.buffer, nombre, datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, hora, true); cen.setUint16(14, fecha, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nombre.length, true); cen.setUint32(42, offset, true);
    central.push(cen.buffer, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.byteLength, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, fin.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function crearXlsx(hoja) {
  const nombreHoja = xlsxEscapar(String(hoja.nombre || 'Hoja1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zipSinComprimir([
    { nombre: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nombre: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nombreHoja}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nombre: 'xl/styles.xml', texto: XLSX_STYLES },
    { nombre: 'xl/worksheets/sheet1.xml', texto: xlsxHojaXml(hoja) },
  ]);
}

// Baja un archivo armado en el navegador
function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
