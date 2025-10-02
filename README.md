# Backlog Pilot

Backlog Pilot is a lightweight Trello-style backlog manager with four swimlanes (Backlog, In Progress, Review, Done). Each project is protected by a secret key: share the key with collaborators and they can immediately open the board. No traditional account system is required.

## ✨ Features

- Create projects with custom secret keys and share them securely.
- Four standard delivery columns with drag-and-drop card movement.
- Rich card management with descriptions, inline editing, and deletion.
- Secret key gatekeeping on every API call (provided via `x-project-secret`).
- Shareable invite links that prefill the project ID so teammates only supply the secret.
- JSON file persistence — no external database required.
- Automated server tests covering project access, backlog CRUD, and reordering.

## 🧱 Tech Stack

| Layer     | Tech                                                                 |
|-----------|----------------------------------------------------------------------|
| Frontend  | React 19 + Vite, `@hello-pangea/dnd`, modern CSS with glassmorphism |
| Backend   | Node.js + Express 5, file-backed persistence with Node `fs`          |
| Testing   | Jest + Supertest                                                     |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Install dependencies

```powershell
cd server
npm install
cd ..\client
npm install
```

### Configure environment (optional)

The client automatically talks to `http://localhost:5000/api`. To point at a different backend, copy `.env.example` and update the URL:

```powershell
cd client
Copy-Item .env.example .env
# edit .env to set VITE_API_BASE
```

### Run the app locally

Open two terminals:

1. **API server**
   ```powershell
   cd server
   npm run dev
   ```

2. **Frontend**
   ```powershell
   cd client
   npm run dev
   ```

Visit `http://localhost:5173` and enter a project secret to open a board, or create a new project.

## ✅ Quality Gates

- **Server tests**
  ```powershell
  cd server
  npm test
  ```
- **Frontend build**
  ```powershell
  cd client
  npm run build
  ```

Both gates are green as of the latest commit.

## 🔌 API Overview

All project-specific routes expect the `x-project-secret` header.

| Method | Route                                      | Description                         |
|--------|---------------------------------------------|-------------------------------------|
| POST   | `/api/projects`                             | Create a project with secret key    |
| POST   | `/api/access`                               | Resolve a project by secret key     |
| GET    | `/api/projects/:projectId`                  | Fetch project metadata              |
| DELETE | `/api/projects/:projectId`                  | Delete a project and its items      |
| GET    | `/api/projects/:projectId/items`            | Fetch grouped backlog columns       |
| POST   | `/api/projects/:projectId/items`            | Create a backlog item               |
| PATCH  | `/api/projects/:projectId/items/:itemId`    | Update a backlog item               |
| DELETE | `/api/projects/:projectId/items/:itemId`    | Delete a backlog item               |
| POST   | `/api/projects/:projectId/items/reorder`    | Persist drag-and-drop ordering      |

Happy planning! 🗂️
