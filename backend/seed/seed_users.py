from datetime import date

from sqlalchemy.orm import Session
from models.users import User, OfficeStatus


# -------------------------------------------------
# UPSERT (refresh_token preserved)
# -------------------------------------------------
def upsert_user(db: Session, data: dict) -> User:
    user = db.query(User).filter(User.email == data["email"]).first()

    if user:
        existing_refresh_token = user.refresh_token

        for k, v in data.items():
            if k == "refresh_token":
                continue
            setattr(user, k, v)

        user.refresh_token = existing_refresh_token

    else:
        user = User(**data)
        db.add(user)

    db.commit()
    db.refresh(user)
    return user


# -------------------------------------------------
# SEED USERS (correct hierarchy)
# -------------------------------------------------
def seed_users(db: Session):

    # =========================
    # L2 LEADS
    # =========================
    ad = upsert_user(db, {
        "email": "adithya@1digitalstack.ai",
        "name": "AD",
        "role": "Product Lead",
        "manager_id": None,
        "is_admin": True,
        "refresh_token": "dummy string",
        "slack_user_id": "U08NGTQRXBL",
        "office_status": None,
        "birthday": date(1990, 3, 15),
        "joining_date": date(2025, 9, 8),
    })

    # =========================
    # L1 UNDER AD ONLY
    # =========================
    thisya = upsert_user(db, {
        "email": "thisya.gudupudi@1digitalstack.ai",
        "name": "Thisya",
        "role": "PM",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U094ARA7RFA",
        "office_status": None,
        "birthday": date(1995, 7, 4),
        "joining_date": date(2025, 7, 1),
    })

    sai = upsert_user(db, {
        "email": "k.sai.tejeshwar@1digitalstack.ai",
        "name": "Sai Tejeshwar",
        "role": "PM",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U09JW1R9GJW",
        "office_status": None,
        "birthday": date(1996, 1, 28),
        "joining_date": date(2025, 10, 8),
    })

    achal = upsert_user(db, {
        "email": "achal.lalwani@1digitalstack.ai",
        "name": "Achal Lalwani",
        "role": "PM",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ADUL97P8F",
        "office_status": None,
        "birthday": date(1994, 5, 19),
        "joining_date": date(2025, 7, 16),
    })

    juhi = upsert_user(db, {
        "email": "juhi.sharma@1digitalstack.ai",
        "name": "Juhi Sharma",
        "role": "QA Lead",
        "manager_id": achal.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AGTCNJ8AD",
        "office_status": None,
        "birthday": date(1993, 8, 30),
        "joining_date": date(2025, 2, 23),
    })

    siya = upsert_user(db, {
        "email": "siya.jain@1digitalstack.ai",
        "name": "Siya Jain",
        "role": "PM",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0228BG7AGL",
        "office_status": None,
        "birthday": date(1997, 2, 14),
        "joining_date": date(2026, 4, 24),
    })

    nijo = upsert_user(db, {
        "email": "nijo.noble@1digitalstack.ai",
        "name": "Nijo Noble",
        "role": "Backend Lead",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035S8Z1Z1N",
        "office_status": None,
        "birthday": date(1991, 10, 5),
        "joining_date": date(2022, 3, 11),
    })

    gautam = upsert_user(db, {
        "email": "gautam.patil@1digitalstack.ai",
        "name": "Gautam Patil",
        "role": "Backend Lead",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0A6D61AT1C",
        "office_status": None,
        "birthday": date(1992, 12, 9),
        "joining_date": date(2026, 1, 2),
    })

    vaheed = upsert_user(db, {
        "email": "masood.vaheed@1digitalstack.ai",
        "name": "Masood Vaheed",
        "role": "Frontend Lead",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035TALQ57X",
        "office_status": None,
        "birthday": date(1990, 6, 25),
        "joining_date": date(2022, 3, 7),
    })

    # =========================
    # ICs UNDER AD (via L1s conceptually)
    # =========================
    aman = upsert_user(db, {
        "email": "aman.negi@1digitalstack.ai",
        "name": "Aman Negi",
        "role": "",
        "manager_id": nijo.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U09CNE6FZFA",
        "office_status": None,
        "birthday": date(1999, 4, 12),
        "joining_date": date(2025, 8, 25),
    })

    manas = upsert_user(db, {
        "email": "manas.pachauri@1digitalstack.ai",
        "name": "Manas Pachauri",
        "role": "",
        "manager_id": nijo.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ATS4VCXMH",
        "office_status": None,
        "birthday": date(1998, 9, 3),
        "joining_date": date(2026, 4, 20),
    })

    arun = upsert_user(db, {
        "email": "arun.kumar@1digitalstack.ai",
        "name": "Arun Kumar",
        "role": "",
        "manager_id": vaheed.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AQYLZS42J",
        "office_status": None,
        "birthday": date(1997, 11, 21),
        "joining_date": date(2026, 4, 6),
    })

    Neel = upsert_user(db, {
        "email": "neel.mehta@1digitalstack.ai",
        "name": "Neel Mehta",
        "role": "",
        "manager_id": thisya.id,
        "refresh_token": "",
        "slack_user_id": "U0B8UBBTPRT",
        "office_status": None,
        "birthday": date(2006, 8, 3),
        "joining_date": date(2026, 6, 8),
    })

    Vir = upsert_user(db, {
        "email": "vir.dang@1digitalstack.ai",
        "name": "Vir Dang",
        "role": "",
        "manager_id": thisya.id,
        "refresh_token": "",
        "slack_user_id": "Nothing",
        "office_status": None,
        "birthday": date(2003, 7, 3),
        "joining_date": date(2026, 6, 8),
    })

    # =========================
    # ICs DIRECTLY UNDER ABHI
    # =========================
    asif = upsert_user(db, {
        "email": "asif.siddique@1digitalstack.ai",
        "name": "Asif Siddique",
        "role": "",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0A0TRC1XUL",
        "office_status": None,
        "birthday": date(1996, 3, 8),
        "joining_date": date(2025, 12, 2),
    })

    manoj = upsert_user(db, {
        "email": "manoj.kumar@1digitalstack.ai",
        "name": "Manoj Kumar",
        "role": "",
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U04JP86DPMW",
        "office_status": None,
        "birthday": date(1995, 6, 16),
        "joining_date": date(2023, 7, 1),
    })

    sarvesh = upsert_user(db, {
        "email": "sarvesh.rajpure@1digitalstack.ai",
        "name": "Sarvesh Rajpure",
        "role": "",
        "manager_id": asif.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U07S9U441FU",
        "office_status": None,
        "birthday": date(2000, 7, 17),
        "joining_date": date(2024, 10, 21),
    })
