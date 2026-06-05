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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import orderBy from 'lodash/orderBy';
import { SortByType } from '@superset-ui/core/components/TableView/types';
import { useSelector } from 'react-redux';
import { t } from '@apache-superset/core/translation';
import {
  BinaryQueryObjectFilterClause,
  DatasourceType,
  ensureIsArray,
  JsonObject,
  QueryFormData,
} from '@superset-ui/core';
import { css, useTheme } from '@apache-superset/core/theme';
import { GenericDataType } from '@apache-superset/core/common';
import {
  EmptyState,
  EmptyWrapperType,
  Loading,
  TableView,
} from '@superset-ui/core/components';
import { getDatasourceSamples } from 'src/components/Chart/chartAction';
import { RootState } from 'src/dashboard/types';
import { useTableColumns, useFilteredTableData } from 'src/explore/components/DataTableControl';
import { useDatasetMetadataBar } from 'src/features/datasets/metadataBar/useDatasetMetadataBar';
import { applyFormattingToTabularData } from 'src/utils/common';
import { Dataset } from '../types';
import TableControls from './DrillDetailTableControls';
import { getDrillPayload } from './utils';
import { ResultsPage } from './types';

const PAGE_SIZE = 50;

export default function DrillDetailPane({
  formData,
  initialFilters,
  dataset,
  chartName,
}: {
  formData: QueryFormData;
  initialFilters: BinaryQueryObjectFilterClause[];
  dataset?: Dataset;
  chartName?: string;
}) {
  const theme = useTheme();
  const [pageIndex, setPageIndex] = useState(0);
  // Cached previous page index so we can keep rendering the prior page's
  // data while a new page is being fetched (avoids a "blank" frame).
  const lastPageIndex = useRef(pageIndex);
  const [filters, setFilters] = useState(initialFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [responseError, setResponseError] = useState('');
  const [resultsPages, setResultsPages] = useState<Map<number, ResultsPage>>(
    new Map(),
  );
  // Forces TableView to remount when filters change or reload is clicked, so
  // its internal react-table pagination state resets to initialPageIndex=0.
  const [dataSetVersion, setDataSetVersion] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<SortByType>([]);

  const dashboardId = useSelector<RootState, number>(
    ({ dashboardInfo }) => dashboardInfo.id,
  );

  const SAMPLES_ROW_LIMIT = useSelector(
    (state: { common: { conf: JsonObject } }) =>
      state.common.conf.SAMPLES_ROW_LIMIT,
  );

  // Extract datasource ID/type from compound string ID like "1__table"
  const [datasourceId, datasourceType] = useMemo(
    () => formData.datasource.split('__'),
    [formData.datasource],
  );

  const { metadataBar: metadataBarComponent } = useDatasetMetadataBar({
    dataset,
  });

  // Get page of results
  const resultsPage = useMemo(() => {
    const nextResultsPage = resultsPages.get(pageIndex);
    if (nextResultsPage) {
      lastPageIndex.current = pageIndex;
      return nextResultsPage;
    }
    return resultsPages.get(lastPageIndex.current);
  }, [pageIndex, resultsPages]);

  // Shape current page rows as an array of objects keyed by column name —
  // matches what react-table (via useTableColumns) expects.
  const data = useMemo(
    () =>
      resultsPage?.data.map(row =>
        resultsPage?.colNames.reduce(
          (acc, curr) => ({ ...acc, [curr]: row[curr] }),
          {} as Record<string, any>,
        ),
      ) || [],
    [resultsPage?.colNames, resultsPage?.data],
  );

  // Build TableView columns using the same helper View-as-table uses —
  // ensures identical rendering / formatting for the temporal, boolean,
  // null and HTML cells.
  const allowHTML = formData.allow_render_html ?? true;
  const columns = useTableColumns(
    resultsPage?.colNames,
    resultsPage?.colTypes,
    data,
    formData.datasource,
    !!resultsPage,
    {},
    allowHTML,
    dataset?.verbose_map,
  );

  const filteredData = useFilteredTableData(searchText, data);

  const sortedFilteredData = useMemo(() => {
    if (!sortBy.length) return filteredData;
    return orderBy(
      filteredData,
      sortBy.map((s: { id: string; desc?: boolean }) => s.id),
      sortBy.map((s: { id: string; desc?: boolean }) => (s.desc ? 'desc' : 'asc')),
    );
  }, [filteredData, sortBy]);

  // Format temporal columns so CSV/Excel exports show dates instead of raw
  // epochs.
  const exportData = useMemo(() => {
    if (!resultsPage) return [];
    const temporalCols = resultsPage.colNames.filter(
      (_, idx) => resultsPage.colTypes[idx] === GenericDataType.Temporal,
    );
    return applyFormattingToTabularData(data, temporalCols);
  }, [data, resultsPage]);

  // Clear cache on reload button click
  const handleReload = useCallback(() => {
    setResponseError('');
    setResultsPages(new Map());
    setPageIndex(0);
    setDataSetVersion(v => v + 1);
  }, []);

  // Clear cache and reset page index if filters change
  useEffect(() => {
    setResponseError('');
    setResultsPages(new Map());
    setPageIndex(0);
    setDataSetVersion(v => v + 1);
  }, [filters]);

  // Update cache order if page in cache (LRU)
  useEffect(() => {
    if (
      resultsPages.has(pageIndex) &&
      [...resultsPages.keys()].at(-1) !== pageIndex
    ) {
      const nextResultsPages = new Map(resultsPages);
      nextResultsPages.delete(pageIndex);
      setResultsPages(
        nextResultsPages.set(
          pageIndex,
          resultsPages.get(pageIndex) as ResultsPage,
        ),
      );
    }
  }, [pageIndex, resultsPages]);

  // Download page of results & trim cache if page not in cache
  useEffect(() => {
    if (!responseError && !isLoading && !resultsPages.has(pageIndex)) {
      setIsLoading(true);
      const jsonPayload = getDrillPayload(formData, filters) ?? {};
      const cachePageLimit = Math.ceil(SAMPLES_ROW_LIMIT / PAGE_SIZE);
      getDatasourceSamples(
        datasourceType as DatasourceType,
        Number(datasourceId),
        false,
        jsonPayload,
        PAGE_SIZE,
        pageIndex + 1,
        dashboardId,
      )
        .then(response => {
          setResultsPages(
            new Map([
              ...[...resultsPages.entries()].slice(-cachePageLimit + 1),
              [
                pageIndex,
                {
                  total: response.total_count,
                  data: response.data,
                  colNames: ensureIsArray(response.colnames),
                  colTypes: ensureIsArray(response.coltypes),
                },
              ],
            ]),
          );
          setResponseError('');
        })
        .catch(error => {
          setResponseError(`${error.name}: ${error.message}`);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [
    SAMPLES_ROW_LIMIT,
    datasourceId,
    datasourceType,
    filters,
    formData,
    isLoading,
    pageIndex,
    responseError,
    resultsPages,
  ]);

  const bootstrapping = !responseError && !resultsPages.size;

  let tableContent = null;
  if (responseError) {
    tableContent = (
      <pre
        css={css`
          margin-top: ${theme.sizeUnit * 4}px;
        `}
      >
        {responseError}
      </pre>
    );
  } else if (bootstrapping) {
    tableContent = <Loading />;
  } else if (resultsPage?.total === 0) {
    tableContent = (
      <EmptyState
        image="document.svg"
        title={t('No rows were returned for this dataset')}
      />
    );
  } else {
    // TableView is the same component View-as-table uses. Its native
    // server-side pagination support drives `setPageIndex`, which feeds
    // back into the existing page-fetch effect above. Remount-on-filter-
    // change (via `dataSetVersion` key) resets react-table's internal
    // pageIndex to the initial value (0).
    tableContent = (
      <TableView
        key={dataSetVersion}
        columns={columns}
        data={sortedFilteredData}
        pageSize={PAGE_SIZE}
        serverPagination
        totalCount={resultsPage?.total ?? 0}
        initialPageIndex={pageIndex}
        initialSortBy={sortBy}
        onServerPagination={({ pageIndex: p, sortBy: sb }: { pageIndex: number; sortBy?: SortByType }) => {
          if (sb !== undefined) {
            setSortBy(sb);
          } else {
            setPageIndex(p);
          }
        }}
        loading={isLoading}
        emptyWrapperType={EmptyWrapperType.Small}
        showRowCount={false}
        scrollTable
        stickyHeader
        resizable
        small
      />
    );
  }

  return (
    <div
      className="drill-detail-modal-target"
      css={css`
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      `}
    >
      {!bootstrapping && metadataBarComponent}
      {!bootstrapping && (
        <TableControls
          filters={filters}
          setFilters={setFilters}
          totalCount={resultsPage?.total}
          loading={isLoading}
          onReload={handleReload}
          exportData={exportData}
          exportColumnNames={resultsPage?.colNames || []}
          chartName={chartName}
          searchText={searchText}
          onSearchChange={setSearchText}
        />
      )}
      {tableContent}
    </div>
  );
}
