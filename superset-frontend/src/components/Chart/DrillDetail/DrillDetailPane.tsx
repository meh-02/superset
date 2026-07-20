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
import { SupersetClient } from '@superset-ui/core';
import { RootState } from 'src/dashboard/types';
import { useTableColumns, useFilteredTableData } from 'src/explore/components/DataTableControl';
import { useDatasetMetadataBar } from 'src/features/datasets/metadataBar/useDatasetMetadataBar';
import { applyFormattingToTabularData } from 'src/utils/common';
import { Dataset } from '../types';
import TableControls from './DrillDetailTableControls';
import { getDrillPayload } from './utils';
import { ResultsPage } from './types';

const PAGE_SIZE = 50;
// Larger chunk size used only by the background prefetch that powers the
// download button. The visible pagination still uses PAGE_SIZE.
const EXPORT_PAGE_SIZE = 500;

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
  const rawResultsPage = useMemo(() => {
    const nextResultsPage = resultsPages.get(pageIndex);
    if (nextResultsPage) {
      lastPageIndex.current = pageIndex;
      return nextResultsPage;
    }
    return resultsPages.get(lastPageIndex.current);
  }, [pageIndex, resultsPages]);

  // Set of column names the dataset owner has hidden from Drill to Detail
  // via the per-column toggle in Edit Dataset. Missing/undefined values from
  // older datasets are treated as enabled.
  const drillToDetailDisabledColumns = useMemo(() => {
    const disabled = new Set<string>();
    (dataset?.columns ?? []).forEach(col => {
      if (col.is_drill_to_detail === false && col.column_name) {
        disabled.add(col.column_name);
      }
    });
    return disabled;
  }, [dataset?.columns]);

  // resultsPage view that drops hidden columns. Data rows are untouched
  // (extra keys are harmless); only colNames/colTypes shrink so both the
  // table display and the download honor the toggle.
  const resultsPage = useMemo(() => {
    if (!rawResultsPage) return rawResultsPage;
    if (!drillToDetailDisabledColumns.size) return rawResultsPage;
    const keptIndices = rawResultsPage.colNames
      .map((name, idx) =>
        drillToDetailDisabledColumns.has(name) ? -1 : idx,
      )
      .filter(idx => idx !== -1);
    return {
      ...rawResultsPage,
      colNames: keptIndices.map(i => rawResultsPage.colNames[i]),
      colTypes: keptIndices.map(i => rawResultsPage.colTypes[i]),
    };
  }, [rawResultsPage, drillToDetailDisabledColumns]);

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

  // Compute display labels (verbose_map → replace _ → UPPERCASE) for export headers
  const exportDisplayColumnNames = useMemo(
    () =>
      (resultsPage?.colNames ?? []).map(k =>
        (dataset?.verbose_map?.[k] ?? k).replace(/_/g, ' ').toUpperCase(),
      ),
    [resultsPage?.colNames, dataset?.verbose_map],
  );

  // Remap export data keys to display labels so downloaded files show proper headers
  const exportDataWithDisplayNames = useMemo(
    () =>
      exportData.map(row =>
        Object.fromEntries(
          (resultsPage?.colNames ?? []).map((k, i) => [
            exportDisplayColumnNames[i],
            row[k],
          ]),
        ),
      ),
    [exportData, resultsPage?.colNames, exportDisplayColumnNames],
  );

  const handleServerPagination = useCallback(
    ({ pageIndex: p, sortBy: sb }: { pageIndex: number; sortBy?: SortByType }) => {
      if (sb !== undefined) {
        setSortBy(sb);
      } else {
        setPageIndex(p);
      }
    },
    [],
  );

  // Cached "all rows" for export. Populated in the background as soon as the
  // first page (and thus total count) is known, so the download button
  // resolves instantly instead of waiting on API round-trips at click time.
  const [prefetchedExportRows, setPrefetchedExportRows] = useState<
    Record<string, any>[] | null
  >(null);
  const prefetchInFlightRef = useRef(false);

  // Fetches ALL rows by paginating through the same 50-per-page endpoint the
  // modal uses (parallelized). A single giant per_page request has proven
  // slow, so we mirror the page size the backend is already serving quickly.
  const fetchAllExportRows = useCallback(async () => {
    const total = resultsPage?.total ?? 0;
    if (!total) return [];
    const jsonPayload = getDrillPayload(formData, filters) ?? {};
    const pageCount = Math.ceil(total / EXPORT_PAGE_SIZE);
    const responses = await Promise.all(
      Array.from({ length: pageCount }, (_, i) =>
        getDatasourceSamples(
          datasourceType as DatasourceType,
          Number(datasourceId),
          false,
          jsonPayload,
          EXPORT_PAGE_SIZE,
          i + 1,
          dashboardId,
        ),
      ),
    );
    const first = responses[0] ?? { colnames: [], coltypes: [], data: [] };
    const allColNames = ensureIsArray(first.colnames) as string[];
    const allColTypes = ensureIsArray(first.coltypes) as GenericDataType[];
    const rawRows = responses.flatMap(
      (r: JsonObject) => (r.data ?? []) as Record<string, any>[],
    );
    const asObjects = rawRows.map((row: Record<string, any>) =>
      allColNames.reduce(
        (acc, col) => ({ ...acc, [col]: row[col] }),
        {} as Record<string, any>,
      ),
    );
    const temporalCols = allColNames.filter(
      (_, idx) => allColTypes[idx] === GenericDataType.Temporal,
    );
    const formatted = applyFormattingToTabularData(asObjects, temporalCols);
    const displayNames = allColNames.map(k =>
      (dataset?.verbose_map?.[k] ?? k).replace(/_/g, ' ').toUpperCase(),
    );
    return formatted.map(row =>
      Object.fromEntries(
        allColNames.map((k, i) => [displayNames[i], row[k]]),
      ),
    );
  }, [
    resultsPage?.total,
    formData,
    filters,
    datasourceType,
    datasourceId,
    dashboardId,
    dataset?.verbose_map,
  ]);

  // Reset the prefetch cache whenever filters or the underlying dataset
  // change — otherwise stale rows would slip into a subsequent download.
  useEffect(() => {
    setPrefetchedExportRows(null);
    prefetchInFlightRef.current = false;
  }, [filters, dataSetVersion]);

  // Prefetch all rows in the background as soon as the modal knows the total.
  useEffect(() => {
    if (
      !resultsPage?.total ||
      prefetchedExportRows !== null ||
      prefetchInFlightRef.current
    ) {
      return;
    }
    prefetchInFlightRef.current = true;
    fetchAllExportRows()
      .then(rows => setPrefetchedExportRows(rows))
      .catch(() => setPrefetchedExportRows([]))
      .finally(() => {
        prefetchInFlightRef.current = false;
      });
  }, [resultsPage?.total, prefetchedExportRows, fetchAllExportRows]);

  // Prefer cached rows when the download button is clicked; fall back to a
  // just-in-time fetch if the prefetch hasn't landed yet.
  const resolveExportRows = useCallback(async () => {
    if (prefetchedExportRows) return prefetchedExportRows;
    const rows = await fetchAllExportRows();
    setPrefetchedExportRows(rows);
    return rows;
  }, [prefetchedExportRows, fetchAllExportRows]);

  // Streams the drill-detail dataset from the backend as a single file,
  // bypassing the paginated JSON API entirely — the right path when the row
  // count is too large for the browser to hold in memory or write with
  // SheetJS.
  const directDownload = useCallback(
    async (format: 'csv' | 'xlsx') => {
      const jsonPayload = getDrillPayload(formData, filters) ?? {};
      const filename = (
        chartName ??
        (formData?.slice_name as string | undefined) ??
        'drill-to-detail'
      )
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || 'drill-to-detail';
      const searchParams: Record<string, string | number | boolean> = {
        datasource_type: datasourceType,
        datasource_id: Number(datasourceId),
        force: false,
        format,
        filename,
      };
      if (dashboardId != null) {
        searchParams.dashboard_id = dashboardId;
      }
      const response = (await SupersetClient.post({
        endpoint: '/datasource/samples/download',
        jsonPayload,
        searchParams,
        parseMethod: null,
      })) as unknown as Response;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    [
      formData,
      filters,
      chartName,
      datasourceType,
      datasourceId,
      dashboardId,
    ],
  );

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
        onServerPagination={handleServerPagination}
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
          exportData={exportDataWithDisplayNames}
          exportColumnNames={exportDisplayColumnNames}
          fetchExportData={resolveExportRows}
          directDownload={directDownload}
          chartName={chartName}
          searchText={searchText}
          onSearchChange={setSearchText}
        />
      )}
      {tableContent}
    </div>
  );
}
