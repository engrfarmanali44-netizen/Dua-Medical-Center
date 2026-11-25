"""Other income (consultation fees, donations, rent received, capital / opening cash).

Revision ID: 20261125_0012
Revises: 20261125_0011
"""
from alembic import op
import sqlalchemy as sa

revision = '20261125_0012'
down_revision = '20261125_0011'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('other_incomes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('income_number', sa.String(length=50), nullable=False),
    sa.Column('income_date', sa.Date(), nullable=False),
    sa.Column('category', sa.String(length=20), nullable=False),
    sa.Column('description', sa.String(length=300), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('payment_method', sa.String(length=30), nullable=False),
    sa.Column('received_from', sa.String(length=160), nullable=True),
    sa.Column('reference', sa.String(length=100), nullable=True),
    sa.Column('recorded_by', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("category IN ('CONSULTATION','LAB','PROCEDURE','DONATION','RENT_RECEIVED','CAPITAL','OPENING_BALANCE','OTHER')", name='ck_income_category'),
    sa.CheckConstraint('amount > 0', name='ck_income_amount'),
    sa.ForeignKeyConstraint(['recorded_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('income_number')
    )
    op.create_index(op.f('ix_other_incomes_income_date'), 'other_incomes', ['income_date'], unique=False)
    # Same rule as every other table: Row Level Security on, no policies (only the API reaches the data).
    op.execute("ALTER TABLE other_incomes ENABLE ROW LEVEL SECURITY")


def downgrade():
    op.drop_index(op.f('ix_other_incomes_income_date'), table_name='other_incomes')
    op.drop_table('other_incomes')
