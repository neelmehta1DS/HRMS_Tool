from sqlalchemy.orm import Session
from models.users import User, RoleLevel


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
        "role_level": RoleLevel.l2_lead,
        "manager_id": None,
        "refresh_token": "dummy string",
        "slack_user_id": "U08NGTQRXBL",
        "in_office": True,
    })

    abhi = upsert_user(db, {
        "email": "abhishek.jain@1digitalstack.com",
        "name": "Abhishek Jain",
        "role": "Tech Lead",
        "role_level": RoleLevel.l2_lead,
        "manager_id": None,
        "refresh_token": "dummy string",
        "slack_user_id": "U01RQ34K9B4",
        "in_office": True,
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
        "in_office": True,
    })

    sai = upsert_user(db, {
        "email": "k.sai.tejeshwar@1digitalstack.ai",
        "name": "Sai Tejeshwar",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U09JW1R9GJW",
        "in_office": True,
    })

    achal = upsert_user(db, {
        "email": "achal.lalwani@1digitalstack.ai",
        "name": "Achal Lalwani",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ADUL97P8F",
        "in_office": True,
    })

    juhi = upsert_user(db, {
        "email": "juhi.sharma@1digitalstack.ai",
        "name": "Juhi Sharma",
        "role": "QA Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AGTCNJ8AD",
        "in_office": True,
    })

    siya = upsert_user(db, {
        "email": "siya.jain@1digitalstack.ai",
        "name": "Siya Jain",
        "role": "PM",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0228BG7AGL",
        "in_office": True,
    })

    nijo = upsert_user(db, {
        "email": "nijo.noble@1digitalstack.ai",
        "name": "Nijo Noble",
        "role": "Backend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035S8Z1Z1N",
        "in_office": True,
    })

    gautam = upsert_user(db, {
        "email": "gautam.patil@1digitalstack.ai",
        "name": "Gautam Patil",
        "role": "Backend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0A6D61AT1C",
        "in_office": True,
    })

    vaheed = upsert_user(db, {
        "email": "masood.vaheed@1digitalstack.ai",
        "name": "Masood Vaheed",
        "role": "Frontend Lead",
        "role_level": RoleLevel.l1_manager,
        "manager_id": ad.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U035TALQ57X",
        "in_office": True,
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
        "in_office": True,
    })

    manas = upsert_user(db, {
        "email": "manas.pachauri@1digitalstack.ai",
        "name": "Manas Pachauri",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": nijo.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0ATS4VCXMH",
        "in_office": True,
    })

    sarvesh = upsert_user(db, {
        "email": "sarvesh.rajpure@1digitalstack.ai",
        "name": "Sarvesh Rajpure",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": vaheed.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U07S9U441FU",
        "in_office": True,
    })

    arun = upsert_user(db, {
        "email": "arun.kumar@1digitalstack.ai",
        "name": "Arun Kumar",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": vaheed.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U0AQYLZS42J",
        "in_office": True,
    })

    Neel = upsert_user(db, {
        "email": "neel.mehta@1digitalstack.ai",
        "name": "Neel Mehta",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": siya.id,
        "refresh_token": "",
        "slack_user_id": "U0B8UBBTPRT",
        "in_office": True,
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
        "in_office": True,
    })

    manoj = upsert_user(db, {
        "email": "manoj.kumar@1digitalstack.ai",
        "name": "Manoj Kumar",
        "role": "",
        "role_level": RoleLevel.ic,
        "manager_id": abhi.id,
        "refresh_token": "dummy string",
        "slack_user_id": "U04JP86DPMW",
        "in_office": True,
    })