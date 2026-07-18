/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { utils, write } from 'xlsx';

export default function exportPivotExcel(
  tableSelector: string,
  fileName: string,
) {
  const table = document.querySelector(tableSelector);
  const workbook = utils.table_to_book(table);
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'FF154C79' },
      bgColor: { rgb: 'FF154C79' },
    },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  workbook.SheetNames.forEach((sheetName: string) => {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet['!ref'];
    if (!ref) return;
    const range = utils.decode_range(ref);
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cellRef = utils.encode_cell({ r: range.s.r, c });
      if (sheet[cellRef]) {
        sheet[cellRef].s = headerStyle;
      }
    }
  });
  const wbBuf = write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });
  const blob = new Blob([wbBuf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
