"""Create the first Admin account on a fresh (production) database.

    python -m scripts.create_initial_admin --username admin --password '<at least 12 characters>'

Roles and permissions are synced from app/core/roles.py first, so this works on an empty database.
The admin is asked to change the password on first login unless --keep-password is given.
"""
import argparse

from sqlalchemy import select

from app.core import roles as R
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserRole
from scripts.seed import sync_roles_and_permissions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True, help="Use a unique password of at least 12 characters")
    parser.add_argument("--keep-password", action="store_true",
                        help="Do not force a password change at first login (password chosen by the owner)")
    args = parser.parse_args()
    if len(args.password) < 12:
        raise SystemExit("Password must contain at least 12 characters")

    with SessionLocal.begin() as db:
        if db.scalar(select(User).where(User.username == args.username)):
            raise SystemExit("Username already exists")
        roles = sync_roles_and_permissions(db)
        user = User(username=args.username, password_hash=hash_password(args.password),
                    is_active=True, is_superuser=True, must_change_password=not args.keep_password)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=roles[R.ADMIN].id))
    print(f"Created admin account: {args.username}")


if __name__ == "__main__":
    main()
