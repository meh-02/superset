# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
from collections import Counter
from typing import Any

from flask import current_app, redirect, request
from flask_appbuilder import expose, permission_name
from flask_appbuilder.api import rison
from flask_appbuilder.security.decorators import has_access, has_access_api
from flask_babel import _
from marshmallow import ValidationError
from sqlalchemy.exc import NoResultFound, NoSuchTableError

from superset import db, event_logger, security_manager
from superset.commands.dataset.exceptions import (
    DatasetForbiddenError,
    DatasetNotFoundError,
)
from superset.commands.utils import populate_owner_list
from superset.connectors.sqla.models import SqlaTable
from superset.connectors.sqla.utils import get_physical_table_metadata
from superset.daos.dashboard import DashboardDAO
from superset.daos.dataset import DatasetDAO
from superset.daos.datasource import DatasourceDAO
from superset.exceptions import SupersetException, SupersetSecurityException
from superset.models.core import Database
from superset.sql.parse import Table
from superset.superset_typing import FlaskResponse
from superset.utils import json
from superset.utils.core import DatasourceType
from superset.views.base import (
    api,
    BaseSupersetView,
    deprecated,
    generate_download_headers,
    json_error_response,
    XlsxResponse,
    CsvResponse,
)
from superset.views.datasource.schemas import (
    ExternalMetadataParams,
    ExternalMetadataSchema,
    get_external_metadata_schema,
    SamplesDownloadRequestSchema,
    SamplesPayloadSchema,
    SamplesRequestSchema,
)
from superset.views.datasource.utils import get_samples
from superset.views.error_handling import handle_api_exception
from superset.views.utils import sanitize_datasource_data


class Datasource(BaseSupersetView):
    """Datasource-related views"""

    @expose("/save/", methods=("POST",))
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.save",
        log_to_statsd=False,
    )
    @has_access_api
    @api
    @handle_api_exception
    @deprecated(new_target="/api/v1/dataset/<int:pk>")
    def save(self) -> FlaskResponse:
        data = request.form.get("data")
        if not isinstance(data, str):
            return json_error_response(_("Request missing data field."), status=500)

        datasource_dict = json.loads(data)
        normalize_columns = datasource_dict.get("normalize_columns", False)
        always_filter_main_dttm = datasource_dict.get("always_filter_main_dttm", False)
        datasource_dict["normalize_columns"] = normalize_columns
        datasource_dict["always_filter_main_dttm"] = always_filter_main_dttm
        datasource_id = datasource_dict.get("id")
        datasource_type = datasource_dict.get("type")
        database_id = datasource_dict["database"].get("id")
        orm_datasource = DatasourceDAO.get_datasource(
            DatasourceType(datasource_type), datasource_id
        )
        orm_datasource.database_id = database_id

        if "owners" in datasource_dict and orm_datasource.owner_class is not None:
            # Check ownership
            try:
                security_manager.raise_for_ownership(orm_datasource)
            except SupersetSecurityException as ex:
                raise DatasetForbiddenError() from ex

        datasource_dict["owners"] = populate_owner_list(
            datasource_dict["owners"], default_to_user=False
        )

        duplicates = [
            name
            for name, count in Counter(
                [col["column_name"] for col in datasource_dict["columns"]]
            ).items()
            if count > 1
        ]
        if duplicates:
            return json_error_response(
                _(
                    "Duplicate column name(s): %(columns)s",
                    columns=",".join(duplicates),
                ),
                status=409,
            )
        orm_datasource.update_from_object(datasource_dict)
        data = orm_datasource.data
        db.session.commit()  # pylint: disable=consider-using-transaction

        return self.json_response(sanitize_datasource_data(data))

    @expose("/get/<datasource_type>/<datasource_id>/")
    @has_access_api
    @api
    @handle_api_exception
    @deprecated(new_target="/api/v1/dataset/<int:pk>")
    def get(self, datasource_type: str, datasource_id: int) -> FlaskResponse:
        datasource = DatasourceDAO.get_datasource(
            DatasourceType(datasource_type), datasource_id
        )
        return self.json_response(sanitize_datasource_data(datasource.data))

    @expose("/external_metadata/<datasource_type>/<datasource_id>/")
    @has_access_api
    @api
    @handle_api_exception
    def external_metadata(
        self, datasource_type: str, datasource_id: int
    ) -> FlaskResponse:
        """Gets column info from the source system"""
        datasource = DatasourceDAO.get_datasource(
            DatasourceType(datasource_type),
            datasource_id,
        )
        try:
            external_metadata = datasource.external_metadata()
        except SupersetException as ex:
            return json_error_response(str(ex), status=400)
        return self.json_response(external_metadata)

    @expose("/external_metadata_by_name/")
    @has_access_api
    @api
    @handle_api_exception
    @rison(get_external_metadata_schema)
    def external_metadata_by_name(self, **kwargs: Any) -> FlaskResponse:
        """Gets table metadata from the source system and SQLAlchemy inspector"""
        try:
            params: ExternalMetadataParams = ExternalMetadataSchema().load(
                kwargs.get("rison")
            )
        except ValidationError as err:
            return json_error_response(str(err), status=400)

        datasource = SqlaTable.get_datasource_by_name(
            database_name=params["database_name"],
            catalog=params.get("catalog_name"),
            schema=params["schema_name"],
            datasource_name=params["table_name"],
        )
        try:
            if datasource is not None:
                # Get columns from Superset metadata
                external_metadata = datasource.external_metadata()
            else:
                # Use the SQLAlchemy inspector to get columns
                database = (
                    db.session.query(Database)
                    .filter_by(database_name=params["database_name"])
                    .one()
                )
                external_metadata = get_physical_table_metadata(
                    database=database,
                    table=Table(params["table_name"], params["schema_name"]),
                    normalize_columns=params.get("normalize_columns") or False,
                )
        except (NoResultFound, NoSuchTableError) as ex:
            raise DatasetNotFoundError() from ex
        return self.json_response(external_metadata)

    @expose("/samples", methods=("POST",))
    @has_access_api
    @api
    @handle_api_exception
    def samples(self) -> FlaskResponse:
        try:
            params = SamplesRequestSchema().load(request.args)
            payload = SamplesPayloadSchema().load(request.json)
        except ValidationError as err:
            return json_error_response(err.messages, status=400)

        if security_manager.is_guest_user():
            if not params["dashboard_id"]:
                return json_error_response(_("Forbidden"), status=403)
            dataset = DatasetDAO.find_by_id(
                params["datasource_id"], skip_base_filter=True
            )
            dashboard = DashboardDAO.find_by_id(
                params["dashboard_id"], skip_base_filter=True
            )
            if not (dashboard and dataset):
                return self.response_404()
            if not security_manager.can_drill_dataset_via_dashboard_access(
                dataset,
                dashboard,
            ):
                return json_error_response(_("Forbidden"), status=403)

        rv = get_samples(
            datasource_type=params["datasource_type"],
            datasource_id=params["datasource_id"],
            force=params["force"],
            page=params["page"],
            per_page=params["per_page"],
            payload=payload,
        )
        return self.json_response({"result": rv})

    @expose("/samples/download", methods=("POST",))
    @has_access_api
    @permission_name("samples")
    @api
    @handle_api_exception
    def samples_download(self) -> FlaskResponse:
        """Stream the drill-detail dataset as a single xlsx/csv file so the
        browser doesn't have to stitch together hundreds of paginated JSON
        responses. Uses the same auth checks as /samples."""
        import pandas as pd

        from superset.utils.core import GenericDataType
        from superset.utils.excel import apply_column_types, df_to_excel
        from superset.utils.csv import df_to_escaped_csv

        try:
            params = SamplesDownloadRequestSchema().load(request.args)
            payload = SamplesPayloadSchema().load(request.json)
        except ValidationError as err:
            return json_error_response(err.messages, status=400)

        if security_manager.is_guest_user():
            if not params["dashboard_id"]:
                return json_error_response(_("Forbidden"), status=403)
            dataset = DatasetDAO.find_by_id(
                params["datasource_id"], skip_base_filter=True
            )
            dashboard = DashboardDAO.find_by_id(
                params["dashboard_id"], skip_base_filter=True
            )
            if not (dashboard and dataset):
                return self.response_404()
            if not security_manager.can_drill_dataset_via_dashboard_access(
                dataset,
                dashboard,
            ):
                return json_error_response(_("Forbidden"), status=403)

        samples_row_limit = current_app.config.get("SAMPLES_ROW_LIMIT", 1000)
        rv = get_samples(
            datasource_type=params["datasource_type"],
            datasource_id=params["datasource_id"],
            force=params["force"],
            page=1,
            per_page=samples_row_limit,
            payload=payload,
        )

        columns = rv.get("colnames") or []
        coltypes_raw = rv.get("coltypes") or []
        data = rv.get("data") or []

        # Drop columns the dataset owner has hidden from Drill to Detail via
        # the per-column toggle. `is_drill_to_detail=False` means the column
        # should not appear in the downloaded file, matching the modal UI.
        try:
            datasource = DatasourceDAO.get_datasource(
                datasource_type=params["datasource_type"],
                database_id_or_uuid=str(params["datasource_id"]),
            )
            disabled_cols = {
                c.column_name
                for c in getattr(datasource, "columns", [])
                if getattr(c, "is_drill_to_detail", True) is False
            }
        except Exception:  # noqa: BLE001
            disabled_cols = set()
        if disabled_cols:
            kept = [
                (name, coltype)
                for name, coltype in zip(
                    columns, coltypes_raw or [None] * len(columns), strict=False
                )
                if name not in disabled_cols
            ]
            columns = [name for name, _ in kept]
            coltypes_raw = [ct for _, ct in kept if ct is not None]

        df = pd.DataFrame(data, columns=columns) if columns else pd.DataFrame(data)

        if coltypes_raw:
            coltypes = [GenericDataType(c) for c in coltypes_raw]
            df = apply_column_types(df, coltypes)

        filename = params.get("filename") or "drill-to-detail"
        fmt = params["format"]
        if fmt == "csv":
            csv_data = df_to_escaped_csv(
                df, index=False, **current_app.config["CSV_EXPORT"]
            )
            return CsvResponse(
                csv_data, headers=generate_download_headers("csv", filename)
            )

        xlsx_data = df_to_excel(df, index=False)
        return XlsxResponse(
            xlsx_data, headers=generate_download_headers("xlsx", filename)
        )


class DatasetEditor(BaseSupersetView):
    route_base = "/dataset"
    class_permission_name = "Dataset"

    @expose("/add/")
    @has_access
    @permission_name("read")
    def root(self) -> FlaskResponse:
        return super().render_app_template()

    @expose("/<pk>", methods=("GET",))
    @has_access
    @permission_name("read")
    # pylint: disable=unused-argument
    def show(self, pk: int) -> FlaskResponse:
        dev = request.args.get("testing")
        if dev is not None:
            return super().render_app_template()
        return redirect("/")
