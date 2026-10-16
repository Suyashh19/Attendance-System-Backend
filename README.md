# Attendance System — Backend

Node.js + Express API for a real-time classroom attendance system. A faculty member opens a 15-second attendance window, shows a 4-digit code to the class, and each student types it into the mobile app from the one phone their account is locked to.

The mobile app lives in a separate repository: [Attendance-System-App](https://github.com/Suyashh19/Attendance-System-App).

---

## How attendance is verified

`POST /api/attendance/submit` runs these checks in order (`src/services/attendanceService.js`):

1. **Session is active** — the session exists and has not been closed.
2. **Enrollment** — the student is enrolled in the subject and approved by the faculty.
3. **No duplicate** — one record per student per session; a repeat submission returns the first result.
4. **Device lock** — the first submission locks the account to that phone's device ID. Any other phone is rejected, and one phone cannot be used by two accounts.
5. **Time window** — the submission must arrive within the 15-second window (plus 2 seconds for network transit).
6. **Code** — the 4-digit code must match. The code is never sent to student devices. A student gets 3 tries before the attempt is recorded as `INVALID`.

The result is `PRESENT`, `INVALID` or `WRONG_CODE` (tries remaining). When the session closes, every approved student who did not submit is marked `ABSENT`.

### Session lifecycle

- Starting a session closes any session still open for that subject.
- The server closes a session by itself 10 seconds after its window ends, in case the faculty never taps "End".
- On startup the server picks up sessions left open by a restart and closes or re-arms them.

### Accounts

- Registration and password reset are confirmed with a 6-digit email OTP (valid for 5 minutes, one request per 30 seconds), sent through Resend.
- A student can move their account to a new phone with an email OTP, once every 30 days.
- JWTs are valid for 7 days.

---

## Tech stack

| Area | Choice |
|---|---|
| Runtime | Node.js (CommonJS) |
| Framework | Express 5 |
| Database | PostgreSQL (Neon) with Prisma 5 |
| Real-time | Socket.IO |
| Email | Resend |
| Push notifications | Expo Server SDK |
| Auth | JWT + bcrypt |
| Reports | ExcelJS |

---

## Project structure

```text
server.js                # HTTP server + Socket.IO startup
src/
├── app.js               # Express app and route mounting
├── config/              # Prisma client, Socket.IO singleton
├── controllers/         # Request handlers
├── middleware/          # JWT auth, role guard, validation, error handler
├── routes/              # Endpoint definitions
├── services/            # Attendance checks, session lifecycle, OTP, email, push, reports
└── sockets/             # Socket authentication and room handling
prisma/
├── schema.prisma        # User, Subject, Enrollment, Session, Attendance, Otp
└── migrations/
tests/                   # Unit tests (node --test), no database needed
scripts/                 # One-off database maintenance scripts
postman_collection.json  # API collection for manual testing
```

---

## Getting started

### Prerequisites

- Node.js 21 or newer (the test command relies on it)
- A PostgreSQL database URL (local or Neon)
- A Resend API key for OTP emails

### 1. Install

```bash
git clone https://github.com/Suyashh19/Attendance-System-Backend.git
cd Attendance-System-Backend
npm install
```

`npm install` also generates the Prisma client.

### 2. Configure

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://user:password@host/db?sslmode=require&connection_limit=20&pool_timeout=15"
JWT_SECRET="a_long_random_secret"
RESEND_API_KEY="re_your_key"
PORT=5000
FRONTEND_URL="https://your-web-app.vercel.app"
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Signs and verifies login tokens |
| `RESEND_API_KEY` | Yes | Sends OTP emails |
| `PORT` | No | Defaults to `5000` |
| `FRONTEND_URL` | No | Web app origin(s) allowed by CORS, comma-separated. Unset allows every origin |
| `REPORT_TIMEZONE` | No | Time zone used in Excel reports, defaults to `Asia/Kolkata` |
| `NODE_ENV` | No | `development` adds error details to API responses |

### 3. Create the tables

```bash
npx prisma db push
```

### 4. Run

```bash
npm run dev
```

The server logs `Ready for REST and Socket.IO connections` once it is listening.

### 5. Test

```bash
npm test
```

The tests replace the database and Socket.IO with fakes, so they need no setup.

---

## REST API

All routes are under `/api`. Every route except registration, login and the OTP routes needs an `Authorization: Bearer <token>` header.

### Auth — `/api/auth`

| Method | Path | Purpose |
|---|---|---|
| POST | `/send-signup-otp` | Email a registration OTP |
| POST | `/verify-signup-otp` | Check the registration OTP |
| POST | `/register` | Create an account |
| POST | `/login` | Log in and receive a JWT. Send `platform: "web"` from the web app |
| POST | `/forgot-password` | Email a password-reset OTP |
| POST | `/reset-password` | Set a new password with the OTP |
| GET | `/me` | Current user's profile |
| POST | `/update-prn` | Update the student's PRN |
| POST | `/update-password` | Change password |
| POST | `/push-token` | Save the Expo push token |
| POST | `/device-change/request` | Email an OTP to move the account to a new phone |
| POST | `/device-change/confirm` | Confirm the move |
| DELETE | `/delete-account` | Delete the account |

#### Web app access

The web app is a stand-in for iPhone faculty, so it is faculty-only:

- A login counts as web when the body has `platform: "web"` or the request carries an `Origin` header (browsers send one; the mobile app does not). Students get `403` there.
- Tokens carry a `platform` claim (`web` or `app`). A web token for anyone but faculty is refused by every protected route and by Socket.IO. Tokens without the claim predate it and are treated as app tokens.
- Sign-up (`/send-signup-otp`, `/verify-signup-otp`, `/register`) and `/device-change/*` are app-only.

### Subjects — `/api/subjects`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/` or `/my` | Any | Subjects the user teaches or is enrolled in |
| POST | `/` | Faculty | Create a subject |
| DELETE | `/:id` | Faculty | Delete a subject |

### Enrollments — `/api/enrollments`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/enroll` | Student | Request to join a subject by its code |
| DELETE | `/:subjectId/unenroll` | Student | Leave a subject |
| POST | `/` | Faculty | Enroll a student directly |
| GET | `/:subjectId` | Faculty | List a subject's enrollments |
| PUT | `/subject/:subjectId/student/:studentId/status` | Faculty | Approve or reject a request |

### Sessions — `/api/sessions`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/start` | Faculty | Open an attendance window and get the code |
| POST | `/:sessionId/end` | Faculty | Close the session and get the roster |
| GET | `/my-active` | Faculty | The faculty's open session, to reopen it after an app restart |
| GET | `/recent` | Faculty | Recent sessions |
| GET | `/:subjectId/history` | Faculty | A subject's past sessions |
| GET | `/:subjectId/active` | Any | The subject's open session, if any |

### Attendance — `/api/attendance`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/submit` | Student | Submit `{ sessionId, code, deviceId }` |
| GET | `/history` | Student | The student's attendance history |
| GET | `/subject/:subjectId/my-record` | Student | The student's record for one subject |
| GET | `/subject/:subjectId/analytics` | Faculty | Attendance statistics for a subject |
| GET | `/session/:sessionId` | Faculty | Roster for one session |
| PUT | `/session/:sessionId/student/:studentId` | Faculty | Manually change a student's status |

### Reports — `/api/analytics`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/export/:subjectId` | Faculty | Download a subject's attendance as an Excel file |

---

## Socket.IO

Connect with the JWT in the handshake (`auth: { token }`, or a `token` query parameter). Connections without a valid token are dropped. Each socket joins its private `user_{id}` room automatically.

**Client sends**

| Event | Payload | Effect |
|---|---|---|
| `join_subject` | `{ subjectId }` | Join the `subject_{id}` room |
| `leave_subject` | `{ subjectId }` | Leave it |

**Server sends**

| Event | Room | Meaning |
|---|---|---|
| `session_started` | `subject_{id}` | A window opened; carries the timers and the code length, never the code |
| `session_ended` | `subject_{id}` | The session closed |
| `attendance_result` | `user_{id}` (student) | The student's final status for the session |
| `attendance_count` | `user_{id}` (faculty) | Running count of students marked present |

Students with a saved push token also get an Expo push notification when a session starts and when their result is final.

---

## Deployment

`npm run build` installs dependencies, generates the Prisma client, drops legacy columns and pushes the schema; `npm start` runs the server.

Set `FRONTEND_URL` to the web app's URL to limit browser access, for both REST and Socket.IO. CORS does not affect the mobile app.
