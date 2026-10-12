# 🚀 Real-Time Intelligent Attendance System (Backend)

### 🔐 Secure • 📡 Real-Time • ✅ Verified • ⚡ Ultra-Performant

A production-ready Node.js + Express backend designed to power a frictionless, highly-secure student attendance system. By leveraging a multi-layered verification pipeline, real-time WebSockets, robust PostgreSQL bindings, and a short-lived classroom code, this architecture is built to curb proxy attendance and device sharing. 

---

## 📌 1. Core Verification Pipeline
The core innovation is our `mark-attendance` flow, which validates student submissions sequentially in under ~80ms using minimal database connections:

1. **Identity & Email Verification**: Enforces 6-digit OTP verification via **Resend** during registration and password recovery to ensure email ownership.
2. **Session Active Validation**: Ensures strict enforcement of the 15-second submission window.
3. **Device Hardware Binding**: Locks students to a single physical device UUID (`deviceId`) permanently. Cross-device cheating triggers instant rejections.
4. **Manual Code Entry**: The faculty shows a random 4-digit code; each student types it in. The code is never sent to student devices, and a student gets 3 tries before the attempt is marked `INVALID`.
5. **Anti-Spam Race Condition Protection**: Internal Prisma interception traps high-frequency duplicate submissions (`P2002`).

## ⚡ 2. Performance & Scalability Enhancements
The architecture is aggressively optimized for **bursty traffic spikes** (e.g., a massive classroom clicking submit within the same 5 milliseconds):

- **In-Memory Zero-Latency Cache:** Utilizes an ephemeral Node.js `Map` with a 2-second TTL for active `Session` checks to entirely suppress database connection surges during peak events.
- **Relational Data Consolidation:** Condenses multi-table validity sweeps into a single, flat Prisma query, minimizing Node garbage collection overhead and maxing out the Neon database pooler efficiency.
- **B-Tree Lookups:** Ensures `deviceId` and `studentId` are fully B-Tree indexed for instant O(log N) validations without sequence scans.

---

## 🛠 3. Tech Stack Deep Dive

* **Runtime**: Node.js (v18+)
* **Framework**: Express.js
* **Database Engine**: PostgreSQL (Neon Serverless)
* **ORM Toolkit**: Prisma
* **Real-Time Layer**: Socket.IO (Event-driven broadcasts)
* **Email Engine**: Resend (Transactional OTP delivery)
* **Push Notifications**: Expo Server SDK (`expo-server-sdk`)
* **Authentication Security**: JWT (`jsonwebtoken`) & Hash logic (`bcrypt`)

---

## 📁 4. Project Architecture

The codebase adheres strictly to the Controller-Service-Route paradigm to separate HTTP transport from deep business constraints:

```text
src/
├── config/             # DB initialization & WebSocket singletons
├── controllers/        # Express handlers (Auth, Subjects, Sessions, Attendance)
├── middleware/         # Security layers: JWT checks, Role guards, Input sanitizers
├── models/             # Application structural prototypes 
├── routes/             # API definition endpoints
├── services/           # Heavy Operations: (Attendance verification, Analytics mapping, Expo notifications)
├── sockets/            # Live Socket.IO room management (subject_123, user_456)
└── app.js              # Express app boosting
server.js               # Primary HTTP execution server
tests/                  # Unit tests (node --test), no database needed
scripts/                # One-off database maintenance scripts
prisma/
 └── schema.prisma      # Central DB Schema declaration & index management
postman_collection.json # Local API blueprint testing schema
```

---

## 🚀 5. Quick Start / Local Installation

### Prerequisites
- Node.js (v18 LTS recommended)
- PostgreSQL Database URL (Local or Neon equivalent)

### Step 1: Install Dependencies
```bash
git clone <repository-url>
cd attendance-system
npm install
```

### Step 2: Environment Configuration (`.env`)
Create a `.env` dynamically configuring the connection pools:
```env
DATABASE_URL="postgresql://user:password@hostname.../db?sslmode=require&connection_limit=20&pool_timeout=15"
JWT_SECRET="your_secure_secret"
RESEND_API_KEY="re_your_api_key_from_resend"
PORT=5000
```

### Step 3: Hydrate the Database
Synchronize the Prisma models into your Postgres instance without losing structure data:
```bash
npx prisma db push
```

### Step 4: Boot up
```bash
npm run dev
# Server logs "Ready for REST and Socket.IO connections" on localhost
```

### Step 5: Run the tests
The tests replace the database and Socket.IO with fakes, so they need no setup (Node 21+):
```bash
npm test
```

---

## 📡 6. WebSocket Connectivity & Notification Flow

Socket authentication requires injecting a valid JWT as a client query parameter.

**Client Listens To:**
- `session_started` : Broadcasts to `subject_{id}` rooms with session timers and the code length immediately upon class start (the code itself is not sent).
- `session_ended` : Broadcast lock closures.
- `attendance_result` : Directed individually to `user_{id}` private rooms containing the final result (`PRESENT` or `INVALID`).
- `attendance_count` : Sent to the faculty's `user_{id}` room with the running `presentCount` for the live session.

**Expo Push Notifications:**
The backend seamlessly batches and fires out-of-band push alerts to registered Mobile devices whenever critical lifecycle events (like session activations) trigger.

---

## 📘 7. REST API Coverage

A rich **Postman Collection** is included (`postman_collection.json`) encapsulating the headers, route params, and authorization checks. 

**Critical Core Endpoints:**
- `POST /api/auth/send-signup-otp` (Request registration code)
- `POST /api/auth/verify-signup-otp` (Validate code for registration)
- `POST /api/auth/forgot-password` (Trigger password recovery code)
- `POST /api/auth/login` (Obtain Access Matrix)
- `POST /api/auth/device-change/request` and `/confirm` (Move a student account to a new phone with an email OTP, once every 30 days)
- `POST /api/sessions/start` (Initializes time bounds)
- `POST /api/sessions/:sessionId/end` (Closes the session and returns the roster; the server also closes it by itself shortly after the window)
- `GET /api/sessions/my-active` (The faculty's open session, to reopen it after an app restart)
- `POST /api/attendance/submit` (The Heavy-Lift Validation Route)
- `GET /api/attendance/subject/:subjectId/analytics` (Generates faculty attendance heat maps)

---

## 👨‍💻 Maintainer

Designed as the core brain mapping device binding and strict timeline enforcement into educational and corporate attendance verifications.
