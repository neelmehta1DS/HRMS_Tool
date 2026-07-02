from datetime import date

from sqlalchemy.orm import Session
from models.users import User, RoleLevel, OfficeStatus


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
        "email": "adithya1@1digitalstack.ai",
        "name": "AD",
        "role": "Product Lead",
        "role_level": RoleLevel.l2_lead,
        "manager_id": None,
        "is_admin": True,
        "refresh_token": "dummy string",
        "slack_user_id": "U08NGTQRXBL",
        "office_status": OfficeStatus.IN,
        "birthday": date(1990, 3, 15),
        "joining_date": date(2019, 6, 1),
    })

    abhi = upsert_user(db, {
        "email": "abhishek.jain@1digitalstack.com",
        "name": "Abhishek Jain",
        "role": "Tech Lead",
        "role_level": RoleLevel.l2_lead,
        "manager_id": None,
        "refresh_token": "dummy string",
        "slack_user_id": "U01RQ34K9B4",
        "office_status": OfficeStatus.IN,
        "birthday": date(1988, 11, 22),
        "joining_date": date(2018, 4, 10),
    })

    # =========================
    # L1 UNDER AD ONLY
    # =========================
    thisya = upsert_user(db, {
        "email": "thisya.gudupudi@1digitalstack.ai",
        "name": "Thisya",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U094ARA7RFA",
        "office_status": OfficeStatus.IN,
        "birthday": date(1995, 7, 4),
        "joining_date": date(2021, 9, 15),
    })

    sai = upsert_user(db, {
        "email": "k.sai.tejeshwar@1digitalstack.ai",
        "name": "Sai Tejeshwar",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U09JW1R9GJW",
        "office_status": OfficeStatus.IN,
        "birthday": date(1996, 1, 28),
        "joining_date": date(2022, 3, 7),
    })

    achal = upsert_user(db, {
        "email": "achal.lalwani@1digitalstack.ai",
        "name": "Achal Lalwani",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ADUL97P8F",
        "office_status": OfficeStatus.IN,
        "birthday": date(1994, 5, 19),
        "joining_date": date(2021, 1, 11),
    })

    juhi = upsert_user(db, {
        "email": "juhi.sharma@1digitalstack.ai",
        "name": "Juhi Sharma",
        "role": "QA Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AGTCNJ8AD",
        "office_status": OfficeStatus.IN,
        "birthday": date(1993, 8, 30),
        "joining_date": date(2020, 7, 20),
    })

    siya = upsert_user(db, {
        "email": "siya.jain@1digitalstack.ai",
        "name": "Siya Jain",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0228BG7AGL",
        "office_status": OfficeStatus.IN,
        "birthday": date(1997, 2, 14),
        "joining_date": date(2022, 8, 1),
    })

    nijo = upsert_user(db, {
        "email": "nijo.noble@1digitalstack.ai",
        "name": "Nijo Noble",
        "role": "Backend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035S8Z1Z1N",
        "office_status": OfficeStatus.IN,
        "birthday": date(1991, 10, 5),
        "joining_date": date(2020, 2, 17),
    })

    gautam = upsert_user(db, {
        "email": "gautam.patil@1digitalstack.ai",
        "name": "Gautam Patil",
        "role": "Backend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0A6D61AT1C",
        "office_status": OfficeStatus.IN,
        "birthday": date(1992, 12, 9),
        "joining_date": date(2021, 5, 3),
    })

    vaheed = upsert_user(db, {
        "email": "masood.vaheed@1digitalstack.ai",
        "name": "Masood Vaheed",
        "role": "Frontend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035TALQ57X",
        "office_status": OfficeStatus.IN,
        "birthday": date(1990, 6, 25),
        "joining_date": date(2019, 11, 18),
    })

    # =========================
    # ICs UNDER AD (via L1s conceptually)
    # =========================
    aman = upsert_user(db, {
        "email": "aman.negi@1digitalstack.ai",
        "name": "Aman Negi",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": nijo.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U09CNE6FZFA",
        "office_status": OfficeStatus.IN,
        "birthday": date(1999, 4, 12),
        "joining_date": date(2023, 1, 23),
    })

    manas = upsert_user(db, {
        "email": "manas.pachauri@1digitalstack.ai",
        "name": "Manas Pachauri",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": nijo.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ATS4VCXMH",
        "office_status": OfficeStatus.IN,
        "birthday": date(1998, 9, 3),
        "joining_date": date(2023, 6, 12),
    })

    sarvesh = upsert_user(db, {
        "email": "sarvesh.rajpure@1digitalstack.ai",
        "name": "Sarvesh Rajpure",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": vaheed.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U07S9U441FU",
        "office_status": OfficeStatus.IN,
        "birthday": date(2000, 7, 17),
        "joining_date": date(2024, 2, 5),
    })

    arun = upsert_user(db, {
        "email": "arun.kumar@1digitalstack.ai",
        "name": "Arun Kumar",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": vaheed.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AQYLZS42J",
        "office_status": OfficeStatus.IN,
        "birthday": date(1997, 11, 21),
        "joining_date": date(2022, 10, 10),
    })

    Neel = upsert_user(db, {
        "email": "neel.mehta@1digitalstack.ai",
        "name": "Neel Mehta",
        "role": "",
        "role_level": RoleLevel.l2_lead,
        "manager_id": None,
        "refresh_token": "",
        "slack_user_id": "U0B8UBBTPRT",
        "office_status": OfficeStatus.IN,
        "birthday": date(2006, 8, 3),
        "joining_date": date(2025, 1, 6),
    })

    Vir = upsert_user(db, {
        "email": "vir.dang@1digitalstack.ai",
        "name": "Vir Dang",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": Neel.id,
        "refresh_token": "",
        "slack_user_id": "Nothing",
        "office_status": OfficeStatus.IN,
        "birthday": date(2003, 7, 3),
        "joining_date": date(2025, 1, 6),
    })

    # =========================
    # ICs DIRECTLY UNDER ABHI
    # =========================
    asif = upsert_user(db, {
        "email": "asif.siddique@1digitalstack.ai",
        "name": "Asif Siddique",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": abhi.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0A0TRC1XUL",
        "office_status": OfficeStatus.IN,
        "birthday": date(1996, 3, 8),
        "joining_date": date(2022, 7, 4),
    })

    manoj = upsert_user(db, {
        "email": "manoj.kumar@1digitalstack.ai",
        "name": "Manoj Kumar",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": abhi.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U04JP86DPMW",
        "office_status": OfficeStatus.IN,
        "birthday": date(1995, 6, 16),
        "joining_date": date(2021, 12, 1),
    })