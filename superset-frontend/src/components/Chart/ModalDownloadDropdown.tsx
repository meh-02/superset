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

enum MenuKey {
  Csv = 'csv',
  Excel = 'excel',
  Image = 'image',
}

export interface ModalDownloadDropdownProps {
  data: Record<string, any>[];
  columnNames: string[];
  fileName: string;
  // Selector for the modal body to screenshot.
  // Resolved via document.querySelector — must be unique.
  imageTargetSelector: string;
}

const sanitizeFileName = (name: string) =>
  (name || 'chart-data').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart-data';

const buildSheet = (data: Record<string, any>[], columnNames: string[]) => {
  const header = columnNames?.length
    ? columnNames
    : data?.[0]
      ? Object.keys(data[0])
      : [];
  return utils.json_to_sheet(data ?? [], { header });
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

  const writeBook = useCallback(
    (ext: 'csv' | 'xlsx') => {
      const book = utils.book_new();
      utils.book_append_sheet(book, buildSheet(data, columnNames), 'Data');
      writeFile(
        book,
        `${safeName}.${ext}`,
        ext === 'csv' ? { bookType: 'csv' } : undefined,
      );
    },
    [data, columnNames, safeName],
  );

  const handleClick = useCallback(
    ({ key, domEvent }: { key: Key; domEvent: SyntheticEvent }) => {
      try {
        if (key === MenuKey.Csv) writeBook('csv');
        else if (key === MenuKey.Excel) writeBook('xlsx');
        else if (key === MenuKey.Image) {
          // isExactSelector=true so the lookup is document.querySelector,
          // because the dropdown menu item is portaled outside the modal.
          downloadAsImage(imageTargetSelector, safeName, true, theme)(domEvent);
        }
      } catch {
        addDangerToast(t('Sorry, something went wrong. Try again later.'));
      }
    },
    [writeBook, imageTargetSelector, safeName, theme, addDangerToast],
  );

  const iconCss = css`
    &&.anticon > .anticon:first-child {
      margin-right: 0;
      vertical-align: 0;
    }
  `;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        onClick: handleClick,
        selectable: false,
        items: [
          {
            key: MenuKey.Csv,
            label: t('Export to .CSV'),
            icon: <Icons.FileOutlined css={iconCss} />,
          },
          {
            key: MenuKey.Excel,
            label: t('Export to Excel'),
            icon: <Icons.FileOutlined css={iconCss} />,
          },
          {
            key: MenuKey.Image,
            label: t('Download as image'),
            icon: <Icons.FileImageOutlined css={iconCss} />,
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
