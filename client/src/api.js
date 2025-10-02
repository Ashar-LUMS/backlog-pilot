const normalizeBase = (base) => base.replace(/\/$/, '');

const API_BASE = normalizeBase(
  import.meta.env.VITE_API_BASE || 'http://localhost:5000/api'
);

async function request(path, { method = 'GET', body, secretKey } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (secretKey) {
    headers['x-project-secret'] = secretKey;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export const api = {
  createProject: ({ name, secretKey }) => request('/projects', {
    method: 'POST',
    body: { name, secretKey }
  }),
  accessProject: (secretKey) => request('/access', {
    method: 'POST',
    body: { secretKey }
  }),
  fetchProject: (projectId, secretKey) =>
    request(`/projects/${projectId}`, { secretKey }),
  fetchColumns: (projectId, secretKey) =>
    request(`/projects/${projectId}/items`, { secretKey }),
  createItem: (projectId, secretKey, item) =>
    request(`/projects/${projectId}/items`, {
      method: 'POST',
      body: item,
      secretKey
    }),
  updateItem: (projectId, secretKey, itemId, updates) =>
    request(`/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      body: updates,
      secretKey
    }),
  deleteItem: (projectId, secretKey, itemId) =>
    request(`/projects/${projectId}/items/${itemId}`, {
      method: 'DELETE',
      secretKey
    }),
  reorderItems: (projectId, secretKey, columns) =>
    request(`/projects/${projectId}/items/reorder`, {
      method: 'POST',
      body: { columns },
      secretKey
    })
};
