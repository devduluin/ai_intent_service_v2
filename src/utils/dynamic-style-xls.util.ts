// Dynamic XLS Styles - Simplified version
import type { Worksheet } from 'exceljs';

export interface XlsStyle {
  name: string;
  header: any;
  row: any;
  alternatingRow?: any;
}

export const blueStyle: XlsStyle = {
  name: 'blue',
  header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2196F3' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } },
  row: { font: { color: { argb: 'FF333333' }, size: 11 } },
  alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } } }
};

export const tealStyle: XlsStyle = {
  name: 'teal',
  header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF009688' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } },
  row: { font: { color: { argb: 'FF333333' }, size: 11 } },
  alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2F1' } } }
};

export const greenStyle: XlsStyle = { name: 'green', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } }, row: { font: { color: { argb: 'FF333333' }, size: 11 } }, alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } } };
export const purpleStyle: XlsStyle = { name: 'purple', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9C27B0' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } }, row: { font: { color: { argb: 'FF333333' }, size: 11 } }, alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E5F5' } } } };
export const orangeStyle: XlsStyle = { name: 'orange', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF9800' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } }, row: { font: { color: { argb: 'FF333333' }, size: 11 } }, alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } } } };
export const redStyle: XlsStyle = { name: 'red', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF44336' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } }, row: { font: { color: { argb: 'FF333333' }, size: 11 } }, alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } } } };
export const darkStyle: XlsStyle = { name: 'dark', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF424242' } }, font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 }, alignment: { vertical: 'middle', horizontal: 'center' } }, row: { font: { color: { argb: 'FF333333' }, size: 11 } }, alternatingRow: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } } } };
export const minimalStyle: XlsStyle = { name: 'minimal', header: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }, font: { color: { argb: 'FF333333' }, bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' } }, row: { font: { color: { argb: 'FF555555' }, size: 11 } } };

export const XLS_STYLES: Record<string, XlsStyle> = { blue: blueStyle, teal: tealStyle, green: greenStyle, purple: purpleStyle, orange: orangeStyle, red: redStyle, dark: darkStyle, minimal: minimalStyle };
export const STYLE_NAMES = Object.keys(XLS_STYLES);
export function getStyleByName(name: string): XlsStyle { return XLS_STYLES[name] || blueStyle; }
export function getRandomStyle(): XlsStyle { return XLS_STYLES[STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)]]; }
export function getStyle(name: string | 'random' = 'blue'): XlsStyle { return name === 'random' ? getRandomStyle() : getStyleByName(name); }

// ✅ REMOVED: applyHeaderStyle - use per-cell styling in fileGenerator.service.ts instead

export function applyRowStyles(worksheet: Worksheet, style: XlsStyle): void {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (style.row.font) row.font = style.row.font;
    if (style.alternatingRow && rowNumber % 2 === 0) row.fill = style.alternatingRow.fill;
    row.height = 20;
  });
}

export function autoWidthColumns(worksheet: Worksheet): void {
  const columnWidths: { [key: string]: number } = {};
  worksheet.eachRow(row => {
    row.eachCell((cell, colNumber) => {
      const columnKey = worksheet.getColumn(colNumber).key as string;
      const cellLength = cell.value ? String(cell.value).length : 0;
      if (!columnWidths[columnKey] || cellLength > columnWidths[columnKey]) columnWidths[columnKey] = cellLength;
    });
  });
  worksheet.columns.forEach(column => { if (column) { const key = column.key as string; if (columnWidths[key]) column.width = Math.min(columnWidths[key] + 2, 50); } });
}
