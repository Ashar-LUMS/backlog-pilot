# Backlog Pilot – Functional Specification

## 1. Overview
Backlog Pilot is a lightweight web application for capturing and tracking software delivery work across the standard delivery stages. Teams create simple project backlogs secured by shareable secret keys, avoiding account management while still keeping boards private.

## 2. Goals & Non-Goals
- **Goals**
  - Provide a Trello-style board with four fixed columns: Backlog, In Progress, Review, Done.
  - Enable rapid project creation and access via user-defined secret keys.
  - Support card CRUD, drag-and-drop reordering, and inline editing with an intuitive UI.
  - Persist data on disk so it survives restarts without external database dependencies.
- **Non-Goals**
  - Multi-tenant authentication/authorization, user accounts, or per-user permissions.
  - Column customization beyond the four predefined stages.
  - Real-time multi-user syncing or push notifications.
  - Advanced analytics, reporting, or third-party integrations.

## 3. Actors & Assumptions
- **Actors**: Any collaborator who knows the project’s secret key (no role distinction).
- **Assumptions**
  - Users trust one another to share secrets securely out-of-band.
  - The application runs in a controlled environment where file-system persistence is acceptable.
  - Only modern browsers are targeted (ES2019+).

## 4. Functional Requirements
1. **Project Creation**
   - Users can create a project by providing a human-friendly name and unique secret key.
   - The backend rejects duplicate secret keys.
   - Response returns the project metadata (ID, name, created timestamp) without exposing the secret key.
2. **Project Access**
   - Users can open an existing project by entering the secret key.
   - Users can also open a project through invite links containing the project ID, entering only the secret.
   - Successful access persists the secret locally so the board reloads automatically on revisit.
3. **Project Switching & Deletion**
   - Users can clear the active project (e.g., “Switch project”) which removes the cached secret.
   - Optional deletion endpoint removes a project and its cards when invoked with the correct secret.
4. **Board Visualization**
   - The UI presents four columns with realtime counts per column.
   - Each card displays title, optional description, creation date, and edit/delete controls.
5. **Card Management**
   - Users can create cards within any column, providing at least a title.
   - Users can edit titles/descriptions inline and delete cards.
   - Drag-and-drop allows moving cards within or across columns; order persists to the backend.
6. **Error Handling & Messaging**
   - Client surfaces API errors (e.g., invalid secret, duplicate key) via inline messages.
   - Optimistic updates roll back if the API call fails.

## 5. Data Model
### Project
| Field       | Type    | Notes                               |
|-------------|---------|-------------------------------------|
| id          | UUID    | Generated server-side               |
| name        | string  | Required, trimmed                   |
| secretKey   | string  | Required, stored hashed? (No; plain for MVP) |
| createdAt   | ISO8601 | Set on creation                     |

### Item
| Field       | Type    | Notes                               |
|-------------|---------|-------------------------------------|
| id          | UUID    | Generated server-side               |
| projectId   | UUID    | FK to project                       |
| title       | string  | Required                            |
| description | string  | Optional                            |
| status      | enum    | One of backlog, in_progress, review, done |
| position    | number  | Column-relative ordering            |
| createdAt   | ISO8601 | Set on creation                     |
| updatedAt   | ISO8601 | Set on updates                      |

Data persists in `server/data/database.json`.

## 6. APIs
All project-specific routes require `x-project-secret` header.

| Method | Path                                       | Purpose                                 | Notes |
|--------|---------------------------------------------|-----------------------------------------|-------|
| POST   | `/api/projects`                             | Create a project                        | Body: `{ name, secretKey }` |
| POST   | `/api/access`                               | Fetch project info by secret            | Body: `{ secretKey }` |
| GET    | `/api/projects/:projectId`                  | Get project metadata                    | Header: `x-project-secret` |
| DELETE | `/api/projects/:projectId`                  | Delete project and associated cards     | Header required |
| GET    | `/api/projects/:projectId/items`            | List cards grouped by status            | Header required |
| POST   | `/api/projects/:projectId/items`            | Create a card                           | Body: `{ title, description?, status? }` |
| PATCH  | `/api/projects/:projectId/items/:itemId`    | Update a card                           | Partial body allowed |
| DELETE | `/api/projects/:projectId/items/:itemId`    | Delete a card                           | - |
| POST   | `/api/projects/:projectId/items/reorder`    | Persist column ordering                 | Body: `{ columns: { status: [itemIds] } }` |

## 7. User Flows
1. **Create Project** → Enter name & secret → Receive board → Copy invite link → Share.
2. **Access via Secret** → Submit secret on landing page → Load board → Cache secret locally.
3. **Access via Invite Link** → Link opens landing page with project ID prefilled → User supplies secret → Board loads and persists invitation state.
4. **Card Lifecycle** → Add card → Drag to In Progress → Edit details → Move to Review → Delete when complete.

## 8. Non-Functional Requirements
- **Performance**: Board operations should respond within 500ms under typical loads (<200 cards).
- **Reliability**: Data integrity maintained via synchronous file writes. Server restarts must not corrupt JSON.
- **Security**: Secrets transmitted over HTTPS in production; headers never logged.
- **Accessibility**: Buttons and forms are keyboard operable; contrasts meet WCAG AA.
- **Maintainability**: Code organized into modular Express routes/helpers and isolated React components.

## 9. Open Questions & Future Enhancements
- Should secret keys be hashed at rest to mitigate file compromise risk?
- Support for per-column WIP limits or custom workflows?
- Real-time collaboration (websocket updates) for multi-user editing?
- Export/import capability for backup.
