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
import { Key, SyntheticEvent, useCallback } from 'react';
import { message } from 'antd';
import { utils, writeFile } from 'xlsx';
import { t } from '@apache-superset/core/translation';
import { css, useTheme } from '@apache-superset/core/theme';
import { Dropdown } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import downloadAsImage from 'src/utils/downloadAsImage';

enum DownloadMenuKeys {
  Csv = 'modal-download-csv',
  Excel = 'modal-download-excel',
  Image = 'modal-download-image',
}

export interface ModalDownloadDropdownProps {
  data: Record<string, any>[];
  columnNames: string[];
  fileName: string;
  // CSS selector resolved via .closest() from the click target;
  // must uniquely identify the modal body wrapper to screenshot.
  imageTargetSelector: string;
  // When provided, called on CSV/Excel export to fetch the full dataset
  // (bypasses in-memory pagination). Falls back to `data` if omitted.
  fetchExportData?: () => Promise<Record<string, any>[]>;
}

const sanitizeFileName = (name: string) =>
  (name || 'chart-data').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart-data';

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFFFF' } },
  fill: {
    patternType: 'solid',
    fgColor: { rgb: 'FF154C79' },
    bgColor: { rgb: 'FF154C79' },
  },
  alignment: { horizontal: 'center', vertical: 'center' },
};

const buildWorksheet = (
  data: Record<string, any>[],
  columnNames: string[],
) => {
  const safeCols = columnNames?.length
    ? columnNames
    : data?.[0]
      ? Object.keys(data[0])
      : [];
  return utils.json_to_sheet(data ?? [], { header: safeCols });
};

const applyHeaderStyle = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  columnNames: string[],
) => {
  columnNames.forEach((name, colIdx) => {
    const cellRef = utils.encode_cell({ r: 0, c: colIdx });
    if (!sheet[cellRef]) {
      sheet[cellRef] = { t: 's', v: name };
    }
    sheet[cellRef].s = HEADER_STYLE;
  });
};

export const ModalDownloadDropdown = ({
  data,
  columnNames,
  fileName,
  imageTargetSelector,
  fetchExportData,
}: ModalDownloadDropdownProps) => {
  const theme = useTheme();
  const { addDangerToast } = useToasts();
  const safeName = sanitizeFileName(fileName);

  const resolveData = useCallback(async () => {
    if (fetchExportData) {
      const rows = await fetchExportData();
      return rows ?? [];
    }
    return data;
  }, [fetchExportData, data]);

  const onExportCsv = useCallback(async () => {
    const dismiss = message.loading(t('Preparing download…'), 0);
    try {
      const rows = await resolveData();
      const sheet = buildWorksheet(rows, columnNames);
      const book = utils.book_new();
      utils.book_append_sheet(book, sheet, 'Data');
      writeFile(book, `${safeName}.csv`, { bookType: 'csv' });
    } catch (e) {
      addDangerToast(t('Sorry, something went wrong. Try again later.'));
    } finally {
      dismiss();
    }
  }, [resolveData, columnNames, safeName, addDangerToast]);

  const onExportExcel = useCallback(async () => {
    const dismiss = message.loading(t('Preparing download…'), 0);
    try {
      const rows = await resolveData();
      const sheet = buildWorksheet(rows, columnNames);
      const headerNames = columnNames?.length
        ? columnNames
        : rows?.[0]
          ? Object.keys(rows[0])
          : [];
      applyHeaderStyle(sheet, headerNames);
      const book = utils.book_new();
      utils.book_append_sheet(book, sheet, 'Data');
      writeFile(book, `${safeName}.xlsx`);
    } catch (e) {
      addDangerToast(t('Sorry, something went wrong. Try again later.'));
    } finally {
      dismiss();
    }
  }, [resolveData, columnNames, safeName, addDangerToast]);

  const onDownloadImage = useCallback(
    (domEvent: SyntheticEvent) => {
      try {
        downloadAsImage(imageTargetSelector, safeName, false, theme)(domEvent);
      } catch (e) {
        addDangerToast(t('Sorry, something went wrong. Try again later.'));
      }
    },
    [imageTargetSelector, safeName, theme, addDangerToast],
  );

  const handleMenuClick = useCallback(
    ({ key, domEvent }: { key: Key; domEvent: SyntheticEvent }) => {
      switch (key) {
        case DownloadMenuKeys.Csv:
          onExportCsv();
          break;
        case DownloadMenuKeys.Excel:
          onExportExcel();
          break;
        case DownloadMenuKeys.Image:
          onDownloadImage(domEvent);
          break;
        default:
          break;
      }
    },
    [onExportCsv, onExportExcel, onDownloadImage],
  );

  const iconStyles = css`
    &&.anticon > .anticon:first-child {
      margin-right: 0;
      vertical-align: 0;
    }
  `;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        onClick: handleMenuClick,
        selectable: false,
        items: [
          {
            key: DownloadMenuKeys.Csv,
            label: t('Export to .CSV'),
            icon: <Icons.FileOutlined css={iconStyles} />,
          },
          {
            key: DownloadMenuKeys.Excel,
            label: t('Export to Excel'),
            icon: <Icons.FileOutlined css={iconStyles} />,
          },
          {
            key: DownloadMenuKeys.Image,
            label: t('Download as image'),
            icon: <Icons.FileImageOutlined css={iconStyles} />,
          },
        ],
      }}
    >
      <Icons.DownloadOutlined
        role="button"
        aria-label={t('Download')}
        iconColor={theme.colorIcon}
        iconSize="l"
        css={css`
          margin-left: ${theme.sizeUnit * 2}px;
          cursor: pointer;
        `}
      />
    </Dropdown>
  );
};

export default ModalDownloadDropdown;
