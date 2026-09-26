import os
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from psycopg.rows import dict_row

DSN = os.environ.get("DATABASE_URL", "postgresql://app:app@localhost:54394/printreg")
SECRET = os.environ.get("JWT_SECRET", "print-register-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)
USERS = {
    "printer": {"role": "writer", "password_hash": pwd.hash("print123456")},
    "checker": {"role": "reader", "password_hash": pwd.hash("check123456")},
}


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id serial PRIMARY KEY,
    sheet text NOT NULL,
    cyan_mm double precision NOT NULL,
    magenta_mm double precision NOT NULL,
    status text NOT NULL,
    verdict text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    urgent boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
"""

# 急件记号在任务创建时一次性写死，之后不再随任何改动变化。
MIGRATIONS = [
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false",
]


class LoginIn(BaseModel):
    username: str
    password: str


class JobIn(BaseModel):
    sheet: str
    cyan_mm: float
    magenta_mm: float
    urgent: bool = False


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="无效令牌") from exc
    if payload.get("sub") not in USERS:
        raise HTTPException(status_code=401, detail="无效令牌")
    return {"username": payload["sub"], "role": payload.get("role")}


def require_writer(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "writer":
        raise HTTPException(status_code=403, detail="仅印刷员可送复核")
    return user


app = FastAPI(title="印刷套准复核台")


@app.on_event("startup")
def startup():
    with connect() as conn:
        conn.execute(SCHEMA)
        for migration in MIGRATIONS:
            conn.execute(migration)
        n = conn.execute("SELECT COUNT(*) AS n FROM jobs").fetchone()["n"]
        if n == 0:
            now = datetime.now(timezone.utc)
            conn.execute(
                """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, verdict, reason, created_by, created_at)
                   VALUES
                   ('封面-01', 0.05, -0.04, 'pending', '', '', 'printer', %s),
                   ('内页-09', 0.40, 0.02, 'pending', '', '', 'printer', %s)""",
                (now, now),
            )
        conn.commit()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "print-register-review"}


@app.post("/api/auth/login")
def login(body: LoginIn):
    user = USERS.get(body.username.strip())
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode({"sub": body.username.strip(), "role": user["role"], "exp": exp}, SECRET, algorithm="HS256")
    return {"access_token": token, "username": body.username.strip(), "role": user["role"]}


@app.get("/api/jobs")
def list_jobs(_user: dict = Depends(current_user)):
    with connect() as conn:
        return conn.execute(
            "SELECT id, sheet, cyan_mm, magenta_mm, status, verdict, reason, urgent, created_by "
            "FROM jobs ORDER BY id DESC"
        ).fetchall()


@app.get("/api/lanes")
def lanes(_user: dict = Depends(current_user)):
    """急件车道：急件队、普通队各按编号升序，并标出下一笔将被领走的任务。

    领取规则：先消化急件待处理，再碰普通待处理；同档按编号从小到大。
    """
    with connect() as conn:
        rows = conn.execute(
            """SELECT id, sheet, cyan_mm, magenta_mm, status, verdict, reason, urgent, created_by
               FROM jobs
               WHERE status IN ('pending', 'running')
               ORDER BY urgent DESC, id ASC"""
        ).fetchall()
    urgent_queue = [r for r in rows if r["urgent"]]
    normal_queue = [r for r in rows if not r["urgent"]]
    # running 的任务已被领取，不再是“下一笔”；下一笔取仍在排队的队首。
    next_job = next(
        (r for r in (urgent_queue + normal_queue) if r["status"] == "pending"),
        None,
    )
    return {"urgent": urgent_queue, "normal": normal_queue, "next": next_job}


@app.post("/api/jobs", status_code=202)
def enqueue(body: JobIn, user: dict = Depends(require_writer)):
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, urgent, created_by, created_at)
               VALUES (%s, %s, %s, 'pending', %s, %s, %s)
               RETURNING id, sheet, status, verdict, urgent""",
            (body.sheet.strip(), body.cyan_mm, body.magenta_mm, body.urgent,
             user["username"], datetime.now(timezone.utc)),
        ).fetchone()
        conn.commit()
    return row
