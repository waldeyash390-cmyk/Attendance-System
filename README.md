# attendance-system

Face-recognition based college attendance system.

## Stack
- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: PostgreSQL
- Face recognition: face-api.js (in-browser)

## Folder layout
```
attendance-system/
  client/    React + Vite frontend
  server/    Express API
```

## Quick start

### Backend
```
cd server
cp .env.example .env
npm install
npm run dev
```
Server runs on http://localhost:4000.
Health check: http://localhost:4000/api/health

### Frontend
```
cd client
npm install
npm run dev
```
App runs on http://localhost:5173.
