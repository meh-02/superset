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
import {
  MouseEvent,
  Key,
  KeyboardEvent,
  useState,
  useRef,
  RefObject,
} from 'react';
import { Modal, Select, Input, Popover } from 'antd';
import { RouteComponentProps, useHistory } from 'react-router-dom';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { t } from '@apache-superset/core/translation';
import {
  Behavior,
  isFeatureEnabled,
  FeatureFlag,
  getChartMetadataRegistry,
  VizType,
  BinaryQueryObjectFilterClause,
  QueryFormData,
  BinaryAdhocFilter,
  SupersetClient
} from '@superset-ui/core';
import { css, useTheme, styled } from '@apache-superset/core/theme';
import { useSelector, useDispatch } from 'react-redux';
import { Menu, MenuItem } from '@superset-ui/core/components/Menu';
import {
  NoAnimationDropdown,
  Tooltip,
  Button,
  ModalTrigger,
} from '@superset-ui/core/components';
import downloadAsImage from 'src/utils/downloadAsImage';
import { getSliceHeaderTooltip } from 'src/dashboard/util/getSliceHeaderTooltip';
import { Icons } from '@superset-ui/core/components/Icons';
import ViewQueryModal from 'src/explore/components/controls/ViewQueryModal';
import { ResultsPaneOnDashboard } from 'src/explore/components/DataTablesPane';
import { useDrillDetailMenuItems } from 'src/components/Chart/useDrillDetailMenuItems';
import { LOG_ACTIONS_CHART_DOWNLOAD_AS_IMAGE } from 'src/logger/LogUtils';
import { MenuKeys, RootState } from 'src/dashboard/types';
import DrillDetailModal from 'src/components/Chart/DrillDetail/DrillDetailModal';
import { usePermissions } from 'src/hooks/usePermissions';
import { useDatasetDrillInfo } from 'src/hooks/apiResources/datasets';
import { ResourceStatus } from 'src/hooks/apiResources/apiResources';
import { useCrossFiltersScopingModal } from '../nativeFilters/FilterBar/CrossFilters/ScopingModal/useCrossFiltersScopingModal';
import { ViewResultsModalTrigger } from './ViewResultsModalTrigger';
import AdhocFilter from 'src/explore/components/controls/FilterControl/AdhocFilter';
import AdhocFilterPopoverTrigger from 'src/explore/components/controls/FilterControl/AdhocFilterPopoverTrigger';
import {
  CommonFrame,
  CalendarFrame,
  CustomFrame,
  AdvancedFrame,
} from 'src/explore/components/controls/DateFilterControl/components';
import { CurrentCalendarFrame } from 'src/explore/components/controls/DateFilterControl/components/CurrentCalendarFrame';
import {
  FRAME_OPTIONS,
  guessFrame,
} from 'src/explore/components/controls/DateFilterControl/utils';
import type { FrameType } from 'src/explore/components/controls/DateFilterControl/types';
import {
  updateQueryFormData,
  updateChartFormData,
  triggerQuery,
  postChartFormData,
} from 'src/components/Chart/chartAction';

const RefreshTooltip = styled.div`
  ${({ theme }) => css`
    height: auto;
    margin: ${theme.sizeUnit}px 0;
    color: ${theme.colorTextLabel};
    line-height: 21px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
  `}
`;

const getScreenshotNodeSelector = (chartId: string | number) =>
  `.dashboard-chart-id-${chartId}`;

const VerticalDotsTrigger = () => {
  const theme = useTheme();
  return (
    <Icons.EllipsisOutlined
      css={css`
        transform: rotate(90deg);
        &:hover {
          cursor: pointer;
        }
      `}
      iconSize="xl"
      iconColor={theme.colorTextLabel}
      className="dot"
    />
  );
};

export interface SliceHeaderControlsProps {
  slice: {
    description: string;
    viz_type: string;
    slice_name: string;
    slice_id: number;
    slice_description: string;
    datasource: string;
  };

  defaultOpen?: boolean;
  componentId: string;
  dashboardId: number;
  chartStatus: string;
  isCached: boolean[];
  cachedDttm: string[] | null;
  queriedDttm?: string | null;
  isExpanded?: boolean;
  updatedDttm: number | null;
  isFullSize?: boolean;
  isDescriptionExpanded?: boolean;
  formData: QueryFormData;
  exploreUrl: string;

  forceRefresh: (sliceId: number, dashboardId: number) => void;
  logExploreChart?: (sliceId: number) => void;
  logEvent?: (eventName: string, eventData?: object) => void;
  toggleExpandSlice?: (sliceId: number) => void;
  exportCSV?: (sliceId: number) => void;
  exportPivotCSV?: (sliceId: number) => void;
  exportFullCSV?: (sliceId: number) => void;
  exportXLSX?: (sliceId: number) => void;
  exportFullXLSX?: (sliceId: number) => void;
  handleToggleFullSize: () => void;
  exportPivotExcel?: (tableSelector: string, sliceName: string) => void;

  addDangerToast: (message: string) => void;
  addSuccessToast: (message: string) => void;

  supersetCanExplore?: boolean;
  supersetCanShare?: boolean;
  supersetCanCSV?: boolean;

  crossFiltersEnabled?: boolean;
}
type SliceHeaderControlsPropsWithRouter = SliceHeaderControlsProps &
  RouteComponentProps;

const dropdownIconsStyles = css`
  &&.anticon > .anticon:first-child {
    margin-right: 0;
    vertical-align: 0;
  }
`;

const SliceHeaderControls = (
  props: SliceHeaderControlsPropsWithRouter | SliceHeaderControlsProps,
) => {
  const [drillModalIsOpen, setDrillModalIsOpen] = useState(false);
  // setting openKeys undefined falls back to uncontrolled behaviour
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [valueOptions, setValueOptions] = useState<string[]>([]);
  const [loadingValues, setLoadingValues] = useState(false);
//  const [operator, setOperator] = useState<string | null>(null);
  const [operator, setOperator] = useState<
  '==' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN' | null
>(null);
  const [value, setValue] = useState<string | string[]>('');
  const [timeRange, setTimeRange] = useState<string>('No filter');
  const [frame, setFrame] = useState<FrameType>('No filter');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // Separate state for the calendar (time-only) filter modal
  const [isCalendarFilterOpen, setIsCalendarFilterOpen] = useState(false);
  const [calendarColumn, setCalendarColumn] = useState<string | null>(null);
  const [calendarTimeRange, setCalendarTimeRange] = useState<string>('No filter');
  const [calendarFrame, setCalendarFrame] = useState<FrameType>('No filter');
  const [openScopingModal, scopingModal] = useCrossFiltersScopingModal(
    props.slice.slice_id,
  );
  const history = useHistory();
  const dispatch = useDispatch();

  const queryMenuRef: RefObject<any> = useRef(null);
  const resultsMenuRef: RefObject<any> = useRef(null);
  const menuButtonRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);  

  const [modalFilters, setFilters] = useState<BinaryQueryObjectFilterClause[]>(
    [],
  );
  // Snapshot of the chart's original adhoc_filters captured on first mount.
  // The Chart Filters modal's Clear all button reverts to this value so the
  // chart's built-in (explore-configured) filters are preserved.
  const originalAdhocFiltersRef = useRef(props.formData.adhoc_filters || []);
  // Snapshot the chart's original time_range too. Clear all needs to restore
  // it because the temporal onOk branch overrides time_range when applying a
  // TEMPORAL_RANGE filter.
  const originalTimeRangeRef = useRef(
    (props.formData as any).time_range ?? 'No filter',
  );
  const theme = useTheme();

  const canEditCrossFilters =
    useSelector<RootState, boolean>(
      ({ dashboardInfo }) => dashboardInfo.dash_edit_perm,
    ) &&
    getChartMetadataRegistry()
      .get(props.slice.viz_type)
      ?.behaviors?.includes(Behavior.InteractiveChart);
  const canExplore = props.supersetCanExplore;
  const { canDrillToDetail, canViewQuery, canViewTable } = usePermissions();

  const datasetResource = useDatasetDrillInfo(
    props.slice.datasource,
    props.dashboardId,
    props.formData,
    !canDrillToDetail,
  );
  const chart = useSelector((state: RootState) => state.charts[props.slice.slice_id]);
  const datasetWithVerboseMap =
    datasetResource.status === ResourceStatus.Complete
      ? datasetResource.result
      : undefined;

  // Temporal columns must be defined first so columnOptions can exclude them.
  const temporalColumns = new Set(
    (datasetWithVerboseMap?.columns || [])
      .filter((c: any) => c?.is_dttm)
      .map((c: any) => c.column_name),
  );

  // Exclude temporal columns — time filtering is handled by the calendar icon.
  const columnOptions = Object.keys(
    datasetWithVerboseMap?.verbose_map || {}
  )
    .filter(col => !temporalColumns.has(col))
    .map(col => ({
      label: datasetWithVerboseMap?.verbose_map?.[col] || col,
      value: col,
    }));

  const isTemporal = selectedColumn
    ? temporalColumns.has(selectedColumn)
    : false;

  const refreshChart = () => {
    if (props.updatedDttm) {
      props.forceRefresh(props.slice.slice_id, props.dashboardId);
    }
  };
  
  const handleMenuClick = ({
    key,
    domEvent,
  }: {
    key: Key;
    domEvent: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
  }) => {
    switch (key) {
      case MenuKeys.ForceRefresh:
        refreshChart();
        props.addSuccessToast(t('Data refreshed'));
        break;
      case MenuKeys.ToggleChartDescription:
        // eslint-disable-next-line no-unused-expressions
        props.toggleExpandSlice?.(props.slice.slice_id);
        break;
      case MenuKeys.ExploreChart:
        // eslint-disable-next-line no-unused-expressions
        props.logExploreChart?.(props.slice.slice_id);
        if (domEvent.metaKey || domEvent.ctrlKey) {
          domEvent.preventDefault();
          window.open(props.exploreUrl, '_blank');
        } else {
          history.push(props.exploreUrl);
        }
        break;
      case MenuKeys.ExportCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportPivotCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportPivotCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.Fullscreen:
        props.handleToggleFullSize();
        break;
      case MenuKeys.ExportFullCsv:
        // eslint-disable-next-line no-unused-expressions
        props.exportFullCSV?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportFullXlsx:
        // eslint-disable-next-line no-unused-expressions
        props.exportFullXLSX?.(props.slice.slice_id);
        break;
      case MenuKeys.ExportXlsx:
        // eslint-disable-next-line no-unused-expressions
        props.exportXLSX?.(props.slice.slice_id);
        break;
      case MenuKeys.DownloadAsImage: {
        // menu closes with a delay, we need to hide it manually,
        // so that we don't capture it on the screenshot
        const menu = document.querySelector(
          '.ant-dropdown:not(.ant-dropdown-hidden)',
        ) as HTMLElement;
        if (menu) {
          menu.style.visibility = 'hidden';
        }
        downloadAsImage(
          getScreenshotNodeSelector(props.slice.slice_id),
          props.slice.slice_name,
          true,
          theme,
        )(domEvent).then(() => {
          if (menu) {
            menu.style.visibility = 'visible';
          }
        });
        props.logEvent?.(LOG_ACTIONS_CHART_DOWNLOAD_AS_IMAGE, {
          chartId: props.slice.slice_id,
        });
        break;
      }
      case MenuKeys.ExportPivotXlsx: {
        const sliceSelector = `#chart-id-${props.slice.slice_id}`;
        props.exportPivotExcel?.(
          `${sliceSelector} .pvtTable`,
          props.slice.slice_name,
        );
        break;
      }
      case MenuKeys.CrossFilterScoping: {
        openScopingModal();
        break;
      }
      case MenuKeys.ViewResults: {
        if (resultsMenuRef.current && !resultsMenuRef.current.showModal) {
          resultsMenuRef.current.open(domEvent);
        }
        break;
      }
      case MenuKeys.DrillToDetail: {
        setDrillModalIsOpen(!drillModalIsOpen);
        break;
      }
      case MenuKeys.ViewQuery: {
        if (queryMenuRef.current && !queryMenuRef.current.showModal) {
          queryMenuRef.current.open(domEvent);
        }
        break;
      }
      case MenuKeys.ChartFilters: {
        setIsFilterModalOpen(true);
        break;
      }
      case MenuKeys.ToggleCalendarFilter: {
        setCalendarColumn([...temporalColumns][0]);
        setIsCalendarFilterOpen(true);
        break;
      }
      default:
        break;
    }
    setIsDropdownVisible(false);
  };

  const {
    slice,
    isFullSize,
    cachedDttm = [],
    queriedDttm = null,
    updatedDttm = null,
    isCached = [],
  } = props;
  const isTable = slice.viz_type === VizType.Table;
  const isPivotTable = slice.viz_type === VizType.PivotTable;
  const cachedWhen = (cachedDttm || []).map(itemCachedDttm =>
    (extendedDayjs.utc(itemCachedDttm) as any).fromNow(),
  );
  const updatedWhen = updatedDttm
    ? (extendedDayjs.utc(updatedDttm) as any).fromNow()
    : '';
  const getCachedTitle = (itemCached: boolean) => {
    if (itemCached) {
      return t('Cached %s', cachedWhen);
    }
    if (updatedWhen) {
      return t('Fetched %s', updatedWhen);
    }
    return '';
  };
  const refreshTooltipData = [...new Set(isCached.map(getCachedTitle) || '')];
  // If all queries have same cache time we can unit them to one
  const refreshTooltip = refreshTooltipData.map((item, index) => (
    <div key={`tooltip-${index}`}>
      {refreshTooltipData.length > 1
        ? t('Query %s: %s', index + 1, item)
        : item}
    </div>
  ));

  const queriedLabel = queriedDttm
    ? extendedDayjs.utc(queriedDttm).local().format('L LTS')
    : null;
  const fullscreenLabel = isFullSize
    ? t('Exit fullscreen')
    : t('Enter fullscreen');

  // @z-index-below-dashboard-header (100) - 1 = 99 for !isFullSize and 101 for isFullSize
  const dropdownOverlayStyle = {
    zIndex: isFullSize ? 101 : 99,
    animationDuration: '0s',
  };

  const newMenuItems: MenuItem[] = [
    {
      key: MenuKeys.ForceRefresh,
      label: (
        <Tooltip
          title={queriedLabel ? `${t('Last queried at')}: ${queriedLabel}` : ''}
          overlayStyle={{ maxWidth: 'none' }}
        >
          <div>
            {t('Force refresh')}
            <RefreshTooltip data-test="dashboard-slice-refresh-tooltip">
              {refreshTooltip}
            </RefreshTooltip>
          </div>
        </Tooltip>
      ),
      disabled: props.chartStatus === 'loading',
      style: { height: 'auto', lineHeight: 'initial' },
      'data-test': 'refresh-chart-menu-item', // Typescript hack to get around MenuItem type
    } as any,
    {
      key: MenuKeys.Fullscreen,
      label: fullscreenLabel,
    },
    {
      type: 'item',
      key: MenuKeys.ChartFilters,
      label: t('Filters'),
    },
    ...(temporalColumns.size > 0
      ? [
          {
            type: 'item',
            key: MenuKeys.ToggleCalendarFilter,
            label: t('Calendar filter'),
          },
        ]
      : []),
    {
      type: 'divider',
    },
  ];

  if (slice.description) {
    newMenuItems.push({
      key: MenuKeys.ToggleChartDescription,
      label: props.isDescriptionExpanded
        ? t('Hide chart description')
        : t('Show chart description'),
    });
  }

  if (canExplore) {
    newMenuItems.push({
      key: MenuKeys.ExploreChart,
      label: (
        <Tooltip title={getSliceHeaderTooltip(props.slice.slice_name)}>
          {t('Edit chart')}
        </Tooltip>
      ),
      'data-test-edit-chart-name': slice.slice_name,
    } as any);
  }

  if (canEditCrossFilters) {
    newMenuItems.push({
      key: MenuKeys.CrossFilterScoping,
      label: t('Cross-filtering scoping'),
    });
  }

  if (canExplore || canEditCrossFilters) {
    newMenuItems.push({ type: 'divider' });
  }

  if (canExplore || canViewQuery) {
    newMenuItems.push({
      key: MenuKeys.ViewQuery,
      label: (
        <ModalTrigger
          triggerNode={
            <div data-test="view-query-menu-item">{t('View query')}</div>
          }
          modalTitle={t('View query')}
          modalBody={
            <ViewQueryModal
              latestQueryFormData={
                chart?.latestQueryFormData || props.formData
              }
            />
          }
          draggable
          resizable
          responsive
          ref={queryMenuRef}
        />
      ),
    });
  }

  if (canExplore || canViewTable) {
    newMenuItems.push({
      key: MenuKeys.ViewResults,
      label: (
        <ViewResultsModalTrigger
          canExplore={props.supersetCanExplore}
          exploreUrl={props.exploreUrl}
          triggerNode={
            <div data-test="view-query-menu-item">{t('View as table')}</div>
          }
          modalRef={resultsMenuRef}
          modalTitle={t('Chart Data: %s', slice.slice_name)}
          modalBody={
            <ResultsPaneOnDashboard
              queryFormData={props.formData}
              queryForce={false}
              dataSize={20}
              isRequest
              isVisible
              canDownload={!!props.supersetCanCSV}
              columnDisplayNames={datasetWithVerboseMap?.verbose_map}
              chartName={slice.slice_name}
            />
          }
        />
      ),
    });
  }

  const drillDetailMenuItems = useDrillDetailMenuItems({
    formData: props.formData,
    filters: modalFilters,
    setFilters,
    setShowModal: setDrillModalIsOpen,
    key: MenuKeys.DrillToDetail,
  });


  if (isFeatureEnabled(FeatureFlag.DrillToDetail) && canDrillToDetail) {
    newMenuItems.push(...drillDetailMenuItems);
  }

  if (slice.description || canExplore) {
    newMenuItems.push({ type: 'divider' });
  }


  if (props.supersetCanCSV) {
    newMenuItems.push({
      type: 'submenu',
      key: MenuKeys.Download,
      label: t('Download'),
      children: [
        {
          key: MenuKeys.ExportCsv,
          label: t('Export to .CSV'),
          icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
        },
        ...(isPivotTable
          ? [
              {
                key: MenuKeys.ExportPivotCsv,
                label: t('Export to Pivoted .CSV'),
                icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
              },
              {
                key: MenuKeys.ExportPivotXlsx,
                label: t('Export to Pivoted Excel'),
                icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
              },
            ]
          : []),
        {
          key: MenuKeys.ExportXlsx,
          label: t('Export to Excel'),
          icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
        },
        ...(isFeatureEnabled(FeatureFlag.AllowFullCsvExport) &&
        props.supersetCanCSV &&
        isTable
          ? [
              {
                key: MenuKeys.ExportFullCsv,
                label: t('Export to full .CSV'),
                icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
              },
              {
                key: MenuKeys.ExportFullXlsx,
                label: t('Export to full Excel'),
                icon: <Icons.FileOutlined css={dropdownIconsStyles} />,
              },
            ]
          : []),
        {
          key: MenuKeys.DownloadAsImage,
          label: t('Download as image'),
          icon: <Icons.FileImageOutlined css={dropdownIconsStyles} />,
        },
      ],
    });
  }
  
  const handleClearAllChartFilters = () => {
    const baseFormData = chart?.latestQueryFormData || props.formData;
    const updatedFormData = {
      ...baseFormData,
      adhoc_filters: originalAdhocFiltersRef.current,
      time_range: originalTimeRangeRef.current,
    };
    // Mirror the dispatch pattern used in onOk so the chart actually
    // re-renders to its original filters (not just the next fetch).
    dispatch(updateChartFormData(updatedFormData, props.slice.slice_id));
    dispatch(updateQueryFormData(updatedFormData, props.slice.slice_id));
    dispatch(
      postChartFormData(
        updatedFormData,
        true,
        undefined,
        props.slice.slice_id,
        props.dashboardId,
      ),
    );
    setSelectedColumn(null);
    setOperator(null);
    setValue('');
    setValueOptions([]);
    setTimeRange('No filter');
    setFrame('No filter');
    setIsFilterModalOpen(false);
  };

  // Clears only the temporal (TEMPORAL_RANGE) filter — leaves column filters untouched
  const handleClearCalendarFilter = () => {
    const formData = chart?.latestQueryFormData || props.formData;
    const filtered = (formData.adhoc_filters || []).filter(
      (f: any) => !(f.operator === 'TEMPORAL_RANGE'),
    );
    const updatedFormData = {
      ...formData,
      adhoc_filters: filtered,
      time_range: originalTimeRangeRef.current,
    };
    dispatch(updateChartFormData(updatedFormData, props.slice.slice_id));
    dispatch(updateQueryFormData(updatedFormData, props.slice.slice_id));
    dispatch(
      postChartFormData(
        updatedFormData,
        true,
        undefined,
        props.slice.slice_id,
        props.dashboardId,
      ),
    );
    setCalendarTimeRange('No filter');
    setCalendarFrame('No filter');
    setIsCalendarFilterOpen(false);
  };

  const applyFilterToChart = (newFilter: any) => {
	const existingFilters = props.formData.adhoc_filters || [];

  const filtered = existingFilters.filter(
    f => 'subject' in f && f.subject !== 'y_axis'
  );

  const updatedFormData = {
    ...props.formData,
    adhoc_filters: [...filtered, newFilter],
    // only for showing pills in chart UI
  ui_chart_filters: [
    ...((formData as any).ui_chart_filters || []).filter(
      (f: any) => f.subject !== newFilter.subject,
    ),
    newFilter,
  ],
  };

  console.log('Updated FormData:', updatedFormData);

  // Step 1: Update Redux state
  dispatch(
    updateQueryFormData(updatedFormData, props.slice.slice_id)
  );

  // Step 2: Tell Superset to re-run query
  dispatch(
    triggerQuery(true, props.slice.slice_id)
  );

  props.forceRefresh(props.slice.slice_id, props.dashboardId);

};

  return (
    <>
      {isFullSize && (
        <Icons.FullscreenExitOutlined
          style={{ fontSize: 22 }}
          onClick={() => {
            props.handleToggleFullSize();
          }}
        />
      )}
      {/* Separate calendar icon button — commented out; calendar filter is now in the 3-dot menu
      {temporalColumns.size > 0 && (
        <Tooltip title={t('Time filter')}>
          <Button
            buttonStyle="link"
            aria-label={t('Time filter')}
            onClick={() => {
              setCalendarColumn([...temporalColumns][0]);
              setCalendarTimeRange('No filter');
              setCalendarFrame('No filter');
              setIsCalendarFilterOpen(true);
            }}
            css={(theme: any) => css`
              padding: ${theme.sizeUnit * 2}px;
            `}
          >
            <Icons.CalendarOutlined
              iconSize="xl"
              iconColor={theme.colorTextLabel}
            />
          </Button>
        </Tooltip>
      )}
      */}
      <NoAnimationDropdown
        popupRender={() => (
          <Menu
            onClick={handleMenuClick}
            data-test={`slice_${slice.slice_id}-menu`}
            id={`slice_${slice.slice_id}-menu`}
            selectable={false}
            items={newMenuItems}
          />
        )}
        overlayStyle={dropdownOverlayStyle}
        trigger={['click']}
        placement="bottomRight"
        open={isDropdownVisible}
        onOpenChange={visible => setIsDropdownVisible(visible)}
      >
        <Button
          id={`slice_${slice.slice_id}-controls`}
          buttonStyle="link"
          aria-label={t('More Options')}
          aria-haspopup="true"
          css={theme => css`
            padding: ${theme.sizeUnit * 2}px;
            padding-right: 0px;
          `}
        >
          <VerticalDotsTrigger />
        </Button>
      </NoAnimationDropdown>
      <Modal
  title={
    <div>
      <div style={{ fontWeight: 600 }}>{t('Chart Filters')}</div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 400,
          opacity: 0.7,
          marginTop: 2,
        }}
        title={slice.slice_name}
      >
        {slice.slice_name}
      </div>
    </div>
  }
  width={520}
  centered
  open={isFilterModalOpen}
  onOk={() => {
    // Temporal branch: column is a date (is_dttm). Use DateFilterControl's
    // emitted string verbatim as the TEMPORAL_RANGE comparator — Superset's
    // backend already knows every format the picker can produce.
    if (isTemporal) {
      if (!selectedColumn || !timeRange || timeRange === 'No filter') {
        props.addDangerToast('Please pick a column and a time range');
        return;
      }
      const formData = chart?.latestQueryFormData || props.formData;
      const existingFilters = formData.adhoc_filters || [];
      const filtered = existingFilters.filter(
        f => !('subject' in f && f.subject === selectedColumn),
      );
      const newFilter: BinaryAdhocFilter = {
        clause: 'WHERE',
        subject: selectedColumn!,
        operator: 'TEMPORAL_RANGE' as any,
        comparator: timeRange,
        expressionType: 'SIMPLE',
      };
      // Also set the chart's time_range to the same value. Superset's
      // backend builds the WHERE clause for temporal columns from the
      // (from_dttm, to_dttm) bounds derived from time_range — leaving
      // time_range as "No filter" causes the TEMPORAL_RANGE filter to be
      // silently dropped from the SQL even though it's present in
      // adhoc_filters.
      const updatedFormData = {
        ...formData,
        adhoc_filters: [...filtered, newFilter],
        time_range: timeRange,
      };
      // Persist the override on the chart's form_data so the dashboard
      // Chart container re-renders with the new filter (it reads from
      // chart.form_data, not latestQueryFormData).
      dispatch(updateChartFormData(updatedFormData, props.slice.slice_id));
      dispatch(updateQueryFormData(updatedFormData, props.slice.slice_id));
      dispatch(
        postChartFormData(
          updatedFormData,
          true,
          undefined,
          props.slice.slice_id,
          props.dashboardId,
        ),
      );
      setIsFilterModalOpen(false);
      return;
    }

    const isEmptyValue =
  operator === 'IN' || operator === 'NOT IN'
    ? !Array.isArray(value) || value.length === 0
    : !value;

if (!selectedColumn || !operator || isEmptyValue) {
  props.addDangerToast('Please fill all fields');
  return;
}

    console.log('Filter:', {
      column: 'y_axis',
      operator,
      value,
    });
  //  const existingFilters = props.formData.adhoc_filters || [];
//  const chart = useSelector((state: RootState) => state.charts[props.slice.slice_id]);
  const formData = chart?.latestQueryFormData || props.formData;
  //const existingFilters = props.formData.adhoc_filters || [];
  const existingFilters = formData.adhoc_filters || [];
  const filtered = existingFilters.filter(
    f => !('subject' in f && f.subject === selectedColumn)
  );

  const newFilter: BinaryAdhocFilter = {
    clause: 'WHERE',
    subject: selectedColumn!,
    operator: (operator ?? '==') as any,
    comparator: operator === 'IN' || operator === 'NOT IN'
    ? (value as any)
    : (value as string),
    expressionType: 'SIMPLE',
   // filterOptionName: `filter_${Date.now()}`,
  };

  const updatedFormData = {
    ...formData,
    adhoc_filters: [...filtered, newFilter],
  };
  
  // Persist on chart.form_data so the dashboard Chart container re-renders
  // with the filter (it reads from chart.form_data, not latestQueryFormData).
  dispatch(updateChartFormData(updatedFormData, props.slice.slice_id));
  dispatch(updateQueryFormData(updatedFormData, props.slice.slice_id));
  dispatch(
  postChartFormData(
    updatedFormData,
    true,
    undefined,
    props.slice.slice_id,
    props.dashboardId,
  )
);
  setIsFilterModalOpen(false);
  }}
  onCancel={() => setIsFilterModalOpen(false)}
>

  {/* Clear-all (scoped to this chart's ad-hoc filters only) */}
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      marginBottom: 8,
    }}
  >
    <Button
      buttonStyle="link"
      buttonSize="small"
      onClick={handleClearAllChartFilters}
    >
      {t('Clear all')}
    </Button>
  </div>

  {/* Column (fixed) */}
  <div style={{ marginBottom: 16 }}>
    <div style={{ marginBottom: 4, fontWeight: 500 }}>Column</div>
    <Select
  placeholder="Select column"
  style={{ width: '100%' }}
  value={selectedColumn || undefined}
  onChange={
    async val => {
    setSelectedColumn(val);

    // fetch values for selected column
    setLoadingValues(true);

    try {
      // get dataset id from datasource
//      const datasourceId = props.slice.datasource.split('__')[0];
      const [datasourceId, datasourceType] = props.slice.datasource.split('__');
      const res = await SupersetClient.get({
        endpoint: `/api/v1/datasource/${datasourceType}/${datasourceId}/column/${val}/values/`,
        //endpoint: `/api/v1/dataset/${datasourceId}/values/?column_name=${val}`,
      });

      const values =
        res?.json?.result || [];
      
      setValueOptions(values);
    } catch (err) {
      console.error('Error fetching values:', err);
      setValueOptions([]);
    }

    setLoadingValues(false);
  }
  }
  options={columnOptions}
/>
  </div>

  {/* Operator + Value: only for non-temporal columns. */}
  {!isTemporal && (
    <>
      {/* Operator */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>Operator</div>
        <Select
          placeholder="Select operator"
          style={{ width: '100%' }}
          value={operator || undefined}
          onChange={val => {
                  setOperator(val);
                  setValue(val === 'IN' || val === 'NOT IN' ? [] : '');
          }}
          options={[
            { label: 'Equal to (=)', value: '==' },
            { label: 'Not Equal to (!=)', value: '!=' },
            { label: 'Greater Than (>)', value: '>' },
            { label: 'Greater or equal (>=)', value: '>=' },
            { label: 'Less Than (<)', value: '<' },
            { label: 'Less or equal (<=)', value: '<=' },
            { label: 'In', value: 'IN' },
            { label: 'Not in', value: 'NOT IN' },
          ]}
        />
      </div>

      {/* Value */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>Value</div>
        <Select
      mode={operator === 'IN' || operator === 'NOT IN' ? 'tags' : undefined}
      style={{ width: '100%' }}
      placeholder="Select or type value"
      value={
        operator === 'IN' || operator === 'NOT IN'
          ? (value as string[]) || []
          : value || undefined
      }
      onChange={(vals) => {
        if (operator === 'IN' || operator === 'NOT IN') {
          setValue(vals); // array
        } else {
          setValue(vals);
        }
      }}
      loading={loadingValues}
      showSearch
      options={valueOptions.map(v => ({ label: String(v), value: String(v) }))}
    />
      </div>
    </>
  )}

  {/* Time range: only for temporal columns (auto-detected via is_dttm).
      Renders the full "Edit time range" UI inline (Range type +
      per-frame editor), mirroring DateFilterLabel's popover content but
      without the popover wrapper so it lives directly inside the modal. */}
  {isTemporal && (
    <div style={{ marginBottom: 8 }}>
      <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('Time range')}</div>

      {/* Range type */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>{t('Range type')}</div>
        <Select
          style={{ width: '100%' }}
          options={FRAME_OPTIONS}
          value={frame}
          onChange={(val: FrameType) => {
            setFrame(val);
            if (val === 'No filter') {
              setTimeRange('No filter');
            }
          }}
        />
      </div>

      {/* The selected frame's editor */}
      {frame === 'Common' && (
        <CommonFrame value={timeRange} onChange={setTimeRange} />
      )}
      {frame === 'Calendar' && (
        <CalendarFrame value={timeRange} onChange={setTimeRange} />
      )}
      {frame === 'Current' && (
        <CurrentCalendarFrame value={timeRange} onChange={setTimeRange} />
      )}
      {frame === 'Advanced' && (
        <AdvancedFrame value={timeRange} onChange={setTimeRange} />
      )}
      {frame === 'Custom' && (
        <CustomFrame value={timeRange} onChange={setTimeRange} />
      )}
    </div>
  )}
</Modal>

      {/* ── Calendar (time-only) filter modal ── */}
      <Modal
        title={
          <div>
            <div style={{ fontWeight: 600 }}>{t('Calendar Filter')}</div>
            <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
              {slice.slice_name}
            </div>
          </div>
        }
        width={520}
        centered
        open={isCalendarFilterOpen}
        onOk={() => {
          if (!calendarColumn || !calendarTimeRange || calendarTimeRange === 'No filter') {
            props.addDangerToast(t('Please pick a time range'));
            return;
          }
          const formData = chart?.latestQueryFormData || props.formData;
          const filtered = (formData.adhoc_filters || []).filter(
            (f: any) => !(f.subject === calendarColumn),
          );
          const newFilter: BinaryAdhocFilter = {
            clause: 'WHERE',
            subject: calendarColumn!,
            operator: 'TEMPORAL_RANGE' as any,
            comparator: calendarTimeRange,
            expressionType: 'SIMPLE',
          };
          const updatedFormData = {
            ...formData,
            adhoc_filters: [...filtered, newFilter],
            time_range: calendarTimeRange,
          };
          dispatch(updateChartFormData(updatedFormData, props.slice.slice_id));
          dispatch(updateQueryFormData(updatedFormData, props.slice.slice_id));
          dispatch(
            postChartFormData(
              updatedFormData,
              true,
              undefined,
              props.slice.slice_id,
              props.dashboardId,
            ),
          );
          setIsCalendarFilterOpen(false);
        }}
        onCancel={() => setIsCalendarFilterOpen(false)}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button buttonStyle="link" buttonSize="small" onClick={handleClearCalendarFilter}>
            {t('Clear')}
          </Button>
        </div>

        {/* Show column picker only when there are multiple temporal columns */}
        {temporalColumns.size > 1 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('Column')}</div>
            <Select
              style={{ width: '100%' }}
              value={calendarColumn || undefined}
              onChange={(val: string) => setCalendarColumn(val)}
              options={[...temporalColumns].map(col => ({
                label: datasetWithVerboseMap?.verbose_map?.[col] || col,
                value: col,
              }))}
            />
          </div>
        )}

        {/* Time range picker */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('Select Time range')}</div>
          <div style={{ marginBottom: 12 }}>
            <Select
              style={{ width: '100%' }}
              options={FRAME_OPTIONS}
              value={calendarFrame}
              onChange={(val: FrameType) => {
                setCalendarFrame(val);
                if (val === 'No filter') setCalendarTimeRange('No filter');
              }}
            />
          </div>
          {calendarFrame === 'Common' && (
            <CommonFrame value={calendarTimeRange} onChange={setCalendarTimeRange} />
          )}
          {calendarFrame === 'Calendar' && (
            <CalendarFrame value={calendarTimeRange} onChange={setCalendarTimeRange} />
          )}
          {calendarFrame === 'Current' && (
            <CurrentCalendarFrame value={calendarTimeRange} onChange={setCalendarTimeRange} />
          )}
          {calendarFrame === 'Advanced' && (
            <AdvancedFrame value={calendarTimeRange} onChange={setCalendarTimeRange} />
          )}
          {calendarFrame === 'Custom' && (
            <CustomFrame value={calendarTimeRange} onChange={setCalendarTimeRange} />
          )}
        </div>
      </Modal>

      <DrillDetailModal
        formData={props.formData}
        initialFilters={[]}
        onHideModal={() => {
          setDrillModalIsOpen(false);
        }}
        chartId={slice.slice_id}
        showModal={drillModalIsOpen}
        dataset={datasetWithVerboseMap}
      />

      {canEditCrossFilters && scopingModal}
    </>
  );
};

export default SliceHeaderControls;
