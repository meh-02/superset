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
}

const sanitizeFileName = (name: string) =>
  (name || 'chart-data').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart-data';

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

export const ModalDownloadDropdown = ({
  data,
  columnNames,
  fileName,
  imageTargetSelector,
}: ModalDownloadDropdownProps) => {
  const theme = useTheme();
  const { addDangerToast } = useToasts();
  const safeName = sanitizeFileName(fileName);

  const onExportCsv = useCallback(() => {
    try {
      const sheet = buildWorksheet(data, columnNames);
      const book = utils.book_new();
      utils.book_append_sheet(book, sheet, 'Data');
      writeFile(book, `${safeName}.csv`, { bookType: 'csv' });
    } catch (e) {
      addDangerToast(t('Sorry, something went wrong. Try again later.'));
    }
  }, [data, columnNames, safeName, addDangerToast]);

  const onExportExcel = useCallback(() => {
    try {
      const sheet = buildWorksheet(data, columnNames);
      const book = utils.book_new();
      utils.book_append_sheet(book, sheet, 'Data');
      writeFile(book, `${safeName}.xlsx`);
    } catch (e) {
      addDangerToast(t('Sorry, something went wrong. Try again later.'));
    }
  }, [data, columnNames, safeName, addDangerToast]);

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
