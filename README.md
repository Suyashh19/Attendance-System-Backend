# 🚀 Real-Time Intelligent Attendance System (Backend)

### 🔐 Secure • 📡 Real-Time • 📍 Verified • ⚡ Scalable

A production-ready Node.js backend for a Real-Time Intelligent Attendance System. It eliminates proxy attendance by using a multi-layer verification pipeline, dynamic randomized codes, device binding, and GPS geofencing.

---

## 📌 1. Features Implemented

* **Dynamic Attendance Codes**: Random 3-digit codes generated per session and shuffled with fake options.
* **Multi-Layer Verification Pipeline**:
  1. **Session Active Check**: Ensures submissions only happen during an open window.
  2. **Enrollment Check**: Student must be enrolled in the subject.
  3. **Device Binding**: Locks a student to a specific physical device (`deviceId`) to prevent device-sharing fraud.
  4. **Time Validation**: ~15 seconds response window.
  5. **GPS Proximity Geofencing**: Validates student coordinates against the faculty's anchor point (~50m radius).
  6. **Code Strictness**: Validates the selected code against the actual session code.
* **Real-Time Communication**: Uses `Socket.IO` to instantly broadcast session start/end events and notify individual students of their attendance results (PRESENT/INVALID/ABSENT).
* **Role-Based Access**: Faculty vs Student permissions guarded seamlessly via middlewares.
* **Analytics Engine**: Aggregates attendance statistics per subject and per student.

---

## 🛠 2. Tech Stack

* **Runtime**: Node.js
* **Framework**: Express.js
* **Database**: PostgreSQL
* **ORM**: Prisma
* **Authentication**: JWT & bcrypt
* **Real-Time Engine**: Socket.IO

---

## 📁 3. Project Structure

```text
src/
├── config/        # Environment and DB/Socket configurations
├── controllers/   # Request handlers for Auth, Subjects, Sessions, Attendance
├── middleware/    # Global error handler, Roles, and Input Validation
├── routes/        # Express route definitions
├── services/      # Core Business Logic (Verifications, Analytics, Code Gen)
├── sockets/       # Socket.IO connection handlers and room logic
└── app.js         # Express app initialization
server.js          # HTTP server boosting Express and Socket.IO
prisma/            # Prisma Schema and Migrations
postman_collection.json # Full API Endpoints Postman Collection
```

---

## 🚀 4. Setup & Installation

### Prerequisites
- Node.js (v18+)
- PostgreSQL installed and running

### Step 1: Clone & Install Dependencies
```bash
git clone <repository-url>
cd attendance-system
npm install
```

### Step 2: Environment Variables
Create a `.env` file in the root directory:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/attendance_db?schema=public"
JWT_SECRET="your_super_secret_jwt_key"
PORT=5000
```

### Step 3: Database Setup (Prisma)
Run the Prisma migrations to create the tables in your PostgreSQL database:
```bash
npx prisma migrate dev --name init
```

*(Note: Depending on your initial setup, you may need to use `node run_migration.js` if you are applying our custom multi-model migration over an existing set).*

### Step 4: Start the Server
```bash
npm start
# or for development:
npm run dev
```
The server will boot up and log: `Ready for REST and Socket.IO connections`.

---

## 📡 5. API Documentation

We have provided a comprehensive **Postman Collection** mapping out all API endpoints, auth handling, and request bodies.
Import the `postman_collection.json` file found in the root of the repository into Postman to easily test the APIs.

**Key API Routes:**
* `POST /api/auth/register` (Register faculty/student)
* `POST /api/auth/login` (Obtain JWT)
* `POST /api/subjects` (Faculty: Create Subject)
* `POST /api/sessions/start` (Faculty: Start an active session)
* `POST /api/attendance/submit` (Student: Submit code, device ID, and GPS)

---

## ⚡ 6. Real-Time Socket Events

Clients must pass their valid JWT when connecting to the Socket server.

**Client Listens To:**
- `session_started` : Triggered when a faculty starts a session for a subject room.
- `session_ended` : Triggered when a session is closed.
- `attendance_result` : Sent to the individual student's private room with status (PRESENT/ABSENT/INVALID).

**Client Emits:**
- `join_subject { subjectId }` : To listen for session events for a specific class.
- `leave_subject { subjectId }` : To unsubscribe.

---

## 👨‍💻 Author

**Suyash Patil**

This backend serves as the robust, production-ready foundation for the **Real-Time Intelligent Attendance System**.
