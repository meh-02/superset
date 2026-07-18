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

import { useCallback, useMemo } from 'react';
import { Input } from 'antd';
import { Tag } from 'src/components/Tag';
import { t } from '@apache-superset/core/translation';
import {
  BinaryQueryObjectFilterClause,
  isAdhocColumn,
} from '@superset-ui/core';
import { css, useTheme } from '@apache-superset/core/theme';
import RowCountLabel from 'src/components/RowCountLabel';
import { Icons } from '@superset-ui/core/components/Icons';
import ModalDownloadDropdown from 'src/components/Chart/ModalDownloadDropdown';

export type TableControlsProps = {
  filters: BinaryQueryObjectFilterClause[];
  setFilters: (filters: BinaryQueryObjectFilterClause[]) => void;
  totalCount?: number;
  loading: boolean;
  onReload: () => void;
  exportData?: Record<string, any>[];
  exportColumnNames?: string[];
  fetchExportData?: () => Promise<Record<string, any>[]>;
  directDownload?: (format: 'csv' | 'xlsx') => Promise<void>;
  chartName?: string;
  searchText?: string;
  onSearchChange?: (value: string) => void;
};

export default function TableControls({
  filters,
  setFilters,
  totalCount,
  loading,
  onReload,
  exportData,
  exportColumnNames,
  fetchExportData,
  directDownload,
  chartName,
  searchText = '',
  onSearchChange,
}: TableControlsProps) {
  const theme = useTheme();
  const filterMap: Record<string, BinaryQueryObjectFilterClause> = useMemo(
    () =>
      Object.assign(
        {},
        ...filters.map(filter => ({
          [isAdhocColumn(filter.col)
            ? (filter.col.label as string)
            : filter.col]: filter,
        })),
      ),
    [filters],
  );

  const removeFilter = useCallback(
    colName => {
      const updatedFilterMap = { ...filterMap };
      delete updatedFilterMap[colName];
      setFilters(Object.values(updatedFilterMap));
    },
    [filterMap, setFilters],
  );

  const filterTags = useMemo(
    () =>
      Object.entries(filterMap)
        .map(([colName, { val, formattedVal }]) => ({
          colName,
          val: formattedVal ?? val,
        }))
        .sort((a, b) => a.colName.localeCompare(b.colName)),
    [filterMap],
  );

  return (
    <div
      css={css`
        display: flex;
        justify-content: space-between;
        padding: ${theme.sizeUnit / 2}px 0;
        margin-bottom: ${theme.sizeUnit * 2}px;
      `}
    >
      <div
        css={css`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: ${theme.sizeUnit * 2}px;
        `}
      >
        {onSearchChange && (
          <Input
            prefix={<Icons.SearchOutlined iconSize="s" />}
            placeholder={t('Search')}
            value={searchText}
            onChange={e => onSearchChange(e.target.value)}
            allowClear
            css={css`
              width: 200px;
            `}
          />
        )}
        {filterTags.map(({ colName, val }, index) => (
          <Tag
            editable
            onDelete={removeFilter.bind(null, colName)}
            index={index}
            id={index}
            key={colName}
            name={`${colName}=${val}`}
            data-test="filter-col"
          >
            <span
              css={css`
                margin-right: ${theme.sizeUnit}px;
              `}
            >
              {colName}
            </span>
            <strong data-test="filter-val">{val}</strong>
          </Tag>
        ))}
      </div>
      <div
        css={css`
          display: flex;
          align-items: center;
          height: min-content;
        `}
      >
        <RowCountLabel loading={loading && !totalCount} rowcount={totalCount} />
        <Icons.ReloadOutlined
          iconColor={theme.colorIcon}
          iconSize="l"
          aria-label={t('Reload')}
          role="button"
          onClick={onReload}
        />
        {exportData && exportColumnNames && (
          <ModalDownloadDropdown
            data={exportData}
            columnNames={exportColumnNames}
            fileName={chartName || 'drill-to-detail'}
            imageTargetSelector=".drill-detail-modal-target"
            fetchExportData={fetchExportData}
            directDownload={directDownload}
          />
        )}
      </div>
    </div>
  );
}
