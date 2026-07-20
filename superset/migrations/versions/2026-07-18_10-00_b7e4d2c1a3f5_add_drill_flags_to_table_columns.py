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
"""add drill flags to table_columns

Revision ID: b7e4d2c1a3f5
Revises: a1b2c3d4e5f6
Create Date: 2026-07-18 10:00:00.000000

"""

revision = "b7e4d2c1a3f5"
down_revision = "a1b2c3d4e5f6"

import sqlalchemy as sa
from alembic import op


def upgrade():
    with op.batch_alter_table("table_columns") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_drill_to_detail",
                sa.Boolean(),
                nullable=True,
                server_default=sa.true(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "is_drill_by",
                sa.Boolean(),
                nullable=True,
                server_default=sa.true(),
            )
        )
    # Backfill existing rows to True so behavior is unchanged for pre-existing
    # datasets. Server default handles new rows going forward.
    op.execute(
        "UPDATE table_columns SET is_drill_to_detail = true "
        "WHERE is_drill_to_detail IS NULL"
    )
    op.execute(
        "UPDATE table_columns SET is_drill_by = true WHERE is_drill_by IS NULL"
    )


def downgrade():
    with op.batch_alter_table("table_columns") as batch_op:
        batch_op.drop_column("is_drill_by")
        batch_op.drop_column("is_drill_to_detail")
