from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool
from app.core.config import settings
from app.core.database import Base

# Import model modules to register their tables on Base.metadata.
from app.modules.auth import models as auth_models  # noqa
from app.modules.hospital import models as hospital_models  # noqa
from app.modules.patients import models as patient_models  # noqa
from app.modules.pharmacy import models as pharmacy_models  # noqa
from app.modules.billing import models as billing_models  # noqa
from app.modules.audit import models as audit_models  # noqa
from app.modules.auth import models_extra as auth_extra_models  # noqa
from app.modules.visits import models as visit_models  # noqa
from app.modules.attendance import models as attendance_models  # noqa
from app.modules.chat import models as chat_models  # noqa
from app.modules.reviews import models as review_models  # noqa
from app.modules.requests import models as request_models  # noqa
from app.modules.inventory import models as inventory_models  # noqa
from app.modules.finance import models as finance_models  # noqa

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
